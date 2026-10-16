// 送信の時間帯・1日の上限・土日祝の扱い。
// 管理サイトの「送信前の最終確認」とランナーの送信ガードで同じ計算を使うため、日本時間で計算し、値の import を持たない。
import type { Settings } from '../types.ts'

type Rules = Pick<Settings, 'dailyLimit' | 'sendWindow' | 'skipWeekend'>

const JST = 9 * 3600_000
const DAY = 86_400_000

export function parseWindow(w: string): { start: number; end: number } {
  const m = w.match(/^\s*(\d{1,2}):(\d{2})\s*[〜~～-]\s*(\d{1,2}):(\d{2})\s*$/)
  if (!m) return { start: 9 * 60, end: 18 * 60 }
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) }
}

// 日本時間の 0:00（ミリ秒）
export function jstDayStart(t: number) {
  return Math.floor((t + JST) / DAY) * DAY - JST
}

export function jstDateKey(t: number) {
  return new Date(t + JST).toISOString().slice(0, 10)
}

function jstMinutes(t: number) {
  return Math.floor((t - jstDayStart(t)) / 60_000)
}

export function isSendDay(rules: Rules, t: number, holidays?: ReadonlySet<string>) {
  if (!rules.skipWeekend) return true
  const dow = new Date(t + JST).getUTCDay()
  if (dow === 0 || dow === 6) return false
  return !holidays?.has(jstDateKey(t))
}

export function isOpen(rules: Rules, t: number, holidays?: ReadonlySet<string>) {
  const w = parseWindow(rules.sendWindow)
  const min = jstMinutes(t)
  return isSendDay(rules, t, holidays) && min >= w.start && min < w.end
}

// t 以降で最初に送れる時刻
export function nextOpen(rules: Rules, t: number, holidays?: ReadonlySet<string>) {
  if (isOpen(rules, t, holidays)) return t
  const w = parseWindow(rules.sendWindow)
  let day = jstDayStart(t)
  if (jstMinutes(t) >= w.start) day += DAY
  for (let i = 0; i < 60; i++, day += DAY) {
    const open = day + w.start * 60_000
    if (open >= t && isSendDay(rules, open, holidays)) return open
  }
  return t
}

export type SendSlot = { at: number; count: number }

// count 件を from から送るとき、1日の上限と時間帯で何日に分かれるか
export function planSends(rules: Rules, count: number, from: number, sentToday = 0, holidays?: ReadonlySet<string>): SendSlot[] {
  const out: SendSlot[] = []
  const limit = Math.max(1, rules.dailyLimit)
  let rest = count
  let t = nextOpen(rules, from, holidays)
  let used = jstDayStart(t) === jstDayStart(from) ? sentToday : 0
  while (rest > 0 && out.length < 60) {
    const n = Math.min(rest, Math.max(0, limit - used))
    if (n > 0) {
      out.push({ at: t, count: n })
      rest -= n
    }
    used = 0
    t = nextOpen(rules, jstDayStart(t) + DAY, holidays)
  }
  return out
}
