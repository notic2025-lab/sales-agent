// ClaudeCode 側のスラッシュコマンド（/collect-leads など）を、デモ用にブラウザ内で再現する。
// plan*: 実行開始時にログと結果を組み立てる / apply*: 完了時に DB へ書き込む。
import type {
  Activity,
  Campaign,
  Channel,
  DB,
  Insight,
  Job,
  JobType,
  Lead,
  Message,
  Reaction,
  Sentiment,
} from '../types'
import type { Confidence } from '../types'
import { HOUR, MIN, between, fmtDateTime, nextBusinessMorning, pick, shuffle, uid, type Rng } from '../lib/util'
import { checkMessage, hasError } from './checks'
import { assembleBody, casesOf, defaultSubject } from './compose'
import { REJECT_REASON, isAutoList, isAutoSend } from './leads'
import { planSends } from './sendPlan'
import { IS_DEMO } from './backend'

// デモの企業データを作れる業種と、条件の指定がないときに使う地域
const DEMO_INDUSTRIES = ['飲食', '小売', '不動産', 'クリニック', '製造', '宿泊・観光', '美容', '教育'] as const
const DEMO_REGIONS = ['東京', '神奈川', '埼玉', '千葉', '大阪', '京都', '愛知', '福岡'] as const
export const SIZES = ['指定なし', '〜10名', '11〜50名', '51〜300名', '301名〜'] as const

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'メール',
  form: 'フォーム',
  sns: 'SNS',
}

export const JOB_COMMAND: Record<JobType, string> = {
  'collect-leads': '/collect-leads',
  'draft-messages': '/draft-messages',
  'send-approved': '/send-approved',
  evaluate: '/evaluate',
}

export const JOB_LABEL: Record<JobType, string> = {
  'collect-leads': 'リスト収集',
  'draft-messages': '文面の下書き',
  'send-approved': '承認済みの送信',
  evaluate: '反応チェックと評価',
}

type Profile = {
  stems: [string, string][]
  observe: string
  hook: string
  unit: string
  summaries: ((region: string, n: number) => string)[]
}

const STEMS: [string, string][] = [
  ['かもめ', 'kamome'], ['あおば', 'aoba'], ['さくら', 'sakura'], ['いろは', 'iroha'],
  ['つばさ', 'tsubasa'], ['みどり', 'midori'], ['こはる', 'koharu'], ['あさひ', 'asahi'],
  ['ほしぞら', 'hoshizora'], ['なぎさ', 'nagisa'], ['すずらん', 'suzuran'], ['もみじ', 'momiji'],
  ['かえで', 'kaede'], ['しらかば', 'shirakaba'], ['やまびこ', 'yamabiko'], ['うみねこ', 'umineko'],
  ['ふたば', 'futaba'], ['はるかぜ', 'harukaze'], ['みなと', 'minato'], ['ことぶき', 'kotobuki'],
  ['ひなた', 'hinata'], ['わかば', 'wakaba'], ['あかね', 'akane'], ['そよかぜ', 'soyokaze'],
  ['たちばな', 'tachibana'], ['ゆうなぎ', 'yunagi'], ['つむぎ', 'tsumugi'], ['しおさい', 'shiosai'],
  ['まほろば', 'mahoroba'], ['えにし', 'enishi'], ['むすび', 'musubi'], ['あけぼの', 'akebono'],
]

const PROFILES: Record<string, Profile> = {
  飲食: {
    stems: [['食堂', 'shokudo'], ['珈琲店', 'coffee'], ['ベーカリー', 'bakery'], ['キッチン', 'kitchen'], ['酒場', 'sakaba'], ['製麺', 'seimen']],
    observe: '季節限定メニューの告知ページ',
    hook: '複数店舗を運営されている飲食企業さまから、店舗ごとの販促の手間についてご相談をいただくことが増えています。',
    unit: '店舗',
    summaries: [
      (r, n) => `${r}を中心にカフェ・ベーカリーを${n}店舗展開。季節メニューの告知を店頭POPとInstagramで行っている。`,
      (r, n) => `${r}で定食・居酒屋業態を${n}店舗運営。テイクアウトとデリバリーにも対応。`,
      (r, n) => `${r}発のラーメンチェーン。直営${n}店舗、フランチャイズ展開を準備中。`,
    ],
  },
  小売: {
    stems: [['商店', 'shoten'], ['雑貨店', 'zakka'], ['ストア', 'store'], ['書店', 'shoten-books'], ['青果', 'seika']],
    observe: '店舗ごとのセール情報のページ',
    hook: '多店舗の小売企業さまから、店頭の販促物を入れ替える手間についてご相談をいただくことが増えています。',
    unit: '店舗',
    summaries: [
      (r, n) => `${r}で生活雑貨店を${n}店舗運営。ECサイトとの連携を強化している。`,
      (r, n) => `${r}の地域密着型スーパー。${n}店舗で週替わりのチラシを配布。`,
    ],
  },
  不動産: {
    stems: [['不動産', 'fudosan'], ['ホーム', 'home'], ['住宅販売', 'jutaku'], ['エステート', 'estate']],
    observe: '物件情報の更新頻度の高さ',
    hook: '店舗を構える不動産会社さまから、物件の掲示物や看板の差し替えについてご相談をいただくことが増えています。',
    unit: '店舗',
    summaries: [
      (r, n) => `${r}で賃貸仲介店舗を${n}店舗展開。駅前の店頭に物件チラシを多数掲示。`,
      (r, n) => `${r}の新築戸建て販売。モデルハウス${n}か所で週末の内覧会を実施。`,
    ],
  },
  クリニック: {
    stems: [['クリニック', 'clinic'], ['歯科', 'dental'], ['医院', 'iin'], ['メディカル', 'medical']],
    observe: '診療案内とWeb予約の導線',
    hook: '複数院を運営されている医療法人さまから、院内掲示や予約導線の案内についてご相談をいただくことが増えています。',
    unit: '院',
    summaries: [
      (r, n) => `${r}で内科・小児科のクリニックを${n}院運営。Web予約と問診の電子化を進めている。`,
      (r, n) => `${r}の歯科医院グループ。${n}院で予防歯科の定期検診を案内。`,
    ],
  },
  製造: {
    stems: [['製作所', 'seisakusho'], ['工業', 'kogyo'], ['精機', 'seiki'], ['化成', 'kasei'], ['技研', 'giken']],
    observe: '製品ページの技術資料',
    hook: '中堅の製造業さまから、現場と管理部門の業務の効率化についてご相談をいただくことが増えています。',
    unit: '拠点',
    summaries: [
      (r, n) => `${r}に${n}工場をもつ金属加工メーカー。自動車部品の試作から量産まで対応。`,
      (r, n) => `${r}の樹脂成形メーカー。${n}拠点で医療機器向け部品を製造。`,
      (r, n) => `${r}の産業機械メーカー。全国${n}拠点で保守サービスを提供。`,
    ],
  },
  '宿泊・観光': {
    stems: [['旅館', 'ryokan'], ['ホテル', 'hotel'], ['リゾート', 'resort'], ['観光', 'kanko']],
    observe: '館内案内と周辺観光のページ',
    hook: '複数の施設を運営されている宿泊事業者さまから、館内案内の多言語化や更新の手間についてご相談をいただくことが増えています。',
    unit: '施設',
    summaries: [
      (r, n) => `${r}で温泉旅館を${n}施設運営。インバウンド客の比率が増えている。`,
      (r, n) => `${r}のビジネスホテルチェーン。${n}施設で朝食とレイトチェックアウトを訴求。`,
    ],
  },
  美容: {
    stems: [['ヘアサロン', 'hair'], ['ネイル', 'nail'], ['エステ', 'esthe'], ['ビューティー', 'beauty']],
    observe: 'クーポンと予約ページ',
    hook: '複数店舗を運営されているサロンさまから、店頭の告知とリピート施策についてご相談をいただくことが増えています。',
    unit: '店舗',
    summaries: [
      (r, n) => `${r}でヘアサロンを${n}店舗展開。会員アプリとLINEで再来店を促進。`,
      (r, n) => `${r}のネイル・アイラッシュサロン。${n}店舗で季節のデザインを毎月更新。`,
    ],
  },
  教育: {
    stems: [['学院', 'gakuin'], ['塾', 'juku'], ['スクール', 'school'], ['アカデミー', 'academy']],
    observe: '教室ごとの体験授業の案内',
    hook: '複数教室を運営されている教育事業者さまから、生徒募集の告知についてご相談をいただくことが増えています。',
    unit: '教室',
    summaries: [
      (r, n) => `${r}で個別指導塾を${n}教室運営。春と夏の講習で体験生を募集。`,
      (r, n) => `${r}の子ども向けプログラミングスクール。${n}教室とオンラインで展開。`,
    ],
  },
}

// デモ：一覧の業種以外は、汎用の企業データで作る
const GENERIC: Profile = {
  stems: [['サービス', 'service'], ['ホールディングス', 'hd'], ['企画', 'kikaku'], ['産業', 'sangyo'], ['ソリューションズ', 'solutions'], ['商事', 'shoji']],
  observe: '事業紹介と拠点一覧のページ',
  hook: '複数の拠点で事業を展開されている企業さまから、印刷物や掲示物の差し替えの手間についてご相談をいただくことが増えています。',
  unit: '拠点',
  summaries: [(r, n) => `${r}を中心に${n}拠点で事業を展開。店頭や施設での案内物を拠点ごとに用意している。`],
}
const profileOf = (industry: string) => PROFILES[industry] ?? GENERIC

const SNS_HANDLES = ['@', 'instagram.com/', 'x.com/']

function makeLead(rng: Rng, campaign: Campaign, used: Set<string>, now: number): Lead {
  const cond = campaign.conditions
  const industry = cond.industries.length ? pick(rng, cond.industries) : pick(rng, DEMO_INDUSTRIES)
  const region = cond.regions.length ? pick(rng, cond.regions) : pick(rng, DEMO_REGIONS)
  const p = profileOf(industry)
  let stem = pick(rng, STEMS)
  let suffix = pick(rng, p.stems)
  let guard = 0
  while (used.has(stem[1] + suffix[1]) && guard++ < 40) {
    stem = pick(rng, STEMS)
    suffix = pick(rng, p.stems)
  }
  used.add(stem[1] + suffix[1])
  const pre = rng() < 0.55
  const company = pre ? `株式会社${stem[0]}${suffix[0]}` : `${stem[0]}${suffix[0]}株式会社`
  const domain = `${stem[1]}-${suffix[1]}.example`
  const n = between(rng, 3, 38)
  const employees =
    cond.size && cond.size !== '指定なし' ? cond.size : n > 20 ? '51〜300名' : n > 8 ? '11〜50名' : '〜10名'

  const hasEmail = rng() < 0.62
  const hasForm = rng() < 0.74
  const hasSns = rng() < 0.45
  const prefer: Channel[] = campaign.channels.length ? campaign.channels : ['email', 'form']
  let channel: Channel | undefined
  for (const c of prefer) {
    if ((c === 'email' && hasEmail) || (c === 'form' && hasForm) || (c === 'sns' && hasSns)) {
      channel = c
      break
    }
  }
  channel ??= prefer[0]
  // SNSの更新が活発な企業は、メールよりDMのほうが届きやすいと判断する
  const snsActive = hasSns && campaign.channels.includes('sns') && rng() < 0.3
  if (snsActive) channel = 'sns'

  // スコア：条件との一致度 + 接触しやすさ + 販促の活発さ
  const reasons: string[] = []
  let score = 38
  if (cond.industries.includes(industry)) {
    score += 14
    reasons.push(`条件の業種（${industry}）に一致`)
  }
  if (cond.regions.includes(region)) {
    score += 8
    reasons.push(`${region}エリアに${n}${p.unit}`)
  } else {
    reasons.push(`${region}に${n}${p.unit}`)
  }
  const active = between(rng, 0, 9)
  if (active >= 4) {
    score += active * 2
    reasons.push(`${p.observe}が充実（直近3か月で更新${active}回）`)
  }
  if (n >= 10) {
    score += 8
    reasons.push(`${p.unit}数が多く、導入効果が大きいと推定`)
  } else if (n <= 4) {
    score -= 6
    reasons.push(`${p.unit}数が少なく、効果は限定的な可能性`)
  }
  if (snsActive) reasons.push('SNSの更新が活発で、DMでの反応が見込める')
  if (hasForm) reasons.push('法人向けの問い合わせフォームあり')
  if (hasEmail) {
    score += 4
    reasons.push('代表メールアドレスを公開')
  }
  if (!hasEmail && !hasForm) {
    score -= 10
    reasons.push('メール・フォームが見つからず、SNSのみ')
  }
  score += between(rng, -6, 8)
  score = Math.max(22, Math.min(97, score))

  const pages = ['/', '/company', hasForm ? '/contact' : '/access', industry === '製造' ? '/products' : '/news']

  // 自己チェック：条件との一致を根拠つきで確かめた結果の確信度
  const industryOk = !cond.industries.length || cond.industries.includes(industry)
  const regionOk = !cond.regions.length || cond.regions.includes(region)
  // 規模や事業内容をサイトの引用で示せない企業（デモでは一部をランダムに）は「中」にして要確認に回す
  const cited = rng() < 0.8
  const confidence: Confidence =
    !hasEmail && !hasForm || score < 40 ? 'low' : industryOk && regionOk && score >= 55 && cited ? 'high' : 'medium'
  if (!cited) reasons.push('規模を示す記載がサイトで確認できず、要確認')
  const summary = pick(rng, p.summaries)(region, n)

  return {
    id: uid('lead'),
    campaignId: campaign.id,
    company,
    domain,
    industry,
    region,
    employees,
    summary,
    email: hasEmail ? `${pick(rng, ['info', 'contact', 'sales', 'pr'])}@${domain}` : undefined,
    emailSource: hasEmail ? `https://${domain}/company` : undefined,
    formUrl: hasForm ? `https://${domain}/contact` : undefined,
    sns: hasSns ? `${pick(rng, SNS_HANDLES)}${stem[1]}_${suffix[1]}` : undefined,
    channel,
    score,
    scoreReasons: reasons,
    pages,
    status: 'pending',
    confidence,
    evidence: [
      { url: `https://${domain}/company`, quote: summary },
      ...(hasForm ? [{ url: `https://${domain}/contact`, quote: '法人のお客さまからのお問い合わせはこちら' }] : []),
    ],
    createdAt: now,
  }
}

function numberOf(lead: Lead) {
  const m = lead.summary.match(/(\d+)(店舗|院|工場|拠点|施設|教室|か所)/)
  return m ? `${m[1]}${m[2]}` : ''
}

export function composeMessage(
  db: Pick<DB, 'settings'>,
  campaign: Campaign,
  lead: Lead,
  pattern: 'A' | 'B',
  insights: Insight[],
): Pick<Message, 'subject' | 'body' | 'intro' | 'insightIds'> {
  const p = profileOf(lead.industry)
  const pr = campaign.product
  const useNumber = insights.some((i) => i.key === 'subject-number')
  const count = numberOf(lead)
  const cases = casesOf(pr)
  // デモ：本番では Claude が相手ごとに書く件名と書き出しを、テンプレートで代用する
  const subject =
    lead.channel === 'sns'
      ? ''
      : pattern === 'A' && useNumber && count
        ? `${count}の${p.unit === '店舗' ? '店頭' : '現場'}の案内物を、刷り直さずに更新する方法`
        : defaultSubject(campaign, lead, pattern)
  const intro =
    lead.channel === 'sns'
      ? `${count ? `${count}で` : ''}${p.observe}を拝見しました。${p.hook}`
      : pattern === 'B' && cases.length
        ? `${cases[0].split('：')[0]}では「${cases[0].split('：')[1] ?? cases[0]}」という結果が出ています。\n${count ? `${count}を運営されている` : ''}貴社でも、同じ使い方ができると考えご連絡しました。`
        : `貴社サイトで${p.observe}を拝見しました。${count ? `${count}ある${p.unit}ごとに` : `${p.unit}ごとに`}、掲示物や案内を差し替えるたびに刷り直しや貼り替えが発生しているのではと思い、ご連絡しました。`
  return { subject, body: assembleBody(db.settings, campaign, lead, lead.channel, intro), intro, insightIds: insights.map((i) => i.id) }
}

const REPLY_TEXT: Record<Sentiment, string[]> = {
  positive: [
    'ご連絡ありがとうございます。ちょうど同じような課題を検討していたところです。来週あたりで15分ほどお話を伺えますか。',
    '資料を拝見したいです。あわせて料金の目安も教えていただけますか。',
    '興味があります。販促の担当者も同席させたいので、日程の候補をいただけますか。',
    '他店舗の事例をもう少し詳しく聞きたいです。オンラインで構いませんので一度お願いします。',
  ],
  neutral: [
    '現在すぐに検討する段階ではありませんが、資料だけお送りいただけますか。',
    '来期の予算で検討するかもしれません。時期が近づいたら改めてご連絡ください。',
    '社内で共有します。必要があればこちらからご連絡いたします。',
  ],
  negative: [
    '現在は他社のサービスを利用しているため、今回は見送らせてください。',
    '社内で対応できているため、不要です。',
  ],
}

const UNSUB_TEXT = ['今後のご案内は不要です。配信を停止してください。', '配信停止をお願いします。']
const BOUNCE_TEXT = [
  'Mail Delivery Subsystem：550 5.1.1 宛先のアドレスが見つかりませんでした。',
  'Delivery Status Notification (Failure)：メールボックスが存在しません。',
]

function replyDraftFor(db: DB, sentiment: Sentiment, now: number) {
  const s = db.settings
  if (sentiment === 'positive') {
    const d = [1, 2, 3].map((i) => nextBusinessMorning(now, i))
    const times = ['10:00', '14:00', '16:30']
    return `ご返信いただき、ありがとうございます。${s.senderCompany}の${s.senderName}です。\nぜひ一度お話しさせてください。下記の日程でご都合はいかがでしょうか。\n\n${d
      .map((t, i) => `・${fmtDateTime(t).replace(/\d+:\d+$/, '')}${times[i]}〜`)
      .join('\n')}\n\nオンライン（Google Meet）で15分ほどを想定しています。\nご都合のよい枠をお知らせいただければ、招待をお送りいたします。\n\n${s.signature}`
  }
  return `ご返信いただき、ありがとうございます。${s.senderCompany}の${s.senderName}です。\nサービス資料（PDF）をお送りいたします。ご検討の時期が近づきましたら、お気軽にご連絡ください。\n\n資料：https://notic.example/docs/overview.pdf\n\n${s.signature}`
}

// ──────────────────────────────────────────────
// ジョブの組み立て

export type Planned = { plan: string[]; payload: unknown; summary: string }

export function planJob(db: DB, job: Job, rng: Rng, now: number): Planned {
  const campaign = db.campaigns.find((c) => c.id === job.campaignId)
  if (!campaign) return { plan: ['✕ キャンペーンが見つかりません'], payload: null, summary: '失敗' }
  switch (job.type) {
    case 'collect-leads':
      return planCollect(db, campaign, rng, now)
    case 'draft-messages':
      return planDraft(db, campaign, rng, now)
    case 'send-approved':
      return planSend(db, campaign, job, now)
    case 'evaluate':
      return planEvaluate(db, campaign, rng, now)
  }
}

function planCollect(db: DB, campaign: Campaign, rng: Rng, now: number): Planned {
  const used = new Set(db.leads.map((l) => l.domain.replace('.example', '').replace('-', '')))
  const target = campaign.conditions.count
  const found = target + between(rng, 6, 14)
  const candidates: Lead[] = []
  for (let i = 0; i < found; i++) candidates.push(makeLead(rng, campaign, used, now))
  const suppressed = candidates.filter((l) => db.suppression.includes(l.domain))
  // 配信停止リストと既存顧客に入っている企業は、二度と候補に入れない
  const extraSuppressed = Math.min(db.suppression.length, between(rng, 1, 2))
  const customers = new Set((db.settings.customerDomains ?? []).map((d) => d.toLowerCase()))
  const pool = candidates.filter((l) => !db.suppression.includes(l.domain) && !customers.has(l.domain))
  // 自己チェックで確信度が低い企業（連絡先が推測・条件に合う根拠がない）は落とす
  const dropped = pool.filter((l) => l.confidence === 'low')
  const leads = pool.filter((l) => l.confidence !== 'low').sort((a, b) => b.score - a.score).slice(0, target)
  const high = leads.filter((l) => l.confidence === 'high').length
  const auto = isAutoList(campaign)
  const rejections = db.leads.filter((l) => l.status === 'rejected' && l.rejectReason)
  const byReason = new Map<string, number>()
  for (const l of rejections) byReason.set(l.rejectReason!, (byReason.get(l.rejectReason!) ?? 0) + 1)
  const q = [...campaign.conditions.industries, ...campaign.conditions.regions].slice(0, 3).join(' ') || campaign.product.name
  const sample = shuffle(rng, leads).slice(0, 3)
  const plan = [
    `▸ 営業リスト「${campaign.name}」の商材と条件を読み込み`,
    rejections.length
      ? `▸ 過去にあなたが除外した理由を参照：${[...byReason].map(([k, n]) => `${REJECT_REASON[k as keyof typeof REJECT_REASON]} ${n}`).join('／')}`
      : '',
    `▸ 検索：「${q}」ほか ${between(rng, 3, 6)} クエリ`,
    `▸ 候補 ${found} 社を発見。企業サイトを巡回します`,
    ...sample.map((l) => `  · ${l.domain} — 事業内容・フォームURL・メールを確認`),
    `  · ほか ${found - sample.length} 社`,
    `▸ 除外ルールと照合：配信停止 ${suppressed.length + extraSuppressed} 社${customers.size ? `・既存顧客 ${candidates.length - pool.length - suppressed.length} 社` : ''}・個人事業主 ${between(rng, 0, 3)} 社を除外`,
    `▸ 条件との一致度と、連絡のしやすさでスコアを算出`,
    `▸ 自己チェック：1社ずつ条件に合う根拠（URLと引用）を確認`,
    `  · 根拠が出せない・連絡先が推測の ${dropped.length} 社を落としました`,
    `▸ 上位 ${leads.length} 社に絞り込み（確信 高 ${high}／中 ${leads.length - high}）`,
    auto
      ? `✓ 確信の高い ${high} 社を承認して文面作成へ。要確認 ${leads.length - high} 社は保存だけしました`
      : `✓ 企業リスト ${leads.length} 社とスコアを保存しました（あなたの承認待ち）`,
  ].filter(Boolean)
  return { plan, payload: { leads }, summary: auto ? `${leads.length}社を収集・${high}社を承認` : `${leads.length}社を収集` }
}

function activeInsights(db: DB) {
  return db.insights.filter((i) => i.active)
}

function planDraft(db: DB, campaign: Campaign, rng: Rng, now: number): Planned {
  const hasMsg = new Set(db.messages.filter((m) => m.campaignId === campaign.id).map((m) => m.leadId))
  const leads = db.leads.filter((l) => l.campaignId === campaign.id && l.status === 'approved' && !hasMsg.has(l.id))
  const insights = activeInsights(db)
  const preferB = insights.some((i) => i.key === 'pattern-B')
  const preferA = insights.some((i) => i.key === 'pattern-A')
  const messages: Message[] = leads.map((lead) => {
    const r = rng()
    const pattern: 'A' | 'B' = preferB ? (r < 0.7 ? 'B' : 'A') : preferA ? (r < 0.7 ? 'A' : 'B') : r < 0.5 ? 'A' : 'B'
    return {
      id: uid('msg'),
      campaignId: campaign.id,
      leadId: lead.id,
      channel: lead.channel,
      pattern,
      ...composeMessage(db, campaign, lead, pattern, insights),
      status: 'draft',
      edited: false,
      createdAt: now,
    }
  })
  const plan = [
    `▸ 承認済みの企業 ${leads.length} 社を取得`,
    insights.length ? `▸ 過去の評価結果を参照：学び ${insights.length} 件` : '▸ 過去の評価結果を参照：まだありません',
    ...insights.slice(0, 3).map((i) => `  · ${i.text}`),
    ...leads.slice(0, 3).map((l, i) => `▸ 文面を作成中（${i + 1}/${leads.length}） ${l.company}`),
    leads.length > 3 ? `  · ほか ${leads.length - 3} 社` : '',
    `▸ 特定電子メール法の表示（送信者情報・配信停止の案内）を確認`,
    `✓ 下書き ${messages.length} 件を保存しました`,
  ].filter(Boolean)
  return { plan, payload: { messages }, summary: `下書き${messages.length}件` }
}

type SendPayload =
  | { kind: 'outreach'; sendIds: string[]; manualIds: string[]; evalAt: number }
  | { kind: 'reply'; reactionIds: string[] }

function planSend(db: DB, campaign: Campaign, job: Job, now: number): Planned {
  const pre = job.payload as { kind?: 'reply' } | undefined
  if (pre?.kind === 'reply') {
    const rs = db.reactions.filter((r) => r.campaignId === campaign.id && r.replyDraft?.status === 'scheduled')
    const plan = [
      `▸ 承認済みの返信 ${rs.length} 件を取得`,
      ...rs.slice(0, 3).map((r) => `  · Gmail で返信：${db.leads.find((l) => l.id === r.leadId)?.company ?? ''}`),
      `✓ 返信を送信し、送信ログを記録しました`,
    ]
    return { plan, payload: { kind: 'reply', reactionIds: rs.map((r) => r.id) }, summary: `返信${rs.length}件を送信` }
  }
  // 予約時刻になった文面だけを送る（あとの時刻に予約した分は次のジョブに回す）
  const msgs = db.messages.filter((m) => m.campaignId === campaign.id && m.status === 'scheduled' && (m.scheduledAt ?? 0) <= now)
  const email = msgs.filter((m) => m.channel === 'email')
  const form = msgs.filter((m) => m.channel === 'form')
  const sns = msgs.filter((m) => m.channel === 'sns')
  const evalAt = nextBusinessMorning(now, campaign.evalAfterDays)
  const lead = (m: Message) => db.leads.find((l) => l.id === m.leadId)
  const plan = [
    `▸ 承認済み・送信予約の文面 ${msgs.length} 件を取得`,
    email.length ? `▸ Gmail で送信：${email.length} 件` : '',
    ...email.slice(0, 2).map((m) => `  · ${lead(m)?.email} へ送信（Message-ID 取得）`),
    form.length ? `▸ 問い合わせフォームに入力して送信：${form.length} 件` : '',
    ...form.slice(0, 2).map((m) => `  · ${lead(m)?.formUrl} の項目を入力・送信完了を確認`),
    sns.length ? `▸ SNS ${sns.length} 件は自動送信しないため「手動送信待ち」に回しました` : '',
    `▸ 送信ログを記録（メッセージID付き）`,
    `▸ 評価ジョブを予約：${fmtDateTime(evalAt)}（送信の${campaign.evalAfterDays}日後）`,
    `✓ ${email.length + form.length} 件を送信しました`,
  ].filter(Boolean)
  const payload: SendPayload = {
    kind: 'outreach',
    sendIds: [...email, ...form].map((m) => m.id),
    manualIds: sns.map((m) => m.id),
    evalAt,
  }
  return { plan, payload, summary: `${email.length + form.length}件を送信` }
}

function planEvaluate(db: DB, campaign: Campaign, rng: Rng, now: number): Planned {
  const reacted = new Set(db.reactions.map((r) => r.messageId))
  const sent = db.messages.filter(
    (m) => m.campaignId === campaign.id && m.status === 'sent' && m.channel !== 'sns' && !reacted.has(m.id),
  )
  const snsCount = db.messages.filter((m) => m.campaignId === campaign.id && m.channel === 'sns').length
  const reactions: Reaction[] = []
  for (const m of sent) {
    const lead = db.leads.find((l) => l.id === m.leadId)
    if (!lead) continue
    const sentAt = m.sentAt ?? now
    const at = Math.min(now, sentAt + between(rng, 2, 96) * HOUR)
    const base = { id: uid('rx'), campaignId: campaign.id, leadId: lead.id, messageId: m.id, source: 'gmail' as const }
    const r = rng()
    if (m.channel === 'email' && r < 0.05) {
      reactions.push({ ...base, type: 'bounce', excerpt: pick(rng, BOUNCE_TEXT), receivedAt: Math.min(now, sentAt + 3 * MIN) })
      continue
    }
    if (r < 0.1) {
      reactions.push({ ...base, type: 'unsubscribe', fromAddress: lead.email ?? `contact@${lead.domain}`, excerpt: pick(rng, UNSUB_TEXT), receivedAt: at })
      continue
    }
    let p = 0.01 + Math.max(0, (lead.score - 40) / 60) * 0.19
    if (m.pattern === 'B') p *= 1.45
    if (m.channel === 'form') p *= 0.85
    if (m.edited) p *= 1.15
    if (rng() < p) {
      const s = rng()
      const sentiment: Sentiment = s < 0.48 ? 'positive' : s < 0.8 ? 'neutral' : 'negative'
      reactions.push({
        ...base,
        type: 'reply',
        fromAddress: lead.email ?? `contact@${lead.domain}`,
        sentiment,
        excerpt: pick(rng, REPLY_TEXT[sentiment]),
        receivedAt: at,
        replyDraft: sentiment === 'negative' ? undefined : { body: replyDraftFor(db, sentiment, now), status: 'draft' },
      })
      continue
    }
    reactions.push({ ...base, type: 'no_response', excerpt: `送信から${campaign.evalAfterDays}日間、反応なし`, receivedAt: now })
  }

  const insights = deriveInsights(db, campaign, sent, reactions, now)
  const replies = reactions.filter((r) => r.type === 'reply')
  const count = (t: string) => reactions.filter((r) => r.type === t).length
  const hits = reactions.length - count('no_response')
  const plan = [
    `▸ 送信済みの宛先一覧を取得：${sent.length} 件${snsCount ? `（SNS ${snsCount} 件は手動登録のため対象外）` : ''}`,
    `▸ Gmail を検索：返信・配信停止・不達（Message-ID で照合）`,
    `▸ 該当メール ${hits} 件`,
    `  · 返信 ${replies.length} ／ 配信停止 ${count('unsubscribe')} ／ 不達 ${count('bounce')}`,
    `▸ 反応を記録し、ステータスを更新`,
    count('unsubscribe') ? `▸ 配信停止 ${count('unsubscribe')} 社を配信停止リストに追加` : '',
    `▸ 無反応 ${count('no_response')} 件を記録`,
    `▸ 評価を集計：返信率 ${sent.length ? ((replies.length / sent.length) * 100).toFixed(1) : '0.0'}%`,
    `▸ 返信の下書きを作成：${replies.filter((r) => r.replyDraft).length} 件`,
    insights.length ? `▸ 学びを更新：${insights.length} 件（次の文面作成で参照）` : '',
    `✓ 評価が完了しました`,
  ].filter(Boolean)
  return { plan, payload: { reactions, insights }, summary: `返信${replies.length}件・返信率${sent.length ? ((replies.length / sent.length) * 100).toFixed(1) : 0}%` }
}

function deriveInsights(db: DB, campaign: Campaign, sent: Message[], reactions: Reaction[], now: number): Insight[] {
  const out: Insight[] = []
  const rate = (ms: Message[]) => {
    if (!ms.length) return 0
    const ids = new Set(ms.map((m) => m.id))
    return reactions.filter((r) => r.type === 'reply' && ids.has(r.messageId)).length / ms.length
  }
  const A = sent.filter((m) => m.pattern === 'A')
  const B = sent.filter((m) => m.pattern === 'B')
  const ra = rate(A)
  const rb = rate(B)
  // 少なすぎる件数からは学びを作らない
  if (A.length >= 8 && B.length >= 8 && ra !== rb && Math.min(ra, rb) > 0) {
    const win = rb > ra ? 'B' : 'A'
    const lift = (Math.max(ra, rb) / Math.min(ra, rb)).toFixed(1)
    out.push({
      id: uid('ins'),
      key: `pattern-${win}`,
      text: win === 'B' ? `事例紹介型（B）の文面は、課題提起型（A）より返信率が高い` : `課題提起型（A）の文面は、事例紹介型（B）より返信率が高い`,
      detail: `A ${(ra * 100).toFixed(1)}%（${A.length}件）／ B ${(rb * 100).toFixed(1)}%（${B.length}件）`,
      lift: `×${lift}`,
      campaignId: campaign.id,
      createdAt: now,
      active: true,
    })
  }
  const lead = (m: Message) => db.leads.find((l) => l.id === m.leadId)
  const hi = sent.filter((m) => (lead(m)?.score ?? 0) >= 75)
  const lo = sent.filter((m) => (lead(m)?.score ?? 0) < 75)
  if (hi.length >= 8 && lo.length >= 3 && rate(hi) > rate(lo)) {
    out.push({
      id: uid('ins'),
      key: 'score',
      text: 'スコア75以上の企業は返信率が高い。リスト承認ではスコア順に確認を',
      detail: `75以上 ${(rate(hi) * 100).toFixed(1)}%（${hi.length}件）／ 75未満 ${(rate(lo) * 100).toFixed(1)}%（${lo.length}件）`,
      lift: `+${((rate(hi) - rate(lo)) * 100).toFixed(1)}pt`,
      campaignId: campaign.id,
      createdAt: now,
      active: true,
    })
  }
  return out
}

// ──────────────────────────────────────────────
// 完了時の書き込み

export function applyJob(db: DB, job: Job, now: number): Partial<DB> {
  const campaign = db.campaigns.find((c) => c.id === job.campaignId)
  const act = (text: string): Activity => ({ id: uid('act'), t: now, actor: 'agent', text, campaignId: job.campaignId })
  switch (job.type) {
    case 'collect-leads': {
      const { leads } = job.payload as { leads: Lead[] }
      const auto = campaign ? isAutoList(campaign) : false
      const saved = leads.map((l) =>
        auto && l.confidence === 'high' ? { ...l, status: 'approved' as const, autoApproved: true, createdAt: now } : { ...l, createdAt: now },
      )
      const approved = saved.filter((l) => l.status === 'approved').length
      const review = saved.length - approved
      return {
        leads: [...db.leads, ...saved],
        // 自動承認した企業があれば、そのまま文面作成に進む
        jobs: auto && approved ? [...db.jobs, newJob('draft-messages', job.campaignId, now)] : db.jobs,
        activities: [
          act(
            auto
              ? `「${campaign?.name}」の企業 ${saved.length} 社を集め、確信の高い ${approved} 社を承認して文面作成に進めました${review ? `（要確認 ${review} 社）` : ''}`
              : `「${campaign?.name}」の企業リスト ${leads.length} 社とスコアを保存しました`,
          ),
          ...db.activities,
        ],
      }
    }
    case 'draft-messages': {
      const { messages } = job.payload as { messages: Message[] }
      const saved = messages.map((m) => ({ ...m, createdAt: now }))
      const next: DB = { ...db, messages: [...db.messages, ...saved] }
      if (!campaign || !isAutoSend(campaign)) {
        return {
          messages: next.messages,
          activities: [act(`「${campaign?.name}」の文面の下書き ${messages.length} 件を保存しました`), ...db.activities],
        }
      }
      // 承認なしで送る営業リスト：自動チェックを通った文面はそのまま送信予約へ。通らないものは要確認として残す
      const result = autoSchedule(next, campaign, saved.map((m) => m.id), now, 'agent')
      const held = saved.length - result.scheduled
      return {
        ...result.patch,
        activities: [
          act(
            `「${campaign.name}」の文面 ${saved.length} 件を作り、自動チェックを通った ${result.scheduled} 件を送信予約しました${held ? `（要確認 ${held} 件）` : ''}${result.firstAt ? `。送信 ${fmtDateTime(result.firstAt)}〜` : ''}`,
          ),
          ...db.activities,
        ],
      }
    }
    case 'send-approved': {
      const p = job.payload as SendPayload
      if (p.kind === 'reply') {
        const ids = new Set(p.reactionIds)
        return {
          reactions: db.reactions.map((r) =>
            ids.has(r.id) && r.replyDraft ? { ...r, replyDraft: { ...r.replyDraft, status: 'sent', sentAt: now } } : r,
          ),
          activities: [act(`返信 ${ids.size} 件を Gmail から送信しました`), ...db.activities],
        }
      }
      const send = new Set(p.sendIds)
      const manual = new Set(p.manualIds)
      const messages = db.messages.map((m) => {
        if (send.has(m.id)) {
          return { ...m, status: 'sent' as const, sentAt: now, messageId: makeMessageId(m, now) }
        }
        if (manual.has(m.id)) return { ...m, status: 'manual_pending' as const }
        return m
      })
      const jobs = [...db.jobs]
      const hasEval = jobs.some((j) => j.campaignId === job.campaignId && j.type === 'evaluate' && j.status === 'queued')
      if (send.size && !hasEval) jobs.push(newJob('evaluate', job.campaignId, now, p.evalAt))
      const later = messages.filter((m) => m.campaignId === job.campaignId && m.status === 'scheduled')
      const hasSend = jobs.some((j) => j.campaignId === job.campaignId && j.type === 'send-approved' && j.status === 'queued')
      if (later.length && !hasSend) {
        const at = Math.min(...later.map((m) => m.scheduledAt ?? now))
        jobs.push(newJob('send-approved', job.campaignId, now, at, { kind: 'outreach' }))
      }
      return {
        messages,
        jobs,
        activities: [
          act(
            `「${campaign?.name}」の ${send.size} 件を送信し、送信ログを記録しました${manual.size ? `（SNS ${manual.size} 件は手動送信待ち）` : ''}`,
          ),
          ...db.activities,
        ],
      }
    }
    case 'evaluate': {
      const { reactions, insights } = job.payload as { reactions: Reaction[]; insights: Insight[] }
      const bounced = new Set(reactions.filter((r) => r.type === 'bounce').map((r) => r.messageId))
      const unsub = reactions
        .filter((r) => r.type === 'unsubscribe')
        .map((r) => db.leads.find((l) => l.id === r.leadId)?.domain)
        .filter((d): d is string => !!d)
      const replies = reactions.filter((r) => r.type === 'reply').length
      // 同じ種類の学び（pattern-A と pattern-B など）は新しいものに置き換える
      const family = (k: string) => k.split('-')[0]
      const keys = new Set(insights.map((i) => family(i.key)))
      return {
        reactions: [...db.reactions, ...reactions],
        messages: db.messages.map((m) => (bounced.has(m.id) ? { ...m, status: 'bounced' as const } : m)),
        suppression: [...new Set([...db.suppression, ...unsub])],
        insights: [...insights, ...db.insights.filter((i) => !keys.has(family(i.key)))],
        activities: [act(`「${campaign?.name}」の反応をチェックしました（返信 ${replies} 件）`), ...db.activities],
      }
    }
  }
}

function makeMessageId(m: Message, now: number) {
  if (m.channel === 'form') return `form-${now.toString(36)}-${m.id.slice(-4)}`
  return `<${now.toString(36)}.${m.id.slice(-6)}@mail.gmail.com>`
}

// ランナーはジョブ ID を渡してスラッシュコマンドを実行する（キャンペーンや送信対象はジョブから引く）
export function newJob(type: JobType, campaignId: string, now: number, runAt = now, payload?: unknown): Job {
  const id = uid('job')
  return {
    id,
    type,
    campaignId,
    status: 'queued',
    command: `claude -p "${JOB_COMMAND[type]} ${id}"`,
    createdAt: now,
    runAt,
    plan: [],
    logs: [],
    payload,
  }
}


// 自動チェックを通った文面を、送信ルール（時間帯・1日の上限・土日祝）に合わせて予約する。
// 通らなかった文面は下書き（要確認）のまま残す。デモでは時間帯と上限を待たず、すぐ送る
export function autoSchedule(
  db: DB,
  campaign: Campaign,
  messageIds: string[],
  now: number,
  by: string,
): { patch: Partial<DB>; scheduled: number; firstAt?: number } {
  const want = new Set(messageIds)
  const leads = db.leads.filter((l) => l.campaignId === campaign.id)
  const leadById = new Map(leads.map((l) => [l.id, l]))
  const earlier = db.messages
    .filter((m) => m.campaignId === campaign.id && ['scheduled', 'sending', 'sent', 'bounced'].includes(m.status))
    .map((m) => ({ message: m, lead: leadById.get(m.leadId) }))
  const ok: Message[] = []
  for (const m of db.messages) {
    if (!want.has(m.id) || (m.status !== 'draft' && m.status !== 'approved')) continue
    const checks = checkMessage(m, { settings: db.settings, lead: leadById.get(m.leadId), suppression: db.suppression, otherLeads: leads, earlier })
    if (hasError(checks)) continue
    ok.push(m)
    earlier.push({ message: m, lead: leadById.get(m.leadId) })
  }
  if (!ok.length) return { patch: { messages: db.messages }, scheduled: 0 }
  // 送る時刻：デモはすぐ。本番は次に送れる時刻から、1日の上限で日をまたいで割り当てる
  const at = new Map<string, number>()
  if (IS_DEMO) ok.forEach((m) => at.set(m.id, now))
  else {
    const auto = ok.filter((m) => m.channel !== 'sns')
    const slots = planSends(db.settings, auto.length, now)
    let i = 0
    for (const slot of slots) for (let k = 0; k < slot.count && i < auto.length; k++, i++) at.set(auto[i].id, slot.at)
    ok.filter((m) => m.channel === 'sns').forEach((m) => at.set(m.id, slots[0]?.at ?? now))
  }
  const firstAt = Math.min(...at.values())
  const existing = db.jobs.find(
    (j) => j.campaignId === campaign.id && j.type === 'send-approved' && j.status === 'queued' && (j.payload as { kind?: string } | undefined)?.kind !== 'reply',
  )
  return {
    patch: {
      messages: db.messages.map((m) => (at.has(m.id) ? { ...m, status: 'scheduled', scheduledAt: at.get(m.id), scheduledBy: by } : m)),
      jobs: existing
        ? db.jobs.map((j) => (j.id === existing.id ? { ...j, runAt: Math.min(j.runAt, firstAt) } : j))
        : [...db.jobs, newJob('send-approved', campaign.id, now, firstAt, { kind: 'outreach' })],
    },
    scheduled: ok.length,
    firstAt,
  }
}
