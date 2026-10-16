// 管理者の操作を「いまの DB → 変わる部分」の純粋な関数にしたもの。
// デモはこの結果をそのまま localStorage に保存し、本番は変わった行だけを Firestore に書き込む。
// 変わらない行は同じオブジェクトのまま返す（本番の差分書き込みが参照の一致で判定するため）。
import type { Activity, Campaign, DB, LeadStatus, Message, ReactionType, RejectReason, Sentiment, Settings } from '../types'
import { autoSchedule, composeMessage, newJob } from './agent'
import { REJECT_REASON, isAutoList, isAutoSend } from './leads'
import { uid } from '../lib/util'

export type CampaignInput = Omit<Campaign, 'id' | 'createdAt'>
type Patch = Partial<DB>

const act = (now: number, text: string, campaignId?: string): Activity => ({ id: uid('act'), t: now, actor: 'admin', text, campaignId })
const isOutreachSend = (j: DB['jobs'][number]) =>
  j.type === 'send-approved' && (j.payload as { kind?: string } | undefined)?.kind !== 'reply'

export function createCampaign(s: DB, input: CampaignInput, id: string, now: number): Patch {
  const campaign: Campaign = { ...input, id, createdAt: now }
  return {
    campaigns: [...s.campaigns, campaign],
    jobs: [...s.jobs, newJob('collect-leads', id, now)],
    activities: [act(now, `営業リスト「${campaign.name}」を作成し、企業の収集を登録しました`, id), ...s.activities],
  }
}

export function setLeadStatus(s: DB, ids: string[], status: LeadStatus): Patch {
  const set_ = new Set(ids)
  return { leads: s.leads.map((l) => (set_.has(l.id) && l.status !== status ? { ...l, status, rejectReason: undefined } : l)) }
}

// 理由つきで除外する（次の収集で参照する）
export function rejectLeads(s: DB, ids: string[], reason: RejectReason): Patch {
  const set_ = new Set(ids)
  return { leads: s.leads.map((l) => (set_.has(l.id) ? { ...l, status: 'rejected', rejectReason: reason } : l)) }
}

export function startDrafting(s: DB, campaignId: string, now: number): Patch {
  const hasMsg = new Set(s.messages.filter((m) => m.campaignId === campaignId).map((m) => m.leadId))
  const approved = s.leads.filter((l) => l.campaignId === campaignId && l.status === 'approved' && !hasMsg.has(l.id))
  const campaign = s.campaigns.find((c) => c.id === campaignId)
  // 手動承認では、承認しなかった企業を除外扱いにしてリストを確定する。自動承認では「要確認」のまま残す（見なくても送られない）
  const pending = new Set(
    campaign && isAutoList(campaign) ? [] : s.leads.filter((l) => l.campaignId === campaignId && l.status === 'pending').map((l) => l.id),
  )
  if (!approved.length) return {}
  return {
    leads: s.leads.map((l) => (pending.has(l.id) ? { ...l, status: 'rejected' } : l)),
    jobs: [...s.jobs, newJob('draft-messages', campaignId, now)],
    activities: [
      act(now, `リストを承認しました（承認 ${approved.length}社${pending.size ? `・未確認 ${pending.size}社は除外` : ''}）`, campaignId),
      ...s.activities,
    ],
  }
}

// 文面の段階で「この企業には送らない」。企業も理由つきで除外し、自動承認の精度の指標にする
export function skipMessage(s: DB, id: string, reason: RejectReason, now: number): Patch {
  const m = s.messages.find((x) => x.id === id)
  if (!m || (m.status !== 'draft' && m.status !== 'approved')) return {}
  const lead = s.leads.find((l) => l.id === m.leadId)
  return {
    messages: s.messages.map((x) => (x.id === id ? { ...x, status: 'skipped' } : x)),
    leads: s.leads.map((l) => (l.id === m.leadId ? { ...l, status: 'rejected', rejectReason: reason } : l)),
    activities: [act(now, `「${lead?.company ?? ''}」には送らないことにしました（${REJECT_REASON[reason]}）`, m.campaignId), ...s.activities],
  }
}

export function updateMessage(s: DB, id: string, patch: { subject?: string; body?: string }): Patch {
  return { messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch, edited: true } : m)) }
}

export function setMessagesApproved(s: DB, ids: string[], approved: boolean, now = Date.now(), by?: string): Patch {
  const set_ = new Set(ids)
  const to: Message['status'] = approved ? 'approved' : 'draft'
  const messages: Message[] = s.messages.map((m) =>
    set_.has(m.id) && (m.status === 'draft' || m.status === 'approved') && m.status !== to ? { ...m, status: to } : m,
  )
  if (!approved) return { messages }
  // 承認なしで送る営業リストでは、人が要確認の文面を承認したらそのまま送信予約に入る
  const first = s.messages.find((m) => set_.has(m.id))
  const campaign = s.campaigns.find((c) => c.id === first?.campaignId)
  if (!campaign || !isAutoSend(campaign)) return { messages }
  const r = autoSchedule({ ...s, messages }, campaign, ids, now, by ?? 'admin')
  return { ...r.patch, messages: r.patch.messages ?? messages }
}

// デモ：その場で別パターンの文面に差し替える
export function rewriteMessageNow(s: DB, id: string): Patch {
  const m = s.messages.find((x) => x.id === id)
  const lead = s.leads.find((l) => l.id === m?.leadId)
  const campaign = s.campaigns.find((c) => c.id === m?.campaignId)
  if (!m || !lead || !campaign) return {}
  const pattern = m.pattern === 'A' ? 'B' : 'A'
  const next = composeMessage(s, campaign, lead, pattern, s.insights.filter((i) => i.active))
  return { messages: s.messages.map((x) => (x.id === id ? { ...x, ...next, pattern, edited: false, status: 'draft' } : x)) }
}

// 本番：書き直しを /draft-messages に依頼する（下書きに戻し、ランナーが次の確認で書き直す）
export function requestRewrite(s: DB, id: string, now: number): Patch {
  const m = s.messages.find((x) => x.id === id)
  if (!m || (m.status !== 'draft' && m.status !== 'approved')) return {}
  const pattern = m.pattern === 'A' ? 'B' : 'A'
  return {
    messages: s.messages.map((x) => (x.id === id && x.status !== 'draft' ? { ...x, status: 'draft' } : x)),
    jobs: [...s.jobs, newJob('draft-messages', m.campaignId, now, now, { rewrite: [{ messageId: id, pattern }] })],
  }
}

// 送信前の最終確認を通った文面だけを予約する
export function scheduleSend(s: DB, campaignId: string, messageIds: string[], runAt: number, now: number, by?: string): Patch {
  const want = new Set(messageIds)
  const ids = new Set(s.messages.filter((m) => m.campaignId === campaignId && m.status === 'approved' && want.has(m.id)).map((m) => m.id))
  if (!ids.size) return {}
  const existing = s.jobs.find((j) => j.campaignId === campaignId && isOutreachSend(j) && j.status === 'queued')
  return {
    messages: s.messages.map((m) => (ids.has(m.id) ? { ...m, status: 'scheduled', scheduledAt: runAt, scheduledBy: by } : m)),
    jobs: existing
      ? s.jobs.map((j) => (j.id === existing.id ? { ...j, runAt: Math.min(j.runAt, runAt) } : j))
      : [...s.jobs, newJob('send-approved', campaignId, now, runAt, { kind: 'outreach' })],
    activities: [act(now, `送信前の最終確認をして、文面 ${ids.size}件の送信を予約しました`, campaignId), ...s.activities],
  }
}

// 送信が始まる前なら予約を取り消せる（承認済みに戻す）
export function cancelSchedule(s: DB, campaignId: string, now: number): Patch {
  const job = s.jobs.find((j) => j.campaignId === campaignId && isOutreachSend(j) && j.status === 'queued')
  const ids = new Set(s.messages.filter((m) => m.campaignId === campaignId && m.status === 'scheduled').map((m) => m.id))
  if (!ids.size) return {}
  return {
    messages: s.messages.map((m) => (ids.has(m.id) ? { ...m, status: 'approved', scheduledAt: undefined, scheduledBy: undefined } : m)),
    jobs: job ? s.jobs.filter((j) => j.id !== job.id) : s.jobs,
    activities: [act(now, `送信予約を取り消しました（${ids.size}件を承認済みに戻しました）`, campaignId), ...s.activities],
  }
}

export function markManualDone(s: DB, id: string, now: number): Patch {
  const m = s.messages.find((x) => x.id === id)
  if (!m || m.status !== 'manual_pending') return {}
  return {
    messages: s.messages.map((x) => (x.id === id ? { ...x, status: 'manual_done', sentAt: now } : x)),
    activities: [act(now, 'SNSで手動送信し、完了を登録しました', m.campaignId), ...s.activities],
  }
}

export function addManualReaction(
  s: DB,
  input: { messageId: string; type: ReactionType; sentiment?: Sentiment; excerpt: string },
  now: number,
): Patch {
  const m = s.messages.find((x) => x.id === input.messageId)
  const lead = s.leads.find((l) => l.id === m?.leadId)
  if (!m) return {}
  return {
    reactions: [
      ...s.reactions,
      {
        id: uid('rx'),
        campaignId: m.campaignId,
        leadId: m.leadId,
        messageId: m.id,
        type: input.type,
        sentiment: input.type === 'reply' ? input.sentiment : undefined,
        excerpt: input.excerpt,
        source: 'manual',
        receivedAt: now,
      },
    ],
    // SNS でも配信停止を頼まれたら、以後は連絡しない
    suppression:
      input.type === 'unsubscribe' && lead && !s.suppression.includes(lead.domain.toLowerCase())
        ? [...s.suppression, lead.domain.toLowerCase()]
        : s.suppression,
    activities: [act(now, 'SNSの反応を手動で登録しました', m.campaignId), ...s.activities],
  }
}

export function updateReplyDraft(s: DB, reactionId: string, body: string): Patch {
  return {
    reactions: s.reactions.map((r) =>
      r.id === reactionId && r.replyDraft?.status === 'draft' && r.replyDraft.body !== body ? { ...r, replyDraft: { ...r.replyDraft, body } } : r,
    ),
  }
}

export function approveReplies(s: DB, reactionIds: string[], now: number, by?: string): Patch {
  const ids = new Set(reactionIds)
  const targets = s.reactions.filter((r) => ids.has(r.id) && r.replyDraft?.status === 'draft')
  if (!targets.length) return {}
  const campaigns = [...new Set(targets.map((r) => r.campaignId))]
  return {
    reactions: s.reactions.map((r) =>
      ids.has(r.id) && r.replyDraft?.status === 'draft' ? { ...r, replyDraft: { ...r.replyDraft, status: 'scheduled', approvedBy: by } } : r,
    ),
    jobs: [...s.jobs, ...campaigns.map((c) => newJob('send-approved', c, now, now, { kind: 'reply' }))],
    activities: [act(now, `返信を確認して承認しました（${targets.length}件）`, campaigns[0]), ...s.activities],
  }
}

// 予約を待たずに実行する。送信ジョブなら、予約済みの文面の予約時刻も今に寄せる
export function runJobNow(s: DB, jobId: string, now: number): Patch {
  const job = s.jobs.find((j) => j.id === jobId && j.status === 'queued')
  if (!job) return {}
  const pull = isOutreachSend(job)
  return {
    jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, runAt: now } : j)),
    messages: pull
      ? s.messages.map((m) =>
          m.campaignId === job.campaignId && m.status === 'scheduled' && (m.scheduledAt ?? 0) > now ? { ...m, scheduledAt: now } : m,
        )
      : s.messages,
  }
}

export function toggleInsight(s: DB, id: string): Patch {
  return { insights: s.insights.map((i) => (i.id === id ? { ...i, active: !i.active } : i)) }
}

export function updateSettings(s: DB, patch: Partial<Settings>): Patch {
  return { settings: { ...s.settings, ...patch } }
}
