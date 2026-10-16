import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogOut, Plus, Settings, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { IS_DEMO } from '../data/backend'
import { Toasts } from './ui'

export function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [loc.pathname])

  return (
    <div className="app">
      <Header />
      <main className="content">{children}</main>
      <Toasts />
    </div>
  )
}

function Header() {
  const loc = useLocation()
  const email = useStore((s) => s.session.email)
  const signOut = useStore((s) => s.signOut)
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark">
          <Sparkles size={18} />
        </span>
        <span className="brand-name">営業エージェント</span>
        <span className="brand-by">by NOTIC</span>
      </Link>
      <span className="spacer" />
      {IS_DEMO ? (
        <span className="pill sm hide-sm" title="表示している企業・数値はすべて架空のデモデータです">
          デモデータ（架空）
        </span>
      ) : (
        <span className="row hide-sm" style={{ gap: 6 }}>
          <span className="muted small">{email}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={signOut} aria-label="ログアウト" title="ログアウト">
            <LogOut size={16} />
          </button>
        </span>
      )}
      <Link to="/settings" className="btn btn-ghost btn-icon" aria-label="送信者情報と送信ルール" title="送信者情報と送信ルール">
        <Settings size={19} />
      </Link>
      {loc.pathname !== '/new' && (
        <Link to="/new" className="btn btn-primary">
          <Plus size={18} />
          <span className="btn-label-sm">新しい営業リスト</span>
        </Link>
      )}
    </header>
  )
}
