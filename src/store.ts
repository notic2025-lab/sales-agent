import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { DB, Job, LeadStatus, ReactionType, RejectReason, Sentiment, Settings } from './types'
import { applyJob, planJob } from './data/agent'
import { createSeed, defaultSettings } from './data/seed'
import * as T from './data/transitions'
import { BACKEND } from './data/backend'
import { toast } from './components/ui'
import { uid } from './lib/util'

export type { CampaignInput } from './data/transitions'

type Runner = { lastPollAt: number; lastPollFound: number }

export type Session = {
  status: 'demo' | 'loading' | 'signed_out' | 'denied' | 'ready' | 'error'
  email?: string
  error?: string
}

type Actions = {
  createCampaign: (input: T.CampaignInput) => string
  setLeadStatus: (ids: string[], status: LeadStatus) => void
  rejectLeads: (ids: string[], reason: RejectReason) => void
  skipMessage: (id: string, reason: RejectReason) => void
  startDrafting: (campaignId: string) => void
  updateMessage: (id: string, patch: { subject?: string; body?: string }) => void
  setMessagesApproved: (ids: string[], approved: boolean) => void
  rewriteMessage: (id: string) => void
  scheduleSend: (campaignId: string, messageIds: string[], runAt: number) => void
  cancelSchedule: (campaignId: string) => void
  markManualDone: (id: string) => void
  addManualReaction: (input: { messageId: string; type: ReactionType; sentiment?: Sentiment; excerpt: string }) => void
  updateReplyDraft: (reactionId: string, body: string) => void
  approveReplies: (reactionIds: string[]) => void
  runJobNow: (jobId: string) => void
  toggleInsight: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  resetDemo: () => void
  tick: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => void
}

export type Store = DB & { runner: Runner; session: Session } & Actions

// 本番（Firebase）の書き込み口。src/data/firebase.ts が起動時に差し込む
export type Remote = {
  commit: (prev: DB, patch: Partial<DB>) => Promise<void>
  resync: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}
let remote: Remote | undefined

type SetState = StoreApi<Store>['setState']
type GetState = StoreApi<Store>['getState']

const STEP_MS = 650
const POLL_MS = 3000

const pickDB = (s: Store): DB => ({
  campaigns: s.campaigns,
  leads: s.leads,
  messages: s.messages,
  reactions: s.reactions,
  jobs: s.jobs,
  insights: s.insights,
  activities: s.activities,
  suppression: s.suppression,
  settings: s.settings,
})

export const emptyDB = (): DB => ({
  campaigns: [],
  leads: [],
  messages: [],
  reactions: [],
  jobs: [],
  insights: [],
  activities: [],
  suppression: [],
  settings: defaultSettings(),
})

function actions(set: SetState, get: GetState): Actions {
  // 操作の結果（変わる部分）をデモは保存し、本番は Firestore に書き込む
  const commit = (recipe: (db: DB, now: number) => Partial<DB>) => {
    const prev = pickDB(get())
    const patch = recipe(prev, Date.now())
    if (!Object.keys(patch).length) return
    if (BACKEND === 'demo') {
      set(patch)
      return
    }
    if (!remote || get().session.status !== 'ready') {
      toast('まだ接続中です。少し待ってからもう一度お試しください', 'error')
      return
    }
    set(patch) // 画面にはすぐ反映し、Firestore からの通知で正しい状態に置き換わる
    const r = remote
    r.commit(prev, patch).catch((e: unknown) => {
      r.resync()
      toast(`保存できませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
    })
  }
  const by = () => get().session.email

  return {
    createCampaign: (input) => {
      const id = uid('cmp')
      commit((s, now) => T.createCampaign(s, input, id, now))
      return id
    },
    setLeadStatus: (ids, status) => commit((s) => T.setLeadStatus(s, ids, status)),
    rejectLeads: (ids, reason) => commit((s) => T.rejectLeads(s, ids, reason)),
    skipMessage: (id, reason) => commit((s, now) => T.skipMessage(s, id, reason, now)),
    startDrafting: (campaignId) => commit((s, now) => T.startDrafting(s, campaignId, now)),
    updateMessage: (id, patch) => commit((s) => T.updateMessage(s, id, patch)),
    setMessagesApproved: (ids, approved) => commit((s) => T.setMessagesApproved(s, ids, approved)),
    rewriteMessage: (id) => commit((s, now) => (BACKEND === 'demo' ? T.rewriteMessageNow(s, id) : T.requestRewrite(s, id, now))),
    scheduleSend: (campaignId, messageIds, runAt) => commit((s, now) => T.scheduleSend(s, campaignId, messageIds, runAt, now, by())),
    cancelSchedule: (campaignId) => commit((s, now) => T.cancelSchedule(s, campaignId, now)),
    markManualDone: (id) => commit((s, now) => T.markManualDone(s, id, now)),
    addManualReaction: (input) => commit((s, now) => T.addManualReaction(s, input, now)),
    updateReplyDraft: (reactionId, body) => commit((s) => T.updateReplyDraft(s, reactionId, body)),
    approveReplies: (reactionIds) => commit((s, now) => T.approveReplies(s, reactionIds, now, by())),
    runJobNow: (jobId) => commit((s, now) => T.runJobNow(s, jobId, now)),
    toggleInsight: (id) => commit((s) => T.toggleInsight(s, id)),
    updateSettings: (patch) => commit((s) => T.updateSettings(s, patch)),

    resetDemo: () => {
      if (BACKEND === 'demo') set({ ...createSeed(), runner: { lastPollAt: 0, lastPollFound: 0 } })
    },

    signIn: async (email, password) => (remote ? remote.signIn(email, password) : '接続の準備ができていません'),
    signOut: () => void remote?.signOut(),

    // デモのランナー：DB の未処理ジョブを確認し、ClaudeCode（ここではシミュレーション）を1件ずつ実行する
    tick: () => {
      if (BACKEND !== 'demo') return
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
  }
}

const runnerInit = (): Runner => ({ lastPollAt: 0, lastPollFound: 0 })

export const useStore: UseBoundStore<StoreApi<Store>> =
  BACKEND === 'demo'
    ? create<Store>()(
        persist((set, get) => ({ ...createSeed(), runner: runnerInit(), session: { status: 'demo' }, ...actions(set, get) }), {
          // v2：ジョブのコマンドをジョブ ID 指定に変え、送信前チェック用の項目を足した
          name: 'notic-sales-agent-demo-v2',
          storage: createJSONStorage(() => localStorage),
          partialize: (s) => pickDB(s),
        }),
      )
    : create<Store>()((set, get) => ({ ...emptyDB(), runner: runnerInit(), session: { status: 'loading' }, ...actions(set, get) }))

let started = false
let timer: number | undefined
let currentSpeed = 0

function startDemoRunner() {
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

// デモはブラウザ内のランナーを動かし、本番は Firebase に接続する（ランナーは社内の Mac で別に動く）
export function startBackend() {
  if (started) return
  started = true
  if (BACKEND === 'demo') {
    startDemoRunner()
    return
  }
  import('./data/firebase')
    .then(({ connectFirebase }) => {
      remote = connectFirebase(useStore.setState)
    })
    .catch((e: unknown) => useStore.setState({ session: { status: 'error', error: e instanceof Error ? e.message : String(e) } }))
}
