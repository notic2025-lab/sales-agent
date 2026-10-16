import { Link } from 'react-router-dom'
import { AtSign, Bot, ChevronRight, CircleCheck, FilePenLine, ListChecks, MessageCircle, MessageSquareReply, Play, User } from 'lucide-react'
import { useStore } from '../store'
import { TASK_LABEL, type Task, type TaskKind } from '../data/selectors'
import { JOB_LABEL } from '../data/agent'
import type { Activity, Job } from '../types'
import { cx, fmtDateTime, relTime } from '../lib/util'
import { Empty, Terminal, toast } from './ui'

const TASK_ICON: Record<TaskKind, typeof ListChecks> = {
  list: ListChecks,
  message: FilePenLine,
  manual: AtSign,
  reply: MessageSquareReply,
  sns: MessageCircle,
}

const UNIT: Record<TaskKind, string> = { list: '社', message: '件', manual: '件', reply: '件', sns: '件' }

export function TaskList({ tasks, limit }: { tasks: Task[]; limit?: number }) {
  const campaigns = useStore((s) => s.campaigns)
  if (!tasks.length) {
    return (
      <Empty icon={<CircleCheck size={22} />} title="確認待ちはありません">
        エージェントが次の作業を進めています。
      </Empty>
    )
  }
  return (
    <div>
      {tasks.slice(0, limit).map((t) => {
        const Icon = TASK_ICON[t.kind]
        return (
          <Link to={t.to} key={t.key} className="task">
            <span className="ic">
              <Icon size={19} />
            </span>
            <span className="grow">
              <b>{TASK_LABEL[t.kind].title}</b>
              <span className="meta">{campaigns.find((c) => c.id === t.campaignId)?.name}</span>
            </span>
            <span className="count">
              {t.count}
              <small>{UNIT[t.kind]}</small>
            </span>
            <span className="btn btn-sm hide-sm">
              {TASK_LABEL[t.kind].action}
              <ChevronRight size={15} />
            </span>
          </Link>
        )
      })}
    </div>
  )
}

export function ActivityFeed({ items, limit = 8 }: { items: Activity[]; limit?: number }) {
  if (!items.length) return <Empty icon={<Bot size={22} />} title="まだ動きはありません" />
  return (
    <div>
      {items.slice(0, limit).map((a) => (
        <div className="feed-item" key={a.id}>
          <span className={cx('av', a.actor)}>{a.actor === 'agent' ? <Bot size={15} /> : <User size={15} />}</span>
          <div>
            <p>
              <b>{a.actor === 'agent' ? 'エージェント' : 'あなた'}</b>　{a.text}
            </p>
            <small>{relTime(a.t)}</small>
          </div>
        </div>
      ))}
    </div>
  )
}

export function AgentNow({ compact }: { compact?: boolean }) {
  const jobs = useStore((s) => s.jobs)
  const campaigns = useStore((s) => s.campaigns)
  const paused = useStore((s) => s.settings.runnerPaused)
  const lastPollAt = useStore((s) => s.runner.lastPollAt)
  const runJobNow = useStore((s) => s.runJobNow)
  const running = jobs.find((j) => j.status === 'running')
  const now = Date.now()
  const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.runAt - b.runAt)
  const last = [...jobs].filter((j) => j.status === 'done').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]
  const name = (j: Job) => campaigns.find((c) => c.id === j.campaignId)?.name

  if (running) {
    const p = Math.round(((running.logs.length - 1) / Math.max(1, running.plan.length)) * 100)
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div className="row">
          <span className="live-dot busy" />
          <b>{JOB_LABEL[running.type]}</b>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {p}%
          </span>
        </div>
        <div className="muted small">{name(running)}</div>
        <div className="progress">
          <i style={{ width: `${p}%` }} />
        </div>
        <Terminal job={running} maxHeight={compact ? 190 : 260} follow />
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <span className={cx('live-dot', paused && 'off')} />
        <b>{paused ? '一時停止中' : '待機中'}</b>
        {!paused && lastPollAt > 0 && <span className="muted small">未処理ジョブを確認：{relTime(lastPollAt)}</span>}
      </div>
      {queued.length > 0 ? (
        <div>
          <div className="section-title">予約・順番待ちのジョブ</div>
          {queued.slice(0, 3).map((j) => (
            <div className="task" key={j.id} style={{ padding: '10px 0' }}>
              <span className="grow">
                <b style={{ fontSize: 13.5 }}>{JOB_LABEL[j.type]}</b>
                <span className="meta">
                  {name(j)} ・ {j.runAt <= now ? 'まもなく実行' : fmtDateTime(j.runAt)}
                </span>
              </span>
              {j.runAt > now && (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    runJobNow(j.id)
                    toast('ジョブを今すぐ実行するよう登録しました')
                  }}
                  title="デモ用：予約時刻を待たずに実行します"
                >
                  <Play size={14} />
                  今すぐ実行
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">予約中のジョブはありません。</p>
      )}
      {last && (
        <div>
          <div className="section-title">
            直近の完了：{JOB_LABEL[last.type]}（{last.summary}）・ {relTime(last.finishedAt ?? 0)}
          </div>
          <Terminal job={{ ...last, logs: last.logs.slice(-4) }} maxHeight={150} />
        </div>
      )}
    </div>
  )
}
