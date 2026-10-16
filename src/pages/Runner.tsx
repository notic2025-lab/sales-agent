import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, Bot, ChevronRight, Database, Globe, Mail, MonitorSmartphone, Pause, Play, Terminal as TerminalIcon } from 'lucide-react'
import { useStore } from '../store'
import type { Job } from '../types'
import { JOB_LABEL } from '../data/agent'
import { IS_DEMO } from '../data/backend'
import { cx, fmtDateTime, relTime } from '../lib/util'
import { Pill, Terminal, toast } from '../components/ui'
import { AgentNow } from '../components/shared'

function JobStatus({ job }: { job: Job }) {
  if (job.status === 'running') return <Pill tone="accent" dot sm>実行中</Pill>
  if (job.status === 'done') return <Pill tone="ok" dot sm>完了</Pill>
  if (job.status === 'failed') return <Pill tone="warn" dot sm>失敗</Pill>
  return job.runAt > Date.now() ? <Pill tone="violet" dot sm>予約</Pill> : <Pill tone="amber" dot sm>順番待ち</Pill>
}

const ARCH = [
  { icon: MonitorSmartphone, name: '管理サイト', sub: 'この画面。キャンペーン作成・承認', where: 'GitHub Pages' },
  { icon: Database, name: 'DB', sub: 'ジョブ・企業・文面・送信ログ・反応', where: IS_DEMO ? 'デモ：ブラウザに保存' : 'Firestore' },
  { icon: TerminalIcon, name: 'ランナー', sub: '未処理ジョブを確認して1件ずつ起動', where: IS_DEMO ? 'デモ：ブラウザ内で再現' : '社内の Mac（launchd）' },
  { icon: Bot, name: 'ClaudeCode', sub: 'claude -p でスラッシュコマンドを実行', where: IS_DEMO ? 'デモ：結果を生成' : '.claude/commands' },
]

export default function Runner() {
  const jobs = useStore((s) => s.jobs)
  const campaigns = useStore((s) => s.campaigns)
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const runJobNow = useStore((s) => s.runJobNow)
  const [openId, setOpenId] = useState<string | null>(() => jobs.find((j) => j.status === 'running')?.id ?? null)
  const list = [...jobs].sort((a, b) => {
    const rank = (j: Job) => (j.status === 'running' ? 0 : j.status === 'queued' ? 1 : 2)
    return rank(a) - rank(b) || (rank(a) === 1 ? a.runAt - b.runAt : (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ランナー・ジョブ</h1>
          <p>ランナーは DB の未処理ジョブを確認し、ClaudeCode のスラッシュコマンドを1件ずつ実行します。</p>
        </div>
        <div className="actions">
          {IS_DEMO && (
            <div className="seg" role="group" aria-label="デモの速度">
              {([1, 2, 4] as const).map((v) => (
                <button key={v} className={settings.runnerSpeed === v ? 'on' : ''} onClick={() => update({ runnerSpeed: v })}>
                  {v}倍速
                </button>
              ))}
            </div>
          )}
          <button
            className={cx('btn', settings.runnerPaused ? 'btn-primary' : '')}
            onClick={() => {
              update({ runnerPaused: !settings.runnerPaused })
              toast(settings.runnerPaused ? 'ランナーを再開しました' : 'ランナーを一時停止しました')
            }}
          >
            {settings.runnerPaused ? <Play size={16} /> : <Pause size={16} />}
            {settings.runnerPaused ? '再開' : '一時停止'}
          </button>
        </div>
      </div>

      <div className="grid g-main" style={{ marginBottom: 18 }}>
        <section className="card">
          <div className="card-head">
            <h2>いまの状態</h2>
          </div>
          <div className="card-body">
            <AgentNow />
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>仕組み</h2>
          </div>
          <div className="card-body">
            {ARCH.map((a, i) => (
              <Fragment key={a.name}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <span className="ch">
                    <span className={i === 0 ? 'primary' : 'on'} style={{ width: 34, height: 34, borderRadius: 9 }}>
                      <a.icon size={17} />
                    </span>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{a.name}</b> <span className="muted small">{a.where}</span>
                    <div className="muted small">{a.sub}</div>
                  </div>
                </div>
                {i < ARCH.length - 1 && <ArrowDown size={14} color="var(--ink-4)" style={{ margin: '6px 10px' }} />}
              </Fragment>
            ))}
            <div className="row wrap" style={{ gap: 8, marginTop: 12, paddingLeft: 46 }}>
              <span className="tag">
                <Globe size={12} style={{ marginRight: 4 }} />
                企業サイト（検索・巡回・フォーム送信）
              </span>
              <span className="tag">
                <Mail size={12} style={{ marginRight: 4 }} />
                Gmail（送信・反応チェック）
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>ジョブ</h2>
          <span className="sub">{jobs.length}件</span>
        </div>
        <div className="card-body" style={{ padding: '14px 0 0' }}>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>ジョブ</th>
                  <th className="hide-sm">キャンペーン</th>
                  <th>状態</th>
                  <th>実行</th>
                  <th className="hide-sm">結果</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((j) => (
                  <Fragment key={j.id}>
                    <tr className={cx('clickable', openId === j.id && 'selected')} onClick={() => setOpenId(openId === j.id ? null : j.id)}>
                      <td className="company" style={{ minWidth: 230 }}>
                        <b>{JOB_LABEL[j.type]}</b>
                        <small>{j.command}</small>
                      </td>
                      <td className="hide-sm">
                        <Link to={`/campaigns/${j.campaignId}`} className="link" onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>
                          {campaigns.find((c) => c.id === j.campaignId)?.name}
                        </Link>
                      </td>
                      <td>
                        <JobStatus job={j} />
                      </td>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>
                        {j.status === 'queued' ? (
                          j.runAt > Date.now() ? (
                            <span className="row" style={{ gap: 8 }}>
                              {fmtDateTime(j.runAt)}
                              <button
                                className="btn btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  runJobNow(j.id)
                                  toast(IS_DEMO ? '予約を待たずに実行します（デモ）' : '予約を待たずに、ランナーの次の確認で実行します')
                                }}
                              >
                                <Play size={13} />
                                今すぐ
                              </button>
                            </span>
                          ) : (
                            'まもなく'
                          )
                        ) : (
                          relTime(j.startedAt ?? j.createdAt)
                        )}
                      </td>
                      <td className="hide-sm muted">{j.summary ?? '—'}</td>
                      <td className="r">
                        <ChevronRight size={16} style={{ transform: openId === j.id ? 'rotate(90deg)' : undefined, transition: 'transform .15s', color: 'var(--ink-4)' }} />
                      </td>
                    </tr>
                    {openId === j.id && (
                      <tr>
                        <td colSpan={6} style={{ background: '#fafbfc' }}>
                          <Terminal job={j} maxHeight={320} follow={j.status === 'running'} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
