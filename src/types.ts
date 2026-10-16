// DB のコレクションに対応する型。デモ（localStorage）と本番（Firestore）で同じ形のまま保存する。
// 時刻はすべてミリ秒（Date.now()）。

export type Channel = 'email' | 'form' | 'sns'

export type Campaign = {
  id: string
  name: string
  product: {
    name: string
    summary: string
    strengths: string
    url: string
  }
  conditions: {
    industries: string[]
    regions: string[]
    size: string
    count: number
    keywords: string
  }
  channels: Channel[]
  evalAfterDays: number
  // auto（既定）：確信度の高い企業はエージェントが承認し、すぐ文面作成へ。低いものは「要確認」として残る
  // manual：すべて人が承認する
  listApproval?: 'auto' | 'manual'
  // auto（既定）：自動チェックを通った文面は承認なしで送信予約へ。通らないものは「要確認」として残る
  // manual：文面を人が承認し、送信前の最終確認をしてから送る
  sendApproval?: 'auto' | 'manual'
  createdAt: number
}

export type LeadStatus = 'pending' | 'approved' | 'rejected'
export type Confidence = 'high' | 'medium' | 'low'
// 人が企業を外したときの理由。次の収集で「過去に除外された傾向」として参照する
export type RejectReason = 'industry' | 'size' | 'individual' | 'contact' | 'customer' | 'other'

export type Lead = {
  id: string
  campaignId: string
  company: string
  domain: string
  industry: string
  region: string
  employees: string
  summary: string
  email?: string
  // メールアドレスを公開しているページの URL。公開アドレスにだけ送る（特定電子メール法の例外）根拠として残す
  emailSource?: string
  formUrl?: string
  sns?: string
  channel: Channel
  score: number
  scoreReasons: string[]
  pages: string[]
  status: LeadStatus
  // 条件に合う確信度と、その根拠（サイトの URL と引用）
  confidence?: Confidence
  evidence?: { url: string; quote: string }[]
  autoApproved?: boolean
  rejectReason?: RejectReason
  createdAt: number
}

export type MessageStatus =
  | 'draft'
  | 'approved'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'manual_pending'
  | 'manual_done'
  | 'bounced'
  // 人が「この企業には送らない」と決めた
  | 'skipped'

export type Message = {
  id: string
  campaignId: string
  leadId: string
  channel: Channel
  pattern: 'A' | 'B'
  subject: string
  body: string
  // エージェントが書いた部分（相手企業に触れる数文）。残りは固定の骨格と署名
  intro?: string
  insightIds: string[]
  status: MessageStatus
  edited: boolean
  scheduledAt?: number
  // 送信前の最終確認をした人（本番ではログイン中の管理者のメールアドレス）
  scheduledBy?: string
  sentAt?: number
  messageId?: string
  threadId?: string
  // 送れなかった理由（フォームの CAPTCHA など。人の判断に回す）
  sendError?: string
  createdAt: number
}

export type ReactionType = 'reply' | 'unsubscribe' | 'bounce' | 'no_response'
export type Sentiment = 'positive' | 'neutral' | 'negative'

export type Reaction = {
  id: string
  campaignId: string
  leadId: string
  messageId: string
  type: ReactionType
  sentiment?: Sentiment
  excerpt: string
  source: 'gmail' | 'manual'
  receivedAt: number
  // 返信の差出人とスレッド（承認した返信を同じスレッドに送るため）
  fromAddress?: string
  threadId?: string
  gmailMessageId?: string
  rfcMessageId?: string
  replyDraft?: {
    body: string
    status: 'draft' | 'scheduled' | 'sending' | 'sent'
    approvedBy?: string
    sentAt?: number
  }
}

export type JobType = 'collect-leads' | 'draft-messages' | 'send-approved' | 'evaluate'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export type Job = {
  id: string
  type: JobType
  campaignId: string
  status: JobStatus
  command: string
  createdAt: number
  runAt: number
  startedAt?: number
  finishedAt?: number
  plan: string[]
  logs: { t: number; text: string }[]
  summary?: string
  // デモ：実行開始時に計算し、完了時に DB へ書き込む結果／本番：ジョブへの指示（返信の送信、書き直しの対象など）
  payload?: unknown
  // 本番のランナーが書き込む
  runnerId?: string
  error?: string
}

export type Insight = {
  id: string
  key: string
  text: string
  detail: string
  lift: string
  campaignId: string
  createdAt: number
  active: boolean
}

export type Activity = {
  id: string
  t: number
  actor: 'admin' | 'agent'
  text: string
  campaignId?: string
}

export type Settings = {
  senderCompany: string
  senderName: string
  senderEmail: string
  // 特定電子メール法で表示が必要な送信者の住所
  senderAddress?: string
  signature: string
  dailyLimit: number
  sendWindow: string
  skipWeekend: boolean
  // 既存顧客のドメイン。収集の候補に入れない
  customerDomains?: string[]
  // 送信を一時停止する（予約は残り、再開すると送られる）
  sendingPaused?: boolean
  runnerPaused: boolean
  runnerSpeed: 1 | 2 | 4
}

export type DB = {
  campaigns: Campaign[]
  leads: Lead[]
  messages: Message[]
  reactions: Reaction[]
  jobs: Job[]
  insights: Insight[]
  activities: Activity[]
  suppression: string[]
  settings: Settings
}
