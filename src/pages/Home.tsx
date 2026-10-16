// 最初の画面：営業リストをカードで並べる。押すと詳細へ
import { Link } from 'react-router-dom'
import { Bot, ChevronRight, Plus } from 'lucide-react'
import { useStore } from '../store'
import { stageOf, statsOf } from '../data/selectors'
import { JOB_LABEL } from '../data/agent'
import { fmtDate, pct } from '../lib/util'
import { MiniSteps, StagePill } from '../components/ui'

export default function Home() {
  const db = useStore()
  const list = [...db.campaigns].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>営業リスト</h1>
          <p>商材と条件ごとに、企業の収集 → 文面 → 送信 → 反応の確認まで、エージェントと一緒に進めます。</p>
        </div>
      </div>
      <div className="gallery">
        <Link to="/new" className="lcard new">
          <span className="ic">
            <Plus size={22} />
          </span>
          <b>新しい営業リスト</b>
          <small>商材と、探したい企業の条件を決めると、エージェントが企業を集め始めます</small>
        </Link>
        {list.map((c) => {
          const st = stageOf(db, c.id)
          const s = statsOf(db, c.id)
          const running = db.jobs.find((j) => j.campaignId === c.id && j.status === 'running')
          return (
            <Link to={`/lists/${c.id}`} className="lcard" key={c.id}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <StagePill stage={st} />
                <span className="muted small">{fmtDate(c.createdAt)}</span>
              </div>
              <b className="title">{c.name}</b>
              <div className="row wrap" style={{ gap: 4 }}>
                {[...c.conditions.industries, ...c.conditions.regions].slice(0, 4).map((x) => (
                  <span className="tag" key={x}>
                    {x}
                  </span>
                ))}
              </div>
              <MiniSteps stage={st} />
              <div className="nums">
                {[
                  ['企業', s.leads],
                  ['送信', s.sent || '—'],
                  ['返信率', s.evaluatedSent ? pct(s.replies, s.evaluatedSent) : '—'],
                ].map(([k, v]) => (
                  <span key={k}>
                    <small>{k}</small>
                    <b className="num">{v}</b>
                  </span>
                ))}
              </div>
              {running ? (
                <span className="cta agent">
                  <Bot size={15} />
                  エージェントが「{JOB_LABEL[running.type]}」を実行中
                </span>
              ) : st.tone === 'admin' ? (
                <span className="cta you">
                  あなたの確認：{st.label}
                  {st.detail ? `（${st.detail}）` : ''}
                  <ChevronRight size={15} />
                </span>
              ) : (
                <span className="cta">
                  {st.label}
                  {st.detail ? ` ・ ${st.detail}` : ''}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </>
  )
}
