import { useSearchParams } from 'react-router-dom'
import { ChartColumn, Lightbulb } from 'lucide-react'
import { useStore } from '../store'
import type { Message } from '../types'
import { CHANNEL_LABEL } from '../data/agent'
import { statsOf } from '../data/selectors'
import { cx, fmtDate, pct, ratio } from '../lib/util'
import { Empty, Switch, toast } from '../components/ui'

type Row = { name: string; n: number; replies: number }

function Bars({ rows, note }: { rows: Row[]; note?: string }) {
  const valid = rows.filter((r) => r.n > 0)
  if (!valid.length) return <p className="muted small">まだ評価したデータがありません。</p>
  const max = Math.max(...valid.map((r) => ratio(r.replies, r.n)), 0.01)
  const best = Math.max(...valid.map((r) => ratio(r.replies, r.n)))
  return (
    <div>
      {valid.map((r) => {
        const v = ratio(r.replies, r.n)
        return (
          <div className="hbar" key={r.name}>
            <span className="name" title={r.name}>
              {r.name}
            </span>
            <span className="track">
              <i style={{ width: `${(v / max) * 100}%`, background: v === best ? 'var(--accent)' : '#a9c1e2' }} />
            </span>
            <span className="val">
              {(v * 100).toFixed(1)}%<small>{r.replies}/{r.n}件</small>
            </span>
          </div>
        )
      })}
      {note && <p className="muted small" style={{ marginTop: 8 }}>{note}</p>}
    </div>
  )
}

export default function Reports() {
  const db = useStore()
  const toggleInsight = useStore((s) => s.toggleInsight)
  const [params, setParams] = useSearchParams()
  const campaign = params.get('campaign') ?? ''
  const s = statsOf(db, campaign || undefined)

  const reactions = db.reactions.filter((r) => !campaign || r.campaignId === campaign)
  const byMsg = new Map(reactions.map((r) => [r.messageId, r]))
  const evaluated = db.messages.filter((m) => byMsg.has(m.id) && (!campaign || m.campaignId === campaign))
  const lead = (m: Message) => db.leads.find((l) => l.id === m.leadId)
  const group = (key: (m: Message) => string | undefined, order?: string[]): Row[] => {
    const map = new Map<string, Row>()
    for (const m of evaluated) {
      const k = key(m)
      if (!k) continue
      const row = map.get(k) ?? { name: k, n: 0, replies: 0 }
      row.n++
      if (byMsg.get(m.id)?.type === 'reply') row.replies++
      map.set(k, row)
    }
    const rows = [...map.values()]
    return order ? order.map((o) => map.get(o) ?? { name: o, n: 0, replies: 0 }) : rows.sort((a, b) => ratio(b.replies, b.n) - ratio(a.replies, a.n))
  }

  const band = (m: Message) => {
    const sc = lead(m)?.score ?? 0
    return sc >= 85 ? 'スコア85以上' : sc >= 75 ? 'スコア75〜84' : 'スコア74以下'
  }

  const breakdown = [
    { label: '返信・前向き', v: s.positive, c: 'var(--ok)' },
    { label: '返信・検討', v: s.neutral, c: 'var(--accent)' },
    { label: '返信・お断り', v: s.negative, c: '#9aa3af' },
    { label: '配信停止', v: s.unsub, c: '#c2554b' },
    { label: '不達', v: s.bounce, c: '#e3a33b' },
    { label: '無反応', v: s.noResponse, c: '#dfe4ea' },
  ]
  const total = breakdown.reduce((a, b) => a + b.v, 0)
  const insights = db.insights

  return (
    <>
      <div className="page-head">
        <div>
          <h1>評価レポート</h1>
          <p>送信した文面への反応を集計し、エージェントが次の文面に活かす「学び」をまとめています。</p>
        </div>
        <div className="actions">
          <select className="select" style={{ width: 'auto', minWidth: 240 }} value={campaign} onChange={(e) => setParams(e.target.value ? { campaign: e.target.value } : {}, { replace: true })} aria-label="キャンペーン">
            <option value="">すべてのキャンペーン</option>
            {db.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {evaluated.length === 0 ? (
        <div className="card">
          <Empty icon={<ChartColumn size={22} />} title="まだ評価したデータがありません">
            送信後、評価のタイミングでエージェントが反応をチェックすると、ここに集計されます。
          </Empty>
        </div>
      ) : (
        <>
          <div className="grid g-4" style={{ marginBottom: 18 }}>
            <div className="card kpi">
              <span className="label">評価した送信</span>
              <span className="value">{evaluated.length}</span>
              <span className="foot">送信 {s.sent}件のうち</span>
            </div>
            <div className="card kpi">
              <span className="label">返信率</span>
              <span className="value">{pct(s.replies, evaluated.length)}</span>
              <span className="foot">返信 {s.replies}件</span>
            </div>
            <div className="card kpi">
              <span className="label">前向きな返信</span>
              <span className="value">{pct(s.positive, evaluated.length)}</span>
              <span className="foot">商談候補 {s.positive}件</span>
            </div>
            <div className="card kpi">
              <span className="label">到達率</span>
              <span className="value">{pct(evaluated.length - s.bounce, evaluated.length)}</span>
              <span className="foot">
                不達 {s.bounce} ・ 配信停止 {s.unsub}
              </span>
            </div>
          </div>

          <section className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h2>反応の内訳</h2>
              <span className="sub">{total}件</span>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-sunken)' }}>
                {breakdown.map((b) => (b.v ? <i key={b.label} title={`${b.label} ${b.v}件`} style={{ width: `${(b.v / total) * 100}%`, background: b.c }} /> : null))}
              </div>
              <div className="row wrap" style={{ gap: 18, marginTop: 12 }}>
                {breakdown.map((b) => (
                  <span key={b.label} className="row small" style={{ gap: 6 }}>
                    <i style={{ width: 10, height: 10, borderRadius: 3, background: b.c, display: 'inline-block', border: b.c === '#dfe4ea' ? '1px solid #c9d0d9' : 0 }} />
                    {b.label} <b className="num">{b.v}</b>
                  </span>
                ))}
              </div>
            </div>
          </section>

          <div className="grid g-2" style={{ marginBottom: 18 }}>
            <section className="card">
              <div className="card-head">
                <h2>文面パターン別の返信率</h2>
              </div>
              <div className="card-body">
                <Bars rows={group((m) => (m.pattern === 'A' ? 'A 課題提起型' : 'B 事例紹介型'), ['A 課題提起型', 'B 事例紹介型'])} />
              </div>
            </section>
            <section className="card">
              <div className="card-head">
                <h2>スコア帯別の返信率</h2>
              </div>
              <div className="card-body">
                <Bars rows={group(band, ['スコア85以上', 'スコア75〜84', 'スコア74以下'])} note="スコアが高いほど返信率が高ければ、リスト収集のスコアは当たっています。" />
              </div>
            </section>
            <section className="card">
              <div className="card-head">
                <h2>チャネル別の返信率</h2>
              </div>
              <div className="card-body">
                <Bars rows={group((m) => CHANNEL_LABEL[m.channel])} />
              </div>
            </section>
            <section className="card">
              <div className="card-head">
                <h2>地域別の返信率</h2>
              </div>
              <div className="card-body">
                <Bars rows={group((m) => lead(m)?.region).slice(0, 6)} />
              </div>
            </section>
          </div>
        </>
      )}

      <section className="card">
        <div className="card-head">
          <h2>エージェントの学び</h2>
          <span className="sub">オンにした学びは、次の /draft-messages で参照されます</span>
        </div>
        <div className="card-body" style={{ paddingTop: 4 }}>
          {insights.length === 0 ? (
            <Empty icon={<Lightbulb size={22} />} title="学びはまだありません">
              評価が終わると、返信率の差が大きかった傾向をエージェントがまとめます。
            </Empty>
          ) : (
            insights.map((i) => (
              <div className={cx('insight', !i.active && 'off')} key={i.id}>
                <span className="ic">
                  <Lightbulb size={18} />
                </span>
                <div className="grow">
                  <b>{i.text}</b>
                  <div className="muted small">
                    {i.detail} ・ {db.campaigns.find((c) => c.id === i.campaignId)?.name ?? '導入前の実績'} ・ {fmtDate(i.createdAt)}時点
                  </div>
                </div>
                <span className="lift">{i.lift}</span>
                <Switch
                  on={i.active}
                  label="次の文面で参照する"
                  onChange={() => {
                    toggleInsight(i.id)
                    toast(i.active ? '次の文面では参照しません' : '次の文面で参照します')
                  }}
                />
              </div>
            ))
          )}
        </div>
      </section>
    </>
  )
}
