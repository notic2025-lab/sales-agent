// ClaudeCode のスラッシュコマンドから呼ぶ道具（DB の読み書き・送信ガード・Gmail）。
//   node runner/agent-tools.ts <コマンド> <job_id> [引数]
//
// 守ること
//   ・ランナーが実行中のジョブ（SALES_AGENT_JOB_ID）以外には触れない。書き込みは「実行中」のジョブでだけ行う
//   ・送るのは、人が承認して送信前の最終確認をした（＝予約済みの）文面そのものだけ。本文はここで DB から読む
//   ・送る前に毎回、時間帯・1日の上限・配信停止リスト・特定電子メール法の表示などを確かめる（src/data/checks.ts）
//   ・SEND_MODE=live にするまでは試運転（送らずに、送る予定だけを記録する）
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { doc, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { Campaign, Channel, Confidence, Insight, Job, JobType, Lead, Message, Reaction, RejectReason, Settings } from '../src/types.ts'
import { checkMessage, checkReply, emailDomain, hasError } from '../src/data/checks.ts'
import { INTRO_MAX, SUBJECT_MAX, assembleBody, casesOf, defaultSubject } from '../src/data/compose.ts'
import { REJECT_REASON, isAutoList, isAutoSend, normalizeDomain } from '../src/data/leads.ts'
import { isOpen, jstDateKey, jstDayStart, nextOpen, planSends } from '../src/data/sendPlan.ts'
import { SEND_MODE, WORK_DIR, opt } from './lib/env.ts'
import * as F from './lib/firebase.ts'
import * as gmail from './lib/gmail.ts'
import { loadHolidays } from './lib/holidays.ts'

const DAY = 86_400_000
const PLACEHOLDER = /\{\{|\}\}|〇〇|○○|◯◯|【(?:会社名|社名|企業名|氏名|担当者名|御社名)】/
// フリーメールのドメインごと止めると無関係の人まで止まるので、アドレス単位で止める
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.co.jp', 'ymail.ne.jp', 'outlook.com', 'outlook.jp', 'hotmail.com', 'hotmail.co.jp',
  'live.jp', 'icloud.com', 'me.com', 'docomo.ne.jp', 'ezweb.ne.jp', 'au.com', 'softbank.ne.jp', 'i.softbank.jp',
])

type Ctx = { db: Firestore; job: Job; campaign: Campaign; work: string }

// ──────────────────────────────────────────────
// 入出力

const print = (v: unknown) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`)

class Refused extends Error {}
const refuse = (msg: string): never => {
  throw new Refused(msg)
}

function flags(argv: string[]) {
  const pos: string[] = []
  const f: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        f[a.slice(2)] = next
        i++
      } else f[a.slice(2)] = true
    } else pos.push(a)
  }
  return { pos, f }
}

// JSON は runner/work/<job_id>/ に書いたファイル（--file）か標準入力で受け取る
function readJson<T>(ctx: Ctx, file: string | true | undefined): T {
  let text: string
  if (typeof file === 'string') {
    const p = path.resolve(file)
    if (!p.startsWith(WORK_DIR + path.sep)) refuse(`--file は runner/work/ の中のファイルを指定してください：${file}`)
    text = readFileSync(p, 'utf8')
  } else {
    text = readFileSync(0, 'utf8')
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return refuse(`JSON として読めません（${ctx.job.id}）`)
  }
}

// ジョブ内でした送信の記録（send-finish で集計する）
function record(ctx: Ctx, entry: Record<string, unknown>) {
  appendFileSync(path.join(ctx.work, 'sent.jsonl'), `${JSON.stringify({ t: Date.now(), ...entry })}\n`)
}
function records(ctx: Ctx): Record<string, unknown>[] {
  const p = path.join(ctx.work, 'sent.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
}

async function open(jobId: string | undefined, types?: JobType[], write = true): Promise<Ctx> {
  if (!jobId) refuse('job_id を指定してください')
  const expected = process.env.SALES_AGENT_JOB_ID
  if (expected && expected !== jobId) refuse(`実行中のジョブ（${expected}）以外は操作できません`)
  const { db } = await F.connect()
  const job = await F.getJob(db, jobId!)
  if (types && !types.includes(job.type)) refuse(`${job.type} のジョブでは使えません`)
  if (write && job.status !== 'running') refuse('実行中のジョブではありません（書き込みはランナーが実行しているジョブでだけ行えます）')
  const campaign = await F.getCampaign(db, job.campaignId)
  const work = path.join(WORK_DIR, job.id)
  mkdirSync(work, { recursive: true })
  return { db, job, campaign, work }
}

const kindOf = (job: Job) => ((job.payload as { kind?: string } | undefined)?.kind === 'reply' ? 'reply' : 'outreach')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const lower = (s: string) => s.trim().toLowerCase()

function suppressionKeys(lead: Pick<Lead, 'domain' | 'email'>, from?: string) {
  const keys = new Set<string>()
  if (!FREE_MAIL.has(lower(lead.domain))) keys.add(lower(lead.domain))
  for (const addr of [lead.email, from]) {
    if (!addr) continue
    keys.add(lower(addr))
    const d = emailDomain(addr)
    if (d && !FREE_MAIL.has(d)) keys.add(d)
  }
  return [...keys]
}

// ──────────────────────────────────────────────
// context：ジョブに必要な情報

async function context(jobId?: string) {
  const ctx = await open(jobId, undefined, false)
  const { db, job, campaign } = ctx
  const settings = await F.getSettings(db)
  const base = {
    job: { id: job.id, type: job.type, payload: job.payload ?? null },
    campaign,
    sender: {
      company: settings.senderCompany,
      name: settings.senderName,
      email: settings.senderEmail,
      address: settings.senderAddress ?? '',
      signature: settings.signature,
    },
    sendRules: { dailyLimit: settings.dailyLimit, sendWindow: settings.sendWindow, skipWeekendAndHolidays: settings.skipWeekend },
    today: jstDateKey(Date.now()),
    workDir: path.relative(process.cwd(), ctx.work),
    sendMode: SEND_MODE,
  }
  if (job.type === 'collect-leads') {
    const leads = await F.leadsOf(db, campaign.id)
    const recent = await F.sentSince(db, Date.now() - 90 * DAY)
    const recentLeads = await F.leadsByIds(db, recent.map((m) => m.leadId))
    // 過去にあなたが除外した理由と、前向きな返信があった企業の特徴を、次の収集の参考として渡す
    const rejected = (await F.rejectedLeads(db)).filter((l) => l.rejectReason)
    const byReason: Record<string, { label: string; count: number; examples: object[] }> = {}
    for (const l of rejected) {
      const r = l.rejectReason as RejectReason
      byReason[r] ??= { label: REJECT_REASON[r], count: 0, examples: [] }
      byReason[r].count++
      if (byReason[r].examples.length < 3) byReason[r].examples.push({ industry: l.industry, region: l.region, employees: l.employees, summary: l.summary })
    }
    const positive = await F.positiveReactions(db)
    const positiveLeads = await F.leadsByIds(db, positive.map((r) => r.leadId))
    return print({
      ...base,
      listApproval: isAutoList(campaign) ? 'auto' : 'manual',
      targetCount: campaign.conditions.count,
      suppression: await F.listSuppression(db),
      customerDomains: settings.customerDomains ?? [],
      alreadyListed: leads.map((l) => l.domain),
      contactedLast90Days: [...new Set([...recentLeads.values()].map((l) => l.domain))],
      pastRejections: byReason,
      repliedPositively: [...positiveLeads.values()].slice(0, 10).map((l) => ({ industry: l.industry, region: l.region, employees: l.employees, summary: l.summary })),
    })
  }
  if (job.type === 'draft-messages') {
    const leads = await F.leadsOf(db, campaign.id)
    const messages = await F.messagesOf(db, campaign.id)
    const rewrite = (job.payload as { rewrite?: { messageId: string; pattern: 'A' | 'B' }[] } | undefined)?.rewrite
    const insights = (await F.activeInsights(db)).map((i) => ({ id: i.id, key: i.key, text: i.text, detail: i.detail, lift: i.lift }))
    const leadInfo = (l: Lead) => ({
      leadId: l.id,
      company: l.company,
      domain: l.domain,
      industry: l.industry,
      region: l.region,
      employees: l.employees,
      summary: l.summary,
      channel: l.channel,
      score: l.score,
      scoreReasons: l.scoreReasons,
      pages: l.pages,
    })
    // ハイブリッド生成：骨格（名乗り・商材・締め・署名・法定表示）は道具が組む。エージェントが書くのは intro だけ
    const sampleLead = { company: '（会社名）', industry: '（業種）' }
    const skeleton = {
      email: assembleBody(settings, campaign, sampleLead, 'email', '（ここにあなたが書く intro が入ります）'),
      sns: assembleBody(settings, campaign, sampleLead, 'sns', '（ここにあなたが書く intro が入ります）'),
      fallbackSubjects: { A: defaultSubject(campaign, sampleLead, 'A'), B: defaultSubject(campaign, sampleLead, 'B') },
      introMaxChars: INTRO_MAX,
      subjectMaxChars: SUBJECT_MAX,
      // パターンB（事例紹介型）で使ってよい事例。空ならパターンBは使わない
      caseStudies: casesOf(campaign.product),
    }
    const sendApproval = isAutoSend(campaign) ? 'auto' : 'manual'
    if (rewrite?.length) {
      const targets = rewrite.flatMap((r) => {
        const m = messages.find((x) => x.id === r.messageId && x.status === 'draft')
        const l = leads.find((x) => x.id === m?.leadId)
        return m && l ? [{ messageId: m.id, pattern: r.pattern, current: { subject: m.subject, intro: m.intro ?? '' }, ...leadInfo(l) }] : []
      })
      return print({ ...base, mode: 'rewrite', sendApproval, insights, skeleton, targets })
    }
    const has = new Set(messages.map((m) => m.leadId))
    const targets = leads.filter((l) => l.status === 'approved' && !has.has(l.id)).map(leadInfo)
    return print({ ...base, mode: 'new', sendApproval, insights, skeleton, targets })
  }
  if (job.type === 'send-approved') {
    const now = Date.now()
    if (kindOf(job) === 'reply') {
      const rx = (await F.reactionsOf(db, campaign.id)).filter((r) => r.replyDraft?.status === 'scheduled')
      return print({ ...base, kind: 'reply', approvedReplies: rx.length })
    }
    const due = (await F.messagesOf(db, campaign.id)).filter((m) => m.status === 'scheduled' && (m.scheduledAt ?? 0) <= now)
    const count = (c: Channel) => due.filter((m) => m.channel === c).length
    return print({ ...base, kind: 'outreach', due: { email: count('email'), form: count('form'), sns: count('sns') } })
  }
  return print({ ...base, evalAfterDays: campaign.evalAfterDays })
}

// ──────────────────────────────────────────────
// /collect-leads

type LeadInput = Partial<Omit<Lead, 'id' | 'campaignId' | 'status' | 'createdAt' | 'autoApproved' | 'rejectReason'>> & {
  // 除外ルール（エージェントがサイトで確かめて付ける）
  individual?: boolean
  noSolicitation?: boolean
}

async function saveLeads(jobId: string | undefined, file: string | true | undefined) {
  const ctx = await open(jobId, ['collect-leads'])
  const { db, campaign } = ctx
  const input = readJson<LeadInput[]>(ctx, file)
  if (!Array.isArray(input)) refuse('企業の配列を渡してください')
  const settings = await F.getSettings(db)
  const auto = isAutoList(campaign)
  const suppression = new Set(await F.listSuppression(db))
  const customers = new Set((settings.customerDomains ?? []).map(normalizeDomain))
  const existing = new Set((await F.leadsOf(db, campaign.id)).map((l) => lower(l.domain)))
  const recent = await F.sentSince(db, Date.now() - 90 * DAY)
  const recentDomains = new Set([...(await F.leadsByIds(db, recent.map((m) => m.leadId))).values()].map((l) => lower(l.domain)))
  const skipped: { company?: string; reason: string }[] = []
  const ok: Lead[] = []
  const now = Date.now()
  for (const x of input) {
    const company = x.company?.trim()
    const domain = x.domain ? lower(x.domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : ''
    const skip = (reason: string) => skipped.push({ company, reason })
    if (!company || !domain) {
      skip('会社名かドメインがありません')
      continue
    }
    let email = x.email?.trim()
    // 公開されている掲載元が分からないアドレスには送らない
    if (email && !x.emailSource) email = undefined
    const channel = x.channel ?? (email ? 'email' : x.formUrl ? 'form' : 'sns')
    if (!campaign.channels.includes(channel)) {
      skip(`このキャンペーンでは使わない連絡手段です（${channel}）`)
      continue
    }
    if ((channel === 'email' && !email) || (channel === 'form' && !x.formUrl) || (channel === 'sns' && !x.sns)) {
      skip('連絡先がありません（メールは掲載元の URL が必要です）')
      continue
    }
    if (suppressionKeys({ domain, email }).some((k) => suppression.has(k))) {
      skip('配信停止リストに入っています')
      continue
    }
    if (customers.has(domain)) {
      skip('既存顧客・取引先です')
      continue
    }
    if (x.individual) {
      skip('個人・個人事業主です')
      continue
    }
    if (x.noSolicitation) {
      skip('営業目的の連絡を断っています')
      continue
    }
    const evidence = (x.evidence ?? []).filter((e) => e && typeof e.url === 'string' && typeof e.quote === 'string' && e.quote.trim()).slice(0, 5)
    // 根拠（URL と引用）がない企業は「高」にしない。自動承認は高だけ
    let confidence: Confidence = x.confidence === 'high' || x.confidence === 'medium' || x.confidence === 'low' ? x.confidence : 'medium'
    if (confidence === 'high' && !evidence.length) confidence = 'medium'
    if (confidence === 'low') {
      skip('条件に合う根拠がありません（確信 低）')
      continue
    }
    if (existing.has(domain) || ok.some((l) => l.domain === domain)) {
      skip('すでにリストにあります')
      continue
    }
    if (recentDomains.has(domain)) {
      skip('直近90日に連絡しています')
      continue
    }
    ok.push({
      id: F.newId(db, 'leads'),
      campaignId: campaign.id,
      company,
      domain,
      industry: x.industry ?? '',
      region: x.region ?? '',
      employees: x.employees ?? '',
      summary: x.summary ?? '',
      email,
      emailSource: email ? x.emailSource : undefined,
      formUrl: x.formUrl,
      sns: x.sns,
      channel,
      score: Math.max(0, Math.min(100, Math.round(Number(x.score) || 0))),
      scoreReasons: (x.scoreReasons ?? []).slice(0, 8),
      pages: (x.pages ?? []).slice(0, 12),
      status: auto && confidence === 'high' ? 'approved' : 'pending',
      autoApproved: auto && confidence === 'high' ? true : undefined,
      confidence,
      evidence,
      createdAt: now,
    })
  }
  const leads = ok.sort((a, b) => b.score - a.score).slice(0, campaign.conditions.count)
  for (let i = 0; i < leads.length; i += 400) {
    const batch = writeBatch(db)
    for (const l of leads.slice(i, i + 400)) batch.set(doc(db, 'leads', l.id), l)
    await batch.commit()
  }
  const approved = leads.filter((l) => l.status === 'approved').length
  const review = leads.length - approved
  if (auto && approved) {
    // 自動承認した企業があれば、そのまま文面作成に進む
    const jobs = await F.queuedJobs(db)
    if (!jobs.some((j) => j.campaignId === campaign.id && j.type === 'draft-messages')) await createJob(db, 'draft-messages', campaign.id, Date.now())
    await F.addActivity(
      db,
      `「${campaign.name}」の企業 ${leads.length} 社を集め、確信の高い ${approved} 社を承認して文面作成に進めました${review ? `（要確認 ${review} 社）` : ''}`,
      campaign.id,
    )
  } else {
    await F.addActivity(db, `「${campaign.name}」の企業リスト ${leads.length} 社とスコアを保存しました（承認待ち）`, campaign.id)
  }
  print({ saved: leads.length, autoApproved: approved, needsReview: review, skipped })
}

// ──────────────────────────────────────────────
// /draft-messages

type DraftInput = { leadId?: string; messageId?: string; pattern?: 'A' | 'B'; subject?: string; intro?: string; insightIds?: string[] }

async function saveDrafts(jobId: string | undefined, file: string | true | undefined) {
  const ctx = await open(jobId, ['draft-messages'])
  const { db, campaign, job } = ctx
  const input = readJson<DraftInput[]>(ctx, file)
  if (!Array.isArray(input)) refuse('文面の配列を渡してください')
  const settings = await F.getSettings(db)
  const leads = new Map((await F.leadsOf(db, campaign.id)).map((l) => [l.id, l]))
  const messages = await F.messagesOf(db, campaign.id)
  const insightIds = new Set((await F.activeInsights(db)).map((i) => i.id))
  const rewrite = new Set(((job.payload as { rewrite?: { messageId: string }[] } | undefined)?.rewrite ?? []).map((r) => r.messageId))
  const auto = isAutoSend(campaign)
  const suppression = await F.listSuppression(db)
  const allLeads = [...leads.values()]
  const skipped: { target?: string; reason: string }[] = []
  const written: Message[] = []
  const now = Date.now()
  for (const x of input) {
    const intro = (x.intro ?? '').trim()
    const pattern = x.pattern === 'B' ? 'B' : 'A'
    const skip = (reason: string) => skipped.push({ target: x.leadId ?? x.messageId, reason })
    if (!intro) {
      skip('intro（相手企業に触れる数文）がありません')
      continue
    }
    if (intro.length > INTRO_MAX) {
      skip(`intro が長すぎます（${intro.length}文字。${INTRO_MAX}文字まで）`)
      continue
    }
    if (PLACEHOLDER.test(intro) || PLACEHOLDER.test(x.subject ?? '')) {
      skip('差し込みが残っています。直してもう一度保存してください')
      continue
    }
    const ids = (x.insightIds ?? []).filter((i) => insightIds.has(i))
    const target = x.messageId ? messages.find((y) => y.id === x.messageId) : undefined
    const lead = target ? leads.get(target.leadId) : x.leadId ? leads.get(x.leadId) : undefined
    if (x.messageId && (!target || !rewrite.has(target.id) || target.status !== 'draft')) {
      skip('書き直しの対象ではないか、下書きではありません')
      continue
    }
    if (!lead || lead.status !== 'approved') {
      skip('承認された企業ではありません')
      continue
    }
    if (!target && messages.some((m) => m.leadId === lead.id)) {
      skip('この企業の文面はすでにあります')
      continue
    }
    const channel = target?.channel ?? lead.channel
    if ((x.subject ?? '').trim().length > SUBJECT_MAX) {
      skip(`件名が長すぎます（${(x.subject ?? '').trim().length}文字。${SUBJECT_MAX}文字まで）`)
      continue
    }
    if (pattern === 'B' && !casesOf(campaign.product).length) {
      skip('導入事例が登録されていないので、パターンBは使えません（パターンAで書いてください）')
      continue
    }
    const subject = channel === 'sns' ? '' : (x.subject ?? '').trim() || defaultSubject(campaign, lead, pattern)
    // 骨格は道具が組む。エージェントの文はこの intro だけ
    const body = assembleBody(settings, campaign, lead, channel, intro)
    const m: Message = target
      ? { ...target, subject, body, intro, pattern, insightIds: ids, edited: false }
      : { id: F.newId(db, 'messages'), campaignId: campaign.id, leadId: lead.id, channel, pattern, subject, body, intro, insightIds: ids, status: 'draft', edited: false, createdAt: now }
    if (target) await updateDoc(doc(db, 'messages', m.id), { subject, body, intro, pattern, insightIds: ids, edited: false })
    else {
      await setDoc(doc(db, 'messages', m.id), m)
      messages.push(m)
    }
    written.push(m)
  }
  if (!auto) {
    await F.addActivity(db, `「${campaign.name}」の文面の下書き ${written.length} 件を保存しました（承認待ち）`, campaign.id)
    return print({ saved: written.length, skipped })
  }
  // 承認なしで送る営業リスト：自動チェックを通った文面はそのまま送信予約へ。通らないものは要確認として残す
  const { holidays } = await loadHolidays()
  const earlier = messages.filter((m) => ['scheduled', 'sending', 'sent', 'bounced'].includes(m.status)).map((m) => ({ message: m, lead: leads.get(m.leadId) }))
  const ok: Message[] = []
  const held: { company?: string; reasons: string[] }[] = []
  for (const m of written) {
    const checks = checkMessage(m, { settings, lead: leads.get(m.leadId), suppression, otherLeads: allLeads, earlier })
    const errors = checks.filter((c) => c.level === 'error').map((c) => c.text)
    if (errors.length) {
      held.push({ company: leads.get(m.leadId)?.company, reasons: errors })
      continue
    }
    ok.push(m)
    earlier.push({ message: m, lead: leads.get(m.leadId) })
  }
  let firstAt: number | undefined
  if (ok.length) {
    const sentToday = (await F.sentSince(db, jstDayStart(now))).filter((m) => m.channel !== 'sns' && ['sending', 'sent', 'bounced'].includes(m.status)).length
    const autoSend = ok.filter((m) => m.channel !== 'sns')
    const slots = planSends(settings, autoSend.length, now, sentToday, holidays)
    const at = new Map<string, number>()
    let i = 0
    for (const slot of slots) for (let k = 0; k < slot.count && i < autoSend.length; k++, i++) at.set(autoSend[i].id, slot.at)
    for (const m of ok.filter((x) => x.channel === 'sns')) at.set(m.id, slots[0]?.at ?? nextOpen(settings, now, holidays))
    firstAt = Math.min(...at.values())
    for (const m of ok) await updateDoc(doc(db, 'messages', m.id), { status: 'scheduled', scheduledAt: at.get(m.id), scheduledBy: 'agent' })
    const jobs = await F.queuedJobs(db)
    const existing = jobs.find((j) => j.campaignId === campaign.id && j.type === 'send-approved' && kindOf(j) === 'outreach')
    if (existing) {
      if (existing.runAt > firstAt) await updateDoc(doc(db, 'jobs', existing.id), { runAt: firstAt })
    } else await createJob(db, 'send-approved', campaign.id, firstAt, { kind: 'outreach' })
  }
  await F.addActivity(
    db,
    `「${campaign.name}」の文面 ${written.length} 件を作り、自動チェックを通った ${ok.length} 件を送信予約しました${held.length ? `（要確認 ${held.length} 件）` : ''}${firstAt ? `。送信 ${new Date(firstAt).toISOString()}〜` : ''}`,
    campaign.id,
  )
  print({ saved: written.length, scheduled: ok.length, firstSendAt: firstAt ? new Date(firstAt).toISOString() : null, needsReview: held, skipped })
}

// ──────────────────────────────────────────────
// /send-approved：メール（と承認済みの返信）は、ここで Gmail から送る

type Gate = { blocked?: { reason: string; nextAt: number } }

async function gate(db: Firestore, settings: Settings, holidays: Set<string>, countLimit: boolean): Promise<Gate> {
  const now = Date.now()
  if (settings.sendingPaused) return { blocked: { reason: '設定で送信を一時停止しています', nextAt: now + 30 * 60_000 } }
  if (!isOpen(settings, now, holidays)) return { blocked: { reason: `送信の時間帯（${settings.sendWindow}${settings.skipWeekend ? '・土日祝を除く' : ''}）の外です`, nextAt: nextOpen(settings, now, holidays) } }
  if (!countLimit) return {}
  const today = (await F.sentSince(db, jstDayStart(now))).filter((m) => m.channel !== 'sns' && ['sending', 'sent', 'bounced'].includes(m.status)).length
  if (today >= settings.dailyLimit) {
    return { blocked: { reason: `1日の送信上限（${settings.dailyLimit}件）に達しました`, nextAt: nextOpen(settings, jstDayStart(now) + DAY, holidays) } }
  }
  return {}
}

async function sendEmails(jobId?: string) {
  const ctx = await open(jobId, ['send-approved'])
  if (kindOf(ctx.job) === 'reply') return sendReplies(ctx)
  const { db, campaign } = ctx
  const settings = await F.getSettings(db)
  const { holidays, warning } = await loadHolidays()
  const interval = Number(opt('SEND_INTERVAL_SEC', '5')) * 1000
  const result: Record<string, unknown> & { sent: unknown[]; skipped: unknown[]; uncertain: unknown[] } = {
    mode: SEND_MODE,
    sent: [],
    skipped: [],
    uncertain: [],
    warning,
  }
  const now0 = Date.now()
  const messages = await F.messagesOf(db, campaign.id)
  // SNS は自動で送らない（人が手動で送る）
  let toManual = 0
  for (const m of messages.filter((x) => x.status === 'scheduled' && x.channel === 'sns' && (x.scheduledAt ?? 0) <= now0)) {
    await updateDoc(doc(db, 'messages', m.id), { status: 'manual_pending' })
    record(ctx, { id: m.id, result: 'manual', channel: 'sns' })
    toManual++
  }
  result.toManualSns = toManual
  const leads = await F.leadsOf(db, campaign.id)
  const leadById = new Map(leads.map((l) => [l.id, l]))
  const earlier = messages
    .filter((m) => ['sending', 'sent', 'bounced'].includes(m.status))
    .map((m) => ({ message: m, lead: leadById.get(m.leadId) }))
  const due = messages.filter((m) => m.status === 'scheduled' && m.channel === 'email' && (m.scheduledAt ?? 0) <= now0).sort((a, b) => a.createdAt - b.createdAt)

  for (const m of due) {
    const g = await gate(db, settings, holidays, true)
    if (g.blocked) {
      result.blocked = { ...g.blocked, at: new Date(g.blocked.nextAt).toISOString() }
      break
    }
    const lead = leadById.get(m.leadId)
    const ref = doc(db, 'messages', m.id)
    // 配信停止リストは毎回読み直す（送信中に届いた依頼も反映する）
    const checks = checkMessage(m, { settings, lead, suppression: await F.listSuppression(db), otherLeads: leads, earlier })
    const errors = checks.filter((c) => c.level === 'error').map((c) => c.text)
    if (errors.length) {
      await updateDoc(ref, { status: 'manual_pending', sendError: errors.join(' / ') })
      record(ctx, { id: m.id, result: 'skipped', reasons: errors })
      result.skipped.push({ company: lead?.company, reasons: errors })
      continue
    }
    try {
      // ルール側でも「予約時刻・承認済みの企業・配信停止リスト」を確かめる
      await updateDoc(ref, { status: 'sending', runnerId: process.env.RUNNER_ID ?? 'manual' })
    } catch (e) {
      result.skipped.push({ company: lead?.company, reasons: [`送信を始められませんでした：${msg(e)}`] })
      continue
    }
    if (SEND_MODE === 'dry-run') {
      gmail.buildMime({ fromName: `${settings.senderCompany} ${settings.senderName}`, from: settings.senderEmail, to: lead!.email!, subject: m.subject, body: m.body })
      await updateDoc(ref, { status: 'scheduled', sendError: '試運転のため送っていません（SEND_MODE=dry-run）', runnerId: process.env.RUNNER_ID ?? 'manual' })
      record(ctx, { id: m.id, result: 'dry-run' })
      result.sent.push({ company: lead?.company, to: lead?.email, subject: m.subject, dryRun: true })
      continue
    }
    try {
      const r = await gmail.sendMail({
        fromName: `${settings.senderCompany} ${settings.senderName}`,
        from: settings.senderEmail,
        to: lead!.email!,
        subject: m.subject,
        body: m.body,
      })
      await updateDoc(ref, { status: 'sent', sentAt: Date.now(), messageId: r.rfcMessageId, threadId: r.threadId })
      earlier.push({ message: m, lead })
      record(ctx, { id: m.id, result: 'sent', channel: 'email' })
      result.sent.push({ company: lead?.company, to: lead?.email, subject: m.subject })
    } catch (e) {
      if (e instanceof gmail.GmailRejected) {
        // Gmail が断った＝送られていない。人の判断に回す
        await updateDoc(ref, { status: 'manual_pending', sendError: `Gmail が受け付けませんでした：${msg(e)}` })
        record(ctx, { id: m.id, result: 'skipped', reasons: [msg(e)] })
        result.skipped.push({ company: lead?.company, reasons: [msg(e)] })
        // 認証の失敗などは続けても同じなので止める
        break
      }
      // 送れたかどうか分からない。二重送信を避けるため「送信中」のまま残し、人が Gmail の送信済みを確かめる
      record(ctx, { id: m.id, result: 'uncertain', error: msg(e) })
      result.uncertain.push({ company: lead?.company, error: msg(e) })
      break
    }
    await sleep(interval)
  }
  const left = due.length - result.sent.length - result.skipped.length - result.uncertain.length
  result.emailsLeft = left
  print(result)
}

async function sendReplies(ctx: Ctx) {
  const { db, campaign } = ctx
  const settings = await F.getSettings(db)
  const { holidays, warning } = await loadHolidays()
  const messages = new Map((await F.messagesOf(db, campaign.id)).map((m) => [m.id, m]))
  const reactions = (await F.reactionsOf(db, campaign.id)).filter((r) => r.replyDraft?.status === 'scheduled')
  const result: Record<string, unknown> & { sent: unknown[]; skipped: unknown[] } = { mode: SEND_MODE, kind: 'reply', sent: [], skipped: [], warning }
  for (const r of reactions) {
    const g = await gate(db, settings, holidays, false)
    if (g.blocked) {
      result.blocked = { ...g.blocked, at: new Date(g.blocked.nextAt).toISOString() }
      break
    }
    const draft = r.replyDraft!
    const errors = checkReply(draft.body, r.fromAddress, settings, await F.listSuppression(db)).filter((c) => c.level === 'error')
    if (errors.length) {
      result.skipped.push({ to: r.fromAddress, reasons: errors.map((c) => c.text) })
      continue
    }
    const ref = doc(db, 'reactions', r.id)
    await updateDoc(ref, { replyDraft: { ...draft, status: 'sending' } })
    if (SEND_MODE === 'dry-run') {
      await updateDoc(ref, { replyDraft: { ...draft, status: 'scheduled' } })
      record(ctx, { id: r.id, result: 'dry-run' })
      result.sent.push({ to: r.fromAddress, dryRun: true })
      continue
    }
    const original = messages.get(r.messageId)
    try {
      await gmail.sendMail({
        fromName: `${settings.senderCompany} ${settings.senderName}`,
        from: settings.senderEmail,
        to: r.fromAddress!,
        subject: `Re: ${(original?.subject ?? '').replace(/^(re:\s*)+/i, '')}`,
        body: draft.body,
        inReplyTo: r.rfcMessageId,
        threadId: r.threadId,
      })
      await updateDoc(ref, { replyDraft: { ...draft, status: 'sent', sentAt: Date.now() } })
      record(ctx, { id: r.id, result: 'sent', channel: 'reply' })
      result.sent.push({ to: r.fromAddress })
    } catch (e) {
      if (e instanceof gmail.GmailRejected) {
        await updateDoc(ref, { replyDraft: { ...draft, status: 'scheduled' } })
        result.skipped.push({ to: r.fromAddress, reasons: [msg(e)] })
        break
      }
      record(ctx, { id: r.id, result: 'uncertain', error: msg(e) })
      result.skipped.push({ to: r.fromAddress, reasons: [`送れたか分かりません（送信中のまま残します）：${msg(e)}`] })
      break
    }
  }
  print(result)
}

// フォームは ClaudeCode がブラウザで入力する。1件ずつ「送信中」にしてから渡す
async function nextForm(jobId?: string) {
  const ctx = await open(jobId, ['send-approved'])
  const { db, campaign } = ctx
  const settings = await F.getSettings(db)
  const { holidays } = await loadHolidays()
  const done = new Set(records(ctx).map((r) => r.id as string))
  const leads = await F.leadsOf(db, campaign.id)
  const leadById = new Map(leads.map((l) => [l.id, l]))
  const messages = await F.messagesOf(db, campaign.id)
  const now = Date.now()
  const earlier = messages.filter((m) => ['sending', 'sent', 'bounced'].includes(m.status)).map((m) => ({ message: m, lead: leadById.get(m.leadId) }))
  const due = messages
    .filter((m) => m.status === 'scheduled' && m.channel === 'form' && (m.scheduledAt ?? 0) <= now && !done.has(m.id))
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const m of due) {
    const g = await gate(db, settings, holidays, true)
    if (g.blocked) return print({ blocked: { ...g.blocked, at: new Date(g.blocked.nextAt).toISOString() } })
    const lead = leadById.get(m.leadId)
    const errors = checkMessage(m, { settings, lead, suppression: await F.listSuppression(db), otherLeads: leads, earlier })
      .filter((c) => c.level === 'error')
      .map((c) => c.text)
    if (errors.length) {
      await updateDoc(doc(db, 'messages', m.id), { status: 'manual_pending', sendError: errors.join(' / ') })
      record(ctx, { id: m.id, result: 'skipped', reasons: errors })
      continue
    }
    await updateDoc(doc(db, 'messages', m.id), { status: 'sending', runnerId: process.env.RUNNER_ID ?? 'manual' })
    return print({
      messageId: m.id,
      company: lead?.company,
      formUrl: lead?.formUrl,
      dryRun: SEND_MODE === 'dry-run',
      fill: {
        company: settings.senderCompany,
        name: settings.senderName,
        email: settings.senderEmail,
        subject: m.subject,
        body: m.body,
      },
      remaining: due.length - 1,
    })
  }
  print({ done: true })
}

async function formResult(jobId: string | undefined, messageId: string | undefined, f: Record<string, string | true>) {
  const ctx = await open(jobId, ['send-approved'])
  if (!messageId) refuse('message_id を指定してください')
  const ref = doc(ctx.db, 'messages', messageId!)
  const m = (await F.messagesOf(ctx.db, ctx.campaign.id)).find((x) => x.id === messageId)
  if (!m || m.status !== 'sending' || m.channel !== 'form') refuse('送信中のフォームの文面ではありません')
  if (f['dry-run'] || SEND_MODE === 'dry-run') {
    await updateDoc(ref, { status: 'scheduled', sendError: '試運転のため、フォームに入力しましたが送信していません', runnerId: process.env.RUNNER_ID ?? 'manual' })
    record(ctx, { id: messageId, result: 'dry-run' })
  } else if (f.sent) {
    await updateDoc(ref, { status: 'sent', sentAt: Date.now(), messageId: typeof f.ref === 'string' ? f.ref : `form-${Date.now().toString(36)}` })
    record(ctx, { id: messageId, result: 'sent', channel: 'form' })
  } else if (typeof f.manual === 'string') {
    await updateDoc(ref, { status: 'manual_pending', sendError: f.manual })
    record(ctx, { id: messageId, result: 'manual', reasons: [f.manual] })
  } else {
    refuse('--sent か --manual "<理由>" を指定してください')
  }
  print({ ok: true })
}

async function sendFinish(jobId?: string) {
  const ctx = await open(jobId, ['send-approved'])
  const { db, campaign, job } = ctx
  const settings = await F.getSettings(db)
  const { holidays } = await loadHolidays()
  const rec = records(ctx)
  const n = (r: string, ch?: string) => rec.filter((x) => x.result === r && (!ch || x.channel === ch)).length
  if (kindOf(job) === 'reply') {
    const text = SEND_MODE === 'dry-run' ? `試運転：返信 ${n('dry-run')} 件を送る予定でした（送っていません）` : `返信 ${n('sent')} 件を Gmail から送信しました`
    await F.addActivity(db, text, campaign.id)
    await updateDoc(doc(db, 'jobs', job.id), { summary: SEND_MODE === 'dry-run' ? `試運転 返信${n('dry-run')}件` : `返信${n('sent')}件を送信` })
    return print({ summary: text })
  }
  const now = Date.now()
  const created: string[] = []
  const jobs = await F.queuedJobs(db)
  if (SEND_MODE === 'live') {
    // 時間帯・上限で送りきれなかった分は、次に送れる時刻に続きを予約する
    const left = (await F.messagesOf(db, campaign.id)).filter((m) => m.status === 'scheduled')
    if (left.length && !jobs.some((j) => j.campaignId === campaign.id && j.type === 'send-approved')) {
      const g = await gate(db, settings, holidays, true)
      const earliest = Math.max(now + 60_000, Math.min(...left.map((m) => m.scheduledAt ?? now)))
      const at = g.blocked ? Math.max(g.blocked.nextAt, earliest) : nextOpen(settings, earliest, holidays)
      await createJob(db, 'send-approved', campaign.id, at, { kind: 'outreach' })
      created.push(`続きの送信 ${new Date(at).toISOString()}`)
    }
    // 送った分の反応チェックを予約する（送信の evalAfterDays 日後の朝）
    const sent = n('sent')
    if (sent && !jobs.some((j) => j.campaignId === campaign.id && j.type === 'evaluate')) {
      const at = nextOpen(settings, jstDayStart(now + campaign.evalAfterDays * DAY), holidays)
      await createJob(db, 'evaluate', campaign.id, at)
      created.push(`反応チェック ${new Date(at).toISOString()}`)
    }
  }
  const manual = n('manual')
  const skipped = n('skipped')
  const uncertain = n('uncertain')
  const text =
    SEND_MODE === 'dry-run'
      ? `試運転：「${campaign.name}」の ${n('dry-run')} 件を送る予定でした（送っていません）`
      : `「${campaign.name}」の ${n('sent')} 件を送信し、送信ログを記録しました` +
        `${manual ? `（手動送信待ち ${manual} 件）` : ''}${skipped ? `（送れなかった ${skipped} 件は人の確認待ち）` : ''}` +
        `${uncertain ? `（送れたか分からない ${uncertain} 件は送信中のまま。Gmail の送信済みを確認してください）` : ''}`
  await F.addActivity(db, text, campaign.id)
  await updateDoc(doc(db, 'jobs', job.id), {
    summary: SEND_MODE === 'dry-run' ? `試運転 ${n('dry-run')}件` : `${n('sent')}件を送信${skipped + uncertain ? `・要確認${skipped + uncertain}件` : ''}`,
  })
  print({ summary: text, created })
}

async function createJob(db: Firestore, type: JobType, campaignId: string, runAt: number, payload?: unknown) {
  const id = F.newId(db, 'jobs')
  const job: Job = { id, type, campaignId, status: 'queued', command: `claude -p "/${type} ${id}"`, createdAt: Date.now(), runAt, plan: [], logs: [], payload }
  await setDoc(doc(db, 'jobs', id), job)
}

// ──────────────────────────────────────────────
// /evaluate

async function evalTargets(jobId?: string) {
  const ctx = await open(jobId, ['evaluate'], false)
  const { db, campaign } = ctx
  const now = Date.now()
  const leads = new Map((await F.leadsOf(db, campaign.id)).map((l) => [l.id, l]))
  const reactions = await F.reactionsOf(db, campaign.id)
  const settled = new Set(reactions.filter((r) => r.type !== 'no_response').map((r) => r.messageId))
  const sent = (await F.messagesOf(db, campaign.id)).filter((m) => m.status === 'sent' && m.channel !== 'sns' && !settled.has(m.id))
  const targets = sent.map((m) => {
    const l = leads.get(m.leadId)
    return {
      messageId: m.id,
      channel: m.channel,
      company: l?.company,
      domain: l?.domain,
      email: l?.email,
      subject: m.subject,
      sentAt: m.sentAt,
      sentDate: m.sentAt ? jstDateKey(m.sentAt) : null,
      gmailThreadId: m.channel === 'email' ? m.threadId : null,
      rfcMessageId: m.messageId,
      // 評価までの日数を過ぎていれば「無反応」として記録してよい
      noResponseDue: !!m.sentAt && now >= m.sentAt + campaign.evalAfterDays * DAY,
    }
  })
  print({ evalAfterDays: campaign.evalAfterDays, targets, manualSnsExcluded: (await F.messagesOf(db, campaign.id)).filter((m) => m.channel === 'sns').length })
}

async function gmailRead(kind: 'thread' | 'search', jobId: string | undefined, arg: string | undefined) {
  await open(jobId, ['evaluate', 'send-approved'], false)
  if (!arg) refuse(kind === 'thread' ? 'thread_id を指定してください' : '検索語を指定してください')
  print(kind === 'thread' ? await gmail.getThread(arg!) : await gmail.search(arg!))
}

type ReactionInput = {
  messageId?: string
  type?: Reaction['type']
  sentiment?: Reaction['sentiment']
  excerpt?: string
  receivedAt?: number
  fromAddress?: string
  threadId?: string
  gmailMessageId?: string
  rfcMessageId?: string
  replyDraft?: string
}

async function saveReactions(jobId: string | undefined, file: string | true | undefined) {
  const ctx = await open(jobId, ['evaluate'])
  const { db, campaign } = ctx
  const input = readJson<ReactionInput[]>(ctx, file)
  if (!Array.isArray(input)) refuse('反応の配列を渡してください')
  const settings = await F.getSettings(db)
  const now = Date.now()
  const messages = new Map((await F.messagesOf(db, campaign.id)).map((m) => [m.id, m]))
  const leads = new Map((await F.leadsOf(db, campaign.id)).map((l) => [l.id, l]))
  const existing = await F.reactionsOf(db, campaign.id)
  const seenGmail = new Set(existing.map((r) => r.gmailMessageId).filter(Boolean))
  const suppression = new Set(await F.listSuppression(db))
  const count = { reply: 0, unsubscribe: 0, bounce: 0, no_response: 0 }
  const skipped: { messageId?: string; reason: string }[] = []
  for (const x of input) {
    const m = x.messageId ? messages.get(x.messageId) : undefined
    const lead = m ? leads.get(m.leadId) : undefined
    const skip = (reason: string) => skipped.push({ messageId: x.messageId, reason })
    if (!m || !lead || !['sent', 'bounced'].includes(m.status)) {
      skip('このキャンペーンの送信済みの文面ではありません')
      continue
    }
    if (!x.type || !(x.type in count)) {
      skip('type は reply / unsubscribe / bounce / no_response のどれかです')
      continue
    }
    if (x.gmailMessageId && seenGmail.has(x.gmailMessageId)) {
      skip('記録済みのメールです')
      continue
    }
    const prev = existing.find((r) => r.messageId === m.id)
    if (prev && prev.type !== 'no_response') {
      skip('この文面の反応は記録済みです')
      continue
    }
    if (x.type === 'no_response' && (prev || !m.sentAt || now < m.sentAt + campaign.evalAfterDays * DAY)) {
      skip('無反応として記録するには早いか、記録済みです')
      continue
    }
    let replyDraft: Reaction['replyDraft']
    if (x.type === 'reply' && x.replyDraft && x.sentiment !== 'negative') {
      if (hasError(checkReply(x.replyDraft, x.fromAddress, settings, [...suppression]))) skip('返信の下書きは自動チェックで送れない内容だったため、付けずに記録します')
      else replyDraft = { body: x.replyDraft, status: 'draft' }
    }
    const r: Reaction = {
      id: prev?.id ?? F.newId(db, 'reactions'),
      campaignId: campaign.id,
      leadId: lead.id,
      messageId: m.id,
      type: x.type,
      sentiment: x.type === 'reply' ? (x.sentiment ?? 'neutral') : undefined,
      excerpt: (x.excerpt ?? '').slice(0, 400),
      source: 'gmail',
      receivedAt: x.receivedAt ?? now,
      fromAddress: x.fromAddress ? lower(x.fromAddress.replace(/^.*<([^>]+)>.*$/, '$1')) : undefined,
      threadId: x.threadId,
      gmailMessageId: x.gmailMessageId,
      rfcMessageId: x.rfcMessageId,
      replyDraft,
    }
    if (prev) await updateDoc(doc(db, 'reactions', r.id), { ...r })
    else await setDoc(doc(db, 'reactions', r.id), r)
    if (x.gmailMessageId) seenGmail.add(x.gmailMessageId)
    count[x.type]++
    if (x.type === 'bounce' && m.status === 'sent') await updateDoc(doc(db, 'messages', m.id), { status: 'bounced' })
    if (x.type === 'unsubscribe') {
      for (const key of suppressionKeys(lead, r.fromAddress)) {
        if (suppression.has(key)) continue
        await setDoc(doc(db, 'suppression', key), { domain: key, source: 'reply', reason: `「${campaign.name}」への配信停止の返信`, createdAt: now })
        suppression.add(key)
      }
    }
  }
  await F.addActivity(
    db,
    `「${campaign.name}」の反応をチェックしました（返信 ${count.reply} 件・配信停止 ${count.unsubscribe} 件・不達 ${count.bounce} 件）`,
    campaign.id,
  )
  print({ saved: count, skipped })
}

async function stats(jobId?: string) {
  const ctx = await open(jobId, ['evaluate'], false)
  const { db, campaign } = ctx
  const leads = new Map((await F.leadsOf(db, campaign.id)).map((l) => [l.id, l]))
  const reactions = await F.reactionsOf(db, campaign.id)
  const byMsg = new Map(reactions.map((r) => [r.messageId, r]))
  const evaluated = (await F.messagesOf(db, campaign.id)).filter((m) => byMsg.has(m.id) && m.channel !== 'sns')
  const rate = (ms: Message[]) => {
    const replies = ms.filter((m) => byMsg.get(m.id)?.type === 'reply').length
    return { sent: ms.length, replies, rate: ms.length ? Number(((replies / ms.length) * 100).toFixed(1)) : null }
  }
  print({
    note: '件数が少ない（各8件未満）比較からは学びを作らないでください',
    all: rate(evaluated),
    byPattern: { A: rate(evaluated.filter((m) => m.pattern === 'A')), B: rate(evaluated.filter((m) => m.pattern === 'B')) },
    byScore: {
      high75: rate(evaluated.filter((m) => (leads.get(m.leadId)?.score ?? 0) >= 75)),
      low: rate(evaluated.filter((m) => (leads.get(m.leadId)?.score ?? 0) < 75)),
    },
    byChannel: { email: rate(evaluated.filter((m) => m.channel === 'email')), form: rate(evaluated.filter((m) => m.channel === 'form')) },
    edited: { byHuman: rate(evaluated.filter((m) => m.edited)), asDrafted: rate(evaluated.filter((m) => !m.edited)) },
    unsubscribe: reactions.filter((r) => r.type === 'unsubscribe').length,
    bounce: reactions.filter((r) => r.type === 'bounce').length,
  })
}

async function saveInsights(jobId: string | undefined, file: string | true | undefined) {
  const ctx = await open(jobId, ['evaluate'])
  const { db, campaign } = ctx
  const input = readJson<Partial<Insight>[]>(ctx, file)
  if (!Array.isArray(input)) refuse('学びの配列を渡してください')
  const active = await F.activeInsights(db)
  const family = (k: string) => k.split('-')[0]
  let saved = 0
  for (const x of input) {
    if (!x.key || !/^[a-z0-9-]+$/.test(x.key) || !x.text) continue
    // 同じ種類の学び（pattern-A と pattern-B など）は新しいものに置き換える
    for (const old of active.filter((i) => family(i.key) === family(x.key!))) await updateDoc(doc(db, 'insights', old.id), { active: false })
    const id = F.newId(db, 'insights')
    const ins: Insight = { id, key: x.key, text: x.text, detail: x.detail ?? '', lift: x.lift ?? '', campaignId: campaign.id, createdAt: Date.now(), active: true }
    await setDoc(doc(db, 'insights', id), ins)
    saved++
  }
  print({ saved })
}

async function suppress(jobId: string | undefined, value: string | undefined, reason: string | true | undefined) {
  const ctx = await open(jobId, ['send-approved', 'evaluate'])
  if (!value || !/^[^\s/]+$/.test(value)) refuse('ドメインかメールアドレスを指定してください')
  const key = lower(value!)
  if (FREE_MAIL.has(key)) refuse('フリーメールのドメインごとは止められません。アドレスで指定してください')
  await setDoc(doc(ctx.db, 'suppression', key), { domain: key, source: 'reply', reason: typeof reason === 'string' ? reason : '配信停止の依頼', createdAt: Date.now() })
  print({ suppressed: key })
}

async function summary(jobId: string | undefined, text: string | undefined) {
  const ctx = await open(jobId)
  if (!text) refuse('要約を指定してください')
  await updateDoc(doc(ctx.db, 'jobs', ctx.job.id), { summary: text!.slice(0, 80) })
  print({ ok: true })
}

// ──────────────────────────────────────────────

const HELP = `使い方：node runner/agent-tools.ts <コマンド> <job_id> ...
  context <job_id>                          ジョブに必要な情報（キャンペーン・送信者・対象）
  save-leads <job_id> --file <json>         企業リストを「承認待ち」で保存
  save-drafts <job_id> --file <json>        文面の下書きを保存（署名と法定表示は自動で付く）
  send-emails <job_id>                      予約済みのメール（返信のジョブなら承認済みの返信）を送る
  next-form <job_id>                        次に送るフォームを1件取り出す
  form-result <job_id> <message_id> --sent [--ref <受付番号>] | --manual "<理由>"
  send-finish <job_id>                      送信の後始末（続きと反応チェックの予約・記録）
  eval-targets <job_id>                     反応を確かめる送信済みの一覧
  gmail-thread <job_id> <thread_id>         スレッドのメールを読む
  gmail-search <job_id> "<検索語>"           Gmail を検索する
  save-reactions <job_id> --file <json>     反応を記録（配信停止は配信停止リストへ）
  stats <job_id>                            返信率の集計
  save-insights <job_id> --file <json>      学びを保存
  suppress <job_id> <ドメインかアドレス> [--reason <理由>]
  summary <job_id> "<一言>"                  ジョブの結果を残す`

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { pos, f } = flags(rest)
  switch (cmd) {
    case 'context':
      return context(pos[0])
    case 'save-leads':
      return saveLeads(pos[0], f.file)
    case 'save-drafts':
      return saveDrafts(pos[0], f.file)
    case 'send-emails':
      return sendEmails(pos[0])
    case 'next-form':
      return nextForm(pos[0])
    case 'form-result':
      return formResult(pos[0], pos[1], f)
    case 'send-finish':
      return sendFinish(pos[0])
    case 'eval-targets':
      return evalTargets(pos[0])
    case 'gmail-thread':
      return gmailRead('thread', pos[0], pos[1])
    case 'gmail-search':
      return gmailRead('search', pos[0], pos[1])
    case 'save-reactions':
      return saveReactions(pos[0], f.file)
    case 'stats':
      return stats(pos[0])
    case 'save-insights':
      return saveInsights(pos[0], f.file)
    case 'suppress':
      return suppress(pos[0], pos[1], f.reason)
    case 'summary':
      return summary(pos[0], pos[1])
    default:
      process.stdout.write(`${HELP}\n`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    process.stderr.write(`✕ ${e instanceof Refused ? e.message : msg(e)}\n`)
    process.exit(1)
  })
