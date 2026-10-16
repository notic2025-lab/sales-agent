// 本番のデータ層（Firestore + Firebase Auth）。BACKEND が 'firebase' のときだけ読み込む。
// 読み込み：各コレクションを onSnapshot で購読し、ストアにそのまま入れる（ランナーの進み具合もすぐ届く）
// 書き込み：transitions.ts の結果と直前の状態を比べ、変わった行・項目だけを1つのバッチで書く
// どの書き込みが許されるかは firestore.rules が決める（承認・送信予約は管理者だけ、など）
import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  collection,
  deleteField,
  doc,
  getDoc,
  initializeFirestore,
  setDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import type { DB } from '../types'
import { emptyDB, type Remote, type Store } from '../store'
import { blankSettings } from './seed'
import { firebaseConfig } from './backend'

const COLLECTIONS = ['campaigns', 'leads', 'messages', 'reactions', 'jobs', 'insights', 'activities'] as const
type Col = (typeof COLLECTIONS)[number]
type Row = { id: string } & Record<string, unknown>

// 件数が増え続けるものは新しい順に上限を付けて購読する
const LIMITED: Partial<Record<Col, [field: string, max: number]>> = { jobs: ['createdAt', 300], activities: ['t', 300] }
const SORT: Record<Col, (a: Row, b: Row) => number> = {
  campaigns: (a, b) => num(a.createdAt) - num(b.createdAt),
  leads: (a, b) => num(a.createdAt) - num(b.createdAt),
  messages: (a, b) => num(a.createdAt) - num(b.createdAt),
  reactions: (a, b) => num(a.receivedAt) - num(b.receivedAt),
  jobs: (a, b) => num(a.createdAt) - num(b.createdAt),
  insights: (a, b) => num(b.createdAt) - num(a.createdAt),
  activities: (a, b) => num(b.t) - num(a.t),
}
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'メールアドレスかパスワードが違います',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/user-disabled': 'このアカウントは無効になっています',
  'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからお試しください',
  'auth/network-request-failed': 'ネットワークに接続できません',
}

export function connectFirebase(setState: (patch: Partial<Store>) => void): Remote {
  const app = initializeApp(firebaseConfig)
  const auth = getAuth(app)
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true })
  let subs: Unsubscribe[] = []
  let latest: Partial<Store> = {}

  const stop = () => {
    subs.forEach((u) => u())
    subs = []
    latest = {}
  }

  onAuthStateChanged(auth, async (user) => {
    stop()
    if (!user) {
      setState({ ...emptyDB(), session: { status: 'signed_out' } })
      return
    }
    const email = user.email ?? ''
    setState({ session: { status: 'loading', email } })
    try {
      let member = await getDoc(doc(db, 'members', user.uid))
      // 初回ログイン：firestore.rules の一覧にあるメールアドレスなら、自分の役割を登録できる
      if (!member.exists()) {
        await setDoc(doc(db, 'members', user.uid), { role: 'admin', email }).catch(() => undefined)
        member = await getDoc(doc(db, 'members', user.uid))
      }
      if (member.data()?.role !== 'admin') {
        setState({ session: { status: 'denied', email } })
        return
      }
    } catch (e) {
      setState({ session: { status: 'denied', email, error: message(e) } })
      return
    }

    const waiting = new Set<string>([...COLLECTIONS, 'suppression', 'settings', 'runners'])
    const put = (key: string, patch: Partial<Store>) => {
      latest = { ...latest, ...patch }
      waiting.delete(key)
      setState(waiting.size ? patch : { ...patch, session: { status: 'ready', email } })
    }
    const fail = (key: string) => (e: Error) => setState({ session: { status: 'error', email, error: `${key}：${e.message}` } })

    for (const c of COLLECTIONS) {
      const lim = LIMITED[c]
      const q = lim ? query(collection(db, c), orderBy(lim[0], 'desc'), limit(lim[1])) : collection(db, c)
      subs.push(
        onSnapshot(
          q,
          (snap) => put(c, { [c]: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Row).sort(SORT[c]) } as Partial<Store>),
          fail(c),
        ),
      )
    }
    subs.push(onSnapshot(collection(db, 'suppression'), (snap) => put('suppression', { suppression: snap.docs.map((d) => d.id) }), fail('suppression')))
    subs.push(
      onSnapshot(
        doc(db, 'settings', 'main'),
        (snap) => put('settings', { settings: { ...blankSettings(), ...(snap.data() as Partial<DB['settings']>), runnerSpeed: 1 } }),
        fail('settings'),
      ),
    )
    subs.push(
      onSnapshot(
        collection(db, 'runners'),
        (snap) => {
          const last = snap.docs.map((d) => d.data()).sort((a, b) => num(b.lastPollAt) - num(a.lastPollAt))[0]
          put('runners', { runner: { lastPollAt: num(last?.lastPollAt), lastPollFound: num(last?.lastPollFound) } })
        },
        fail('runners'),
      ),
    )
  })

  return {
    async commit(prev, patch) {
      const batch = writeBatch(db)
      let writes = 0
      for (const c of COLLECTIONS) {
        const next = patch[c] as Row[] | undefined
        if (!next) continue
        const before = new Map((prev[c] as Row[]).map((r) => [r.id, r]))
        const seen = new Set<string>()
        for (const row of next) {
          seen.add(row.id)
          const old = before.get(row.id)
          if (old === row) continue
          const ref = doc(db, c, row.id)
          if (!old) {
            batch.set(ref, row)
            writes++
            continue
          }
          const changed = diff(old, row)
          if (Object.keys(changed).length) {
            batch.update(ref, changed)
            writes++
          }
        }
        for (const id of before.keys()) {
          if (!seen.has(id)) {
            batch.delete(doc(db, c, id))
            writes++
          }
        }
      }
      if (patch.settings && patch.settings !== prev.settings) {
        const { runnerSpeed: _demoOnly, ...settings } = patch.settings
        batch.set(doc(db, 'settings', 'main'), settings, { merge: true })
        writes++
      }
      if (patch.suppression && patch.suppression !== prev.suppression) {
        for (const d of patch.suppression.filter((x) => !prev.suppression.includes(x))) {
          batch.set(doc(db, 'suppression', d), { domain: d, source: 'manual', createdAt: Date.now() })
          writes++
        }
      }
      if (writes) await batch.commit()
    },
    resync: () => setState(latest),
    async signIn(email, password) {
      try {
        await signInWithEmailAndPassword(auth, email, password)
        return null
      } catch (e) {
        const code = (e as { code?: string }).code ?? ''
        return AUTH_ERRORS[code] ?? message(e)
      }
    },
    signOut: () => signOut(auth),
    async resetPassword(email) {
      try {
        await sendPasswordResetEmail(auth, email)
        return null
      } catch (e) {
        const code = (e as { code?: string }).code ?? ''
        return AUTH_ERRORS[code] ?? message(e)
      }
    },
  }
}

function diff(old: Row, row: Row): DocumentData {
  const out: DocumentData = {}
  for (const k of new Set([...Object.keys(old), ...Object.keys(row)])) {
    if (k === 'id' || old[k] === row[k]) continue
    if (JSON.stringify(old[k]) === JSON.stringify(row[k])) continue
    out[k] = row[k] === undefined ? deleteField() : row[k]
  }
  return out
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
