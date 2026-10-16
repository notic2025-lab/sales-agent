// Gmail のリフレッシュトークンを1回だけ取る（送信用の Google アカウントでブラウザからログインする）。
//   node runner/gmail-auth.ts
// 事前に Google Cloud で OAuth クライアント（デスクトップ アプリ）を作り、runner/.env に
// GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET を入れておく。取れたトークンは runner/.env に手で貼る。
import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { need } from './lib/env.ts'

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']
const PORT = 8765
const REDIRECT = `http://127.0.0.1:${PORT}/`

const clientId = need('GMAIL_CLIENT_ID')
const clientSecret = need('GMAIL_CLIENT_SECRET')

const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES.join(' '),
})}`

const server = createServer(async (req, res) => {
  const code = new URL(req.url ?? '/', REDIRECT).searchParams.get('code')
  if (!code) {
    res.writeHead(400).end('code がありません')
    return
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  })
  const json = (await r.json()) as { refresh_token?: string; error?: string }
  if (!json.refresh_token) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(`取得に失敗しました：${json.error ?? r.status}`)
    console.error(json)
    process.exit(1)
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('トークンを取得しました。ターミナルに戻ってください。')
  console.log('\n次の1行を runner/.env に追加してください：\n')
  console.log(`GMAIL_REFRESH_TOKEN=${json.refresh_token}\n`)
  server.close()
  process.exit(0)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('ブラウザで送信用の Google アカウントにログインし、アクセスを許可してください。')
  console.log(`開かない場合はこの URL を開いてください：\n${url}\n`)
  exec(`open "${url}"`)
})
