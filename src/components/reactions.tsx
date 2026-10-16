import { useState } from 'react'
import { AtSign, Check, Inbox, MessageSquareReply, Send } from 'lucide-react'
import { useStore } from '../store'
import type { Reaction, ReactionType, Sentiment } from '../types'
import { cx, fmtDateTime, relTime } from '../lib/util'
import { ChannelLabel, CloseBtn, Drawer, Empty, Modal, Pill, toast } from './ui'

export const SENTIMENT: Record<Sentiment, { label: string; tone: string }> = {
  positive: { label: '前向き', tone: 'ok' },
  neutral: { label: '検討', tone: 'accent' },
  negative: { label: 'お断り', tone: '' },
}

export const REACTION: Record<ReactionType, { label: string; tone: string }> = {
  reply: { label: '返信', tone: 'ok' },
  unsubscribe: { label: '配信停止', tone: 'warn' },
  bounce: { label: '不達', tone: 'warn' },
  no_response: { label: '無反応', tone: '' },
}

export function ReactionPill({ r }: { r: Reaction }) {
  if (r.type === 'reply' && r.sentiment) {
    return (
      <Pill tone={SENTIMENT[r.sentiment].tone} dot sm>
        返信・{SENTIMENT[r.sentiment].label}
      </Pill>
    )
  }
  return (
    <Pill tone={REACTION[r.type].tone} dot sm>
      {REACTION[r.type].label}
    </Pill>
  )
}

function ReplyState({ r }: { r: Reaction }) {
  if (!r.replyDraft) return <span className="muted small">—</span>
  if (r.replyDraft.status === 'draft') return <Pill tone="amber" sm>承認待ち</Pill>
  if (r.replyDraft.status === 'scheduled') return <Pill tone="violet" sm>送信予約</Pill>
  return <Pill tone="ok" sm>返信済み</Pill>
}

export function ReactionTable({ reactions, showCampaign }: { reactions: Reaction[]; showCampaign?: boolean }) {
  const leads = useStore((s) => s.leads)
  const messages = useStore((s) => s.messages)
  const campaigns = useStore((s) => s.campaigns)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = reactions.find((r) => r.id === openId)
  const sorted = [...reactions].sort((a, b) => {
    const pa = a.replyDraft?.status === 'draft' ? 1 : 0
    const pb = b.replyDraft?.status === 'draft' ? 1 : 0
    return pb - pa || b.receivedAt - a.receivedAt
  })

  if (!reactions.length) {
    return (
      <Empty icon={<Inbox size={22} />} title="反応はまだありません">
        評価ジョブが Gmail をチェックすると、返信・配信停止・不達がここに記録されます。
      </Empty>
    )
  }

  return (
    <>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>企業</th>
              <th>反応</th>
              <th className="hide-sm">内容</th>
              <th className="hide-sm">チャネル</th>
              <th>返信</th>
              <th className="r">受信</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const lead = leads.find((l) => l.id === r.leadId)
              const msg = messages.find((m) => m.id === r.messageId)
              return (
                <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                  <td className="company" style={{ minWidth: 190 }}>
                    <b>{lead?.company}</b>
                    <small>{showCampaign ? campaigns.find((c) => c.id === r.campaignId)?.name : lead?.domain}</small>
                  </td>
                  <td>
                    <ReactionPill r={r} />
                  </td>
                  <td className="hide-sm">
                    <span className="clamp">{r.excerpt}</span>
                  </td>
                  <td className="hide-sm">{msg && <ChannelLabel channel={msg.channel} />}</td>
                  <td>
                    <ReplyState r={r} />
                  </td>
                  <td className="r muted small" style={{ whiteSpace: 'nowrap' }}>
                    {r.type === 'no_response' ? '—' : relTime(r.receivedAt)}
                    {r.source === 'manual' && <div>手動登録</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {open && <ReactionDrawer reaction={open} onClose={() => setOpenId(null)} />}
    </>
  )
}

export function ReactionDrawer({ reaction: r, onClose }: { reaction: Reaction; onClose: () => void }) {
  const lead = useStore((s) => s.leads.find((l) => l.id === r.leadId))
  const msg = useStore((s) => s.messages.find((m) => m.id === r.messageId))
  const settings = useStore((s) => s.settings)
  const updateReply = useStore((s) => s.updateReplyDraft)
  const approve = useStore((s) => s.approveReplies)
  const [body, setBody] = useState(r.replyDraft?.body ?? '')
  const [expanded, setExpanded] = useState(false)
  const draft = r.replyDraft?.status === 'draft'

  return (
    <Drawer onClose={onClose}>
      <div className="drawer-head">
        <div className="grow">
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <ReactionPill r={r} />
            {r.source === 'manual' && <span className="tag">手動登録</span>}
          </div>
          <h2>{lead?.company}</h2>
        </div>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="drawer-body">
        {msg && (
          <div>
            <div className="section-title">送った文面</div>
            <div className={cx('bubble', !expanded && 'collapsed')} onClick={() => setExpanded(true)} style={{ cursor: expanded ? 'auto' : 'pointer' }}>
              <div className="who">
                <span>
                  <b>{settings.senderCompany}</b> ・ <ChannelLabel channel={msg.channel} />
                </span>
                <span>{msg.sentAt ? fmtDateTime(msg.sentAt) : ''}</span>
              </div>
              {msg.channel !== 'sns' && <b style={{ display: 'block', marginBottom: 6 }}>{msg.subject}</b>}
              {msg.body}
            </div>
            {msg.messageId && (
              <div className="muted small" style={{ marginTop: 6 }}>
                メッセージID <span className="mono">{msg.messageId}</span>
              </div>
            )}
          </div>
        )}
        <div>
          <div className="section-title">{r.type === 'no_response' ? '評価の結果' : '相手からの反応'}</div>
          <div className={cx('bubble', r.type === 'reply' && 'them')}>
            <div className="who">
              <b>{r.type === 'bounce' ? 'Mail Delivery Subsystem' : lead?.company}</b>
              <span>{r.type === 'no_response' ? '' : fmtDateTime(r.receivedAt)}</span>
            </div>
            {r.excerpt}
          </div>
          {r.type === 'unsubscribe' && <p className="small muted" style={{ marginTop: 8 }}>配信停止リストに追加済みです。今後のリスト収集から自動で除外されます。</p>}
          {r.type === 'bounce' && <p className="small muted" style={{ marginTop: 8 }}>宛先が無効でした。次回はフォームなど別の連絡先を使います。</p>}
        </div>
        {r.replyDraft && (
          <div>
            <div className="section-title row" style={{ justifyContent: 'space-between' }}>
              <span>エージェントが作成した返信</span>
              {!draft && <Pill tone={r.replyDraft.status === 'sent' ? 'ok' : 'violet'} sm>{r.replyDraft.status === 'sent' ? '返信済み' : '送信予約'}</Pill>}
            </div>
            {draft ? (
              <textarea className="textarea" style={{ minHeight: 280, fontSize: 13.5, lineHeight: 1.8 }} value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => updateReply(r.id, body)} />
            ) : (
              <div className="bubble">{r.replyDraft.body}</div>
            )}
          </div>
        )}
      </div>
      {draft && (
        <div className="drawer-foot">
          <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            承認すると Gmail から返信します
          </span>
          <button
            className="btn btn-primary"
            onClick={() => {
              updateReply(r.id, body)
              approve([r.id])
              toast('返信を承認しました。ランナーが送信します')
              onClose()
            }}
          >
            <Send size={16} />
            承認して返信
          </button>
        </div>
      )}
    </Drawer>
  )
}

export function ManualReactionModal({ campaignId, onClose }: { campaignId?: string; onClose: () => void }) {
  const messages = useStore((s) => s.messages)
  const reactions = useStore((s) => s.reactions)
  const leads = useStore((s) => s.leads)
  const add = useStore((s) => s.addManualReaction)
  const reacted = new Set(reactions.map((r) => r.messageId))
  const options = messages.filter((m) => m.channel === 'sns' && m.status === 'manual_done' && !reacted.has(m.id) && (!campaignId || m.campaignId === campaignId))
  const [messageId, setMessageId] = useState(options[0]?.id ?? '')
  const [type, setType] = useState<'reply' | 'no_response'>('reply')
  const [sentiment, setSentiment] = useState<Sentiment>('positive')
  const [excerpt, setExcerpt] = useState('')

  return (
    <Modal onClose={onClose}>
      <div className="drawer-head">
        <div className="grow">
          <h2>SNSの反応を登録</h2>
          <p className="muted small">SNSはエージェントが確認できないため、反応をあなたが登録します。評価の集計に含まれます。</p>
        </div>
        <CloseBtn onClick={onClose} />
      </div>
      {options.length === 0 ? (
        <div className="drawer-body">
          <Empty icon={<AtSign size={22} />} title="登録できるSNSの送信はありません">
            手動送信を完了したSNSの宛先が、ここに表示されます。
          </Empty>
        </div>
      ) : (
        <>
          <div className="drawer-body">
            <div className="field">
              <label htmlFor="rx-msg">送信先</label>
              <select id="rx-msg" className="select" value={messageId} onChange={(e) => setMessageId(e.target.value)}>
                {options.map((m) => {
                  const lead = leads.find((l) => l.id === m.leadId)
                  return (
                    <option key={m.id} value={m.id}>
                      {lead?.company}（{lead?.sns}）
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="field">
              <span className="label">反応</span>
              <div className="seg">
                <button type="button" className={type === 'reply' ? 'on' : ''} onClick={() => setType('reply')}>
                  返信があった
                </button>
                <button type="button" className={type === 'no_response' ? 'on' : ''} onClick={() => setType('no_response')}>
                  反応なし
                </button>
              </div>
            </div>
            {type === 'reply' && (
              <>
                <div className="field">
                  <span className="label">温度感</span>
                  <div className="seg">
                    {(Object.keys(SENTIMENT) as Sentiment[]).map((s) => (
                      <button type="button" key={s} className={sentiment === s ? 'on' : ''} onClick={() => setSentiment(s)}>
                        {SENTIMENT[s].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="rx-text">内容</label>
                  <textarea id="rx-text" className="textarea" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="相手からのメッセージを貼り付けてください" />
                </div>
              </>
            )}
          </div>
          <div className="drawer-foot">
            <button className="btn" onClick={onClose}>
              キャンセル
            </button>
            <button
              className="btn btn-primary"
              disabled={!messageId || (type === 'reply' && !excerpt.trim())}
              onClick={() => {
                add({ messageId, type, sentiment: type === 'reply' ? sentiment : undefined, excerpt: type === 'reply' ? excerpt.trim() : 'SNSで反応なし（手動登録）' })
                toast('SNSの反応を登録しました')
                onClose()
              }}
            >
              <Check size={16} />
              登録する
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

export function ReplyApproveAll({ ids }: { ids: string[] }) {
  const approve = useStore((s) => s.approveReplies)
  if (!ids.length) return null
  return (
    <button
      className="btn btn-primary"
      onClick={() => {
        approve(ids)
        toast(`返信 ${ids.length}件を承認しました`)
      }}
    >
      <MessageSquareReply size={16} />
      返信 {ids.length}件をまとめて承認
    </button>
  )
}
