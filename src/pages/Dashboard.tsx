import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Info, X } from 'lucide-react'
import { useStore } from '../store'
import { stageOf, statsOf, tasksOf } from '../data/selectors'
import { DAY, num, pct, ratio } from '../lib/util'
import { IS_DEMO } from '../data/backend'
import { MiniSteps, Sparkline, StagePill } from '../components/ui'
import { ActivityFeed, AgentNow, TaskList } from '../components/shared'

// 直近の日ごとの累計（KPIの値が累計なので、線も右肩の推移で見せる）
function cumulative(ts: number[], days = 21) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const base = start.getTime() - (days - 1) * DAY
  const out = Array(days).fill(0)
  let before = 0
  for (const t of ts) {
    const i = Math.floor((t - base) / DAY)
    if (i < 0) before++
    else if (i < days) out[i]++
  }
  let acc = before
  return out.map((v) => (acc += v))
}

export default function Dashboard() {
  const db = useStore()
  const nav = useNavigate()
  const s = statsOf(db)
  const tasks = useMemo(() => tasksOf(db), [db])
  const sentMsgs = db.messages.filter((m) => m.sentAt)
  const replies = db.reactions.filter((r) => r.type === 'reply')
  const replyDrafts = db.reactions.filter((r) => r.replyDraft?.status === 'draft').length
  const byCh = (c: string) => sentMsgs.filter((m) => m.channel === c).length

  const funnel = [
    { label: '収集した企業', v: s.leads, sub: 'エージェントが収集' },
    { label: '承認した企業', v: s.approved, sub: `承認率 ${pct(s.approved, s.leads, 0)}` },
    { label: '送信', v: s.sent, sub: `承認済みの ${pct(s.sent, s.approved, 0)}` },
    { label: '返信', v: s.replies, sub: `返信率 ${pct(s.replies, s.evaluatedSent)}` },
    { label: '前向きな返信', v: s.positive, sub: '商談候補' },
  ]
  const fmax = Math.max(...funnel.map((f) => f.v), 1)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ダッシュボード</h1>
          <p>エージェントの進み具合と、あなたの確認が必要な作業をまとめています。</p>
        </div>
      </div>

      {IS_DEMO && <DemoNote />}

      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <div className="card kpi">
          <span className="label">収集した企業</span>
          <div className="value-row">
            <span className="value">{num(s.leads)}</span>
            <Sparkline data={cumulative(db.leads.map((l) => l.createdAt))} />
          </div>
          <span className="foot">承認 {s.approved}社 ・ 確認待ち {s.pendingLeads}社</span>
        </div>
        <div className="card kpi">
          <span className="label">送信</span>
          <div className="value-row">
            <span className="value">{num(s.sent)}</span>
            <Sparkline data={cumulative(sentMsgs.map((m) => m.sentAt!))} />
          </div>
          <span className="foot">
            メール {byCh('email')} ・ フォーム {byCh('form')} ・ SNS {byCh('sns')}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">返信率</span>
          <div className="value-row">
            <span className="value">
              {s.evaluatedSent ? (ratio(s.replies, s.evaluatedSent) * 100).toFixed(1) : '—'}
              <small>%</small>
            </span>
            <Sparkline data={cumulative(replies.map((r) => r.receivedAt))} color="#1D7A4C" />
          </div>
          <span className="foot">
            返信 {s.replies}件 ・ 配信停止 {s.unsub} ・ 不達 {s.bounce}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">前向きな返信</span>
          <div className="value-row">
            <span className="value">
              {s.positive}
              <small>件</small>
            </span>
          </div>
          <span className="foot">
            {replyDrafts ? (
              <Link to="/reactions?tab=todo" className="link">
                返信の承認待ち {replyDrafts}件 <ChevronRight size={14} />
              </Link>
            ) : (
              '承認待ちの返信はありません'
            )}
          </span>
        </div>
      </div>

      <div className="grid g-main" style={{ marginBottom: 18 }}>
        <section className="card">
          <div className="card-head">
            <h2>あなたの確認待ち</h2>
            <Link to="/inbox" className="link small">
              すべて見る <ChevronRight size={14} />
            </Link>
          </div>
          <div className="card-body" style={{ paddingTop: 6 }}>
            <TaskList tasks={tasks} limit={5} />
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>エージェントの動き</h2>
            <Link to="/runner" className="link small">
              ジョブ一覧 <ChevronRight size={14} />
            </Link>
          </div>
          <div className="card-body">
            <AgentNow compact />
          </div>
        </section>
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h2>全体の流れ</h2>
          <span className="sub">全キャンペーンの合計</span>
        </div>
        <div className="card-body">
          <div className="funnel">
            {funnel.map((f) => (
              <div className="stage" key={f.label}>
                <div className="label">{f.label}</div>
                <div className="v">{num(f.v)}</div>
                <div className="track">
                  <i style={{ width: `${Math.max(2, (f.v / fmax) * 100)}%` }} />
                </div>
                <small>{f.sub}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid g-main">
        <section className="card">
          <div className="card-head">
            <h2>キャンペーン</h2>
            <Link to="/campaigns" className="link small">
              すべて見る <ChevronRight size={14} />
            </Link>
          </div>
          <div className="card-body" style={{ padding: '14px 0 6px' }}>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>キャンペーン</th>
                    <th>状態</th>
                    <th className="r">送信</th>
                    <th className="r">返信率</th>
                  </tr>
                </thead>
                <tbody>
                  {[...db.campaigns].reverse().map((c) => {
                    const st = stageOf(db, c.id)
                    const cs = statsOf(db, c.id)
                    return (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/campaigns/${c.id}`)}>
                        <td className="company">
                          <b>{c.name}</b>
                          <div style={{ marginTop: 6 }}>
                            <MiniSteps stage={st} />
                          </div>
                        </td>
                        <td>
                          <StagePill stage={st} />
                          {st.detail && <div className="muted small" style={{ marginTop: 4 }}>{st.detail}</div>}
                        </td>
                        <td className="r num">{cs.sent || '—'}</td>
                        <td className="r num">{cs.evaluatedSent ? pct(cs.replies, cs.evaluatedSent) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>最近の動き</h2>
          </div>
          <div className="card-body" style={{ paddingTop: 6 }}>
            <ActivityFeed items={db.activities} limit={6} />
          </div>
        </section>
      </div>
    </>
  )
}

const NOTE_KEY = 'notic-sales-agent-note-closed'

function DemoNote() {
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem(NOTE_KEY) === '1'
    } catch {
      return false
    }
  })
  if (closed) return null
  return (
    <div className="banner blue" style={{ marginBottom: 18 }}>
      <span className="ic">
        <Info size={18} />
      </span>
      <div className="grow">
        <b>これはデモ環境です</b>
        <span className="small">
          企業・数値はすべて架空です。ランナーと ClaudeCode の処理はブラウザ内で再現しており、実際の送信は行いません。操作した内容はこのブラウザにだけ保存されます（設定からリセットできます）。
        </span>
      </div>
      <Link to="/runner" className="btn btn-sm">
        仕組みを見る
      </Link>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        aria-label="閉じる"
        onClick={() => {
          setClosed(true)
          try {
            localStorage.setItem(NOTE_KEY, '1')
          } catch {
            /* 保存できなくても表示を閉じるだけ */
          }
        }}
      >
        <X size={16} />
      </button>
    </div>
  )
}
