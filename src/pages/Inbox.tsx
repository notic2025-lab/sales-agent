import { useMemo, useState } from 'react'
import { Bot, User } from 'lucide-react'
import { useStore } from '../store'
import { TASK_LABEL, tasksOf, type TaskKind } from '../data/selectors'
import { TaskList } from '../components/shared'

const ORDER: TaskKind[] = ['list', 'message', 'manual', 'reply', 'sns']

export default function Inbox() {
  const db = useStore()
  const tasks = useMemo(() => tasksOf(db), [db])
  const [tab, setTab] = useState<TaskKind | 'all'>('all')
  const shown = tab === 'all' ? tasks : tasks.filter((t) => t.kind === tab)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>確認待ち</h1>
          <p>エージェントは、あなたの承認なしに企業へ連絡しません。ここにある作業を確認すると、次の工程へ進みます。</p>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          すべて <span className="n">{tasks.length}</span>
        </button>
        {ORDER.map((k) => {
          const n = tasks.filter((t) => t.kind === k).length
          return (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {TASK_LABEL[k].title} <span className="n">{n}</span>
            </button>
          )
        })}
      </div>
      <div className="grid g-main">
        <section className="card">
          <div className="card-body" style={{ paddingTop: 6 }}>
            <TaskList tasks={shown} />
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>人とエージェントの分担</h2>
          </div>
          <div className="card-body">
            <ol className="reasons" style={{ gap: 12 }}>
              {[
                ['admin', 'キャンペーンを作る（商材と条件）'],
                ['agent', '企業を検索・巡回し、リストとスコアを保存'],
                ['admin', 'リストを承認'],
                ['agent', '過去の評価を参照して文面を下書き'],
                ['admin', '文面を承認し、送信を予約'],
                ['agent', 'メール送信・フォーム入力（SNSはあなたが手動送信）'],
                ['agent', '返信・配信停止・不達をチェックし、評価を集計'],
                ['admin', '返信を承認（SNSの反応は手動で登録）'],
              ].map(([who, text], i) => (
                <li key={i}>
                  {who === 'agent' ? <Bot size={16} color="var(--accent)" /> : <User size={16} color="var(--amber)" />}
                  <span>
                    <span className={`actor ${who}`} style={{ marginRight: 6 }}>
                      {who === 'agent' ? 'エージェント' : 'あなた'}
                    </span>
                    {text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </>
  )
}
