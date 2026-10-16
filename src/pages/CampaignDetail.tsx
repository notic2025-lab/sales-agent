import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CalendarClock, ChartColumn, ChevronRight, CircleCheck, FilePenLine, ListChecks, MessageSquareReply, Play, Send } from 'lucide-react'
import { useStore } from '../store'
import { stageOf, statsOf } from '../data/selectors'
import { CHANNEL_LABEL, JOB_LABEL } from '../data/agent'
import { fmtDateTime, pct } from '../lib/util'
import { ChannelLabel, Empty, Pill, StagePill, Stepper, Terminal, toast } from '../components/ui'
import { ReactionTable, ReplyApproveAll } from '../components/reactions'
import { LeadsTab } from './campaign/LeadsTab'
import { MessagesTab, MSG_STATUS } from './campaign/MessagesTab'

type Tab = 'leads' | 'messages' | 'log' | 'reactions' | 'brief'

export default function CampaignDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const db = useStore()
  const runJobNow = useStore((s) => s.runJobNow)
  const campaign = db.campaigns.find((c) => c.id === id)

  if (!campaign) {
    return (
      <div className="card">
        <Empty icon={<ListChecks size={22} />} title="キャンペーンが見つかりません">
          <Link to="/campaigns" className="link">
            キャンペーン一覧へ
          </Link>
        </Empty>
      </div>
    )
  }

  const st = stageOf(db, id)
  const s = statsOf(db, id)
  const msgs = db.messages.filter((m) => m.campaignId === id)
  const reactions = db.reactions.filter((r) => r.campaignId === id)
  const jobs = db.jobs.filter((j) => j.campaignId === id)
  const running = jobs.find((j) => j.status === 'running')
  const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.runAt - b.runAt)[0]
  const sentLog = msgs.filter((m) => ['scheduled', 'sent', 'manual_pending', 'manual_done', 'bounced'].includes(m.status))
  const replyDrafts = reactions.filter((r) => r.replyDraft?.status === 'draft')

  const defaultTab: Tab = st.step <= 1 ? 'leads' : st.step <= 3 ? 'messages' : st.step === 4 ? 'log' : 'reactions'
  const tab = (params.get('tab') as Tab) || defaultTab
  const go = (t: Tab) => setParams({ tab: t }, { replace: true })

  const next = (() => {
    if (running) return null
    if (st.tone === 'admin' && st.step === 1)
      return { icon: <ListChecks size={18} />, title: '企業リストを確認して、連絡してよい企業を承認してください', action: () => go('leads'), label: 'リストを確認' }
    if (st.tone === 'admin' && st.step === 3)
      return { icon: <FilePenLine size={18} />, title: '文面を確認して承認し、送信を予約してください', action: () => go('messages'), label: '文面を確認' }
    if (st.label === 'SNSの手動送信待ち')
      return { icon: <Send size={18} />, title: 'SNSの文面をコピーして手動で送信し、完了を登録してください', action: () => setParams({ tab: 'messages', filter: 'manual' }, { replace: true }), label: '手動送信へ' }
    if (st.label === '返信の承認待ち')
      return { icon: <MessageSquareReply size={18} />, title: `エージェントが返信を${replyDrafts.length}件下書きしました。確認して承認してください`, action: () => go('reactions'), label: '返信を確認' }
    return null
  })()

  return (
    <>
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-body" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', paddingTop: 20 }}>
          <div style={{ flex: '1 1 380px', minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
              <StagePill stage={st} />
              <span className="muted small mono">{campaign.id}</span>
            </div>
            <h1 style={{ fontSize: 24, lineHeight: 1.35 }}>{campaign.name}</h1>
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              <span className="tag">商材 {campaign.product.name}</span>
              {[...campaign.conditions.industries, ...campaign.conditions.regions].map((x) => (
                <span className="tag" key={x}>
                  {x}
                </span>
              ))}
              <span className="tag">{campaign.conditions.count}社</span>
              <span className="tag">評価 送信の{campaign.evalAfterDays}日後</span>
            </div>
          </div>
          <div className="row" style={{ gap: 28, alignItems: 'flex-start' }}>
            {[
              ['企業', s.leads, `承認 ${s.approved}`],
              ['送信', s.sent, msgs.length ? `文面 ${msgs.length}` : '—'],
              ['返信率', s.evaluatedSent ? pct(s.replies, s.evaluatedSent) : '—', s.evaluatedSent ? `返信 ${s.replies}` : s.sent ? '評価待ち' : ''],
            ].map(([label, v, sub]) => (
              <div key={label as string} style={{ textAlign: 'right' }}>
                <div className="muted small">{label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }} className="num">
                  {v}
                </div>
                <div className="muted small">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h2>進み具合</h2>
          <span className="sub">{st.detail ? `${st.label} ・ ${st.detail}` : st.label}</span>
        </div>
        <Stepper stage={st} />
        <div style={{ padding: '0 22px 20px' }}>
          {running && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <span className="live-dot busy" />
                <b>エージェントが「{JOB_LABEL[running.type]}」を実行中</b>
              </div>
              <Terminal job={running} maxHeight={220} follow />
            </div>
          )}
          {!running && next && (
            <div className="banner">
              <span className="ic">{next.icon}</span>
              <div className="grow">
                <b>{next.title}</b>
              </div>
              <button className="btn btn-dark" onClick={next.action}>
                {next.label}
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          {!running && !next && queued && (
            <div className="banner blue">
              <span className="ic">
                <CalendarClock size={18} />
              </span>
              <div className="grow">
                <b>
                  {queued.runAt <= Date.now() ? `まもなく「${JOB_LABEL[queued.type]}」を実行します` : `${fmtDateTime(queued.runAt)} に「${JOB_LABEL[queued.type]}」を実行予定`}
                </b>
                <span className="small">ランナーが予約時刻に ClaudeCode を起動します。</span>
              </div>
              {queued.runAt > Date.now() && (
                <button
                  className="btn"
                  onClick={() => {
                    runJobNow(queued.id)
                    toast('予約を待たずに実行します（デモ）')
                  }}
                >
                  <Play size={15} />
                  今すぐ実行（デモ）
                </button>
              )}
            </div>
          )}
          {!running && !next && !queued && st.tone === 'done' && (
            <div className="banner green">
              <span className="ic">
                <CircleCheck size={18} />
              </span>
              <div className="grow">
                <b>評価が完了しました</b>
                <span className="small">結果と学びは評価レポートで確認できます。学びは次の文面作成で参照されます。</span>
              </div>
              <Link to={`/reports?campaign=${id}`} className="btn">
                <ChartColumn size={16} />
                評価レポート
              </Link>
            </div>
          )}
        </div>
      </section>

      <div className="tabs" role="tablist">
        {(
          [
            ['leads', '企業リスト', s.leads, st.step === 1 && st.tone === 'admin'],
            ['messages', '文面', msgs.length, st.step === 3 || st.label === 'SNSの手動送信待ち'],
            ['log', '送信ログ', sentLog.length, false],
            ['reactions', '反応', reactions.length, replyDrafts.length > 0],
            ['brief', '商材と条件', null, false],
          ] as [Tab, string, number | null, boolean][]
        ).map(([k, label, n, alert]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            {label}
            {n !== null && <span className="n">{n}</span>}
            {alert && <span className="alert" />}
          </button>
        ))}
      </div>

      {tab === 'leads' && <LeadsTab key={id} campaignId={id} drafting={st.step === 2} />}
      {tab === 'messages' && <MessagesTab key={`${id}-${params.get('filter') ?? ''}`} campaignId={id} initialFilter={params.get('filter') ?? undefined} />}
      {tab === 'log' && (
        <div className="card">
          {sentLog.length === 0 ? (
            <Empty icon={<Send size={22} />} title="まだ送信していません">
              文面を承認して送信を予約すると、ここに記録されます。
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>送信日時</th>
                    <th>企業</th>
                    <th>チャネル</th>
                    <th className="hide-sm">件名</th>
                    <th className="hide-sm">メッセージID</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sentLog]
                    .sort((a, b) => (b.sentAt ?? b.scheduledAt ?? 0) - (a.sentAt ?? a.scheduledAt ?? 0))
                    .map((m) => {
                      const lead = db.leads.find((l) => l.id === m.leadId)
                      return (
                        <tr key={m.id}>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>
                            {m.sentAt ? fmtDateTime(m.sentAt) : m.scheduledAt ? <span className="muted">{fmtDateTime(m.scheduledAt)} 予約</span> : '—'}
                          </td>
                          <td className="company">
                            <b>{lead?.company}</b>
                            <small>{m.channel === 'email' ? lead?.email : m.channel === 'form' ? lead?.formUrl : lead?.sns}</small>
                          </td>
                          <td>
                            <ChannelLabel channel={m.channel} />
                          </td>
                          <td className="hide-sm">
                            <span className="clamp">{m.channel === 'sns' ? '（SNSメッセージ）' : m.subject}</span>
                          </td>
                          <td className="hide-sm mono small muted">{m.messageId ?? '—'}</td>
                          <td>
                            <Pill tone={MSG_STATUS[m.status].tone} dot sm>
                              {MSG_STATUS[m.status].label}
                            </Pill>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === 'reactions' && (
        <>
          {replyDrafts.length > 0 && (
            <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
              <ReplyApproveAll ids={replyDrafts.map((r) => r.id)} />
            </div>
          )}
          <div className="card">
            <ReactionTable reactions={reactions} />
          </div>
        </>
      )}
      {tab === 'brief' && (
        <div className="grid g-2">
          <div className="card">
            <div className="card-head">
              <h2>商材</h2>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>商材名</dt>
                <dd>
                  <b>{campaign.product.name}</b>
                </dd>
                <dt>概要</dt>
                <dd>{campaign.product.summary}</dd>
                <dt>強み</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{campaign.product.strengths}</dd>
                <dt>URL</dt>
                <dd className="mono">{campaign.product.url}</dd>
              </dl>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>条件</h2>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>業種</dt>
                <dd>{campaign.conditions.industries.join('・') || '指定なし'}</dd>
                <dt>地域</dt>
                <dd>{campaign.conditions.regions.join('・') || '指定なし'}</dd>
                <dt>従業員規模</dt>
                <dd>{campaign.conditions.size}</dd>
                <dt>収集件数</dt>
                <dd>{campaign.conditions.count}社</dd>
                <dt>キーワード</dt>
                <dd>{campaign.conditions.keywords || '—'}</dd>
                <dt>連絡の方法</dt>
                <dd>{campaign.channels.map((c) => CHANNEL_LABEL[c]).join(' → ')}</dd>
                <dt>評価</dt>
                <dd>送信の{campaign.evalAfterDays}日後</dd>
                <dt>作成</dt>
                <dd>{fmtDateTime(campaign.createdAt)}</dd>
              </dl>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
