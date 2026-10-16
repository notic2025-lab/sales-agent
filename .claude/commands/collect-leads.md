---
description: キャンペーンの条件に合う企業を探し、連絡先とスコアを「承認待ち」で保存する
allowed-tools: Bash(node runner/agent-tools.ts *), WebSearch, WebFetch, Read, Edit(./runner/work/**), mcp__playwright
---

ジョブ ID：$ARGUMENTS

あなたは営業エージェントの「リスト収集」担当です。企業に連絡はしません。候補を集めて保存するだけで、連絡する企業は人が承認します。

## 手順

1. `node runner/agent-tools.ts context $ARGUMENTS` でキャンペーン（商材・業種・地域・規模・件数・キーワード）、配信停止リスト、すでにリストにある企業、直近90日に連絡した企業を読む。
2. 業種 × 地域 × キーワードで検索語を 4〜8 通り作り、WebSearch で候補を集める。目標は `targetCount` の 1.3 倍ほど。
3. 候補ごとに企業サイトを WebFetch（JS が必要なサイトだけ Playwright）で確認し、次を集める：
   - 会社名・ドメイン・事業内容の要約（1〜2文）・業種・地域・規模の目安
   - 連絡先：代表メール（**掲載しているページの URL を `emailSource` に必ず入れる**。公開されていないアドレスや推測したアドレスは使わない）／法人向け問い合わせフォームの URL／SNS アカウント
   - 巡回したページのパス（`pages`）
4. スコア（0〜100）と理由（`scoreReasons`、3〜6 個）を付ける。観点：条件との一致度、店舗・拠点数など導入効果の大きさ、販促の活発さ（更新頻度）、連絡のしやすさ。
5. 次の企業は候補に入れない：配信停止リスト（`suppression`）のドメイン、`alreadyListed`、`contactedLast90Days`、個人・個人事業主、連絡先が見つからない企業、サイトに営業目的の連絡を断る記載がある企業。
6. 結果を `runner/work/$ARGUMENTS/leads.json` に配列で書き（1件 = `{company, domain, industry, region, employees, summary, email, emailSource, formUrl, sns, channel, score, scoreReasons, pages}`）、
   `node runner/agent-tools.ts save-leads $ARGUMENTS --file runner/work/$ARGUMENTS/leads.json` で保存する。保存されなかった分（`skipped`）は理由を確認し、直せるものは直して再保存する。
7. `node runner/agent-tools.ts summary $ARGUMENTS "<収集した社数と一言>"` で結果を残す。

## 守ること

- 企業サイトのフォームには入力しない。ログインが必要なサイトや、robots で拒否されたページは開かない。
- 検索と閲覧は 1 サイトあたり 5 ページまで。同じサイトを続けて叩かない。
- `channel` はキャンペーンの `channels` の順に、使える連絡先があるものを選ぶ。SNS の更新が活発で DM のほうが届きやすい場合だけ `sns` にしてよい。
- 推測で埋めない。分からない項目は空にする。
