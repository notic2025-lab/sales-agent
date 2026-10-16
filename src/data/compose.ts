// 文面の骨格（ハイブリッド生成）。管理サイトのデモとランナーで共通。
// 名乗り・商材の説明・締め・署名・法定表示は固定のテンプレートで組み、エージェントが書くのは「相手企業に触れる数文」（intro）だけ。
// 生成部分が短いので言い過ぎが起きにくく、自動チェックを通しやすい。
import type { Campaign, Channel, Lead, Settings } from '../types.ts'
import { complianceFooter } from './checks.ts'

type Sender = Pick<Settings, 'senderCompany' | 'senderName' | 'senderEmail' | 'senderAddress' | 'signature'>

export function strengthsOf(product: Campaign['product']) {
  return product.strengths
    .split(/\n|、|。/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3)
}

// 件名はテンプレート。「学び」で件名に数字を入れると決まっていれば、店舗数などを使う
export function defaultSubject(campaign: Campaign, lead: Pick<Lead, 'company' | 'industry'>, pattern: 'A' | 'B', count?: string) {
  const pr = campaign.product
  if (pattern === 'A') return count ? `${count}の運営で、${pr.name}が役立つかもしれません` : `${lead.company}様へ｜${pr.name}のご案内`
  return count ? `【${lead.industry}の事例】${count}規模の企業さまでの${pr.name}の使われ方` : `【${lead.industry}の事例】${pr.name}の導入事例のご紹介`
}

export function assembleBody(s: Sender, campaign: Campaign, lead: Pick<Lead, 'company'>, channel: Channel, intro: string) {
  const pr = campaign.product
  const strengths = strengthsOf(pr)
  const text = intro.trim()
  if (channel === 'sns') {
    return `${lead.company}ご担当者様\nはじめまして、${s.senderCompany}の${s.senderName}です。\n${text}\n${pr.name}について、15分ほどご紹介の機会をいただけないでしょうか。${pr.url ? `\n${pr.url}` : ''}`
  }
  const opening = `${lead.company}\nご担当者様\n\n突然のご連絡失礼いたします。${s.senderCompany}の${s.senderName}と申します。`
  const product = `${pr.name}は、${pr.summary.replace(/。$/, '')}。${strengths.length ? `\n${strengths.map((x) => `・${x}`).join('\n')}` : ''}`
  const close = `もしご関心がありましたら、15分ほどオンラインでご説明させてください。\nご都合のよい日時をお知らせいただけますと幸いです。${pr.url ? `\n\nサービス概要：${pr.url}` : ''}`
  const footer = channel === 'email' ? complianceFooter(s) : `――――――――――\n${s.signature}`
  return `${opening}\n\n${text}\n\n${product}\n\n${close}\n\n${footer}`
}

// エージェントが書く部分の上限（これより長いものは保存しない）
export const INTRO_MAX = 220
