// 企業を外すときの理由を選ぶ。理由は次の収集で「過去に除外された傾向」としてエージェントが参照する
import { useState } from 'react'
import { Ban } from 'lucide-react'
import type { RejectReason } from '../types'
import { REJECT_REASON } from '../data/leads'
import { cx } from '../lib/util'
import { CloseBtn, Modal } from './ui'

export function RejectReasonModal({
  title,
  count,
  onClose,
  onPick,
}: {
  title: string
  count: number
  onClose: () => void
  onPick: (reason: RejectReason) => void
}) {
  const [reason, setReason] = useState<RejectReason>('industry')
  return (
    <Modal onClose={onClose} label={title}>
      <div className="drawer-head">
        <div className="grow">
          <h2>{title}</h2>
          <p className="muted small">理由を1つ選んでください。次に企業を集めるとき、エージェントが同じ傾向の企業を避けます。</p>
        </div>
        <CloseBtn onClick={onClose} />
      </div>
      <div className="drawer-body">
        <div className="stack" style={{ gap: 8 }}>
          {(Object.keys(REJECT_REASON) as RejectReason[]).map((k) => (
            <button key={k} type="button" className={cx('choice', reason === k && 'on')} onClick={() => setReason(k)}>
              <span className="ic">
                <Ban size={16} />
              </span>
              <span style={{ flex: 1 }}>
                <b>{REJECT_REASON[k]}</b>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="drawer-foot">
        <button className="btn" onClick={onClose}>
          キャンセル
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            onPick(reason)
            onClose()
          }}
        >
          <Ban size={16} />
          {count}社を除外
        </button>
      </div>
    </Modal>
  )
}
