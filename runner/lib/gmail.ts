// Gmail API（送信・スレッドの取得・検索）。
// 送るのは agent-tools.ts から、DB にある「承認済みの文面そのもの」だけ。ClaudeCode が本文を組み立てて送ることはしない。
// 認証は runner/gmail-auth.ts で取得したリフレッシュトークンを使う（スコープ：gmail.send / gmail.readonly）。
import { randomUUID } from 'node:crypto'
import { need } from './env.ts'

let token: { value: string; exp: number } | undefined

async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: need('GMAIL_CLIENT_ID'),
      client_secret: need('GMAIL_CLIENT_SECRET'),
      refresh_token: need('GMAIL_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  })
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !json.access_token) throw new GmailRejected(`Gmail の認証に失敗しました：${json.error ?? res.status}`)
  token = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 }
  return token.value
}

// Gmail が応答を返して断った（＝送られていない）ことが確かなエラー
export class GmailRejected extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
  })
  if (!res.ok) throw new GmailRejected(`Gmail API ${res.status}：${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

// 件名・差出人名の日本語（RFC 2047）。1つの encoded-word が長くなりすぎないよう分ける
function encodeWord(s: string) {
  if (/^[\x20-\x7e]*$/.test(s)) return s
  const chars = Array.from(s)
  const parts: string[] = []
  for (let i = 0; i < chars.length; i += 12) {
    parts.push(`=?UTF-8?B?${Buffer.from(chars.slice(i, i + 12).join(''), 'utf8').toString('base64')}?=`)
  }
  return parts.join('\r\n ')
}

const wrap76 = (b64: string) => b64.match(/.{1,76}/g)?.join('\r\n') ?? ''

export type Outgoing = {
  fromName: string
  from: string
  to: string
  subject: string
  body: string
  inReplyTo?: string
  threadId?: string
}

export function buildMime(m: Outgoing) {
  const host = m.from.split('@')[1] ?? 'localhost'
  const rfcId = `<${randomUUID()}@${host}>`
  const headers = [
    `From: ${encodeWord(m.fromName)} <${m.from}>`,
    `To: ${m.to}`,
    `Subject: ${encodeWord(m.subject)}`,
    `Message-ID: ${rfcId}`,
    // 受信側のメールソフトから配信停止できるようにする
    `List-Unsubscribe: <mailto:${m.from}?subject=${encodeURIComponent('配信停止')}>`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  const body = wrap76(Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))
  return { raw: `${headers.join('\r\n')}\r\n\r\n${body}`, rfcId }
}

export async function sendMail(m: Outgoing) {
  const { raw, rfcId } = buildMime(m)
  const sent = await api<{ id: string; threadId: string }>('messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url'), threadId: m.threadId }),
  })
  // Gmail が付けた Message-ID を読み直して残す（反応のチェックで照合に使う）。読めなくても送信は済んでいる
  let rfcMessageId = rfcId
  try {
    rfcMessageId = header(await api<GmailMessage>(`messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`), 'Message-ID') || rfcId
  } catch {
    /* 自分で付けた Message-ID を使う */
  }
  return { gmailId: sent.id, threadId: sent.threadId, rfcMessageId }
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] }
type GmailMessage = {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  labelIds?: string[]
  payload?: Part & { headers?: { name: string; value: string }[] }
}

const header = (m: GmailMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

function textOf(p: Part | undefined): string {
  if (!p) return ''
  if (p.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8')
  for (const c of p.parts ?? []) {
    const t = textOf(c)
    if (t) return t
  }
  if (p.mimeType === 'text/html' && p.body?.data) {
    return Buffer.from(p.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  }
  return ''
}

// ClaudeCode に渡す形（本文は長すぎないように切る）
export function summarize(m: GmailMessage) {
  return {
    gmailMessageId: m.id,
    threadId: m.threadId,
    from: header(m, 'From'),
    to: header(m, 'To'),
    subject: header(m, 'Subject'),
    date: header(m, 'Date'),
    receivedAt: Number(m.internalDate ?? 0),
    rfcMessageId: header(m, 'Message-ID'),
    inReplyTo: header(m, 'In-Reply-To'),
    sentByMe: m.labelIds?.includes('SENT') ?? false,
    text: textOf(m.payload).slice(0, 3000),
  }
}

export async function getThread(threadId: string) {
  const t = await api<{ messages?: GmailMessage[] }>(`threads/${threadId}?format=full`)
  return (t.messages ?? []).map(summarize)
}

export async function search(q: string, max = 20) {
  const list = await api<{ messages?: { id: string }[] }>(`messages?q=${encodeURIComponent(q)}&maxResults=${max}`)
  const out = []
  for (const { id } of list.messages ?? []) out.push(summarize(await api<GmailMessage>(`messages/${id}?format=full`)))
  return out
}
