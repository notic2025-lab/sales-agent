# 営業エージェント by NOTIC（管理サイト）

FigJam「営業エージェント 全体フロー（反応チェックと評価つき）」の **管理サイト** を形にしたものです。
営業リスト作成 → 企業の収集 → リスト承認 → 文面作成 → 文面承認・送信予約 → 送信 → 反応チェック・評価 → 返信承認、までを1つの画面の流れで扱えます。

- デモ：https://notic2025-lab.github.io/sales-agent/ （企業名・数値はすべて架空。実際の検索・送信は行いません）
- 本番は Firebase（DB）＋社内の Mac のランナー＋ClaudeCode で動きます（「本番化の手順」参照）

画面は2つだけです。最初の画面に営業リスト（商材 × 探す企業の条件）がカードで並び、押すと詳細（企業リスト／文面／送信ログ／反応／評価）が開きます。FigJam の「キャンペーン」は、この画面では「営業リスト」と呼んでいます。

## 人とエージェントの分担

エージェントは **あなたの承認なしに企業へ連絡しません**。人が判断する場所（承認）と、エージェントが動く場所（収集・下書き・送信・評価）を、画面上でもはっきり分けています。

| FigJam のステップ | 画面 | 担当 |
| --- | --- | --- |
| キャンペーン作成（商材と条件） / ジョブ登録 | 新しい営業リスト | 管理者 |
| 未処理ジョブを確認 → `claude -p /collect-leads` → 検索とサイト巡回 → 企業リストとスコア保存 | 営業リストの詳細（進み具合） | エージェント |
| リスト承認 | 営業リスト › 企業リスト | 管理者 |
| `/draft-messages` → 過去の評価結果を参照 → 文面の下書き保存 | 営業リスト › 文面 | エージェント |
| 文面承認と送信予約 | 営業リスト › 文面 | 管理者 |
| `/send-approved` → メール送信・フォーム入力 → 送信ログ（メッセージID付き） | 営業リスト › 送信ログ | エージェント |
| SNSは手動送信して完了登録 | 営業リスト › 文面（手動送信待ち） | 管理者 |
| `/evaluate` → 送信ログ取得 → Gmail で返信・配信停止・不達を検索 → 反応記録・評価集計・返信の下書き | 営業リスト › 反応 / 評価 | エージェント |
| 反応一覧と評価 / SNSの反応を手動登録 / 返信を承認 | 営業リスト › 反応 / 評価 | 管理者 |

評価で得た「学び」（例：事例紹介型の文面のほうが返信率が高い）は、「評価」タブでオン・オフでき、次の `/draft-messages` で参照されます。
配信停止の返信があった企業は配信停止リストに入り、以後のリスト収集から自動で除外されます。

## 2つのモード

| | デモ（公開中） | 本番 |
| --- | --- | --- |
| DB | このブラウザの localStorage | Firebase（Firestore + Authentication + Security Rules） |
| ランナー | ブラウザ内のタイマーが3秒ごとに未処理ジョブを確認 | 社内の Mac に常駐する Node スクリプト（launchd） |
| ClaudeCode | `src/data/agent.ts` が結果とログを生成 | `claude -p "/collect-leads <job_id>"` などを実行（`.claude/commands/`） |
| Gmail・企業サイト | 触らない | Gmail API で送信・反応チェック、フォームは Playwright で入力 |

画面と型（`src/types.ts`）は共通です。`.env.local` に Firebase の設定があれば本番、なければデモで動きます（本番ビルドでも URL に `?demo` を付けるとデモを開けます）。

- `src/data/backend.ts` … モードの判定
- `src/data/transitions.ts` … 管理者の操作（承認・予約・取り消しなど）を「いまの状態 → 変わる部分」で表した純粋な関数。デモはそのまま保存し、本番は変わった行だけを Firestore に書く
- `src/data/firebase.ts` … 本番のデータ層（ログイン、購読、差分書き込み）
- `src/data/checks.ts` … 送信前の自動チェック（管理サイトとランナーで同じ判定を使う）
- `src/data/sendPlan.ts` … 送信の時間帯・1日の上限・土日祝の計算（同上）

## 人が送る前に確かめる仕組み

エージェントが送れるのは、**人が1件ずつ承認し、送信前の最終確認を通した文面だけ**です。

1. **文面の承認**：1件ずつ開き、「相手に届く内容」（差出人・宛先・本文・リンク先・メールアドレスの掲載元）と「送信前の自動チェック」を見てから承認します。チェックに「送れない」項目があれば承認できず、「注意」があれば「注意点を確認しました」にチェックしないと承認できません。まとめて承認はできません。
2. **送信前の最終確認**：予約の前に、送る全件の宛先・件名・チェック結果を一覧で確かめ、送るタイミングと送信の予定（1日の上限と時間帯で何日に分かれるか）を見て、確認のチェックを入れて予約します。確認した人のメールアドレスが文面に残ります。
3. **予約の取り消し**：送信が始まるまでは、営業リストの画面から取り消せます（承認済みに戻ります）。
4. **返信の承認**：エージェントが下書きした返信も、1件ずつ宛先・本文・チェックを読んで「送ってよい」を付けたものだけが送られます。

自動チェックの内容：リストで承認した企業か／配信停止リストとの照合／送信先（メールは**公開されている掲載元の URL があるアドレスだけ**）／同じ宛先への重複／直近30日の連絡／件名・本文／差し込み漏れ／別の企業名の混入／宛先の会社名／特定電子メール法の表示（送信者名・住所・配信停止の案内）。

本番では同じチェックを **ランナーが送る直前にもう一度** 行い、さらに Firestore のルールで「予約時刻を過ぎた予約済みの文面」「リストで承認された企業」「配信停止リストにない宛先」以外は送信状態にできないようにしています。承認・予約・返信の承認はランナーのアカウントからはできません。ランナーは Admin SDK を使わず、権限を絞った専用ユーザーでログインします（`firestore.rules`）。

## 本番化の手順

### 1. Firebase プロジェクト

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作り、**Firestore**（本番モード、ロケーションは asia-northeast1）と **Authentication › メール / パスワード** を有効にする
2. プロジェクトの設定 › マイアプリで **ウェブアプリ** を追加し、`apiKey` / `authDomain` / `projectId` / `appId` を控える
3. Authentication でユーザーを2つ作る：管理者（あなた）と、ランナー用（例：`runner@…`）
4. Firestore に `members` コレクションを作り、ユーザーの UID をドキュメント ID にして `role` を入れる：管理者は `{ role: "admin" }`、ランナーは `{ role: "runner" }`
5. ルールとインデックスを反映する（Java 21 以上と Firebase CLI が必要）：

```bash
npx firebase-tools login
```

```bash
npx firebase-tools use <project-id>
```

```bash
npx firebase-tools deploy --only firestore
```

### 2. 管理サイト

`.env.local` を作る（GitHub Pages で本番を公開する場合は、同じ値をリポジトリの Settings › Secrets and variables › Actions › **Variables** に `VITE_FIREBASE_API_KEY` などの名前で入れる。Firebase の API キーは公開前提の値で、アクセス制御はルールが行う）：

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

`npm run dev` で開くとログイン画面になります。管理者でログインし、**設定 › 送信者情報** で会社名・担当者名・送信に使うメールアドレス・**住所**・署名と、送信ルール（1日の上限・時間帯・土日祝）を保存してください。住所が空のままだとメールは送れません。

Firebase の Authentication › 設定 › 承認済みドメインに `notic2025-lab.github.io` を追加します。

### 3. ランナー（社内の Mac）

```bash
cp runner/.env.example runner/.env
```

`runner/.env` に Firebase の設定（管理サイトと同じ値）とランナー用ユーザーのメール・パスワードを入れます。`SEND_MODE=dry-run` のままにしておきます。

Gmail：Google Cloud で Gmail API を有効にし、OAuth クライアント（**デスクトップ アプリ**）を作って `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` を入れ、送信に使う Google アカウントで次を実行してトークンを取ります（スコープは送信と読み取りだけ）：

```bash
node runner/gmail-auth.ts
```

フォーム入力用のブラウザ：

```bash
npx playwright install chromium
```

Claude Code がこの Mac でログイン済みであることを確認し（`claude -p "1+1"`）、1件だけ試します：

```bash
node runner/index.ts --once
```

常駐させる（`__REPO__` `__NODE__` `__HOME__` を置き換える）：

```bash
sed -e "s#__REPO__#$(pwd)#g" -e "s#__NODE__#$(which node)#g" -e "s#__HOME__#$HOME#g" runner/launchd/jp.notic.sales-agent-runner.plist > ~/Library/LaunchAgents/jp.notic.sales-agent-runner.plist && launchctl load ~/Library/LaunchAgents/jp.notic.sales-agent-runner.plist
```

ログは `runner/logs/runner.log`（ランナー）と `runner/logs/<job_id>.jsonl`（ClaudeCode の出力）に残り、管理サイトの「ランナー・ジョブ」にも流れます。止めるときは `launchctl unload ~/Library/LaunchAgents/jp.notic.sales-agent-runner.plist`。

### 4. 試運転から本番へ

1. `SEND_MODE=dry-run` のまま、管理サイトで営業リストを1つ作り、リスト収集 → リスト承認 → 文面作成 → 文面承認 → 送信前の最終確認 → 送信（試運転）まで通す。送信ログに「試運転のため送っていません」と残り、何も送られない
2. 送る予定の内容（ランナーのログと管理サイトの文面）を人が読んで問題なければ、`runner/.env` を `SEND_MODE=live` にして `launchctl unload` → `load` で再起動する
3. 最初は **設定 › 1日の送信上限** を小さく（5件など）して様子を見る

### ランナーの仕組み

- `runner/index.ts` … `jobs` から「順番待ちで実行時刻を過ぎたもの」を1件ずつトランザクションで取り、`claude -p "/<type> <job_id>"` を実行。出力を `jobs.logs` に流し、終わったら done / failed にする
- `runner/agent-tools.ts` … ClaudeCode から呼ぶ道具。DB の読み書き・送信ガード・Gmail はすべてここを通す。ClaudeCode に許す操作は `.claude/settings.json` と `--allowedTools` で「この道具・検索・閲覧・`runner/work/` への書き込み・Playwright」に絞り、`--permission-mode dontAsk` で許可のない操作は止める
- `.claude/commands/*.md` … 4つのスラッシュコマンド。`send-approved` は本文を書かず、道具が DB の承認済みの文面をそのまま送る
- `runner/mcp.json` … フォーム入力に使う Playwright MCP（ヘッドレス・使い捨てプロファイル）

### ルールの確認

`firestore.rules` の挙動（承認・予約は管理者だけ、送信はランナーだけ、など）とランナーの道具は Firebase エミュレーターで確認しています。Java 17 では最新の firebase-tools が動かないため、ローカルでは `firebase-tools@13` を使ってください。

## 開発

```bash
npm install
npm run dev
```

```bash
npm run build
```

`main` に push すると GitHub Actions（`.github/workflows/deploy.yml`）でビルドして GitHub Pages に公開します。Actions の Variables に `VITE_FIREBASE_*` があれば本番モード、なければデモのままです。

```bash
npx tsc -p tsconfig.runner.json
```

ランナー側の型チェックです。
