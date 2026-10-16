import type { DB, Job, Message } from '../types'
import { fmtDate, fmtDateTime } from '../lib/util'

export const STEPS = [
  { label: 'リスト収集', actor: 'agent' },
  { label: 'リスト承認', actor: 'admin' },
  { label: '文面作成', actor: 'agent' },
  { label: '文面承認・送信予約', actor: 'admin' },
  { label: '送信', actor: 'agent' },
  { label: '反応チェック・評価', actor: 'agent' },
] as const

export type Tone = 'agent' | 'admin' | 'wait' | 'done'
export type Stage = { step: number; label: string; tone: Tone; detail?: string }

const isReplyJob = (j: Job) => (j.payload as { kind?: string } | undefined)?.kind === 'reply'
const SENT: Message['status'][] = ['sent', 'manual_done', 'bounced']

export function stageOf(db: DB, campaignId: string): Stage {
  const jobs = db.jobs.filter((j) => j.campaignId === campaignId)
  const live = (type: Job['type']) =>
    jobs.find((j) => j.type === type && !isReplyJob(j) && (j.status === 'running' || j.status === 'queued'))
  const leads = db.leads.filter((l) => l.campaignId === campaignId)
  const msgs = db.messages.filter((m) => m.campaignId === campaignId)

  const collect = live('collect-leads')
  if (collect) return { step: 0, label: collect.status === 'running' ? 'リストを収集中' : '収集の順番待ち', tone: 'agent' }
  const draft = live('draft-messages')
  if (draft) return { step: 2, label: draft.status === 'running' ? '文面を作成中' : '文面作成の順番待ち', tone: 'agent' }
  if (!msgs.length) {
    const pending = leads.filter((l) => l.status === 'pending').length
    if (pending) return { step: 1, label: 'リストの承認待ち', tone: 'admin', detail: `${pending}社を確認` }
    return { step: 1, label: '承認する企業がありません', tone: 'wait' }
  }
  const send = live('send-approved')
  if (send?.status === 'running') return { step: 4, label: '送信中', tone: 'agent' }
  const drafts = msgs.filter((m) => m.status === 'draft' || m.status === 'approved')
  if (drafts.length) {
    const ok = drafts.filter((m) => m.status === 'approved').length
    return { step: 3, label: '文面の承認待ち', tone: 'admin', detail: `${ok}/${drafts.length}件 承認済み` }
  }
  if (send) return { step: 4, label: '送信予約済み', tone: 'wait', detail: fmtDateTime(send.runAt) }
  const manual = msgs.filter((m) => m.status === 'manual_pending').length
  const evalJob = live('evaluate')
  if (evalJob?.status === 'running') return { step: 5, label: '反応をチェック中', tone: 'agent' }
  if (evalJob) {
    if (manual) return { step: 5, label: 'SNSの手動送信待ち', tone: 'admin', detail: `${manual}件` }
    return { step: 5, label: '反応待ち', tone: 'wait', detail: `評価 ${fmtDate(evalJob.runAt)}` }
  }
  const replyDrafts = db.reactions.filter((r) => r.campaignId === campaignId && r.replyDraft?.status === 'draft').length
  if (jobs.some((j) => j.type === 'evaluate' && j.status === 'done')) {
    if (replyDrafts) return { step: 6, label: '返信の承認待ち', tone: 'admin', detail: `${replyDrafts}件` }
    if (manual) return { step: 6, label: 'SNSの手動送信待ち', tone: 'admin', detail: `${manual}件` }
    return { step: 6, label: '評価済み', tone: 'done' }
  }
  return { step: 4, label: '送信待ち', tone: 'wait' }
}

export type TaskKind = 'list' | 'message' | 'manual' | 'reply' | 'sns'
export type Task = {
  key: string
  kind: TaskKind
  campaignId: string
  count: number
  to: string
}

export const TASK_LABEL: Record<TaskKind, { title: string; action: string }> = {
  list: { title: 'リストの承認', action: '企業リストを確認' },
  message: { title: '文面の承認と送信予約', action: '文面を確認' },
  manual: { title: 'SNSの手動送信', action: '送信して完了登録' },
  reply: { title: '返信の承認', action: '返信を確認' },
  sns: { title: 'SNSの反応を登録', action: '反応を登録' },
}

export function tasksOf(db: DB): Task[] {
  const out: Task[] = []
  for (const c of db.campaigns) {
    const st = stageOf(db, c.id)
    const msgs = db.messages.filter((m) => m.campaignId === c.id)
    if (st.step === 1 && st.tone === 'admin') {
      out.push({ key: `list-${c.id}`, kind: 'list', campaignId: c.id, count: db.leads.filter((l) => l.campaignId === c.id && l.status === 'pending').length, to: `/lists/${c.id}?tab=leads` })
    }
    const drafts = msgs.filter((m) => m.status === 'draft' || m.status === 'approved').length
    if (drafts && st.step === 3) out.push({ key: `msg-${c.id}`, kind: 'message', campaignId: c.id, count: drafts, to: `/lists/${c.id}?tab=messages` })
    const manual = msgs.filter((m) => m.status === 'manual_pending').length
    if (manual) out.push({ key: `manual-${c.id}`, kind: 'manual', campaignId: c.id, count: manual, to: `/lists/${c.id}?tab=messages&filter=manual` })
    const replies = db.reactions.filter((r) => r.campaignId === c.id && r.replyDraft?.status === 'draft').length
    if (replies) out.push({ key: `reply-${c.id}`, kind: 'reply', campaignId: c.id, count: replies, to: `/lists/${c.id}?tab=reactions` })
    const reacted = new Set(db.reactions.map((r) => r.messageId))
    const sns = msgs.filter((m) => m.channel === 'sns' && m.status === 'manual_done' && !reacted.has(m.id)).length
    if (sns) out.push({ key: `sns-${c.id}`, kind: 'sns', campaignId: c.id, count: sns, to: `/lists/${c.id}?tab=reactions` })
  }
  return out
}

export function statsOf(db: DB, campaignId?: string) {
  const f = <T extends { campaignId: string }>(xs: T[]) => (campaignId ? xs.filter((x) => x.campaignId === campaignId) : xs)
  const leads = f(db.leads)
  const msgs = f(db.messages)
  const rx = f(db.reactions)
  const sent = msgs.filter((m) => SENT.includes(m.status))
  const replies = rx.filter((r) => r.type === 'reply')
  const reacted = new Set(rx.map((r) => r.messageId))
  return {
    leads: leads.length,
    approved: leads.filter((l) => l.status === 'approved').length,
    pendingLeads: leads.filter((l) => l.status === 'pending').length,
    drafts: msgs.filter((m) => m.status === 'draft' || m.status === 'approved').length,
    sent: sent.length,
    // 返信率の分母：評価（反応の記録）まで終わった送信
    evaluatedSent: sent.filter((m) => reacted.has(m.id)).length,
    replies: replies.length,
    positive: replies.filter((r) => r.sentiment === 'positive').length,
    neutral: replies.filter((r) => r.sentiment === 'neutral').length,
    negative: replies.filter((r) => r.sentiment === 'negative').length,
    unsub: rx.filter((r) => r.type === 'unsubscribe').length,
    bounce: rx.filter((r) => r.type === 'bounce').length,
    noResponse: rx.filter((r) => r.type === 'no_response').length,
    evaluated: rx.length,
  }
}

export const isSent = (m: Message) => SENT.includes(m.status)

// デモは手順の数が分かるので％を出す。本番は手順の数が分からないので null（動いていることだけ見せる）
export function jobProgress(job: Job): number | null {
  if (!job.plan.length) return null
  return Math.min(100, Math.round(((job.logs.length - 1) / job.plan.length) * 100))
}
