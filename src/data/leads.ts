// 企業リストの自動承認と除外理由（管理サイトとランナーで共通）
import type { Campaign, Confidence, RejectReason } from '../types.ts'

export const isAutoList = (c: Pick<Campaign, 'listApproval'>) => c.listApproval !== 'manual'
export const isAutoSend = (c: Pick<Campaign, 'sendApproval'>) => c.sendApproval !== 'manual'

// 営業リスト作成時の「承認の方法」
export type ApprovalMode = 'auto' | 'send' | 'manual'
export const approvalMode = (c: Pick<Campaign, 'listApproval' | 'sendApproval'>): ApprovalMode =>
  !isAutoList(c) ? 'manual' : !isAutoSend(c) ? 'send' : 'auto'
export const APPROVAL_MODE: Record<ApprovalMode, { title: string; desc: string }> = {
  auto: {
    title: 'エージェントに任せる',
    desc: '企業の選定も文面も自動。自動チェックを通った文面は、送信ルールの範囲で承認なしに送ります。通らなかったものだけ要確認として残ります',
  },
  send: { title: '文面を確認してから送る', desc: '企業の選定は自動。文面は1件ずつ確認して承認し、送信前の最終確認をしてから送ります' },
  manual: { title: 'すべて自分で承認する', desc: '企業の選定も文面も1件ずつ確認してから進めます' },
}
export const modeToFields = (m: ApprovalMode): Pick<Campaign, 'listApproval' | 'sendApproval'> => ({
  listApproval: m === 'manual' ? 'manual' : 'auto',
  sendApproval: m === 'auto' ? 'auto' : 'manual',
})

export const REJECT_REASON: Record<RejectReason, string> = {
  industry: '業種・事業内容が合わない',
  size: '規模が合わない',
  individual: '個人・個人事業主',
  contact: '連絡先が不適切',
  customer: '既存顧客・取引先',
  other: 'その他',
}

export const CONFIDENCE: Record<Confidence, { label: string; tone: string }> = {
  high: { label: '確信 高', tone: 'ok' },
  medium: { label: '確信 中', tone: 'amber' },
  low: { label: '確信 低', tone: 'warn' },
}

export const normalizeDomain = (d: string) =>
  d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
