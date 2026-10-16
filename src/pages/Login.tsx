// 本番（Firebase）のときだけ出るログインと接続状態の画面
import { useState } from 'react'
import { LogIn, LogOut, Sparkles } from 'lucide-react'
import { useStore } from '../store'

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Sparkles size={18} />
      </span>
      <span className="brand-name">営業エージェント</span>
      <span className="brand-by">by NOTIC</span>
    </div>
  )
}

const demoUrl = () => `${location.pathname}?demo#/`

export default function AuthGate() {
  const session = useStore((s) => s.session)
  const signIn = useStore((s) => s.signIn)
  const signOut = useStore((s) => s.signOut)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session.status === 'loading') {
    return (
      <div className="auth">
        <div className="auth-card">
          <Brand />
          <p className="muted">読み込み中…</p>
        </div>
      </div>
    )
  }

  if (session.status === 'denied' || session.status === 'error') {
    return (
      <div className="auth">
        <div className="auth-card">
          <Brand />
          <div>
            <b>{session.status === 'denied' ? 'このアカウントには管理者の権限がありません' : 'データを読み込めませんでした'}</b>
            <p className="muted small" style={{ marginTop: 6 }}>
              {session.status === 'denied'
                ? `${session.email} を管理者として登録してください（Firestore の members コレクション）。`
                : session.error}
            </p>
          </div>
          <button className="btn" onClick={signOut}>
            <LogOut size={16} />
            ログアウト
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(await signIn(email.trim(), password))
          setBusy(false)
        }}
      >
        <Brand />
        <div>
          <h1 style={{ fontSize: 18 }}>ログイン</h1>
          <p className="muted small">管理者のアカウントでログインしてください。</p>
        </div>
        <div className="field">
          <label htmlFor="email">メールアドレス</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">パスワード</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && (
          <p className="small" role="alert" style={{ color: 'var(--warn)' }}>
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <LogIn size={16} />
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
        <a className="link small" href={demoUrl()}>
          デモ（架空のデータ）を見る
        </a>
      </form>
    </div>
  )
}
