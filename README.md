# 営業エージェント by NOTIC（管理サイト・デモ）

FigJam「営業エージェント 全体フロー（反応チェックと評価つき）」の **管理サイト** を形にしたものです。
キャンペーン作成 → リスト収集 → リスト承認 → 文面作成 → 文面承認・送信予約 → 送信 → 反応チェック・評価 → 返信承認、までを1つの画面の流れで扱えます。

- デモ：https://notic2025-lab.github.io/sales-agent/
- 企業名・数値はすべて架空のデモデータです。実際の検索・送信は行いません。

## 人とエージェントの分担

エージェントは **あなたの承認なしに企業へ連絡しません**。人が判断する場所（承認）と、エージェントが動く場所（収集・下書き・送信・評価）を、画面上でもはっきり分けています。

| FigJam のステップ | 画面 | 担当 |
| --- | --- | --- |
| キャンペーン作成（商材と条件） / ジョブ登録 | キャンペーン作成 | 管理者 |
| 未処理ジョブを確認 → `claude -p /collect-leads` → 検索とサイト巡回 → 企業リストとスコア保存 | ランナー・ジョブ / キャンペーン詳細 | エージェント |
| リスト承認 | キャンペーン詳細 › 企業リスト | 管理者 |
| `/draft-messages` → 過去の評価結果を参照 → 文面の下書き保存 | キャンペーン詳細 › 文面 | エージェント |
| 文面承認と送信予約 | キャンペーン詳細 › 文面 | 管理者 |
| `/send-approved` → メール送信・フォーム入力 → 送信ログ（メッセージID付き） | キャンペーン詳細 › 送信ログ | エージェント |
| SNSは手動送信して完了登録 | キャンペーン詳細 › 文面（手動送信待ち） | 管理者 |
| `/evaluate` → 送信ログ取得 → Gmail で返信・配信停止・不達を検索 → 反応記録・評価集計・返信の下書き | 反応 / 評価レポート | エージェント |
| 反応一覧と評価レポート / SNSの反応を手動登録 / 返信を承認 | 反応 / 評価レポート / 確認待ち | 管理者 |

評価で得た「学び」（例：事例紹介型の文面のほうが返信率が高い）は、評価レポートでオン・オフでき、次の `/draft-messages` で参照されます。
配信停止の返信があった企業は配信停止リストに入り、以後のリスト収集から自動で除外されます。

## このデモの仕組み

GitHub Pages は静的ホスティングのため、DB・ランナー・ClaudeCode は **ブラウザ内で再現** しています。

```
管理サイト（React / GitHub Pages）
  └─ DB（デモ：localStorage）
       └─ ランナー（デモ：ブラウザ内のタイマーが3秒ごとに未処理ジョブを確認）
            └─ ClaudeCode（デモ：src/data/agent.ts が結果とログを生成）
```

- `src/types.ts` … DB のテーブルに対応する型（campaigns / jobs / leads / messages / reactions / insights）
- `src/data/agent.ts` … 各スラッシュコマンドの処理（plan で結果とログを組み立て、apply で DB に書き込む）
- `src/store.ts` … 状態と操作、ランナーの tick
- `src/data/selectors.ts` … キャンペーンの進み具合・確認待ちの算出

## 本番化するときの構成（案）

画面と型はそのまま使い、データ層とランナーを差し替えます。

1. **DB**：Supabase（Postgres + Auth + RLS）。`src/types.ts` の型をテーブルにし、管理サイトは supabase-js で読み書き
2. **ランナー**：社内の Mac / サーバーで常駐（launchd / cron）。`jobs` の `status = 'queued' and run_at <= now()` を1件ずつ取り、`claude -p "/collect-leads <campaign_id>"` などを実行
3. **ClaudeCode**：`.claude/commands/` に `collect-leads` / `draft-messages` / `send-approved` / `evaluate` を定義。Gmail は MCP または Gmail API、フォーム入力はブラウザ操作で実行
4. **安全策**：送信は承認済み・予約済みの文面だけ／1日の上限と送信時間帯／配信停止リストの照合／特定電子メール法の表示を `send-approved` 側でも必ずチェック

## 開発

```bash
npm install
npm run dev
```

```bash
npm run build
```

`main` に push すると GitHub Actions（`.github/workflows/deploy.yml`）でビルドして GitHub Pages に公開します。
