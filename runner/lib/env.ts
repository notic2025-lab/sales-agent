// runner/.env を読み込み、設定値を取り出す
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RUNNER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const REPO_DIR = path.dirname(RUNNER_DIR)
export const WORK_DIR = path.join(RUNNER_DIR, 'work')
export const LOG_DIR = path.join(RUNNER_DIR, 'logs')

const envFile = path.join(RUNNER_DIR, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

export function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`runner/.env に ${name} がありません（runner/.env.example を参照）`)
  return v
}

export const opt = (name: string, fallback: string) => process.env[name] || fallback

// live にするまでは送信せず、送る予定の内容だけを記録する（最初の試運転用）
export const SEND_MODE: 'dry-run' | 'live' = process.env.SEND_MODE === 'live' ? 'live' : 'dry-run'
