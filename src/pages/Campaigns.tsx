import { Link, useNavigate } from 'react-router-dom'
import { Megaphone, Plus } from 'lucide-react'
import { useStore } from '../store'
import { stageOf, statsOf } from '../data/selectors'
import { CHANNEL_LABEL } from '../data/agent'
import { fmtDate, pct } from '../lib/util'
import { Empty, MiniSteps, StagePill } from '../components/ui'

export default function Campaigns() {
  const db = useStore()
  const nav = useNavigate()
  const list = [...db.campaigns].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>キャンペーン</h1>
          <p>商材と条件ごとに、収集から評価までの流れを管理します。</p>
        </div>
        <div className="actions">
          <Link to="/campaigns/new" className="btn btn-primary">
            <Plus size={18} />
            キャンペーン作成
          </Link>
        </div>
      </div>
      <section className="card">
        {list.length === 0 ? (
          <Empty icon={<Megaphone size={22} />} title="キャンペーンはまだありません">
            「キャンペーン作成」から、商材と条件を登録してください。
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>キャンペーン</th>
                  <th>状態</th>
                  <th className="hide-sm">条件</th>
                  <th className="r">企業</th>
                  <th className="r">送信</th>
                  <th className="r">返信率</th>
                  <th className="r hide-sm">作成</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const st = stageOf(db, c.id)
                  const s = statsOf(db, c.id)
                  return (
                    <tr key={c.id} className="clickable" onClick={() => nav(`/campaigns/${c.id}`)}>
                      <td className="company" style={{ minWidth: 240 }}>
                        <b>{c.name}</b>
                        <small>{c.id}</small>
                        <div style={{ marginTop: 6 }}>
                          <MiniSteps stage={st} />
                        </div>
                      </td>
                      <td>
                        <StagePill stage={st} />
                        {st.detail && <div className="muted small" style={{ marginTop: 4 }}>{st.detail}</div>}
                      </td>
                      <td className="hide-sm">
                        <div className="row wrap" style={{ gap: 4, maxWidth: 300 }}>
                          {[...c.conditions.industries, ...c.conditions.regions].slice(0, 4).map((x) => (
                            <span className="tag" key={x}>
                              {x}
                            </span>
                          ))}
                          {c.channels.map((ch) => (
                            <span className="tag" key={ch}>
                              {CHANNEL_LABEL[ch]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="r num">
                        {s.leads}
                        {s.pendingLeads > 0 && <div className="muted small">確認待ち {s.pendingLeads}</div>}
                      </td>
                      <td className="r num">{s.sent || '—'}</td>
                      <td className="r num">{s.evaluatedSent ? pct(s.replies, s.evaluatedSent) : '—'}</td>
                      <td className="r muted hide-sm">{fmtDate(c.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
