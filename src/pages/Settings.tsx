import { useState } from 'react'
import { Ban, Bot, Database, Mail, RotateCcw, Save } from 'lucide-react'
import { useStore } from '../store'
import { Pill, Switch, toast } from '../components/ui'

const WINDOWS = ['9:00〜18:00', '10:00〜17:00', '8:00〜20:00']

export default function Settings() {
  const settings = useStore((s) => s.settings)
  const suppression = useStore((s) => s.suppression)
  const update = useStore((s) => s.updateSettings)
  const reset = useStore((s) => s.resetDemo)
  const [form, setForm] = useState(settings)
  const dirty = JSON.stringify(form) !== JSON.stringify(settings)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>設定</h1>
          <p>文面の署名と送信ルール、配信停止リスト、外部サービスとの接続です。</p>
        </div>
        <div className="actions">
          <button
            className="btn btn-primary"
            disabled={!dirty}
            onClick={() => {
              update(form)
              toast('設定を保存しました。次に作成する文面から反映されます')
            }}
          >
            <Save size={16} />
            保存
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <section className="form-section">
          <div className="lead">
            <h3>送信者情報</h3>
            <p>特定電子メール法にもとづき、文面の末尾に送信者の情報と配信停止の案内を入れます。</p>
          </div>
          <div className="fields">
            <div className="fields two">
              <div className="field">
                <label htmlFor="sc">会社名</label>
                <input id="sc" className="input" value={form.senderCompany} onChange={(e) => setForm({ ...form, senderCompany: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="sn">担当者名</label>
                <input id="sn" className="input" value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="se">送信に使うメールアドレス</label>
              <input id="se" className="input" value={form.senderEmail} onChange={(e) => setForm({ ...form, senderEmail: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="sig">署名</label>
              <textarea id="sig" className="textarea" rows={3} value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} />
            </div>
          </div>
        </section>
        <section className="form-section">
          <div className="lead">
            <h3>送信ルール</h3>
            <p>/send-approved が守るルールです。上限を超えた分は翌営業日に回します。</p>
          </div>
          <div className="fields">
            <div className="fields two">
              <div className="field">
                <label htmlFor="dl">1日の送信上限</label>
                <input id="dl" type="number" min={1} max={500} className="input" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) || 1 })} />
              </div>
              <div className="field">
                <label htmlFor="sw">送信する時間帯</label>
                <select id="sw" className="select" value={form.sendWindow} onChange={(e) => setForm({ ...form, sendWindow: e.target.value })}>
                  {WINDOWS.map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <b>土日・祝日は送らない</b>
                <div className="muted small">週明けの朝にまとめて送ります</div>
              </div>
              <Switch on={form.skipWeekend} label="土日は送らない" onChange={(v) => setForm({ ...form, skipWeekend: v })} />
            </div>
          </div>
        </section>
      </div>

      <div className="grid g-2">
        <section className="card">
          <div className="card-head">
            <h2>配信停止リスト</h2>
            <span className="sub">{suppression.length}社</span>
          </div>
          <div className="card-body">
            <p className="muted small" style={{ marginBottom: 12 }}>
              「配信停止」の返信があった企業は自動で追加され、以後のリスト収集から除外されます。
            </p>
            {suppression.length === 0 ? (
              <p className="muted">まだありません。</p>
            ) : (
              <div className="row wrap" style={{ gap: 6 }}>
                {suppression.map((d) => (
                  <span className="tag mono" key={d}>
                    <Ban size={12} style={{ marginRight: 5 }} />
                    {d}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>接続</h2>
          </div>
          <div className="card-body stack" style={{ gap: 14 }}>
            {[
              { icon: Mail, name: 'Gmail', sub: '送信と、返信・配信停止・不達のチェックに使います', state: 'デモ（未接続）' },
              { icon: Bot, name: 'ランナー / ClaudeCode', sub: 'claude -p でスラッシュコマンドを実行します', state: 'ブラウザ内で再現' },
              { icon: Database, name: 'DB', sub: 'ジョブ・企業・文面・送信ログ・反応を保存します', state: 'このブラウザに保存' },
            ].map((c) => (
              <div className="row" key={c.name} style={{ alignItems: 'flex-start' }}>
                <span className="ch">
                  <span className="on" style={{ width: 34, height: 34, borderRadius: 9 }}>
                    <c.icon size={17} />
                  </span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{c.name}</b>
                  <div className="muted small">{c.sub}</div>
                </div>
                <Pill sm>{c.state}</Pill>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14 }} className="row wrap">
              <div style={{ flex: 1, minWidth: 200 }}>
                <b>デモデータを最初の状態に戻す</b>
                <div className="muted small">作成したキャンペーンや承認の操作は消えます。</div>
              </div>
              <button
                className="btn"
                onClick={() => {
                  if (window.confirm('デモデータを最初の状態に戻します。よろしいですか？')) {
                    reset()
                    setForm(useStore.getState().settings)
                    toast('デモデータを最初の状態に戻しました')
                  }
                }}
              >
                <RotateCcw size={16} />
                リセット
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
