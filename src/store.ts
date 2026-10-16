import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Activity, Campaign, DB, Job, LeadStatus, ReactionType, Sentiment, Settings } from './types'
import { applyJob, composeMessage, newJob, planJob } from './data/agent'
import { createSeed } from './data/seed'
import { uid } from './lib/util'

export type CampaignInput = Omit<Campaign, 'id' | 'createdAt'>

type Runner = { lastPollAt: number; lastPollFound: number }

type Actions = {
  createCampaign: (input: CampaignInput) => string
  setLeadStatus: (ids: string[], status: LeadStatus) => void
  startDrafting: (campaignId: string) => void
  updateMessage: (id: string, patch: { subject?: string; body?: string }) => void
  setMessagesApproved: (ids: string[], approved: boolean) => void
  rewriteMessage: (id: string) => void
  scheduleSend: (campaignId: string, runAt: number) => void
  markManualDone: (id: string) => void
  addManualReaction: (input: { messageId: string; type: ReactionType; sentiment?: Sentiment; excerpt: string }) => void
  updateReplyDraft: (reactionId: string, body: string) => void
  approveReplies: (reactionIds: string[]) => void
  runJobNow: (jobId: string) => void
  toggleInsight: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  resetDemo: () => void
  tick: () => void
}

export type Store = DB & { runner: Runner } & Actions

const act = (text: string, campaignId?: string): Activity => ({ id: uid('act'), t: Date.now(), actor: 'admin', text, campaignId })

const STEP_MS = 650
const POLL_MS = 3000

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createSeed(),
      runner: { lastPollAt: 0, lastPollFound: 0 },

      createCampaign: (input) => {
        const now = Date.now()
        const id = `cmp_${now.toString(36).slice(-6)}`
        const campaign: Campaign = { ...input, id, createdAt: now }
        set((s) => ({
          campaigns: [...s.campaigns, campaign],
          jobs: [...s.jobs, newJob('collect-leads', id, now)],
          activities: [act(`キャンペーン「${campaign.name}」を作成し、リスト収集を登録しました`, id), ...s.activities],
        }))
        return id
      },

      setLeadStatus: (ids, status) => {
        const set_ = new Set(ids)
        set((s) => ({ leads: s.leads.map((l) => (set_.has(l.id) ? { ...l, status } : l)) }))
      },

      startDrafting: (campaignId) => {
        const s = get()
        const hasMsg = new Set(s.messages.filter((m) => m.campaignId === campaignId).map((m) => m.leadId))
        const approved = s.leads.filter((l) => l.campaignId === campaignId && l.status === 'approved' && !hasMsg.has(l.id))
        const pending = s.leads.filter((l) => l.campaignId === campaignId && l.status === 'pending')
        if (!approved.length) return
        const now = Date.now()
        set({
          // 承認しなかった企業は除外扱いにしてリストを確定する
          leads: s.leads.map((l) => (pending.some((p) => p.id === l.id) ? { ...l, status: 'rejected' } : l)),
          jobs: [...s.jobs, newJob('draft-messages', campaignId, now)],
          activities: [
            act(`リストを承認しました（承認 ${approved.length}社${pending.length ? `・未確認 ${pending.length}社は除外` : ''}）`, campaignId),
            ...s.activities,
          ],
        })
      },

      updateMessage: (id, patch) =>
        set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch, edited: true } : m)) })),

      setMessagesApproved: (ids, approved) => {
        const set_ = new Set(ids)
        set((s) => ({
          messages: s.messages.map((m) =>
            set_.has(m.id) && (m.status === 'draft' || m.status === 'approved') ? { ...m, status: approved ? 'approved' : 'draft' } : m,
          ),
        }))
      },

      rewriteMessage: (id) => {
        const s = get()
        const m = s.messages.find((x) => x.id === id)
        const lead = s.leads.find((l) => l.id === m?.leadId)
        const campaign = s.campaigns.find((c) => c.id === m?.campaignId)
        if (!m || !lead || !campaign) return
        const pattern = m.pattern === 'A' ? 'B' : 'A'
        const next = composeMessage(s, campaign, lead, pattern, s.insights.filter((i) => i.active))
        set({ messages: s.messages.map((x) => (x.id === id ? { ...x, ...next, pattern, edited: false, status: 'draft' } : x)) })
      },

      scheduleSend: (campaignId, runAt) => {
        const s = get()
        const ids = new Set(s.messages.filter((m) => m.campaignId === campaignId && m.status === 'approved').map((m) => m.id))
        if (!ids.size) return
        const now = Date.now()
        const existing = s.jobs.find((j) => j.campaignId === campaignId && j.type === 'send-approved' && j.status === 'queued')
        set({
          messages: s.messages.map((m) => (ids.has(m.id) ? { ...m, status: 'scheduled', scheduledAt: runAt } : m)),
          jobs: existing
            ? s.jobs.map((j) => (j.id === existing.id ? { ...j, runAt } : j))
            : [...s.jobs, newJob('send-approved', campaignId, now, runAt)],
          activities: [act(`文面 ${ids.size}件を承認し、送信を予約しました`, campaignId), ...s.activities],
        })
      },

      markManualDone: (id) =>
        set((s) => {
          const m = s.messages.find((x) => x.id === id)
          return {
            messages: s.messages.map((x) => (x.id === id ? { ...x, status: 'manual_done', sentAt: Date.now() } : x)),
            activities: [act('SNSで手動送信し、完了を登録しました', m?.campaignId), ...s.activities],
          }
        }),

      addManualReaction: ({ messageId, type, sentiment, excerpt }) =>
        set((s) => {
          const m = s.messages.find((x) => x.id === messageId)
          if (!m) return {}
          return {
            reactions: [
              ...s.reactions,
              {
                id: uid('rx'),
                campaignId: m.campaignId,
                leadId: m.leadId,
                messageId,
                type,
                sentiment: type === 'reply' ? sentiment : undefined,
                excerpt,
                source: 'manual',
                receivedAt: Date.now(),
              },
            ],
            activities: [act('SNSの反応を手動で登録しました', m.campaignId), ...s.activities],
          }
        }),

      updateReplyDraft: (reactionId, body) =>
        set((s) => ({
          reactions: s.reactions.map((r) => (r.id === reactionId && r.replyDraft ? { ...r, replyDraft: { ...r.replyDraft, body } } : r)),
        })),

      approveReplies: (reactionIds) => {
        const s = get()
        const ids = new Set(reactionIds)
        const targets = s.reactions.filter((r) => ids.has(r.id) && r.replyDraft?.status === 'draft')
        if (!targets.length) return
        const now = Date.now()
        const campaigns = [...new Set(targets.map((r) => r.campaignId))]
        set({
          reactions: s.reactions.map((r) =>
            ids.has(r.id) && r.replyDraft?.status === 'draft' ? { ...r, replyDraft: { ...r.replyDraft, status: 'scheduled' } } : r,
          ),
          jobs: [...s.jobs, ...campaigns.map((c) => newJob('send-approved', c, now, now, { kind: 'reply' }))],
          activities: [act(`返信を承認しました（${targets.length}件）`, campaigns[0]), ...s.activities],
        })
      },

      runJobNow: (jobId) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === jobId && j.status === 'queued' ? { ...j, runAt: Date.now() } : j)) })),

      toggleInsight: (id) => set((s) => ({ insights: s.insights.map((i) => (i.id === id ? { ...i, active: !i.active } : i)) })),

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      resetDemo: () => set({ ...createSeed(), runner: { lastPollAt: 0, lastPollFound: 0 } }),

      // ランナー：DB の未処理ジョブを確認し、ClaudeCode（ここではシミュレーション）を1件ずつ実行する
      tick: () => {
        const s = get()
        if (s.settings.runnerPaused) return
        const now = Date.now()
        const running = s.jobs.find((j) => j.status === 'running')
        if (running) {
          if (running.logs.length - 1 < running.plan.length) {
            const text = running.plan[running.logs.length - 1]
            set({ jobs: s.jobs.map((j) => (j.id === running.id ? { ...j, logs: [...j.logs, { t: now, text }] } : j)) })
            return
          }
          const done: Job = { ...running, status: 'done', finishedAt: now }
          const patch = applyJob({ ...s, jobs: s.jobs.map((j) => (j.id === done.id ? done : j)) }, done, now)
          set({ jobs: s.jobs.map((j) => (j.id === done.id ? done : j)), ...patch })
          return
        }
        if (now - s.runner.lastPollAt < POLL_MS / s.settings.runnerSpeed) return
        const due = s.jobs.filter((j) => j.status === 'queued' && j.runAt <= now).sort((a, b) => a.runAt - b.runAt)
        const next = due[0]
        if (!next) {
          set({ runner: { lastPollAt: now, lastPollFound: 0 } })
          return
        }
        const planned = planJob(s, next, Math.random, now)
        set({
          runner: { lastPollAt: now, lastPollFound: due.length },
          jobs: s.jobs.map((j) =>
            j.id === next.id
              ? {
                  ...j,
                  status: 'running',
                  startedAt: now,
                  plan: planned.plan,
                  payload: planned.payload,
                  summary: planned.summary,
                  logs: [{ t: now, text: `$ ${j.command}` }],
                }
              : j,
          ),
        })
      },
    }),
    {
      name: 'notic-sales-agent-demo-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ campaigns, leads, messages, reactions, jobs, insights, activities, suppression, settings }) => ({
        campaigns,
        leads,
        messages,
        reactions,
        jobs,
        insights,
        activities,
        suppression,
        settings,
      }),
    },
  ),
)

let timer: number | undefined
let currentSpeed = 0

export function startRunner() {
  const loop = () => {
    const speed = useStore.getState().settings.runnerSpeed
    if (speed !== currentSpeed) {
      currentSpeed = speed
      window.clearInterval(timer)
      timer = window.setInterval(() => {
        useStore.getState().tick()
        if (useStore.getState().settings.runnerSpeed !== currentSpeed) loop()
      }, STEP_MS / speed)
    }
  }
  loop()
}
