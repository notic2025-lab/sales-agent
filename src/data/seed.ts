// 初回表示用のデモデータ。実際のジョブ処理（agent.ts）を時刻をずらして流し、整合した状態を作る。
import type { Activity, Campaign, DB, Job, JobType, Settings } from '../types'
import { DAY, HOUR, MIN, mulberry32, uid } from '../lib/util'
import { applyJob, newJob, planJob } from './agent'

// 本番の初期値：送信者情報は空（デモの値が本番のメールに入らないように）。上限は小さめから始める
export function blankSettings(): Settings {
  return { ...defaultSettings(), senderCompany: '', senderName: '', senderEmail: '', senderAddress: '', signature: '', dailyLimit: 10 }
}

export function defaultSettings(): Settings {
  return {
    senderCompany: 'NOTIC',
    senderName: '営業担当',
    senderEmail: 'sales@notic.example',
    senderAddress: '東京都千代田区（デモ用の住所）',
    signature: 'NOTIC 営業担当\nsales@notic.example\nhttps://notic.jp/qr/',
    dailyLimit: 50,
    sendWindow: '9:00〜18:00',
    skipWeekend: true,
    runnerPaused: false,
    runnerSpeed: 1,
  }
}

const QR = {
  name: '可変QR',
  summary: '印刷・設置したあとでもQRの行き先を変えられるサービスです。1つのQRに複数のリンクをまとめ、どれだけ読まれたかもレポートで確かめられます。',
  strengths: '印刷物を刷り直さずにリンクを差し替えられる\n日時を決めて自動で切り替えられる\n読み取り数のレポートがLINEやメールに届く',
  url: 'https://notic.jp/qr/',
}

function at(base: number, daysAgo: number, h: number, m = 0) {
  const d = new Date(base - daysAgo * DAY)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

export function createSeed(now = Date.now(), seed = 172): DB {
  const rng = mulberry32(seed)
  let db: DB = {
    campaigns: [],
    leads: [],
    messages: [],
    reactions: [],
    jobs: [],
    insights: [],
    activities: [],
    suppression: [],
    settings: defaultSettings(),
  }

  const admin = (t: number, text: string, campaignId?: string) => {
    const a: Activity = { id: uid('act'), t, actor: 'admin', text, campaignId }
    db = { ...db, activities: [a, ...db.activities] }
  }

  const execute = (job: Job, t: number) => {
    const planned = planJob(db, job, rng, t)
    const lines = [`$ ${job.command}`, ...planned.plan]
    const done: Job = {
      ...job,
      status: 'done',
      startedAt: t,
      finishedAt: t + lines.length * 650,
      plan: planned.plan,
      logs: lines.map((text, i) => ({ t: t + i * 650, text })),
      summary: planned.summary,
      payload: planned.payload,
    }
    db = { ...db, jobs: [...db.jobs.filter((j) => j.id !== job.id), done] }
    db = { ...db, ...applyJob(db, done, done.finishedAt!) }
  }
  const run = (type: JobType, campaignId: string, t: number, payload?: unknown) =>
    execute(newJob(type, campaignId, t, t, payload), t)

  const addCampaign = (c: Omit<Campaign, 'id'>, id: string) => {
    db = { ...db, campaigns: [...db.campaigns, { ...c, id }] }
    admin(c.createdAt, `キャンペーン「${c.name}」を作成し、リスト収集を登録しました`, id)
  }

  // ── 1. 送信と評価まで終わったキャンペーン
  const c1 = 'cmp_001'
  const t1 = at(now, 16, 10, 12)
  addCampaign(
    {
      name: '可変QR｜首都圏の飲食チェーン',
      product: QR,
      conditions: { industries: ['飲食'], regions: ['東京', '神奈川', '埼玉', '千葉'], size: '11〜50名', count: 48, keywords: '複数店舗、季節メニュー、店頭POP' },
      channels: ['email', 'form', 'sns'],
      evalAfterDays: 7,
      listApproval: 'manual',
      sendApproval: 'manual',
      createdAt: t1,
    },
    c1,
  )
  run('collect-leads', c1, t1 + MIN)
  {
    const ls = db.leads.filter((l) => l.campaignId === c1).sort((a, b) => b.score - a.score)
    const ok = new Set(ls.slice(0, 42).map((l) => l.id))
    db = { ...db, leads: db.leads.map((l) => (l.campaignId === c1 ? { ...l, status: ok.has(l.id) ? 'approved' : 'rejected' } : l)) }
    // 除外した理由を残しておく（次の収集で参照される）
    const reasons = ['size', 'individual', 'contact', 'size', 'industry', 'size'] as const
    let k = 0
    db = { ...db, leads: db.leads.map((l) => (l.campaignId === c1 && l.status === 'rejected' ? { ...l, rejectReason: reasons[k++ % reasons.length] } : l)) }
    admin(at(now, 15, 11, 4), 'リストを承認しました（承認 42社・除外 6社）', c1)
  }
  run('draft-messages', c1, at(now, 15, 11, 6))
  {
    let i = 0
    db = {
      ...db,
      messages: db.messages.map((m) =>
        m.campaignId === c1 ? { ...m, status: 'scheduled', edited: i++ % 9 === 0, scheduledAt: at(now, 13, 9) } : m,
      ),
    }
    admin(at(now, 14, 16, 40), '文面 42件を承認し、送信を予約しました', c1)
  }
  run('send-approved', c1, at(now, 13, 9))
  db = {
    ...db,
    messages: db.messages.map((m) =>
      m.campaignId === c1 && m.status === 'manual_pending' ? { ...m, status: 'manual_done', sentAt: at(now, 13, 11, 20) } : m,
    ),
  }
  admin(at(now, 13, 11, 20), 'SNSで手動送信し、完了を登録しました', c1)
  {
    const ev = db.jobs.find((j) => j.campaignId === c1 && j.type === 'evaluate' && j.status === 'queued')
    if (ev) execute({ ...ev, runAt: at(now, 6, 9) }, at(now, 6, 9))
  }
  {
    // 前向きな返信のうち1件は承認・送信済みにしておく
    const first = db.reactions.find((r) => r.campaignId === c1 && r.replyDraft && r.sentiment === 'positive')
    if (first) {
      db = {
        ...db,
        reactions: db.reactions.map((r) =>
          r.id === first.id && r.replyDraft ? { ...r, replyDraft: { ...r.replyDraft, status: 'sent', sentAt: at(now, 5, 10, 15) } } : r,
        ),
      }
      admin(at(now, 5, 10, 12), '返信を承認しました（1件）', c1)
    }
    const sns = db.messages.find((m) => m.campaignId === c1 && m.channel === 'sns')
    if (sns) {
      db = {
        ...db,
        reactions: [
          ...db.reactions,
          {
            id: uid('rx'),
            campaignId: c1,
            leadId: sns.leadId,
            messageId: sns.id,
            type: 'reply',
            sentiment: 'positive',
            excerpt: 'DMありがとうございます。店長会で共有したいので、資料をいただけますか。',
            source: 'manual',
            receivedAt: at(now, 9, 15, 30),
          },
        ],
      }
      admin(at(now, 9, 15, 34), 'SNSの反応を手動で登録しました', c1)
    }
  }
  db = {
    ...db,
    insights: [
      ...db.insights,
      {
        id: uid('ins'),
        key: 'subject-number',
        text: '件名に店舗数などの具体的な数字を入れると、開封後の返信につながりやすい',
        detail: '導入前に手作業で送った33件の集計：数字あり 18.2%（11件）／ 数字なし 9.1%（22件）',
        lift: '×2.0',
        campaignId: 'history',
        createdAt: at(now, 20, 9),
        active: true,
      },
    ],
  }

  // ── 2. 文面の承認待ち
  const c2 = 'cmp_002'
  const t2 = at(now, 4, 14, 30)
  addCampaign(
    {
      name: '可変QR｜不動産仲介の店舗',
      product: QR,
      conditions: { industries: ['不動産'], regions: ['東京', '大阪'], size: '指定なし', count: 30, keywords: '駅前店舗、物件チラシ、店頭掲示' },
      channels: ['email', 'form'],
      evalAfterDays: 5,
      listApproval: 'manual',
      sendApproval: 'manual',
      createdAt: t2,
    },
    c2,
  )
  run('collect-leads', c2, t2 + MIN)
  {
    const ls = db.leads.filter((l) => l.campaignId === c2).sort((a, b) => b.score - a.score)
    const ok = new Set(ls.slice(0, 22).map((l) => l.id))
    db = { ...db, leads: db.leads.map((l) => (l.campaignId === c2 ? { ...l, status: ok.has(l.id) ? 'approved' : 'rejected' } : l)) }
    admin(at(now, 3, 10, 2), 'リストを承認しました（承認 22社・除外 8社）', c2)
  }
  run('draft-messages', c2, at(now, 3, 10, 4))
  {
    let i = 0
    db = { ...db, messages: db.messages.map((m) => (m.campaignId === c2 && i++ < 6 ? { ...m, status: 'approved' } : m)) }
  }

  // ── 3. リストの承認待ち
  const c3 = 'cmp_003'
  const t3 = now - 20 * HOUR
  addCampaign(
    {
      name: '可変QR｜製造業の設備ラベル',
      product: { ...QR, strengths: '設備ラベルを貼り替えずにマニュアルの版を差し替えられる\n点検手順や動画へ1つのQRでまとめて案内\n拠点ごとの読み取り数で運用状況を確認できる' },
      conditions: { industries: ['製造'], regions: ['愛知', '大阪', '京都'], size: '51〜300名', count: 26, keywords: '複数工場、保守点検、設備管理' },
      channels: ['email', 'form'],
      evalAfterDays: 7,
      listApproval: 'manual',
      sendApproval: 'manual',
      createdAt: t3,
    },
    c3,
  )
  run('collect-leads', c3, t3 + MIN)

  // ── 4. いまから収集が始まるキャンペーン（ランナーが拾う）
  const c4 = 'cmp_004'
  addCampaign(
    {
      name: '可変QR｜クリニック・医院',
      product: QR,
      conditions: { industries: ['クリニック'], regions: ['東京', '神奈川', '福岡'], size: '指定なし', count: 24, keywords: '複数院、Web予約、院内掲示' },
      channels: ['email', 'form', 'sns'],
      evalAfterDays: 7,
      createdAt: now - 2 * MIN,
    },
    c4,
  )
  db = { ...db, jobs: [...db.jobs, newJob('collect-leads', c4, now - 2 * MIN, now + 4000)] }

  db = { ...db, activities: [...db.activities].sort((a, b) => b.t - a.t) }
  return db
}
