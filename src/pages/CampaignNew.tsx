import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Check, FilePenLine, Rocket, ShieldCheck, UserCheck } from 'lucide-react'
import { useStore } from '../store'
import type { Channel } from '../types'
import { CHANNEL_LABEL, INDUSTRIES, REGIONS, SIZES } from '../data/agent'
import { cx } from '../lib/util'
import { APPROVAL_MODE, modeToFields, type ApprovalMode } from '../data/leads'
import { CHANNEL_ICON, toast } from '../components/ui'

const CHANNEL_DESC: Record<Channel, string> = {
  email: 'Gmailから送信。返信・配信停止・不達を自動でチェックします',
  form: '企業サイトの問い合わせフォームに入力して送信します',
  sns: '文面だけ作成します。送信はあなたが手動で行い、完了を登録します',
}

const EVAL_DAYS = [3, 5, 7, 14]

export default function CampaignNew() {
  const nav = useNavigate()
  const create = useStore((s) => s.createCampaign)
  const [name, setName] = useState('')
  const [product, setProduct] = useState({
    name: '可変QR',
    summary: '印刷・設置したあとでもQRの行き先を変えられるサービスです。1つのQRに複数のリンクをまとめ、どれだけ読まれたかもレポートで確かめられます。',
    strengths: '印刷物を刷り直さずにリンクを差し替えられる\n日時を決めて自動で切り替えられる\n読み取り数のレポートがLINEやメールに届く',
    url: 'https://notic.jp/qr/',
  })
  const [industries, setIndustries] = useState<string[]>(['宿泊・観光'])
  const [regions, setRegions] = useState<string[]>(['京都', '大阪'])
  const [size, setSize] = useState<string>('指定なし')
  const [count, setCount] = useState(20)
  const [keywords, setKeywords] = useState('複数施設、館内案内、インバウンド')
  const [channels, setChannels] = useState<Channel[]>(['email', 'form'])
  const [evalAfterDays, setEval] = useState(7)
  const [mode, setMode] = useState<ApprovalMode>('auto')

  const autoName = `${product.name || '商材'}｜${industries.length ? industries.join('・') : '業種指定なし'}`
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const valid = product.name.trim() && product.summary.trim() && channels.length > 0

  const submit = () => {
    if (!valid) return
    const id = create({
      name: name.trim() || autoName,
      product,
      conditions: { industries, regions, size, count, keywords },
      channels,
      evalAfterDays,
      ...modeToFields(mode),
    })
    toast('営業リストを作成しました。エージェントが企業を集め始めます')
    nav(`/lists/${id}`)
  }

  const brief = `${regions.length ? regions.join('・') : '全国'}の${industries.length ? industries.join('・') : 'さまざまな業種'}の企業を${count}社集めます。${
    size !== '指定なし' ? `従業員規模は${size}。` : ''
  }${channels.map((c) => CHANNEL_LABEL[c]).join('・') || '（チャネル未選択）'}で連絡し、送信の${evalAfterDays}日後に反応を評価します。`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>新しい営業リスト</h1>
          <p>商材と条件を登録すると、エージェントが企業を集め、文面を作り、送信ルールの範囲で送ります。</p>
        </div>
      </div>
      <div className="grid g-main" style={{ alignItems: 'start' }}>
        <div className="card">
          <section className="form-section">
            <div className="lead">
              <h3>
                <span className="step-no">1</span>商材
              </h3>
              <p>文面の材料になります。強みは1行に1つずつ書いてください。</p>
            </div>
            <div className="fields">
              <div className="fields two">
                <div className="field">
                  <label htmlFor="pname">商材名</label>
                  <input id="pname" className="input" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="purl">紹介ページのURL</label>
                  <input id="purl" className="input" value={product.url} onChange={(e) => setProduct({ ...product, url: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="psum">概要</label>
                <textarea id="psum" className="textarea" rows={3} value={product.summary} onChange={(e) => setProduct({ ...product, summary: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="pstr">強み</label>
                <textarea id="pstr" className="textarea" rows={3} value={product.strengths} onChange={(e) => setProduct({ ...product, strengths: e.target.value })} />
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="lead">
              <h3>
                <span className="step-no">2</span>条件
              </h3>
              <p>エージェントが検索と巡回に使う条件です。選ばない項目は「指定なし」になります。</p>
            </div>
            <div className="fields">
              <div className="field">
                <span className="label">業種</span>
                <div className="row wrap" style={{ gap: 8 }}>
                  {INDUSTRIES.map((x) => (
                    <button type="button" key={x} className={cx('chip', industries.includes(x) && 'on')} onClick={() => setIndustries(toggle(industries, x))}>
                      {industries.includes(x) && <Check size={14} />}
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="label">地域</span>
                <div className="row wrap" style={{ gap: 8 }}>
                  {REGIONS.map((x) => (
                    <button type="button" key={x} className={cx('chip', regions.includes(x) && 'on')} onClick={() => setRegions(toggle(regions, x))}>
                      {regions.includes(x) && <Check size={14} />}
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fields two">
                <div className="field">
                  <label htmlFor="size">従業員規模</label>
                  <select id="size" className="select" value={size} onChange={(e) => setSize(e.target.value)}>
                    {SIZES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="count">
                    収集する件数　<b className="num">{count}社</b>
                  </label>
                  <input id="count" type="range" className="range" min={10} max={60} step={2} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ height: 42 }} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="kw">キーワード</label>
                <input id="kw" className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="例：複数店舗、季節メニュー" />
                <span className="hint">企業サイトの巡回で、事業内容との一致を見るときに使います。</span>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="lead">
              <h3>
                <span className="step-no">3</span>承認の方法
              </h3>
              <p>どこまでエージェントに任せるかです。どの方法でも、送るのは設定の送信ルール（1日の上限・時間帯）の範囲で、自動チェックを通った文面だけです。</p>
            </div>
            <div className="fields">
              {(
                [
                  ['auto', ShieldCheck],
                  ['send', FilePenLine],
                  ['manual', UserCheck],
                ] as const
              ).map(([k, Icon]) => (
                <button type="button" key={k} className={cx('choice', mode === k && 'on')} onClick={() => setMode(k)} aria-pressed={mode === k}>
                  <span className="ic">
                    <Icon size={18} />
                  </span>
                  <span>
                    <b>{APPROVAL_MODE[k].title}</b>
                    <small>{APPROVAL_MODE[k].desc}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="form-section">
            <div className="lead">
              <h3>
                <span className="step-no">4</span>連絡の方法
              </h3>
              <p>見つかった連絡先のうち、上から順に使います。</p>
            </div>
            <div className="fields">
              {(['email', 'form', 'sns'] as Channel[]).map((c) => {
                const Icon = CHANNEL_ICON[c]
                const on = channels.includes(c)
                return (
                  <button type="button" key={c} className={cx('choice', on && 'on')} onClick={() => setChannels(toggle(channels, c))} aria-pressed={on}>
                    <span className="ic">
                      <Icon size={18} />
                    </span>
                    <span>
                      <b>{CHANNEL_LABEL[c]}</b>
                      <small>{CHANNEL_DESC[c]}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="form-section">
            <div className="lead">
              <h3>
                <span className="step-no">5</span>評価
              </h3>
              <p>送信から何日後に、返信・配信停止・不達をまとめてチェックするかを決めます。</p>
            </div>
            <div className="fields">
              <div className="seg" role="group" aria-label="評価タイミング">
                {EVAL_DAYS.map((d) => (
                  <button type="button" key={d} className={evalAfterDays === d ? 'on' : ''} onClick={() => setEval(d)}>
                    送信の{d}日後
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="cname">リストの名前</label>
                <input id="cname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} />
                <span className="hint">空欄のときは「{autoName}」になります。</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="card" style={{ position: 'sticky', top: 92 }}>
          <div className="card-head">
            <h2>エージェントへの指示</h2>
            <span className="actor agent">
              <Bot size={13} />
              登録されるジョブ
            </span>
          </div>
          <div className="card-body stack" style={{ gap: 14 }}>
            <p style={{ lineHeight: 1.8 }}>{brief}</p>
            <div className="terminal" style={{ fontSize: 12 }}>
              <span className="cmd">$ claude -p "/collect-leads cmp_…"</span>
              {'\n'}
              <span className="sub">  商材：{product.name || '—'}</span>
              {'\n'}
              <span className="sub">  条件：{[...industries, ...regions].join(' / ') || '指定なし'}</span>
              {'\n'}
              <span className="sub">  件数：{count} ・ 評価：送信の{evalAfterDays}日後</span>
            </div>
            <ol className="reasons">
              {[
                '検索と企業サイトの巡回（事業内容・フォームURL・メール）',
                '除外ルールと照合（配信停止・既存顧客・個人事業主・営業お断り）',
                '1社ずつ条件に合う根拠を確認し、確信度を付ける',
                mode === 'manual' ? '企業リストとスコアを保存 → あなたの承認待ちへ' : '確信の高い企業を承認して文面作成へ（迷う企業は要確認）',
                mode === 'auto' ? '文面を作り、自動チェックを通ったものを送信ルールの範囲で予約（通らないものは要確認）' : '文面を作り、あなたの確認待ちへ',
              ].map((t, i) => (
                <li key={i}>
                  <span className="step-no" style={{ width: 18, height: 18, fontSize: 11 }}>
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ol>
            <button className="btn btn-primary" style={{ height: 46 }} disabled={!valid} onClick={submit}>
              <Rocket size={18} />
              作成してリスト収集を開始
            </button>
            {!channels.length && <p className="small" style={{ color: 'var(--warn)' }}>連絡の方法を1つ以上選んでください。</p>}
          </div>
        </aside>
      </div>
    </>
  )
}
