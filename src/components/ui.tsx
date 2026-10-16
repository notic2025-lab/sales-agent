import { useEffect, useRef, type ReactNode } from 'react'
import { create } from 'zustand'
import { AtSign, Bot, CircleCheck, Mail, PanelTop, User, X } from 'lucide-react'
import type { Channel, Job, Lead } from '../types'
import { STEPS, type Stage } from '../data/selectors'
import { CHANNEL_LABEL } from '../data/agent'
import { cx, fmtTime } from '../lib/util'

export function Pill({ tone, children, dot, sm }: { tone?: string; children: ReactNode; dot?: boolean; sm?: boolean }) {
  return (
    <span className={cx('pill', tone, sm && 'sm')}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

const STAGE_TONE: Record<Stage['tone'], string> = { agent: 'accent', admin: 'amber', wait: '', done: 'ok' }

export function StagePill({ stage }: { stage: Stage }) {
  return (
    <Pill tone={STAGE_TONE[stage.tone]} dot>
      {stage.label}
    </Pill>
  )
}

export function Score({ value }: { value: number }) {
  const tone = value >= 75 ? '' : value >= 55 ? 'mid' : 'low'
  return (
    <span className={cx('score', tone)} title={`スコア ${value}`}>
      <b>{value}</b>
      <span className="bar">
        <i style={{ width: `${value}%` }} />
      </span>
    </span>
  )
}

export const CHANNEL_ICON: Record<Channel, typeof Mail> = { email: Mail, form: PanelTop, sns: AtSign }

export function Contacts({ lead }: { lead: Lead }) {
  const has: Record<Channel, boolean> = { email: !!lead.email, form: !!lead.formUrl, sns: !!lead.sns }
  return (
    <span className="ch">
      {(['email', 'form', 'sns'] as Channel[]).map((c) => {
        const Icon = CHANNEL_ICON[c]
        return (
          <span
            key={c}
            className={cx(has[c] && 'on', lead.channel === c && 'primary')}
            title={`${CHANNEL_LABEL[c]}${has[c] ? (lead.channel === c ? '（送信に使用）' : '（あり）') : '（なし）'}`}
          >
            <Icon size={14} />
          </span>
        )
      })}
    </span>
  )
}

export function ChannelLabel({ channel }: { channel: Channel }) {
  const Icon = CHANNEL_ICON[channel]
  return (
    <span className="ch-label">
      <Icon size={15} />
      {CHANNEL_LABEL[channel]}
    </span>
  )
}

export function Sparkline({ data, width = 110, height = 34, color = 'var(--accent)' }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const span = max - min || 1
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={color} opacity={0.08} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function MiniSteps({ stage }: { stage: Stage }) {
  return (
    <span className="mini-steps" aria-label={`${stage.step + 1}/6 ${stage.label}`}>
      {STEPS.map((_, i) => (
        <i
          key={i}
          className={cx(i < stage.step && 'done', i === stage.step && 'current', i === stage.step && stage.tone === 'admin' && 'admin')}
        />
      ))}
    </span>
  )
}

export function Actor({ who }: { who: 'agent' | 'admin' }) {
  return who === 'agent' ? (
    <span className="actor agent">
      <Bot size={13} />
      エージェント
    </span>
  ) : (
    <span className="actor admin">
      <User size={13} />
      あなた
    </span>
  )
}

export function Stepper({ stage }: { stage: Stage }) {
  return (
    <div className="stepper">
      {STEPS.map((s, i) => {
        const state = i < stage.step ? 'done' : i === stage.step ? 'current' : 'upcoming'
        return (
          <div key={s.label} className={cx('step', state, state === 'current' && stage.tone === 'admin' && 'admin')}>
            <span className="line" />
            <span className="circle">{state === 'done' ? <CircleCheck size={16} /> : i + 1}</span>
            <span className="name">{s.label}</span>
            <Actor who={state === 'current' && stage.tone === 'admin' ? 'admin' : s.actor} />
          </div>
        )
      })}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={cx('switch', on && 'on')} onClick={() => onChange(!on)} />
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        {children}
      </aside>
    </>
  )
}

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </>
  )
}

export function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-ghost btn-icon btn-sm" onClick={onClick} aria-label="閉じる">
      <X size={18} />
    </button>
  )
}

function useEscape(fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && ref.current()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">{icon}</div>
      <b>{title}</b>
      {children}
    </div>
  )
}

export function Terminal({ job, maxHeight, follow }: { job: Job; maxHeight?: number; follow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [job.logs.length, follow])
  return (
    <div className="terminal" ref={ref} style={{ maxHeight }}>
      {job.logs.length === 0 && <span className="sub">ランナーが拾うのを待っています…</span>}
      {job.logs.map((l, i) => (
        <div key={i}>
          <span className="t">{fmtTime(l.t)}</span>
          <span className={l.text.startsWith('$') ? 'cmd' : l.text.startsWith('✓') ? 'ok' : l.text.startsWith('  ') ? 'sub' : ''}>{l.text}</span>
        </div>
      ))}
      {job.status === 'running' && <span className="cursor" />}
    </div>
  )
}

type ToastState = { items: { id: number; text: string }[]; push: (text: string) => void }
const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (text) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items, { id, text }] }))
    window.setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 3200)
  },
}))

export const toast = (text: string) => useToasts.getState().push(text)

export function Toasts() {
  const items = useToasts((s) => s.items)
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <CircleCheck size={18} />
          {t.text}
        </div>
      ))}
    </div>
  )
}
