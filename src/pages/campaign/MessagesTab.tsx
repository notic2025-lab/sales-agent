import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, Copy, FilePenLine, Lightbulb, RotateCcw, Send, Undo2 } from 'lucide-react'
import { useStore } from '../../store'
import type { Lead, Message, MessageStatus } from '../../types'
import { CHANNEL_LABEL } from '../../data/agent'
import { cx, fmtDateTime, nextBusinessMorning } from '../../lib/util'
import { CHANNEL_ICON, ChannelLabel, CloseBtn, Empty, Modal, Pill, toast } from '../../components/ui'

export const MSG_STATUS: Record<MessageStatus, { label: string; tone: string }> = {
  draft: { label: '確認待ち', tone: 'amber' },
  approved: { label: '承認済み', tone: 'accent' },
  scheduled: { label: '送信予約', tone: 'violet' },
  sent: { label: '送信済み', tone: 'ok' },
  manual_pending: { label: '手動送信待ち', tone: 'amber' },
  manual_done: { label: '手動送信済み', tone: 'ok' },
  bounced: { label: '不達', tone: 'warn' },
}

const PATTERN = { A: '課題提起型', B: '事例紹介型' }

type Filter = 'all' | 'todo' | 'approved' | 'sent' | 'manual'

const match = (m: Message, f: Filter) =>
  f === 'all' ||
  (f === 'todo' && m.status === 'draft') ||
  (f === 'approved' && m.status === 'approved') ||
  (f === 'sent' && ['scheduled', 'sent', 'manual_done', 'bounced'].includes(m.status)) ||
  (f === 'manual' && m.status === 'manual_pending')

export function MessagesTab({ campaignId, initialFilter }: { campaignId: string; initialFilter?: string }) {
  const allMessages = useStore((s) => s.messages)
  const leads = useStore((s) => s.leads)
  const setApproved = useStore((s) => s.setMessagesApproved)
  const msgs = useMemo(() => allMessages.filter((m) => m.campaignId === campaignId), [allMessages, campaignId])
  const leadOf = (m: Message) => leads.find((l) => l.id === m.leadId)

  const [filter, setFilter] = useState<Filter>(() => {
    if (initialFilter === 'manual') return 'manual'
    if (msgs.some((m) => m.status === 'draft')) return 'todo'
    return 'all'
  })
  const shown = msgs.filter((m) => match(m, filter))
  const [activeId, setActiveId] = useState<string | undefined>(shown[0]?.id)
  const [scheduling, setScheduling] = useState(false)
  const active = msgs.find((m) => m.id === activeId) ?? shown[0]

  useEffect(() => {
    if (!active && shown[0]) setActiveId(shown[0].id)
  }, [active, shown])

  const drafts = msgs.filter((m) => m.status === 'draft')
  const approved = msgs.filter((m) => m.status === 'approved')
  const reviewing = drafts.length + approved.length

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
    setApproved([m.id], true)
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
            <CalendarClock size={18} />
          </span>
          <div className="grow">
            <b>
              承認済み {approved.length} / {reviewing}件
            </b>
            <div className="progress" style={{ marginTop: 6, maxWidth: 360, background: '#fff' }}>
              <i style={{ width: `${(approved.length / reviewing) * 100}%` }} />
            </div>
          </div>
          <button
            className="btn"
            disabled={!drafts.length}
            onClick={() => {
              setApproved(drafts.map((m) => m.id), true)
              toast(`${drafts.length}件をまとめて承認しました`)
            }}
          >
            <Check size={16} />
            残り{drafts.length}件をすべて承認
          </button>
          <button className="btn btn-primary" disabled={!approved.length} onClick={() => setScheduling(true)}>
            <Send size={16} />
            承認した{approved.length}件の送信を予約
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
                <Pill tone={MSG_STATUS[m.status].tone} sm>
                  {MSG_STATUS[m.status].label}
                </Pill>
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

      {scheduling && <ScheduleModal campaignId={campaignId} approved={approved} onClose={() => setScheduling(false)} />}
    </>
  )
}

function Editor({ message: m, lead, onApproveNext }: { message: Message; lead: Lead; onApproveNext: (m: Message) => void }) {
  const update = useStore((s) => s.updateMessage)
  const setApproved = useStore((s) => s.setMessagesApproved)
  const rewrite = useStore((s) => s.rewriteMessage)
  const markManualDone = useStore((s) => s.markManualDone)
  const insights = useStore((s) => s.insights)
  const settings = useStore((s) => s.settings)
  const [subject, setSubject] = useState(m.subject)
  const [body, setBody] = useState(m.body)
  const editable = m.status === 'draft' || m.status === 'approved'
  const dirty = subject !== m.subject || body !== m.body
  const used = insights.filter((i) => m.insightIds.includes(i.id))

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
            <button
              className="btn"
              onClick={() => {
                rewrite(m.id)
                toast(`パターン${m.pattern === 'A' ? 'B' : 'A'}で書き直しました`)
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
      </div>

      <div className="preview-pane">
        <div className="section-title">{m.channel === 'email' ? '受信者の画面' : m.channel === 'form' ? 'フォームに入力する内容' : 'SNSのメッセージ'}</div>
        {m.channel === 'email' && (
          <div className="mail-preview">
            <div className="mhead">
              <b>{subject}</b>
              <span>
                差出人：{settings.senderCompany} {settings.senderName} &lt;{settings.senderEmail}&gt;
              </span>
              <span>宛先：{lead.email}</span>
            </div>
            <div className="mbody">{body}</div>
          </div>
        )}
        {m.channel === 'form' && (
          <div className="form-preview">
            <div className="muted mono" style={{ fontSize: 11 }}>
              {lead.formUrl}
            </div>
            <div className="f">
              <span>会社名</span>
              <div>{settings.senderCompany}</div>
            </div>
            <div className="f">
              <span>お名前</span>
              <div>{settings.senderName}</div>
            </div>
            <div className="f">
              <span>メールアドレス</span>
              <div>{settings.senderEmail}</div>
            </div>
            <div className="f">
              <span>件名</span>
              <div>{subject}</div>
            </div>
            <div className="f">
              <span>お問い合わせ内容</span>
              <div className="long">{body}</div>
            </div>
          </div>
        )}
        {m.channel === 'sns' && (
          <div className="phone">
            <div className="muted small" style={{ textAlign: 'center', marginBottom: 10 }}>
              {lead.sns}
            </div>
            <div className="dm">{body}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduleModal({ campaignId, approved, onClose }: { campaignId: string; approved: Message[]; onClose: () => void }) {
  const schedule = useStore((s) => s.scheduleSend)
  const settings = useStore((s) => s.settings)
  const morning = nextBusinessMorning()
  const [when, setWhen] = useState<'now' | 'morning' | 'custom'>('now')
  const [custom, setCustom] = useState(() => {
    const d = new Date(morning)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00`
  })
  const auto = approved.filter((m) => m.channel !== 'sns').length
  const manual = approved.length - auto
  const runAt = when === 'now' ? Date.now() : when === 'morning' ? morning : new Date(custom).getTime()
  const valid = !Number.isNaN(runAt)

  return (
    <Modal onClose={onClose}>
      <div className="drawer-head">
        <div className="grow">
          <h2>送信を予約</h2>
          <p className="muted small">予約した時刻にランナーが /send-approved を実行します。</p>
        </div>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="drawer-body">
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ['now', '今すぐ送信', 'ランナーが次の確認で拾います（デモでは数秒後）'],
              ['morning', `${fmtDateTime(morning)}`, '次の営業日の朝。開封されやすい時間帯です'],
              ['custom', '日時を指定', ''],
            ] as const
          ).map(([k, label, sub]) => (
            <button key={k} type="button" className={cx('choice', when === k && 'on')} onClick={() => setWhen(k)}>
              <span className="ic">
                <CalendarClock size={17} />
              </span>
              <span style={{ flex: 1 }}>
                <b>{label}</b>
                {sub && <small>{sub}</small>}
                {k === 'custom' && when === 'custom' && (
                  <input type="datetime-local" className="input" style={{ marginTop: 8 }} value={custom} onChange={(e) => setCustom(e.target.value)} onClick={(e) => e.stopPropagation()} />
                )}
              </span>
            </button>
          ))}
        </div>
        <dl className="kv">
          <dt>自動で送信</dt>
          <dd>
            <b>{auto}件</b>（{CHANNEL_LABEL.email}・{CHANNEL_LABEL.form}）
          </dd>
          <dt>手動送信待ちへ</dt>
          <dd>
            <b>{manual}件</b>（SNS）
          </dd>
          <dt>送信ルール</dt>
          <dd>
            1日{settings.dailyLimit}件まで ・ {settings.sendWindow}
            {settings.skipWeekend ? ' ・ 土日は送らない' : ''}
          </dd>
        </dl>
      </div>
      <div className="drawer-foot">
        <button className="btn" onClick={onClose}>
          キャンセル
        </button>
        <button
          className="btn btn-primary"
          disabled={!valid}
          onClick={() => {
            schedule(campaignId, runAt)
            toast(`${approved.length}件の送信を予約しました`)
            onClose()
          }}
        >
          <Send size={16} />
          {approved.length}件の送信を予約
        </button>
      </div>
    </Modal>
  )
}
