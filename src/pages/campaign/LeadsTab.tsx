import { useMemo, useState } from 'react'
import { Ban, Bot, Building2, Check, CircleAlert, CircleCheck, ExternalLink, FilePenLine, Lightbulb, Minus } from 'lucide-react'
import { useStore } from '../../store'
import type { Lead, LeadStatus, RejectReason } from '../../types'
import { CHANNEL_LABEL } from '../../data/agent'
import { CONFIDENCE, REJECT_REASON, isAutoList } from '../../data/leads'
import { cx } from '../../lib/util'
import { CloseBtn, Contacts, Drawer, Empty, Pill, Score, toast } from '../../components/ui'
import { RejectReasonModal } from '../../components/reject'

const STATUS: Record<LeadStatus, { label: string; tone: string }> = {
  pending: { label: '確認待ち', tone: 'amber' },
  approved: { label: '承認', tone: 'ok' },
  rejected: { label: '除外', tone: '' },
}
const AUTO_STATUS: Record<LeadStatus, { label: string; tone: string }> = { ...STATUS, pending: { label: '要確認', tone: 'amber' } }

type Filter = 'all' | LeadStatus

export function LeadsTab({ campaignId, drafting }: { campaignId: string; drafting: boolean }) {
  const allLeads = useStore((s) => s.leads)
  const messages = useStore((s) => s.messages)
  const insights = useStore((s) => s.insights)
  const setLeadStatus = useStore((s) => s.setLeadStatus)
  const rejectLeads = useStore((s) => s.rejectLeads)
  const startDrafting = useStore((s) => s.startDrafting)
  const campaign = useStore((s) => s.campaigns.find((c) => c.id === campaignId))
  const auto = campaign ? isAutoList(campaign) : true
  const LABEL = auto ? AUTO_STATUS : STATUS
  const [rejecting, setRejecting] = useState<string[] | null>(null)
  const leads = useMemo(() => allLeads.filter((l) => l.campaignId === campaignId).sort((a, b) => b.score - a.score), [allLeads, campaignId])
  const [filter, setFilter] = useState<Filter>(() => (leads.some((l) => l.status === 'pending') ? 'pending' : 'all'))
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Lead | null>(null)

  const hasMsg = new Set(messages.filter((m) => m.campaignId === campaignId).map((m) => m.leadId))
  const shown = filter === 'all' ? leads : leads.filter((l) => l.status === filter)
  const count = (f: LeadStatus) => leads.filter((l) => l.status === f).length
  const readyToDraft = leads.filter((l) => l.status === 'approved' && !hasMsg.has(l.id)).length
  const pending = count('pending')
  const autoApproved = leads.filter((l) => l.autoApproved).length
  const scoreInsight = insights.find((i) => i.active && i.key === 'score')
  const allSel = shown.length > 0 && shown.every((l) => sel.has(l.id))

  // 文面を作成済みの企業は状態を変えない
  const editable = (selected: string[]) => selected.filter((id) => !hasMsg.has(id))
  const apply = (selected: string[], status: LeadStatus, reason?: RejectReason) => {
    const ids = editable(selected)
    if (status === 'rejected' && reason) rejectLeads(ids, reason)
    else setLeadStatus(ids, status)
    setSel(new Set())
    toast(
      ids.length
        ? `${ids.length}社を${status === 'approved' ? '承認' : '除外'}しました${ids.length < selected.length ? `（文面作成済みの${selected.length - ids.length}社はそのまま）` : ''}`
        : '文面を作成済みの企業は変更できません',
    )
  }

  if (!leads.length) {
    return (
      <div className="card">
        <Empty icon={<Building2 size={22} />} title="企業リストはまだありません">
          エージェントが検索と巡回を終えると、ここにスコアつきで表示されます。
        </Empty>
      </div>
    )
  }

  return (
    <>
      {auto && autoApproved > 0 && (
        <div className="banner green" style={{ marginBottom: 14 }}>
          <span className="ic">
            <Bot size={18} />
          </span>
          <div className="grow">
            <b>確信の高い {autoApproved}社はエージェントが承認し、文面作成に進めました</b>
            <span className="small">
              {pending > 0
                ? `要確認の ${pending}社は、見なくても送られません。時間があるときに承認か除外をしてください。`
                : '文面の段階で「この企業には送らない」を選ぶと、その理由を次の収集で参照します。'}
            </span>
          </div>
        </div>
      )}
      {(pending > 0 || readyToDraft > 0) && !drafting && !(auto && autoApproved > 0 && readyToDraft === 0) && (
        <div className="banner blue" style={{ marginBottom: 14 }}>
          <span className="ic">
            <FilePenLine size={18} />
          </span>
          <div className="grow">
            <b>{pending > 0 ? `${pending}社が確認待ちです` : `承認した${readyToDraft}社の文面を作成できます`}</b>
            <span className="small">
              {pending > 0
                ? '連絡してよい企業を承認してください。確定すると、確認していない企業は除外され、承認した企業の文面作成が始まります。'
                : 'エージェントが過去の評価結果を参照して、文面を下書きします。'}
            </span>
          </div>
          <button
            className="btn btn-primary"
            disabled={readyToDraft === 0}
            onClick={() => {
              startDrafting(campaignId)
              toast(`承認した${readyToDraft}社で、文面作成のジョブを登録しました`)
            }}
          >
            <Check size={17} />
            {readyToDraft ? `${readyToDraft}社で確定して文面作成へ` : '承認した企業がありません'}
          </button>
        </div>
      )}

      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="seg" role="group" aria-label="絞り込み">
          {(['all', 'pending', 'approved', 'rejected'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'すべて' : LABEL[f].label} <span className="muted num">{f === 'all' ? leads.length : count(f)}</span>
            </button>
          ))}
        </div>
        {pending > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => setSel(new Set(leads.filter((l) => l.status === 'pending' && l.score >= 75).map((l) => l.id)))}
            title={scoreInsight?.detail}
          >
            <Lightbulb size={15} color="var(--violet)" />
            スコア75以上の確認待ちを選択
          </button>
        )}
      </div>

      {sel.size > 0 && (
        <div className="selbar">
          <span className="row" style={{ gap: 8 }}>
            <CircleCheck size={18} />
            <b>{sel.size}社を選択中</b>
          </span>
          <span className="spacer" />
          <button className="btn light" onClick={() => apply([...sel], 'approved')}>
            <Check size={16} />
            承認する
          </button>
          <button className="btn" onClick={() => setRejecting([...sel])}>
            <Ban size={16} />
            除外する
          </button>
          <button className="btn" onClick={() => setSel(new Set())}>
            選択を解除
          </button>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    className="check"
                    aria-label="すべて選択"
                    checked={allSel}
                    onChange={() => setSel(allSel ? new Set() : new Set(shown.map((l) => l.id)))}
                  />
                </th>
                <th>企業</th>
                <th className="hide-sm">業種・地域</th>
                <th className="hide-sm">事業内容</th>
                <th>連絡先</th>
                <th>スコア</th>
                <th className="hide-sm">確信</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} className={cx('clickable', sel.has(l.id) && 'selected')} onClick={() => setOpen(l)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="check"
                      aria-label={`${l.company}を選択`}
                      checked={sel.has(l.id)}
                      onChange={() => {
                        const n = new Set(sel)
                        if (n.has(l.id)) n.delete(l.id)
                        else n.add(l.id)
                        setSel(n)
                      }}
                    />
                  </td>
                  <td className="company" style={{ minWidth: 200 }}>
                    <b>{l.company}</b>
                    <small>{l.domain}</small>
                  </td>
                  <td className="hide-sm">
                    <span className="tag">{l.industry}</span> <span className="tag">{l.region}</span>
                  </td>
                  <td className="hide-sm">
                    <span className="clamp">{l.summary}</span>
                  </td>
                  <td>
                    <Contacts lead={l} />
                  </td>
                  <td>
                    <Score value={l.score} />
                  </td>
                  <td className="hide-sm">
                    {l.confidence && (
                      <Pill tone={CONFIDENCE[l.confidence].tone} sm>
                        {CONFIDENCE[l.confidence].label}
                      </Pill>
                    )}
                  </td>
                  <td>
                    <Pill tone={LABEL[l.status].tone} dot sm>
                      {LABEL[l.status].label}
                      {l.status === 'approved' && l.autoApproved ? '（自動）' : ''}
                    </Pill>
                    {l.status === 'rejected' && l.rejectReason && <div className="muted small">{REJECT_REASON[l.rejectReason]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <Empty icon={<Building2 size={22} />} title="該当する企業はありません" />}
      </div>

      {open && (
        <LeadDrawer
          lead={leads.find((l) => l.id === open.id) ?? open}
          label={LABEL}
          locked={hasMsg.has(open.id)}
          onClose={() => setOpen(null)}
          onSet={(s) => setLeadStatus([open.id], s)}
          onReject={() => setRejecting([open.id])}
        />
      )}
      {rejecting && (
        <RejectReasonModal
          title={rejecting.length === 1 ? `${leads.find((l) => l.id === rejecting[0])?.company ?? ''} を除外` : `${rejecting.length}社を除外`}
          count={editable(rejecting).length}
          onClose={() => setRejecting(null)}
          onPick={(reason) => apply(rejecting, 'rejected', reason)}
        />
      )}
    </>
  )
}

function LeadDrawer({
  lead,
  label,
  locked,
  onClose,
  onSet,
  onReject,
}: {
  lead: Lead
  label: Record<LeadStatus, { label: string; tone: string }>
  locked: boolean
  onClose: () => void
  onSet: (s: LeadStatus) => void
  onReject: () => void
}) {
  const negative = (r: string) => /少なく|見つからず|限定的/.test(r)
  const STATUS = label
  return (
    <Drawer onClose={onClose}>
      <div className="drawer-head">
        <div className="grow">
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <Pill tone={STATUS[lead.status].tone} dot sm>
              {STATUS[lead.status].label}
              {lead.status === 'approved' && lead.autoApproved ? '（自動）' : ''}
            </Pill>
            {lead.confidence && (
              <Pill tone={CONFIDENCE[lead.confidence].tone} sm>
                {CONFIDENCE[lead.confidence].label}
              </Pill>
            )}
            <span className="muted small mono">{lead.domain}</span>
          </div>
          <h2>{lead.company}</h2>
        </div>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="drawer-body">
        <div className="card" style={{ padding: 16, display: 'flex', gap: 18, alignItems: 'center' }}>
          <div>
            <div className="muted small">スコア</div>
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }} className="num">
              {lead.score}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <Score value={lead.score} />
            <div className="muted small" style={{ marginTop: 6 }}>
              条件との一致度・連絡のしやすさ・販促の活発さから算出
            </div>
          </div>
        </div>
        <div>
          <div className="section-title">スコアの根拠</div>
          <ul className="reasons">
            {lead.scoreReasons.map((r) => (
              <li key={r}>
                {negative(r) ? <CircleAlert size={15} color="var(--amber)" /> : <CircleCheck size={15} color="var(--ok)" />}
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="section-title">事業内容</div>
          <p style={{ lineHeight: 1.8 }}>{lead.summary}</p>
        </div>
        {lead.evidence && lead.evidence.length > 0 && (
          <div>
            <div className="section-title">条件に合うと判断した根拠（サイトからの引用）</div>
            <ul className="reasons">
              {lead.evidence.map((e, i) => (
                <li key={i} style={{ display: 'block' }}>
                  <span style={{ display: 'block' }}>「{e.quote}」</span>
                  <a href={e.url} target="_blank" rel="noreferrer" className="link small mono" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {e.url}
                    <ExternalLink size={11} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {lead.status === 'rejected' && lead.rejectReason && (
          <p className="muted small">除外の理由：{REJECT_REASON[lead.rejectReason]}</p>
        )}
        <div>
          <div className="section-title">連絡先</div>
          <dl className="kv">
            <dt>メール</dt>
            <dd className="mono">{lead.email ?? <span className="muted">見つかりませんでした</span>}</dd>
            <dt>フォーム</dt>
            <dd className="mono">{lead.formUrl ?? <span className="muted">見つかりませんでした</span>}</dd>
            <dt>SNS</dt>
            <dd className="mono">{lead.sns ?? <span className="muted">見つかりませんでした</span>}</dd>
            <dt>送信に使う</dt>
            <dd>
              <b>{CHANNEL_LABEL[lead.channel]}</b>
            </dd>
            <dt>規模</dt>
            <dd>{lead.employees}</dd>
          </dl>
        </div>
        <div>
          <div className="section-title">巡回したページ</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {lead.pages.map((p) => (
              <span className="tag mono" key={p}>
                {lead.domain}
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="drawer-foot">
        {locked ? (
          <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            文面を作成済みのため、状態は変更できません
          </span>
        ) : (
          <>
            {lead.status !== 'pending' && (
              <button className="btn" onClick={() => onSet('pending')}>
                <Minus size={16} />
                確認待ちに戻す
              </button>
            )}
            <button className="btn" disabled={lead.status === 'rejected'} onClick={onReject}>
              <Ban size={16} />
              除外
            </button>
            <button className="btn btn-primary" disabled={lead.status === 'approved'} onClick={() => onSet('approved')}>
              <Check size={16} />
              承認
            </button>
          </>
        )}
      </div>
    </Drawer>
  )
}
