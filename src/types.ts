// DB のテーブルに対応する型。実運用ではこの形のまま Supabase などに置き換えられるようにしている。

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
  createdAt: number
}

export type LeadStatus = 'pending' | 'approved' | 'rejected'

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
  formUrl?: string
  sns?: string
  channel: Channel
  score: number
  scoreReasons: string[]
  pages: string[]
  status: LeadStatus
  createdAt: number
}

export type MessageStatus =
  | 'draft'
  | 'approved'
  | 'scheduled'
  | 'sent'
  | 'manual_pending'
  | 'manual_done'
  | 'bounced'

export type Message = {
  id: string
  campaignId: string
  leadId: string
  channel: Channel
  pattern: 'A' | 'B'
  subject: string
  body: string
  insightIds: string[]
  status: MessageStatus
  edited: boolean
  scheduledAt?: number
  sentAt?: number
  messageId?: string
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
  replyDraft?: {
    body: string
    status: 'draft' | 'scheduled' | 'sent'
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
  // 実行開始時に計算し、完了時に DB へ書き込む結果
  payload?: unknown
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
  signature: string
  dailyLimit: number
  sendWindow: string
  skipWeekend: boolean
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
