export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]
export const between = (rng: Rng, min: number, max: number) => Math.floor(min + rng() * (max - min + 1))
export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

let counter = 0
export function uid(prefix: string) {
  counter = (counter + 1) % 1296
  return `${prefix}_${Date.now().toString(36).slice(-5)}${counter.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`
}

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

export function fmtDate(t: number) {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`
}

export function fmtDateTime(t: number) {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtTime(t: number) {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function relTime(t: number, now = Date.now()) {
  const diff = now - t
  if (diff < 0) {
    const f = -diff
    if (f < HOUR) return `${Math.max(1, Math.round(f / MIN))}分後`
    if (f < DAY) return `${Math.round(f / HOUR)}時間後`
    return `${Math.round(f / DAY)}日後`
  }
  if (diff < MIN) return 'たった今'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}分前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}時間前`
  if (diff < 2 * DAY) return '昨日'
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}日前`
  return fmtDate(t)
}

export const pct = (n: number, d: number, digits = 1) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(digits)}%`)
export const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d)
export const num = (n: number) => n.toLocaleString('ja-JP')

export function nextBusinessMorning(from = Date.now(), days = 0) {
  const d = new Date(from + days * DAY)
  d.setHours(9, 0, 0, 0)
  if (d.getTime() <= from) d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}
