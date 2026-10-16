// データ層の切り替え。
// Firebase の環境変数がそろっていれば本番（Firestore）、なければデモ（このブラウザの localStorage）で動く。
// 本番のビルドでも URL に ?demo を付けるとデモを開ける（例：https://…/sales-agent/?demo）。
const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const FIREBASE_CONFIGURED = Object.values(firebaseConfig).every(Boolean)

const forceDemo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')

export const BACKEND: 'demo' | 'firebase' = FIREBASE_CONFIGURED && !forceDemo ? 'firebase' : 'demo'
export const IS_DEMO = BACKEND === 'demo'
