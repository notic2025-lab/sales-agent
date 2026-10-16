import { useEffect, useMemo, useState } from 'react'
import { Ban, CalendarClock, CalendarX, Check, Copy, FilePenLine, Lightbulb, RotateCcw, Send, ShieldCheck, Undo2 } from 'lucide-react'
import { useStore } from '../../store'
import type { Lead, Message, MessageStatus } from '../../types'
import { hasError } from '../../data/checks'
import { IS_DEMO } from '../../data/backend'
import { cx, fmtDateTime } from '../../lib/util'
import { CHANNEL_ICON, ChannelLabel, Empty, Pill, toast } from '../../components/ui'
import { CheckBadge, FinalReviewModal, MessageChecks, SendPreview, useCheckEnv } from '../../components/review'
import { RejectReasonModal } from '../../components/reject'

export const MSG_STATUS: Record<MessageStatus, { label: string; tone: string }> = {
  draft: { label: '確認待ち', tone: 'amber' },
  approved: { label: '承認済み', tone: 'accent' },
  scheduled: { label: '送信予約', tone: 'violet' },
  sending: { label: '送信中', tone: 'accent' },
  sent: { label: '送信済み', tone: 'ok' },
  manual_pending: { label: '手動送信待ち', tone: 'amber' },
  manual_done: { label: '手動送信済み', tone: 'ok' },
  bounced: { label: '不達', tone: 'warn' },
  skipped: { label: '送らない', tone: '' },
}

const PATTERN = { A: '課題提起型', B: '事例紹介型' }

type Filter = 'all' | 'todo' | 'approved' | 'sent' | 'manual'

const match = (m: Message, f: Filter) =>
  f === 'all' ||
  (f === 'todo' && m.status === 'draft') ||
  (f === 'approved' && m.status === 'approved') ||
  (f === 'sent' && ['scheduled', 'sending', 'sent', 'manual_done', 'bounced'].includes(m.status)) ||
  (f === 'manual' && m.status === 'manual_pending')

export function MessagesTab({ campaignId, initialFilter }: { campaignId: string; initialFilter?: string }) {
  const allMessages = useStore((s) => s.messages)
  const leads = useStore((s) => s.leads)
  const jobs = useStore((s) => s.jobs)
  const cancelSchedule = useStore((s) => s.cancelSchedule)
  const env = useCheckEnv(campaignId)
  const msgs = useMemo(() => allMessages.filter((m) => m.campaignId === campaignId), [allMessages, campaignId])
  const leadOf = (m: Message) => leads.find((l) => l.id === m.leadId)

  const [filter, setFilter] = useState<Filter>(() => {
    if (initialFilter === 'manual') return 'manual'
    if (msgs.some((m) => m.status === 'draft')) return 'todo'
    return 'all'
  })
  const shown = msgs.filter((m) => match(m, filter))
  const [activeId, setActiveId] = useState<string | undefined>(shown[0]?.id)
  const [finalReview, setFinalReview] = useState(false)
  const active = msgs.find((m) => m.id === activeId) ?? shown[0]

  useEffect(() => {
    if (!active && shown[0]) setActiveId(shown[0].id)
  }, [active, shown])

  const drafts = msgs.filter((m) => m.status === 'draft')
  const approved = msgs.filter((m) => m.status === 'approved')
  const reviewing = drafts.length + approved.length
  const scheduled = msgs.filter((m) => m.status === 'scheduled')
  const sendJob = jobs.find(
    (j) => j.campaignId === campaignId && j.type === 'send-approved' && (j.payload as { kind?: string } | undefined)?.kind !== 'reply' && j.status !== 'done' && j.status !== 'failed',
  )

  if (!msgs.length) {
    return (
      <div className="card">
        <Empty icon={<FilePenLine size={22} />} title="文面はまだありません">
          リストを承認すると、エージェントが企業ごとの文面を下書きします。
        </Empty>
      </div>
    )
  }

  const approveAndNext = (m: Message) => {
    useStore.getState().setMessagesApproved([m.id], true)
    const rest = shown.filter((x) => x.status === 'draft' && x.id !== m.id)
    const idx = shown.findIndex((x) => x.id === m.id)
    const next = rest.find((x) => shown.indexOf(x) > idx) ?? rest[0]
    if (next) setActiveId(next.id)
    toast(`${leadOf(m)?.company} の文面を承認しました`)
  }

  return (
    <>
      {reviewing > 0 && (
        <div className="banner blue" style={{ marginBottom: 14 }}>
          <span className="ic">
            <ShieldCheck size={18} />
          </span>
          <div className="grow">
            <b>
              承認済み {approved.length} / {reviewing}件
            </b>
            <span className="small">1件ずつ開いて、届く内容と自動チェックを確かめてから承認してください。予約の前に、送信前の最終確認があります。</span>
            <div className="progress" style={{ marginTop: 6, maxWidth: 360, background: '#fff' }}>
              <i style={{ width: `${(approved.length / reviewing) * 100}%` }} />
            </div>
          </div>
          <button className="btn btn-primary" disabled={!approved.length} onClick={() => setFinalReview(true)}>
            <Send size={16} />
            承認した{approved.length}件を最終確認して予約
          </button>
        </div>
      )}

      {scheduled.length > 0 && sendJob?.status === 'queued' && (
        <div className="banner" style={{ marginBottom: 14, borderColor: 'var(--line)', background: 'var(--violet-soft)', color: 'var(--violet)' }}>
          <span className="ic" style={{ borderColor: 'var(--line)' }}>
            <CalendarClock size={18} />
          </span>
          <div className="grow">
            <b>
              {scheduled.length}件の送信を予約しています（{fmtDateTime(sendJob.runAt)}〜）
            </b>
            <span className="small">送信が始まるまでは取り消せます。取り消すと承認済みに戻ります。</span>
          </div>
          <button
            className="btn"
            onClick={() => {
              if (window.confirm(`${scheduled.length}件の送信予約を取り消します。よろしいですか？`)) {
                cancelSchedule(campaignId)
                toast('送信予約を取り消しました')
              }
            }}
          >
            <CalendarX size={16} />
            予約を取り消す
          </button>
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="seg" role="group" aria-label="絞り込み">
          {(
            [
              ['all', 'すべて'],
              ['todo', '確認待ち'],
              ['approved', '承認済み'],
              ['sent', '予約・送信済み'],
              ['manual', '手動送信待ち'],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {label} <span className="muted num">{msgs.filter((m) => match(m, f)).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card split">
        <div className="list">
          {shown.length === 0 && <Empty icon={<Check size={22} />} title="該当する文面はありません" />}
          {shown.map((m) => {
            const lead = leadOf(m)
            const Icon = CHANNEL_ICON[m.channel]
            return (
              <div key={m.id} className={cx('msg-item', active?.id === m.id && 'on')} onClick={() => setActiveId(m.id)}>
                <span className="ch">
                  <span className="on">
                    <Icon size={14} />
                  </span>
                </span>
                <div className="grow">
                  <b>{lead?.company}</b>
                  <small>{m.subject}</small>
                </div>
                {m.status === 'draft' && hasError(env.check(m)) ? (
                  <CheckBadge checks={env.check(m)} />
                ) : (
                  <Pill tone={MSG_STATUS[m.status].tone} sm>
                    {MSG_STATUS[m.status].label}
                  </Pill>
                )}
              </div>
            )
          })}
        </div>
        {active && leadOf(active) ? (
          <Editor key={active.id} message={active} lead={leadOf(active)!} onApproveNext={approveAndNext} />
        ) : (
          <Empty icon={<FilePenLine size={22} />} title="文面を選んでください" />
        )}
      </div>

      {finalReview && <FinalReviewModal campaignId={campaignId} onClose={() => setFinalReview(false)} />}
    </>
  )
}

function Editor({ message: m, lead, onApproveNext }: { message: Message; lead: Lead; onApproveNext: (m: Message) => void }) {
  const update = useStore((s) => s.updateMessage)
  const setApproved = useStore((s) => s.setMessagesApproved)
  const rewrite = useStore((s) => s.rewriteMessage)
  const markManualDone = useStore((s) => s.markManualDone)
  const skipMessage = useStore((s) => s.skipMessage)
  const insights = useStore((s) => s.insights)
  const settings = useStore((s) => s.settings)
  const env = useCheckEnv(m.campaignId)
  const [subject, setSubject] = useState(m.subject)
  const [body, setBody] = useState(m.body)
  const [ack, setAck] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const editable = m.status === 'draft' || m.status === 'approved'
  const dirty = subject !== m.subject || body !== m.body
  const used = insights.filter((i) => m.insightIds.includes(i.id))
  // 編集中の内容でチェックする（直したらすぐ結果が変わる）
  const checks = env.check({ ...m, subject, body })
  const blocked = hasError(checks)
  const needsAck = !blocked && checks.length > 0

  useEffect(() => {
    setSubject(m.subject)
    setBody(m.body)
  }, [m.subject, m.body])

  const save = () => {
    if (dirty) update(m.id, { subject, body })
  }

  return (
    <div className="editor">
      <div className="pane">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 17 }}>{lead.company}</h3>
            <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
              <ChannelLabel channel={m.channel} />
              <span className="tag">
                パターン{m.pattern}・{PATTERN[m.pattern]}
              </span>
              {m.edited && <span className="tag">あなたが編集</span>}
            </div>
          </div>
          <Pill tone={MSG_STATUS[m.status].tone} dot>
            {MSG_STATUS[m.status].label}
            {m.status === 'scheduled' && m.scheduledAt ? ` ${fmtDateTime(m.scheduledAt)}` : ''}
          </Pill>
        </div>

        {m.status === 'manual_pending' && (
          <div className="banner">
            <span className="ic">
              <Send size={17} />
            </span>
            <div className="grow">
              <b>SNSで手動送信してください</b>
              <span className="small">
                宛先 <span className="mono">{lead.sns}</span>。文面をコピーして送信したら、完了を登録します。
              </span>
            </div>
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(m.body)
                  toast('文面をコピーしました')
                } catch {
                  toast('コピーできませんでした。本文を選択してコピーしてください')
                }
              }}
            >
              <Copy size={14} />
              コピー
            </button>
            <button
              className="btn btn-sm btn-dark"
              onClick={() => {
                markManualDone(m.id)
                toast('手動送信の完了を登録しました')
              }}
            >
              <Check size={14} />
              送信済みにする
            </button>
          </div>
        )}

        {m.channel !== 'sns' && (
          <div className="field">
            <label htmlFor="subj">件名</label>
            <input id="subj" className="input" value={subject} readOnly={!editable} onChange={(e) => setSubject(e.target.value)} onBlur={save} />
          </div>
        )}
        <div className="field">
          <label htmlFor="body">本文</label>
          <textarea id="body" className="textarea body" value={body} readOnly={!editable} onChange={(e) => setBody(e.target.value)} onBlur={save} />
        </div>

        {used.length > 0 && (
          <div>
            <div className="section-title">参照した過去の評価</div>
            <div className="stack" style={{ gap: 6 }}>
              {used.map((i) => (
                <div className="insight-chip" key={i.id}>
                  <Lightbulb size={14} />
                  <span>
                    {i.text}
                    <b style={{ marginLeft: 6 }}>{i.lift}</b>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {m.messageId && (
          <div className="muted small">
            メッセージID <span className="mono">{m.messageId}</span>
            {m.sentAt && ` ・ ${fmtDateTime(m.sentAt)} 送信`}
          </div>
        )}

        {editable && (
          <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 'auto' }}>
            <button className="btn btn-ghost" onClick={() => setSkipping(true)} title="この企業を除外します。理由は次の収集で参照されます">
              <Ban size={16} />
              この企業には送らない
            </button>
            <button
              className="btn"
              onClick={() => {
                rewrite(m.id)
                toast(
                  IS_DEMO
                    ? `パターン${m.pattern === 'A' ? 'B' : 'A'}で書き直しました`
                    : `パターン${m.pattern === 'A' ? 'B' : 'A'}での書き直しを依頼しました。ランナーが次の確認で作成します`,
                )
              }}
            >
              <RotateCcw size={16} />
              別パターンで書き直す
            </button>
            {m.status === 'approved' ? (
              <button className="btn" onClick={() => setApproved([m.id], false)}>
                <Undo2 size={16} />
                承認を取り消す
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={blocked || (needsAck && !ack)}
                title={blocked ? '自動チェックで送れない項目があります' : needsAck && !ack ? '注意点を確認したらチェックを入れてください' : undefined}
                onClick={() => {
                  save()
                  onApproveNext(m)
                }}
              >
                <Check size={16} />
                承認して次へ
              </button>
            )}
          </div>
        )}
        {skipping && (
          <RejectReasonModal
            title={`${lead.company} には送らない`}
            count={1}
            onClose={() => setSkipping(false)}
            onPick={(reason) => {
              skipMessage(m.id, reason)
              toast(`${lead.company} には送らないことにしました`)
            }}
          />
        )}
        {editable && m.status === 'draft' && needsAck && (
          <label className={cx('confirm', 'amber')}>
            <input type="checkbox" className="check" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              <b>注意点（{checks.length}件）を確認しました</b>
              <small>右の自動チェックを読んだうえで、このまま送ってよい場合にチェックしてください。</small>
            </span>
          </label>
        )}
      </div>

      <div className="preview-pane">
        <div className="section-title">{m.channel === 'email' ? '相手に届くメール' : m.channel === 'form' ? 'フォームに入力する内容' : 'SNSのメッセージ（あなたが手動で送ります）'}</div>
        <SendPreview channel={m.channel} lead={lead} settings={settings} subject={subject} body={body} />
        {(editable || m.status === 'scheduled') && <MessageChecks checks={checks} channel={m.channel} />}
        {m.sendError && (
          <p className="small" style={{ color: 'var(--warn)' }}>
            送れなかった理由：{m.sendError}
          </p>
        )}
      </div>
    </div>
  )
}
