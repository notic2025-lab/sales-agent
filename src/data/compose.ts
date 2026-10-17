// 文面の骨格（ハイブリッド生成）。管理サイトのデモとランナーで共通。
// 名乗り・商材の説明・締め・署名・法定表示は固定のテンプレートで組み、エージェントが書くのは件名と「相手企業に触れる数文」（intro）だけ。
//
// 営業の文面としての方針（返信をもらうことが目的）
//   ・スマホで2スクロール以内（法定表示を除いて 300〜500 字）。段落は短く
//   ・1通1つのお願い。いちばん軽い行動（「資料希望」と返すだけ）を先に、打ち合わせは添える程度
//   ・商材の説明は機能ではなく「相手にとって何が変わるか」。概要の1文＋強み3つまで
//   ・相手に関係のある話（intro）を先に置き、自社の話はそのあと
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

// 導入事例（1行に1つ）。ここに書いたものだけを文面で使う
export function casesOf(product: Campaign['product']) {
  return (product.caseStudies ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

// 商材の概要は最初の1文だけ使う（長い説明は読まれない）
function oneLiner(summary: string) {
  const first = summary.split('。')[0]?.trim() ?? ''
  return first.replace(/。$/, '')
}

// 件名は基本的にエージェントが相手ごとに書く。これは書かなかったときの既定
export function defaultSubject(campaign: Campaign, lead: Pick<Lead, 'company' | 'industry'>, pattern: 'A' | 'B') {
  const pr = campaign.product
  if (pattern === 'B') return casesOf(pr).length ? `${lead.industry}での${pr.name}の活用事例` : `${lead.industry}での${pr.name}の使い方`
  return `${lead.company}様へ｜${pr.name}のご紹介`
}

export function assembleBody(s: Sender, campaign: Campaign, lead: Pick<Lead, 'company'>, channel: Channel, intro: string) {
  const pr = campaign.product
  const strengths = strengthsOf(pr)
  const text = intro.trim()
  const one = oneLiner(pr.summary)
  if (channel === 'sns') {
    return [
      `${lead.company}ご担当者様`,
      `はじめまして、${s.senderCompany}の${s.senderName}です。`,
      text,
      `${pr.name}の資料をお送りしてもよろしいでしょうか。${pr.url ? `\n${pr.url}` : ''}`,
    ].join('\n')
  }
  const opening = `${lead.company}\nご担当者様\n\n突然のご連絡失礼いたします。${s.senderCompany}の${s.senderName}と申します。`
  const product = `${pr.name}は、${one}。${strengths.length ? `\n${strengths.map((x) => `・${x}`).join('\n')}` : ''}`
  // フォームからの問い合わせには「返信」できないので、連絡先を示す
  const ask =
    channel === 'email'
      ? 'ご関心がありましたら、このメールに「資料希望」とだけご返信ください。概要資料をお送りします。'
      : `ご関心がありましたら、${s.senderEmail} まで「資料希望」とだけご連絡ください。概要資料をお送りします。`
  const close = `${ask}\n15分ほどのオンラインでのご説明も承ります。${pr.url ? `\n\n詳しくはこちら：${pr.url}` : ''}`
  const footer = channel === 'email' ? complianceFooter(s) : `――――――――――\n${s.signature}`
  return `${opening}\n\n${text}\n\n${product}\n\n${close}\n\n${footer}`
}

// エージェントが書く部分の上限（これより長いものは保存しない）
export const INTRO_MAX = 220
export const SUBJECT_MAX = 36
