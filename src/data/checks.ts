// 送信前の自動チェック。
// 管理サイトの「送信前の最終確認」と、ランナーの送信ガード（runner/agent-tools.ts）の両方で同じ判定を使う。
// error：送れない（直すまで予約・送信しない） / warn：人が確認したうえで送るかを決める
import type { Channel, Lead, Message, Settings } from '../types.ts'

export type CheckLevel = 'error' | 'warn'
// code は下の CHECK_RULES のどれか（画面で「何を確かめたか」を一覧にするため）
export type Check = { level: CheckLevel; code: string; text: string }

export const CHECK_RULES: { code: string; label: string; channels?: Channel[] }[] = [
  { code: 'lead', label: 'リストで承認した企業' },
  { code: 'suppressed', label: '配信停止リストとの照合' },
  { code: 'to', label: '送信先（メールアドレス・フォーム・SNS）' },
  { code: 'to-source', label: 'メールアドレスの掲載元（公開アドレスか）', channels: ['email'] },
  { code: 'duplicate', label: '同じ宛先への重複' },
  { code: 'recent', label: '直近30日の連絡' },
  { code: 'subject', label: '件名', channels: ['email', 'form'] },
  { code: 'body', label: '本文' },
  { code: 'placeholder', label: '差し込み漏れ（〇〇・{{ }} など）' },
  { code: 'other-company', label: '別の企業名の混入' },
  { code: 'company', label: '宛先の会社名' },
  { code: 'law', label: '特定電子メール法の表示（送信者・住所・配信停止の案内）', channels: ['email'] },
]

export const rulesFor = (channel: Channel) => CHECK_RULES.filter((r) => !r.channels || r.channels.includes(channel))

export type CheckContext = {
  settings: Pick<Settings, 'senderCompany' | 'senderEmail' | 'senderAddress'>
  lead: Lead | undefined
  suppression: readonly string[]
  // 同じキャンペーンの他の企業（別の会社名が混ざっていないかを見る）
  otherLeads?: readonly Lead[]
  // 同じバッチで先に送る文面（同じ宛先への2通目を止める）
  earlier?: readonly { message: Message; lead: Lead | undefined }[]
  // 直近30日に他のキャンペーンで連絡したドメイン
  recentDomains?: ReadonlySet<string>
}

const PLACEHOLDER = /\{\{|\}\}|〇〇|○○|◯◯|【(?:会社名|社名|企業名|氏名|担当者名|御社名)】|\[(?:会社名|社名|企業名|氏名|担当者名)\]/
const OPT_OUT = /配信停止|受信拒否|配信を希望されない|ご案内が不要/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const emailDomain = (email?: string) => (email?.split('@')[1] ?? '').toLowerCase()

export function isSuppressed(lead: Pick<Lead, 'domain' | 'email'>, suppression: readonly string[]) {
  const s = new Set(suppression.map((x) => x.toLowerCase()))
  return s.has(lead.domain.toLowerCase()) || (!!lead.email && (s.has(lead.email.toLowerCase()) || s.has(emailDomain(lead.email))))
}

export function extractLinks(text: string) {
  return [...new Set(text.match(/https?:\/\/[^\s）)」』>]+/g) ?? [])]
}

// 特定電子メール法の表示（送信者の名称・住所・受信拒否の連絡先と、その旨の案内）
export function complianceChecks(body: string, settings: CheckContext['settings']): Check[] {
  const out: Check[] = []
  const miss = (text: string) => out.push({ level: 'error', code: 'law', text })
  if (!settings.senderCompany || !body.includes(settings.senderCompany)) miss('送信者の名称（会社名）が本文にありません')
  if (!settings.senderAddress) miss('設定に送信者の住所がありません（設定 › 送信者情報）')
  else if (!body.includes(settings.senderAddress)) miss('送信者の住所が本文にありません')
  if (!settings.senderEmail || !body.includes(settings.senderEmail)) miss('受信拒否の連絡先（送信者のメールアドレス）が本文にありません')
  if (!OPT_OUT.test(body)) miss('配信停止（受信拒否）の案内が本文にありません')
  return out
}

export function checkMessage(m: Message, ctx: CheckContext): Check[] {
  const out: Check[] = []
  const err = (code: string, text: string) => out.push({ level: 'error', code, text })
  const warn = (code: string, text: string) => out.push({ level: 'warn', code, text })
  const lead = ctx.lead

  // 宛先
  if (!lead) {
    err('lead', '宛先の企業が見つかりません')
    return out
  }
  if (lead.status !== 'approved') err('lead', 'リストで承認されていない企業です')
  if (isSuppressed(lead, ctx.suppression)) err('suppressed', '配信停止リストに入っている企業です')
  if (m.channel === 'email') {
    if (!lead.email || !EMAIL.test(lead.email)) err('to', '送信先のメールアドレスがありません')
    else if (!lead.emailSource) err('to-source', 'メールアドレスの掲載元がありません（公開されているアドレスにだけ送ります）')
  }
  if (m.channel === 'form' && !lead.formUrl) err('to', '問い合わせフォームの URL がありません')
  if (m.channel === 'sns' && !lead.sns) err('to', 'SNS のアカウントがありません')
  const dup = ctx.earlier?.find(
    (e) => e.lead && (e.lead.domain === lead.domain || (!!lead.email && e.lead.email === lead.email)),
  )
  if (dup) err('duplicate', `同じ宛先への2通目です（${dup.lead?.company}）`)
  if (ctx.recentDomains?.has(lead.domain)) warn('recent', '直近30日に別のキャンペーンで連絡した企業です')

  // 中身
  if (m.channel !== 'sns' && !m.subject.trim()) err('subject', '件名が空です')
  if (!m.body.trim()) err('body', '本文が空です')
  if (PLACEHOLDER.test(m.subject) || PLACEHOLDER.test(m.body)) err('placeholder', '差し込みが残っています（〇〇、{{ }}、【会社名】など）')
  const other = ctx.otherLeads?.find((l) => l.id !== lead.id && l.company !== lead.company && m.body.includes(l.company))
  if (other) err('other-company', `別の企業名「${other.company}」が本文に入っています`)
  if (!m.body.includes(lead.company)) warn('company', `本文に宛先の会社名「${lead.company}」が見当たりません`)
  if (m.channel === 'email') out.push(...complianceChecks(m.body, ctx.settings))
  if (m.channel !== 'sns' && m.body.length > 2000) warn('body', `本文が長めです（${m.body.length}文字）`)
  return out
}

export const hasError = (checks: readonly Check[]) => checks.some((c) => c.level === 'error')

// 本番の文面に付ける署名と、特定電子メール法の表示
export function complianceFooter(s: Pick<Settings, 'signature' | 'senderCompany' | 'senderAddress' | 'senderEmail'>) {
  return [
    '――――――――――',
    s.signature,
    `${s.senderCompany}　${s.senderAddress ?? ''}`.trim(),
    '',
    `今後このようなご案内が不要な場合は、お手数ですが本メールに「配信停止」とご返信いただくか、${s.senderEmail} までご連絡ください。`,
  ].join('\n')
}

// 承認した返信を送る前のチェック
export const REPLY_RULES: { code: string; label: string }[] = [
  { code: 'to', label: '返信先のメールアドレス' },
  { code: 'suppressed', label: '配信停止リストとの照合' },
  { code: 'body', label: '本文' },
  { code: 'placeholder', label: '差し込み漏れ（〇〇・{{ }} など）' },
  { code: 'company', label: '自社名・署名' },
]

export function checkReply(
  body: string,
  to: string | undefined,
  settings: Pick<Settings, 'senderCompany'>,
  suppression: readonly string[] = [],
): Check[] {
  const out: Check[] = []
  if (!to || !EMAIL.test(to)) out.push({ level: 'error', code: 'to', text: '返信先のメールアドレスがありません（SNS の反応は手動で返信します）' })
  else if (suppression.some((x) => x.toLowerCase() === to.toLowerCase() || x.toLowerCase() === emailDomain(to)))
    out.push({ level: 'error', code: 'suppressed', text: '配信停止リストに入っている宛先です' })
  if (!body.trim()) out.push({ level: 'error', code: 'body', text: '本文が空です' })
  if (PLACEHOLDER.test(body)) out.push({ level: 'error', code: 'placeholder', text: '差し込みが残っています（〇〇、{{ }}、【会社名】など）' })
  if (settings.senderCompany && !body.includes(settings.senderCompany)) out.push({ level: 'warn', code: 'company', text: '本文に自社名（署名）が見当たりません' })
  return out
}
