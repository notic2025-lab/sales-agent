// 人が送信前に確認するための部品。
// 「実際に送られる内容」と「自動チェックで何を確かめたか」を同じ形で見せ、確認が済むまで承認・予約できないようにする。
import { Fragment, useMemo, useState } from 'react'
import { CalendarClock, ChevronRight, CircleCheck, CircleX, ExternalLink, Send, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useStore } from '../store'
import type { Channel, Lead, Message, Settings } from '../types'
import { REPLY_RULES, checkMessage, checkReply, extractLinks, hasError, rulesFor, type Check } from '../data/checks'
import { jstDayStart, planSends } from '../data/sendPlan'
import { CHANNEL_LABEL } from '../data/agent'
import { IS_DEMO } from '../data/backend'
import { DAY, cx, fmtDateTime, nextBusinessMorning } from '../lib/util'
import { ChannelLabel, CloseBtn, Modal, Pill, toast } from './ui'

// ──────────────────────────────────────────────
// チェックの実行

export function useCheckEnv(campaignId: string) {
  const leads = useStore((s) => s.leads)
  const messages = useStore((s) => s.messages)
  const suppression = useStore((s) => s.suppression)
  const settings = useStore((s) => s.settings)
  return useMemo(() => {
    const leadById = new Map(leads.map((l) => [l.id, l]))
    const otherLeads = leads.filter((l) => l.campaignId === campaignId)
    const since = Date.now() - 30 * DAY
    const recentDomains = new Set(
      messages
        .filter((m) => m.campaignId !== campaignId && (m.sentAt ?? 0) >= since)
        .map((m) => leadById.get(m.leadId)?.domain)
        .filter((d): d is string => !!d),
    )
    const check = (m: Message, earlier?: { message: Message; lead: Lead | undefined }[]) =>
      checkMessage(m, { settings, lead: leadById.get(m.leadId), suppression, otherLeads, recentDomains, earlier })
    return { leadById, settings, check }
  }, [leads, messages, suppression, settings, campaignId])
}

export function CheckBadge({ checks }: { checks: Check[] }) {
  if (hasError(checks)) return <Pill tone="warn" sm>送れない</Pill>
  if (checks.length) return <Pill tone="amber" sm>注意 {checks.length}</Pill>
  return <Pill tone="ok" sm>問題なし</Pill>
}

// 何を確かめたかを全項目並べる（問題のない項目も見せる）
export function CheckList({ checks, rules }: { checks: Check[]; rules: { code: string; label: string }[] }) {
  return (
    <ul className="checks">
      {rules.map((r) => {
        const hit = checks.filter((c) => c.code === r.code)
        const level = hit.some((c) => c.level === 'error') ? 'error' : hit.length ? 'warn' : 'ok'
        return (
          <li key={r.code} className={level}>
            {level === 'ok' ? <CircleCheck size={15} /> : level === 'error' ? <CircleX size={15} /> : <TriangleAlert size={15} />}
            <span>
              <b>{r.label}</b>
              {hit.map((c, i) => (
                <small key={i}>{c.text}</small>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function MessageChecks({ checks, channel }: { checks: Check[]; channel: Channel }) {
  const errors = checks.filter((c) => c.level === 'error').length
  return (
    <div>
      <div className="section-title row" style={{ justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 6 }}>
          <ShieldCheck size={14} />
          送信前の自動チェック
        </span>
        <CheckBadge checks={checks} />
      </div>
      <CheckList checks={checks} rules={rulesFor(channel)} />
      {errors > 0 && <p className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>直すまで承認・送信できません。</p>}
    </div>
  )
}

// ──────────────────────────────────────────────
// 実際に送られる内容

export function SendPreview({
  channel,
  lead,
  settings,
  subject,
  body,
}: {
  channel: Channel
  lead: Lead
  settings: Settings
  subject: string
  body: string
}) {
  const links = extractLinks(body)
  return (
    <div className="stack" style={{ gap: 12 }}>
      {channel === 'email' && (
        <div className="mail-preview">
          <div className="mhead">
            <b>{subject || '（件名なし）'}</b>
            <span>
              差出人：{settings.senderCompany} {settings.senderName} &lt;{settings.senderEmail}&gt;
            </span>
            <span>宛先：{lead.email ?? '（なし）'}</span>
            {lead.emailSource && (
              <span>
                アドレスの掲載元：
                <a className="link" href={lead.emailSource} target="_blank" rel="noreferrer">
                  {lead.emailSource}
                </a>
              </span>
            )}
          </div>
          <div className="mbody">{body}</div>
        </div>
      )}
      {channel === 'form' && (
        <div className="form-preview">
          <div className="muted mono" style={{ fontSize: 11 }}>
            {lead.formUrl ?? '（フォームの URL なし）'}
          </div>
          {(
            [
              ['会社名', settings.senderCompany],
              ['お名前', settings.senderName],
              ['メールアドレス', settings.senderEmail],
              ['件名', subject],
            ] as const
          ).map(([k, v]) => (
            <div className="f" key={k}>
              <span>{k}</span>
              <div>{v}</div>
            </div>
          ))}
          <div className="f">
            <span>お問い合わせ内容</span>
            <div className="long">{body}</div>
          </div>
        </div>
      )}
      {channel === 'sns' && (
        <div className="phone">
          <div className="muted small" style={{ textAlign: 'center', marginBottom: 10 }}>
            {lead.sns}
          </div>
          <div className="dm">{body}</div>
        </div>
      )}
      {links.length > 0 && (
        <div>
          <div className="section-title">本文のリンク（行き先を確認してください）</div>
          <ul className="links">
            {links.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer" className="link mono">
                  {u}
                  <ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// 送信前の最終確認（承認した文面の送信を予約する前に必ず通す）

type When = 'now' | 'morning' | 'custom'

const toLocalInput = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00`
}

export function FinalReviewModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const messages = useStore((s) => s.messages)
  const schedule = useStore((s) => s.scheduleSend)
  const reviewer = useStore((s) => s.session.email)
  const env = useCheckEnv(campaignId)
  const settings = env.settings
  const morning = nextBusinessMorning()
  const [openId, setOpenId] = useState<string | null>(null)
  const [when, setWhen] = useState<When>('morning')
  const [custom, setCustom] = useState(() => toLocalInput(morning))
  const [confirmed, setConfirmed] = useState(false)

  const rows = useMemo(() => {
    const earlier: { message: Message; lead: Lead | undefined }[] = []
    return messages
      .filter((m) => m.campaignId === campaignId && m.status === 'approved')
      .map((m) => {
        const lead = env.leadById.get(m.leadId)
        const checks = env.check(m, earlier)
        if (!hasError(checks)) earlier.push({ message: m, lead })
        return { m, lead, checks }
      })
  }, [messages, campaignId, env])

  const ok = rows.filter((r) => !hasError(r.checks))
  const blocked = rows.filter((r) => hasError(r.checks))
  const warned = ok.filter((r) => r.checks.length > 0)
  const auto = ok.filter((r) => r.m.channel !== 'sns')
  const manual = ok.length - auto.length
  const byChannel = (c: Channel) => auto.filter((r) => r.m.channel === c).length

  const now = Date.now()
  const chosen = when === 'now' ? now : when === 'morning' ? morning : new Date(custom).getTime()
  const valid = !Number.isNaN(chosen) && chosen >= now - 60_000
  const sentToday = messages.filter(
    (m) => m.channel !== 'sns' && (m.sentAt ?? 0) >= jstDayStart(now) && ['sending', 'sent', 'bounced'].includes(m.status),
  ).length
  const plan = valid ? planSends(settings, auto.length, chosen, sentToday) : []
  // 本番は時間帯・上限に合わせて最初に送れる時刻にジョブを置く。デモはすぐ送る
  const runAt = IS_DEMO || !plan.length ? chosen : plan[0].at
  const shifted = !IS_DEMO && plan.length > 0 && plan[0].at > chosen + 60_000
  const pickWhen = (w: When) => {
    setWhen(w)
    setConfirmed(false)
  }

  return (
    <Modal onClose={onClose} wide label="送信前の最終確認">
      <div className="drawer-head">
        <div className="grow">
          <h2>送信前の最終確認</h2>
          <p className="muted small">送られる内容・宛先・タイミングを確認してください。下の確認が済むまで、送信は予約されません。</p>
        </div>
        <CloseBtn onClick={onClose} />
      </div>

      <div className="drawer-body">
        <section>
          <h3 className="review-step">
            <span className="step-no">1</span>宛先と自動チェック
          </h3>
          <div className="row wrap" style={{ gap: 8, margin: '10px 0 12px' }}>
            <Pill tone="ok" sm>送れる {ok.length}件</Pill>
            {warned.length > 0 && <Pill tone="amber" sm>うち注意 {warned.length}件</Pill>}
            {blocked.length > 0 && <Pill tone="warn" sm>送れない {blocked.length}件</Pill>}
          </div>
          {blocked.length > 0 && (
            <div className="banner" style={{ marginBottom: 12 }}>
              <span className="ic">
                <TriangleAlert size={17} />
              </span>
              <div className="grow">
                <b>送れない {blocked.length}件は、今回の予約から外します</b>
                <span className="small">文面や宛先を直して承認し直すと、次の予約で送れます。</span>
              </div>
            </div>
          )}
          <div className="table-wrap review-table">
            <table className="t">
              <thead>
                <tr>
                  <th>宛先の企業</th>
                  <th>送り方</th>
                  <th className="hide-sm">宛先</th>
                  <th className="hide-sm">件名</th>
                  <th>チェック</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, lead, checks }) => (
                  <Fragment key={m.id}>
                    <tr className={cx('clickable', openId === m.id && 'selected')} onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                      <td className="company">
                        <b>{lead?.company ?? '（不明）'}</b>
                        {m.edited && <small>あなたが編集</small>}
                      </td>
                      <td>
                        <ChannelLabel channel={m.channel} />
                      </td>
                      <td className="hide-sm mono small" style={{ wordBreak: 'break-all' }}>
                        {m.channel === 'email' ? lead?.email : m.channel === 'form' ? lead?.formUrl : lead?.sns}
                      </td>
                      <td className="hide-sm clamp">{m.channel === 'sns' ? '—' : m.subject}</td>
                      <td>
                        <CheckBadge checks={checks} />
                      </td>
                      <td className="r">
                        <ChevronRight size={16} style={{ transform: openId === m.id ? 'rotate(90deg)' : undefined, color: 'var(--ink-4)' }} />
                      </td>
                    </tr>
                    {openId === m.id && lead && (
                      <tr>
                        <td colSpan={6} style={{ background: '#fafbfc' }}>
                          <div className="review-detail">
                            <SendPreview channel={m.channel} lead={lead} settings={settings} subject={m.subject} body={m.body} />
                            <MessageChecks checks={checks} channel={m.channel} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            行を開くと、相手に届く内容をそのまま確認できます。
          </p>
        </section>

        <section>
          <h3 className="review-step">
            <span className="step-no">2</span>送るタイミング
          </h3>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {(
              [
                ['now', '今すぐ', IS_DEMO ? 'デモではランナーが数秒後に送ります' : 'ランナーが次の確認（30秒ごと）で送り始めます'],
                ['morning', fmtDateTime(morning), '次の営業日の朝。開封されやすい時間帯です'],
                ['custom', '日時を指定', ''],
              ] as const
            ).map(([k, label, sub]) => (
              <button key={k} type="button" className={cx('choice', when === k && 'on')} onClick={() => pickWhen(k)}>
                <span className="ic">
                  <CalendarClock size={17} />
                </span>
                <span style={{ flex: 1 }}>
                  <b>{label}</b>
                  {sub && <small>{sub}</small>}
                  {k === 'custom' && when === 'custom' && (
                    <input
                      type="datetime-local"
                      className="input"
                      style={{ marginTop: 8 }}
                      value={custom}
                      onChange={(e) => {
                        setCustom(e.target.value)
                        setConfirmed(false)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
          {!valid && <p className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>過去の日時は指定できません。</p>}
          {valid && auto.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="section-title">送信の予定（1日{settings.dailyLimit}件まで・{settings.sendWindow}{settings.skipWeekend ? '・土日祝は送らない' : ''}）</div>
              <ul className="plan">
                {plan.map((p) => (
                  <li key={p.at}>
                    <span>{fmtDateTime(p.at)}〜</span>
                    <b>{p.count}件</b>
                  </li>
                ))}
              </ul>
              {shifted && <p className="small muted" style={{ marginTop: 6 }}>送信の時間帯の外なので、最初に送れる時刻から送ります。</p>}
              {IS_DEMO && <p className="small muted" style={{ marginTop: 6 }}>デモでは時間帯と上限を待たずに送ります（本番のランナーはこの予定どおりに送ります）。</p>}
            </div>
          )}
        </section>

        <section>
          <h3 className="review-step">
            <span className="step-no">3</span>最終確認
          </h3>
          <dl className="kv" style={{ margin: '10px 0 14px' }}>
            <dt>自動で送る</dt>
            <dd>
              <b>{auto.length}件</b>（{CHANNEL_LABEL.email} {byChannel('email')}・{CHANNEL_LABEL.form} {byChannel('form')}）
            </dd>
            <dt>手動送信待ちへ</dt>
            <dd>
              <b>{manual}件</b>（SNS はあなたが送ります）
            </dd>
            {blocked.length > 0 && (
              <>
                <dt>今回は送らない</dt>
                <dd>
                  <b>{blocked.length}件</b>（自動チェックで送れないもの）
                </dd>
              </>
            )}
            <dt>差出人</dt>
            <dd>
              {settings.senderCompany} {settings.senderName} &lt;{settings.senderEmail}&gt;
            </dd>
            <dt>送り始め</dt>
            <dd>{valid ? fmtDateTime(runAt) : '—'}</dd>
            {reviewer && (
              <>
                <dt>確認した人</dt>
                <dd>{reviewer}</dd>
              </>
            )}
          </dl>
          <label className={cx('confirm', confirmed && 'on')}>
            <input type="checkbox" className="check" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!ok.length || !valid} />
            <span>
              <b>宛先・件名・本文と送るタイミングを確認しました。</b>
              <small>この {ok.length}件を送ることを承認します。送信が始まるまでは、キャンペーンの画面から予約を取り消せます。</small>
            </span>
          </label>
        </section>
      </div>

      <div className="drawer-foot">
        <button className="btn" onClick={onClose}>
          キャンセル
        </button>
        <button
          className="btn btn-primary"
          disabled={!confirmed || !ok.length || !valid}
          onClick={() => {
            schedule(
              campaignId,
              ok.map((r) => r.m.id),
              runAt,
            )
            toast(`${ok.length}件の送信を予約しました（${fmtDateTime(runAt)}〜）`)
            onClose()
          }}
        >
          <Send size={16} />
          {ok.length}件の送信を予約
        </button>
      </div>
    </Modal>
  )
}

// ──────────────────────────────────────────────
// 返信の確認（1件ずつ「送ってよい」を付けたものだけ承認する）

export function ReplyReviewModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const reactions = useStore((s) => s.reactions)
  const leads = useStore((s) => s.leads)
  const messages = useStore((s) => s.messages)
  const settings = useStore((s) => s.settings)
  const suppression = useStore((s) => s.suppression)
  const approve = useStore((s) => s.approveReplies)
  const [ok, setOk] = useState<Set<string>>(() => new Set())

  const rows = useMemo(
    () =>
      reactions
        .filter((r) => ids.includes(r.id) && r.replyDraft?.status === 'draft')
        .map((r) => {
          const lead = leads.find((l) => l.id === r.leadId)
          const msg = messages.find((m) => m.id === r.messageId)
          const to = r.fromAddress ?? lead?.email
          const body = r.replyDraft?.body ?? ''
          return { r, lead, to, subject: `Re: ${msg?.subject ?? ''}`, body, checks: checkReply(body, to, settings, suppression) }
        }),
    [reactions, leads, messages, settings, suppression, ids],
  )
  const toggle = (id: string, v: boolean) =>
    setOk((s) => {
      const n = new Set(s)
      if (v) n.add(id)
      else n.delete(id)
      return n
    })

  return (
    <Modal onClose={onClose} wide label="返信の確認">
      <div className="drawer-head">
        <div className="grow">
          <h2>返信の確認</h2>
          <p className="muted small">エージェントが下書きした返信です。1件ずつ読んで「この返信を送ってよい」にチェックしたものだけを承認します。</p>
        </div>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="drawer-body">
        {rows.map(({ r, lead, to, subject, body, checks }) => (
          <div className="reply-card" key={r.id}>
            <div className="row wrap" style={{ justifyContent: 'space-between' }}>
              <b>{lead?.company}</b>
              <CheckBadge checks={checks} />
            </div>
            <dl className="kv">
              <dt>宛先</dt>
              <dd className="mono">{to ?? '（なし）'}</dd>
              <dt>件名</dt>
              <dd>{subject}</dd>
              <dt>相手の返信</dt>
              <dd className="muted">{r.excerpt}</dd>
            </dl>
            <div className="reply-body">{body}</div>
            <CheckList checks={checks} rules={REPLY_RULES} />
            <label className={cx('confirm', ok.has(r.id) && 'on')}>
              <input type="checkbox" className="check" checked={ok.has(r.id)} disabled={hasError(checks)} onChange={(e) => toggle(r.id, e.target.checked)} />
              <span>
                <b>この返信を送ってよい</b>
                {hasError(checks) && <small>自動チェックで送れない項目があります。返信を開いて直してください。</small>}
              </span>
            </label>
          </div>
        ))}
      </div>
      <div className="drawer-foot">
        <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
          {ok.size} / {rows.length}件にチェック
        </span>
        <button className="btn" onClick={onClose}>
          キャンセル
        </button>
        <button
          className="btn btn-primary"
          disabled={!ok.size}
          onClick={() => {
            approve([...ok])
            toast(`返信 ${ok.size}件を承認しました。ランナーが送信します`)
            onClose()
          }}
        >
          <Send size={16} />
          チェックした {ok.size}件を承認
        </button>
      </div>
    </Modal>
  )
}
