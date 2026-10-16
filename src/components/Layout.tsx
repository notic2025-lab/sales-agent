import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  ChartColumn,
  ChevronRight,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareReply,
  Plus,
  Settings,
  Sparkles,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { useStore } from '../store'
import { jobProgress, tasksOf } from '../data/selectors'
import { IS_DEMO } from '../data/backend'
import { JOB_COMMAND, JOB_LABEL } from '../data/agent'
import { cx, fmtDateTime } from '../lib/util'
import { Toasts } from './ui'

const TITLES: Record<string, string> = {
  '': 'ダッシュボード',
  inbox: '確認待ち',
  campaigns: 'キャンペーン',
  reactions: '反応',
  reports: '評価レポート',
  runner: 'ランナー',
  settings: '設定',
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    setOpen(false)
    window.scrollTo(0, 0)
  }, [loc.pathname])

  return (
    <div className="app">
      <Sidebar open={open} />
      {open && <div className="overlay" style={{ zIndex: 55 }} onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="content">{children}</main>
      </div>
      <Toasts />
    </div>
  )
}

function Sidebar({ open }: { open: boolean }) {
  const campaigns = useStore((s) => s.campaigns)
  const reactions = useStore((s) => s.reactions)
  const db = useStore()
  const tasks = useMemo(() => tasksOf(db), [db])
  const replies = reactions.filter((r) => r.type === 'reply').length

  return (
    <aside className={cx('sidebar', open && 'open')}>
      <div className="brand">
        <span className="brand-mark">
          <Sparkles size={18} />
        </span>
        <span className="brand-name">営業エージェント</span>
        <span className="brand-by">by NOTIC</span>
      </div>
      <div className="workspace">
        <span className="workspace-avatar">N</span>
        <div>
          <b>NOTIC 営業部</b>
          <small>
            {IS_DEMO ? 'デモ環境' : '本番'} ・ キャンペーン {campaigns.length}件
          </small>
        </div>
      </div>
      <nav className="nav">
        <NavLink to="/" end>
          <LayoutDashboard size={18} />
          ダッシュボード
        </NavLink>
        <NavLink to="/inbox">
          <Inbox size={18} />
          確認待ち
          {tasks.length > 0 && <span className="badge">{tasks.length}</span>}
        </NavLink>
        <NavLink to="/campaigns">
          <Megaphone size={18} />
          キャンペーン
          <span className="count">{campaigns.length}</span>
        </NavLink>
        <NavLink to="/reactions">
          <MessageSquareReply size={18} />
          反応
          <span className="count">{replies}</span>
        </NavLink>
        <NavLink to="/reports">
          <ChartColumn size={18} />
          評価レポート
        </NavLink>
        <div className="nav-label">エージェント</div>
        <NavLink to="/runner">
          <TerminalIcon size={18} />
          ランナー・ジョブ
        </NavLink>
        <NavLink to="/settings">
          <Settings size={18} />
          設定
        </NavLink>
      </nav>
      <RunnerCard />
    </aside>
  )
}

function RunnerCard() {
  const jobs = useStore((s) => s.jobs)
  const paused = useStore((s) => s.settings.runnerPaused)
  const campaigns = useStore((s) => s.campaigns)
  const running = jobs.find((j) => j.status === 'running')
  const now = Date.now()
  const next = jobs.filter((j) => j.status === 'queued' && j.runAt > now).sort((a, b) => a.runAt - b.runAt)[0]

  return (
    <Link to="/runner" className="runner-card">
      <div className="row">
        <span className={cx('live-dot', running && 'busy', paused && 'off')} />
        <b>{paused ? 'ランナー 一時停止中' : running ? 'エージェント実行中' : 'ランナー 待機中'}</b>
      </div>
      {running ? (
        <>
          <p>
            <span className="mono">{JOB_COMMAND[running.type]}</span> ・ {campaigns.find((c) => c.id === running.campaignId)?.name}
          </p>
          <div className={cx('progress', jobProgress(running) === null && 'indeterminate')} style={{ marginTop: 8 }}>
            <i style={{ width: jobProgress(running) === null ? undefined : `${jobProgress(running)}%` }} />
          </div>
        </>
      ) : (
        <p>
          {paused
            ? '再開すると、未処理のジョブから順に実行します。'
            : IS_DEMO
              ? '3秒ごとに未処理のジョブを確認しています。'
              : '社内のランナーが未処理のジョブを確認しています。'}
          {next && !paused && (
            <>
              <br />
              次の予約：{JOB_LABEL[next.type]} {fmtDateTime(next.runAt)}
            </>
          )}
        </p>
      )}
    </Link>
  )
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const loc = useLocation()
  const campaigns = useStore((s) => s.campaigns)
  const parts = loc.pathname.split('/').filter(Boolean)
  const crumbs: { label: string; to?: string }[] = [{ label: TITLES[parts[0] ?? ''] ?? '', to: parts.length > 1 ? `/${parts[0]}` : undefined }]
  if (parts[0] === 'campaigns' && parts[1]) {
    crumbs.push({ label: parts[1] === 'new' ? '新しいキャンペーン' : (campaigns.find((c) => c.id === parts[1])?.name ?? '見つかりません') })
  }

  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon menu-btn" onClick={onMenu} aria-label="メニューを開く">
        <Menu size={20} />
      </button>
      <nav className="crumbs" aria-label="パンくず">
        <span className="hide-sm">NOTIC 営業部</span>
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 8, minWidth: 0 }}>
            <ChevronRight size={14} className={i === 0 ? 'hide-sm' : ''} />
            {c.to ? <Link to={c.to}>{c.label}</Link> : <b>{c.label}</b>}
          </span>
        ))}
      </nav>
      <span className="spacer" />
      {IS_DEMO ? (
        <span className="pill sm hide-sm" title="表示している企業・数値はすべて架空のデモデータです">
          デモデータ（架空）
        </span>
      ) : (
        <UserMenu />
      )}
      {loc.pathname !== '/campaigns/new' && (
        <Link to="/campaigns/new" className="btn btn-primary">
          <Plus size={18} />
          <span className="btn-label-sm">キャンペーン作成</span>
        </Link>
      )}
    </header>
  )
}

function UserMenu() {
  const email = useStore((s) => s.session.email)
  const signOut = useStore((s) => s.signOut)
  return (
    <span className="row hide-sm" style={{ gap: 6 }}>
      <span className="muted small">{email}</span>
      <button className="btn btn-ghost btn-icon btn-sm" onClick={signOut} aria-label="ログアウト" title="ログアウト">
        <LogOut size={16} />
      </button>
    </span>
  )
}
