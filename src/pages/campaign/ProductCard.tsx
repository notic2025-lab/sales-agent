// 「商材と条件」タブの商材。作成後も直せる（導入事例を足すなど）。直したら、送る前の文面を作り直せる
import { useState } from 'react'
import { PenLine, RotateCcw, Save } from 'lucide-react'
import { useStore } from '../../store'
import type { Campaign } from '../../types'
import { IS_DEMO } from '../../data/backend'
import { ProductFields } from '../../components/ProductFields'
import { toast } from '../../components/ui'

export function RemakeDraftsButton({ campaignId, count, primary }: { campaignId: string; count: number; primary?: boolean }) {
  const remake = useStore((s) => s.remakeDrafts)
  if (!count) return null
  return (
    <button
      type="button"
      className={primary ? 'btn btn-primary' : 'btn'}
      onClick={() => {
        if (!window.confirm(`送る前の文面 ${count}件を、いまの商材の情報と書き方で作り直します。手で直した内容は消えます。よろしいですか？`)) return
        remake(campaignId)
        toast(IS_DEMO ? `文面 ${count}件を作り直しました` : `文面 ${count}件の作り直しを依頼しました。ランナーが次の確認で作成します`)
      }}
    >
      <RotateCcw size={16} />
      文面 {count}件を作り直す
    </button>
  )
}

export function ProductCard({ campaign }: { campaign: Campaign }) {
  const update = useStore((s) => s.updateProduct)
  const drafts = useStore((s) => s.messages.filter((m) => m.campaignId === campaign.id && (m.status === 'draft' || m.status === 'approved')).length)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState(campaign.product)
  const p = campaign.product

  return (
    <div className="card">
      <div className="card-head">
        <h2>商材</h2>
        {!editing && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setForm(campaign.product)
              setEditing(true)
              setSaved(false)
            }}
          >
            <PenLine size={14} />
            編集
          </button>
        )}
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        {editing ? (
          <>
            <ProductFields value={form} onChange={setForm} />
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditing(false)}>
                キャンセル
              </button>
              <button
                className="btn btn-primary"
                disabled={!form.name.trim() || !form.summary.trim()}
                onClick={() => {
                  update(campaign.id, form)
                  setEditing(false)
                  setSaved(true)
                  toast('商材の情報を保存しました。次に作る文面から使われます')
                }}
              >
                <Save size={16} />
                保存
              </button>
            </div>
          </>
        ) : (
          <dl className="kv">
            <dt>商材名</dt>
            <dd>
              <b>{p.name}</b>
            </dd>
            <dt>概要</dt>
            <dd>{p.summary}</dd>
            <dt>強み</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{p.strengths}</dd>
            <dt>導入事例</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{p.caseStudies || <span className="muted">なし（事例を使わない文面になります）</span>}</dd>
            <dt>URL</dt>
            <dd className="mono">{p.url}</dd>
          </dl>
        )}
        {saved && drafts > 0 && (
          <div className="banner blue">
            <div className="grow">
              <b>送る前の文面が {drafts}件あります</b>
              <span className="small">いま保存した商材の情報（導入事例など）で作り直せます。</span>
            </div>
            <RemakeDraftsButton campaignId={campaign.id} count={drafts} primary />
          </div>
        )}
      </div>
    </div>
  )
}
