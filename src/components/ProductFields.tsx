// 商材の情報（名前・URL・概要・強み・導入事例）の入力欄。新しい営業リストと、作成後の編集で共通
import type { Campaign } from '../types'

type Product = Campaign['product']

export function ProductFields({ value, onChange }: { value: Product; onChange: (v: Product) => void }) {
  return (
    <div className="fields">
      <div className="fields two">
        <div className="field">
          <label htmlFor="pname">商材名</label>
          <input id="pname" className="input" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="purl">紹介ページのURL</label>
          <input id="purl" className="input" value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="psum">概要</label>
        <textarea id="psum" className="textarea" rows={3} value={value.summary} onChange={(e) => onChange({ ...value, summary: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="pstr">強み</label>
        <textarea id="pstr" className="textarea" rows={3} value={value.strengths} onChange={(e) => onChange({ ...value, strengths: e.target.value })} />
        <span className="hint">機能より「相手にとって何が変わるか」で書くと返信につながります（例：刷り直しの費用がなくなる）。</span>
      </div>
      <div className="field">
        <label htmlFor="pcase">導入事例（任意）</label>
        <textarea
          id="pcase"
          className="textarea"
          rows={3}
          value={value.caseStudies ?? ''}
          placeholder={'1行に1つ。「どんな会社：どう使って、何が変わったか」\n例：京都の旅館グループ（3館）：館内掲示のQRを貼ったまま季節ごとに案内を切り替え、刷り直しがなくなった'}
          onChange={(e) => onChange({ ...value, caseStudies: e.target.value })}
        />
        <span className="hint">ここに書いた事例だけを文面で使います（エージェントが事例を作ることはありません）。社名を出せない場合は業種と規模で。</span>
      </div>
    </div>
  )
}
