// 新しい営業リストで選べる業種と地域。ここにない業種は画面で自由に足せる
export const INDUSTRY_GROUPS: { label: string; items: string[] }[] = [
  { label: '飲食・小売', items: ['飲食', 'カフェ・ベーカリー', '小売', 'スーパー・食品', 'ドラッグストア', 'アパレル', '家電・量販店', 'ホームセンター', 'EC・通販'] },
  { label: '宿泊・観光・レジャー', items: ['宿泊・観光', '旅行・観光バス', 'テーマパーク・レジャー', 'フィットネス・ジム', 'スポーツ施設', '映画館・劇場', 'ゴルフ場', '温浴・スパ'] },
  { label: '医療・福祉', items: ['クリニック', '歯科', '病院', '調剤薬局', '介護・福祉', '動物病院'] },
  { label: '美容・暮らし', items: ['美容', 'エステ・ネイル', '冠婚葬祭', 'ペット', 'クリーニング', '保育・学童'] },
  { label: '教育', items: ['教育', '学習塾', '専門学校・大学', 'スクール・習い事', '自動車教習所'] },
  { label: '不動産・住まい', items: ['不動産', '住宅・工務店', 'リフォーム', 'マンション管理', '建設', '住宅設備'] },
  { label: 'ものづくり・物流', items: ['製造', '食品製造', '印刷', '物流・倉庫', '運送', '卸売'] },
  { label: '交通・自動車', items: ['自動車販売・整備', 'ガソリンスタンド', '鉄道・バス・タクシー', 'レンタカー・カーシェア', '駐車場'] },
  { label: 'ビジネス・公共', items: ['IT・Web', '広告・販促', 'イベント・展示会', '人材・派遣', '士業', '保険・金融', '自治体・公共施設', '観光協会・商工会'] },
]

export const AREAS: { label: string; items: string[] }[] = [
  { label: '北海道・東北', items: ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島'] },
  { label: '関東', items: ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川'] },
  { label: '中部', items: ['新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知'] },
  { label: '近畿', items: ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山'] },
  { label: '中国', items: ['鳥取', '島根', '岡山', '広島', '山口'] },
  { label: '四国', items: ['徳島', '香川', '愛媛', '高知'] },
  { label: '九州・沖縄', items: ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'] },
]

export const ALL_INDUSTRIES = INDUSTRY_GROUPS.flatMap((g) => g.items)
export const ALL_PREFECTURES = AREAS.flatMap((a) => a.items)

// 「京都・大阪・兵庫ほか3」のように短くする（名前やカードの表示用）
export function shortList(items: readonly string[], max = 3, unit = '') {
  if (items.length <= max) return items.join('・')
  return `${items.slice(0, max).join('・')}ほか${items.length - max}${unit}`
}

// 地域をまとめて読めるようにする（地方の全県を選んでいれば地方名にする）
export function regionLabel(regions: readonly string[]) {
  if (!regions.length) return '全国'
  const set = new Set(regions)
  const parts: string[] = []
  for (const a of AREAS) {
    const hit = a.items.filter((p) => set.has(p))
    if (hit.length === a.items.length) parts.push(a.label)
    else parts.push(...hit)
  }
  parts.push(...regions.filter((r) => !ALL_PREFECTURES.includes(r)))
  return shortList(parts, 4)
}
