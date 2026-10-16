// ランナーの Firestore 接続。
// Admin SDK（ルールを素通りする）は使わず、members で role: 'runner' にした専用ユーザーでログインする。
// そのため承認・送信予約などは firestore.rules により、ランナーからはできない。
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import type { Activity, Campaign, Insight, Job, Lead, Message, Reaction, Settings } from '../../src/types.ts'
import { need } from './env.ts'

export type Conn = { db: Firestore; uid: string; email: string }

export async function connect(): Promise<Conn> {
  const app = initializeApp({
    apiKey: need('FIREBASE_API_KEY'),
    authDomain: need('FIREBASE_AUTH_DOMAIN'),
    projectId: need('FIREBASE_PROJECT_ID'),
    appId: need('FIREBASE_APP_ID'),
  })
  const auth = getAuth(app)
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true })
  // 動作確認用：エミュレーターに向ける（本番では設定しない）
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
    connectFirestoreEmulator(db, host, Number(port))
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
  const cred = await signInWithEmailAndPassword(auth, need('RUNNER_EMAIL'), need('RUNNER_PASSWORD'))
  // 初回：firestore.rules の一覧にあるメールアドレスなら、自分の役割（runner）を登録できる
  const me = doc(db, 'members', cred.user.uid)
  if (!(await getDoc(me)).exists()) await setDoc(me, { role: 'runner', email: cred.user.email ?? '' }).catch(() => undefined)
  return { db, uid: cred.user.uid, email: cred.user.email ?? '' }
}

const rows = <T>(snap: Awaited<ReturnType<typeof getDocs>>) => snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T)

export async function getJob(db: Firestore, id: string) {
  const s = await getDoc(doc(db, 'jobs', id))
  if (!s.exists()) throw new Error(`ジョブ ${id} が見つかりません`)
  return { ...(s.data() as Job), id: s.id }
}

export async function getCampaign(db: Firestore, id: string) {
  const s = await getDoc(doc(db, 'campaigns', id))
  if (!s.exists()) throw new Error(`キャンペーン ${id} が見つかりません`)
  return { ...(s.data() as Campaign), id: s.id }
}

export async function getSettings(db: Firestore): Promise<Settings> {
  const s = await getDoc(doc(db, 'settings', 'main'))
  if (!s.exists()) throw new Error('設定（settings/main）がありません。管理サイトの「設定」で送信者情報を保存してください')
  return s.data() as Settings
}

export const listSuppression = async (db: Firestore) => (await getDocs(collection(db, 'suppression'))).docs.map((d) => d.id)
export const leadsOf = async (db: Firestore, campaignId: string) =>
  rows<Lead>(await getDocs(query(collection(db, 'leads'), where('campaignId', '==', campaignId))))
export const messagesOf = async (db: Firestore, campaignId: string) =>
  rows<Message>(await getDocs(query(collection(db, 'messages'), where('campaignId', '==', campaignId))))
export const reactionsOf = async (db: Firestore, campaignId: string) =>
  rows<Reaction>(await getDocs(query(collection(db, 'reactions'), where('campaignId', '==', campaignId))))
export const activeInsights = async (db: Firestore) =>
  rows<Insight>(await getDocs(query(collection(db, 'insights'), where('active', '==', true))))
export const rejectedLeads = async (db: Firestore) => rows<Lead>(await getDocs(query(collection(db, 'leads'), where('status', '==', 'rejected'))))
export const positiveReactions = async (db: Firestore) =>
  rows<Reaction>(await getDocs(query(collection(db, 'reactions'), where('sentiment', '==', 'positive'))))
export const queuedJobs = async (db: Firestore) => rows<Job>(await getDocs(query(collection(db, 'jobs'), where('status', '==', 'queued'))))
export const runningJobs = async (db: Firestore) => rows<Job>(await getDocs(query(collection(db, 'jobs'), where('status', '==', 'running'))))
export const sentSince = async (db: Firestore, t: number) =>
  rows<Message>(await getDocs(query(collection(db, 'messages'), where('sentAt', '>=', t))))
export const leadsByIds = async (db: Firestore, ids: string[]) => {
  const out = new Map<string, Lead>()
  for (const id of new Set(ids)) {
    const s = await getDoc(doc(db, 'leads', id))
    if (s.exists()) out.set(id, { ...(s.data() as Lead), id })
  }
  return out
}

export const newId = (db: Firestore, col: string) => doc(collection(db, col)).id

export async function addActivity(db: Firestore, text: string, campaignId?: string) {
  const id = newId(db, 'activities')
  const a: Activity = { id, t: Date.now(), actor: 'agent', text, campaignId }
  await setDoc(doc(db, 'activities', id), a)
}
