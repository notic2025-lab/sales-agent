import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AtSign } from 'lucide-react'
import { useStore } from '../store'
import type { ReactionType } from '../types'
import { statsOf } from '../data/selectors'
import { ManualReactionModal, ReactionTable, ReplyApproveAll } from '../components/reactions'

type Tab = 'todo' | 'all' | ReactionType

export default function Reactions() {
  const db = useStore()
  const [params, setParams] = useSearchParams()
  const campaign = params.get('campaign') ?? ''
  const [registering, setRegistering] = useState(params.get('register') === '1')
  const base = db.reactions.filter((r) => !campaign || r.campaignId === campaign)
  const todo = base.filter((r) => r.replyDraft?.status === 'draft')
  const tab = (params.get('tab') as Tab) || (todo.length ? 'todo' : 'all')
  const s = statsOf(db, campaign || undefined)

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    next.delete('register')
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  const shown = tab === 'todo' ? todo : tab === 'all' ? base : base.filter((r) => r.type === tab)
  const count = (t: ReactionType) => base.filter((r) => r.type === t).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>反応</h1>
          <p>評価ジョブが Gmail から拾った返信・配信停止・不達と、手動で登録したSNSの反応です。</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setRegistering(true)}>
            <AtSign size={16} />
            SNSの反応を登録
          </button>
          {tab === 'todo' && <ReplyApproveAll ids={todo.map((r) => r.id)} />}
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <div className="card kpi">
          <span className="label">返信</span>
          <span className="value">{s.replies}</span>
          <span className="foot">
            <span className="up">前向き {s.positive}</span> ・ 検討 {s.neutral} ・ お断り {s.negative}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">配信停止</span>
          <span className="value">{s.unsub}</span>
          <span className="foot">配信停止リスト {db.suppression.length}社に反映</span>
        </div>
        <div className="card kpi">
          <span className="label">不達</span>
          <span className="value">{s.bounce}</span>
          <span className="foot">次回は別の連絡先を使います</span>
        </div>
        <div className="card kpi">
          <span className="label">無反応</span>
          <span className="value">{s.noResponse}</span>
          <span className="foot">評価のタイミングまでに反応なし</span>
        </div>
      </div>

      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 0, flex: '1 1 auto' }}>
          {(
            [
              ['todo', '返信の承認待ち', todo.length],
              ['all', 'すべて', base.length],
              ['reply', '返信', count('reply')],
              ['unsubscribe', '配信停止', count('unsubscribe')],
              ['bounce', '不達', count('bounce')],
              ['no_response', '無反応', count('no_response')],
            ] as [Tab, string, number][]
          ).map(([k, label, n]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k })}>
              {label} <span className="n">{n}</span>
              {k === 'todo' && n > 0 && <span className="alert" />}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 220 }} value={campaign} onChange={(e) => set({ campaign: e.target.value })} aria-label="キャンペーンで絞り込み">
          <option value="">すべてのキャンペーン</option>
          {db.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ borderBottom: '1px solid var(--line)', marginBottom: 18 }} />

      <div className="card">
        <ReactionTable reactions={shown} showCampaign={!campaign} />
      </div>

      {registering && <ManualReactionModal campaignId={campaign || undefined} onClose={() => setRegistering(false)} />}
    </>
  )
}
