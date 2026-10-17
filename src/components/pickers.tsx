// 新しい営業リストの「業種」と「地域」の選択
import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { ALL_INDUSTRIES, AREAS, INDUSTRY_GROUPS, regionLabel } from '../data/options'
import { cx } from '../lib/util'

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={cx('chip', 'sm', on && 'on')} onClick={onClick} aria-pressed={on}>
      {on && <Check size={13} />}
      {label}
    </button>
  )
}

export function IndustryPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('')
  const custom = value.filter((v) => !ALL_INDUSTRIES.includes(v))
  const add = () => {
    const items = text
      .split(/[、,\n]/)
      .map((x) => x.trim())
      .filter((x) => x && !value.includes(x))
    if (items.length) onChange([...value, ...items])
    setText('')
  }
  return (
    <div className="picker">
      <div className="picker-head">
        <span className="muted small">{value.length ? `${value.length}業種を選択中` : '選ばないと業種の指定なし'}</span>
        {value.length > 0 && (
          <button type="button" className="link small" onClick={() => onChange([])}>
            クリア
          </button>
        )}
      </div>
      {INDUSTRY_GROUPS.map((g) => (
        <div className="pick-group" key={g.label}>
          <span className="glabel">{g.label}</span>
          <div className="chips">
            {g.items.map((x) => (
              <Chip key={x} label={x} on={value.includes(x)} onClick={() => onChange(toggle(value, x))} />
            ))}
          </div>
        </div>
      ))}
      <div className="pick-group">
        <span className="glabel">その他</span>
        <div className="chips">
          {custom.map((x) => (
            <button type="button" key={x} className="chip sm on" onClick={() => onChange(value.filter((v) => v !== x))} aria-label={`${x}を外す`}>
              {x}
              <X size={13} />
            </button>
          ))}
          <span className="row" style={{ gap: 6, flex: '1 1 220px' }}>
            <input
              className="input"
              style={{ height: 32, fontSize: 13 }}
              value={text}
              placeholder="一覧にない業種（例：酒蔵、造園）"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  add()
                }
              }}
            />
            <button type="button" className="btn btn-sm" onClick={add} disabled={!text.trim()}>
              <Plus size={14} />
              追加
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

export function RegionPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const set = new Set(value)
  return (
    <div className="picker">
      <div className="picker-head">
        <span className="muted small">{value.length ? `${regionLabel(value)}（${value.length}都道府県）` : '選ばないと全国'}</span>
        {value.length > 0 && (
          <button type="button" className="link small" onClick={() => onChange([])}>
            全国に戻す
          </button>
        )}
      </div>
      {AREAS.map((a) => {
        const n = a.items.filter((p) => set.has(p)).length
        const all = n === a.items.length
        return (
          <div className="pick-group" key={a.label}>
            <button
              type="button"
              className={cx('glabel', 'area', all && 'on')}
              onClick={() => onChange(all ? value.filter((v) => !a.items.includes(v)) : [...value, ...a.items.filter((p) => !set.has(p))])}
              title={all ? `${a.label}をすべて外す` : `${a.label}をまとめて選ぶ`}
            >
              {a.label}
              <small>{n ? `${n}/${a.items.length}` : 'まとめて選ぶ'}</small>
            </button>
            <div className="chips">
              {a.items.map((p) => (
                <Chip key={p} label={p} on={set.has(p)} onClick={() => onChange(toggle(value, p))} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
