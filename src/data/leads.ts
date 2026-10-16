// 企業リストの自動承認と除外理由（管理サイトとランナーで共通）
import type { Campaign, Confidence, RejectReason } from '../types.ts'

export const isAutoList = (c: Pick<Campaign, 'listApproval'>) => c.listApproval !== 'manual'

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
