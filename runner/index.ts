// ランナー：社内の Mac に常駐し、jobs から「順番待ちで実行時刻を過ぎたもの」を1件ずつ取って
// ClaudeCode（claude -p "/<type> <job_id>"）を実行し、ログと結果を Firestore に書く。
//   node runner/index.ts          常駐（launchd から起動）
//   node runner/index.ts --once   1件だけ実行して終わる（動作確認用）
//
// ClaudeCode に渡す権限は .claude/settings.json と --allowedTools で絞り、DB の読み書きは
// runner/agent-tools.ts 経由だけにする。承認・送信予約はルール上ランナーからはできない。
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { doc, runTransaction, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import type { Job } from '../src/types.ts'
import { LOG_DIR, REPO_DIR, SEND_MODE, WORK_DIR, opt } from './lib/env.ts'
import * as F from './lib/firebase.ts'

const RUNNER_ID = opt('RUNNER_ID', hostname())
const POLL_MS = Number(opt('POLL_SEC', '30')) * 1000
const MAX_MIN = Number(opt('JOB_TIMEOUT_MIN', '40'))
// 1ジョブの推定費用の上限（暴走止め）。サブスクで動かす場合も推定額で止まる
const MAX_BUDGET = opt('MAX_BUDGET_USD', '10')

// 失敗の理由を、画面に出す日本語にする
const FAIL_REASON: Record<string, string> = {
  error_max_budget_usd: `1ジョブの上限（推定 $${MAX_BUDGET}）に達したため止まりました。途中まで保存した分は残っています`,
  error_max_turns: 'やりとりの回数の上限に達したため止まりました',
  error_during_execution: '実行中にエラーが起きました',
}
const CLAUDE = opt('CLAUDE_BIN', 'claude')
// 秘密情報とコードは読ませない・書かせない（作業フォルダの信頼設定に関係なく効くよう、起動時に渡す）
const DENIED = [
  'Read(./runner/.env)',
  'Read(./.env.local)',
  'Read(~/.config/**)',
  'Read(~/.claude.json)',
  'Edit(./src/**)',
  'Edit(./runner/*.ts)',
  'Edit(./runner/lib/**)',
  'Edit(./.claude/**)',
  'Edit(./firestore.rules)',
].join(',')
const ALLOWED = [
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Edit(./runner/work/**)',
  'Bash(node runner/agent-tools.ts *)',
  'mcp__playwright',
].join(',')

mkdirSync(LOG_DIR, { recursive: true })
mkdirSync(WORK_DIR, { recursive: true })

const stamp = () => new Date().toISOString()
function log(line: string) {
  const text = `${stamp()} ${line}`
  console.log(text)
  appendFileSync(path.join(LOG_DIR, 'runner.log'), `${text}\n`)
}

// 複数のランナーが同じジョブを取らないよう、トランザクションで「順番待ち→実行中」にする
async function claim(db: Firestore): Promise<Job | null> {
  const now = Date.now()
  const due = (await F.queuedJobs(db)).filter((j) => j.runAt <= now).sort((a, b) => a.runAt - b.runAt)
  for (const j of due) {
    const got = await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, 'jobs', j.id))
      if (!snap.exists() || snap.data().status !== 'queued') return false
      tx.update(doc(db, 'jobs', j.id), { status: 'running', startedAt: now, runnerId: RUNNER_ID, logs: [{ t: now, text: `$ ${j.command}` }], plan: [] })
      return true
    })
    if (got) return { ...j, status: 'running', startedAt: now }
  }
  return null
}

// ランナーが落ちて「実行中」のまま残ったジョブを失敗にする
async function sweep(db: Firestore) {
  for (const j of await F.runningJobs(db)) {
    if (j.runnerId === RUNNER_ID && (j.startedAt ?? 0) < Date.now() - (MAX_MIN + 5) * 60_000) {
      await updateDoc(doc(db, 'jobs', j.id), { status: 'failed', finishedAt: Date.now(), error: 'ランナーの再起動により中断しました' })
      log(`中断していたジョブを失敗にしました：${j.id}`)
    }
  }
}

type Event = { type: string; subtype?: string; num_turns?: number; message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] }; result?: string; is_error?: boolean; total_cost_usd?: number; permission_denials?: unknown[] }

function describe(ev: Event): string[] {
  if (ev.type !== 'assistant') return []
  const out: string[] = []
  for (const c of ev.message?.content ?? []) {
    if (c.type === 'text' && c.text?.trim()) out.push(`▸ ${c.text.trim().split('\n')[0].slice(0, 160)}`)
    if (c.type === 'tool_use') {
      const i = c.input ?? {}
      const detail =
        c.name === 'Bash' ? String(i.command ?? '').replace(/^node runner\/agent-tools\.ts /, 'tools: ').slice(0, 140)
        : c.name === 'WebSearch' ? `検索：${String(i.query ?? '')}`
        : c.name === 'WebFetch' ? `取得：${String(i.url ?? '')}`
        : c.name?.startsWith('mcp__playwright') ? `ブラウザ：${c.name.replace('mcp__playwright__', '')} ${String(i.url ?? i.text ?? '')}`.trim()
        : c.name ?? ''
      out.push(`  · ${detail}`)
    }
  }
  return out
}

function run(db: Firestore, job: Job): Promise<{ ok: boolean; summary: string; error?: string }> {
  return new Promise((resolve) => {
    const work = path.join(WORK_DIR, job.id)
    rmSync(work, { recursive: true, force: true })
    mkdirSync(work, { recursive: true })
    const args = [
      '-p',
      `/${job.type} ${job.id}`,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'dontAsk',
      '--allowedTools', ALLOWED,
      '--disallowedTools', DENIED,
      '--max-budget-usd', MAX_BUDGET,
      '--no-session-persistence',
      ...(job.type === 'send-approved' || job.type === 'collect-leads'
        ? ['--mcp-config', path.join(REPO_DIR, 'runner', 'mcp.json'), '--strict-mcp-config']
        : ['--strict-mcp-config']),
    ]
    const child = spawn(CLAUDE, args, {
      cwd: REPO_DIR,
      env: { ...process.env, SALES_AGENT_JOB_ID: job.id, RUNNER_ID },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const logFile = path.join(LOG_DIR, `${job.id}.jsonl`)
    const lines: { t: number; text: string }[] = [{ t: job.startedAt ?? Date.now(), text: `$ ${job.command}` }]
    let pending = false
    let result: Event | undefined
    let buf = ''
    let stderr = ''
    const flush = () => {
      if (!pending) return
      pending = false
      updateDoc(doc(db, 'jobs', job.id), { logs: lines.slice(-400) }).catch((e: unknown) => log(`ログの書き込みに失敗：${String(e)}`))
    }
    const timer = setInterval(flush, 1500)
    const push = (text: string) => {
      lines.push({ t: Date.now(), text })
      pending = true
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        appendFileSync(logFile, `${line}\n`)
        let ev: Event
        try {
          ev = JSON.parse(line) as Event
        } catch {
          continue
        }
        if (ev.type === 'result') result = ev
        for (const t of describe(ev)) push(t)
      }
    })
    child.stderr.on('data', (c: Buffer) => {
      // 作業フォルダの信頼設定の警告は、許可を --allowedTools で渡しているので無視してよい
      stderr += c
        .toString()
        .split('\n')
        .filter((l) => l.trim() && !l.includes('this workspace has not been trusted'))
        .join('\n')
    })
    const killer = setTimeout(() => {
      push(`✕ ${MAX_MIN}分を超えたため中断します`)
      child.kill('SIGTERM')
    }, MAX_MIN * 60_000)
    child.on('close', (code) => {
      clearInterval(timer)
      clearTimeout(killer)
      const denied = result?.permission_denials?.length ?? 0
      if (denied) push(`▸ 許可されていない操作を ${denied} 件止めました`)
      const cost = result?.total_cost_usd != null ? `（$${result.total_cost_usd.toFixed(2)}）` : ''
      const ok = code === 0 && !!result && !result.is_error
      const summary = (result?.result ?? '').trim().split('\n').slice(-1)[0]?.slice(0, 80) ?? ''
      push(ok ? `✓ 完了${cost}` : `✕ 失敗（終了コード ${code}）${cost}`)
      flush()
      const reason = result?.subtype ? FAIL_REASON[result.subtype] : undefined
      resolve({ ok, summary, error: ok ? undefined : (reason ?? result?.result ?? stderr ?? `終了コード ${code}`).slice(-500) })
    })
  })
}

async function main() {
  const once = process.argv.includes('--once')
  const { db, email } = await F.connect()
  log(`起動：${RUNNER_ID} として ${email} でログイン（SEND_MODE=${SEND_MODE}）`)
  await sweep(db)
  let stopping = false
  process.on('SIGTERM', () => {
    stopping = true
    log('停止の指示を受けました。実行中のジョブが終わったら止まります')
  })
  while (!stopping) {
    try {
      const job = await claim(db)
      await setDoc(doc(db, 'runners', RUNNER_ID), { id: RUNNER_ID, lastPollAt: Date.now(), lastPollFound: job ? 1 : 0, sendMode: SEND_MODE }, { merge: true })
      if (job) {
        log(`開始：${job.type} ${job.id}`)
        const r = await run(db, job)
        await updateDoc(doc(db, 'jobs', job.id), {
          status: r.ok ? 'done' : 'failed',
          finishedAt: Date.now(),
          ...(r.summary && r.ok ? { summary: r.summary } : {}),
          ...(r.error ? { error: r.error } : {}),
        })
        log(`${r.ok ? '完了' : '失敗'}：${job.type} ${job.id}${r.error ? ` — ${r.error.split('\n')[0]}` : ''}`)
        if (once) break
        continue
      }
      if (once) {
        log('実行するジョブはありません')
        break
      }
    } catch (e) {
      log(`エラー：${e instanceof Error ? e.message : String(e)}`)
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  process.exit(0)
}

main().catch((e: unknown) => {
  log(`起動できませんでした：${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
