// 日本の祝日（https://holidays-jp.github.io/）。7日ごとに取り直し、取れないときは前回の一覧を使う
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { WORK_DIR } from './env.ts'

const FILE = path.join(WORK_DIR, 'holidays.json')
const read = () => new Set(Object.keys(JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>))

export async function loadHolidays(): Promise<{ holidays: Set<string>; warning?: string }> {
  try {
    if (existsSync(FILE) && Date.now() - statSync(FILE).mtimeMs < 7 * 86_400_000) return { holidays: read() }
  } catch {
    /* 取り直す */
  }
  try {
    const res = await fetch('https://holidays-jp.github.io/api/v1/date.json')
    if (!res.ok) throw new Error(String(res.status))
    const json = (await res.json()) as Record<string, string>
    mkdirSync(WORK_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(json))
    return { holidays: new Set(Object.keys(json)) }
  } catch {
    if (existsSync(FILE)) return { holidays: read(), warning: '祝日の一覧を更新できなかったため、前回の一覧を使います' }
    return { holidays: new Set(), warning: '祝日の一覧を取得できませんでした（土日だけを避けます）' }
  }
}
