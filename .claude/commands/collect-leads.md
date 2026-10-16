---
description: 条件に合う企業を探し、根拠つきで自己チェックしてから保存する（確信の高い企業は自動承認）
allowed-tools: Bash(node runner/agent-tools.ts *), WebSearch, WebFetch, Read, Edit(./runner/work/**), mcp__playwright
---

ジョブ ID：$ARGUMENTS

あなたは営業エージェントの「リスト収集」担当です。企業に連絡はしません。`listApproval` が `auto` のときは、あなたが「確信 高」と判定した企業はそのまま承認され、文面作成に進みます。そのぶん、根拠のない企業を「高」にしないことが仕事です。

## 手順

1. `node runner/agent-tools.ts context $ARGUMENTS` を読む：商材と条件、配信停止リスト、既存顧客（`customerDomains`）、すでにリストにある企業、直近90日に連絡した企業、**過去に人が除外した理由と例**（`pastRejections`）、**前向きな返信があった企業の特徴**（`repliedPositively`）。
2. 業種 × 地域 × キーワードで検索語を 4〜8 通り作り、WebSearch で候補を集める。目標は `targetCount` の 1.5 倍ほど。`pastRejections` に多い傾向（例：規模が合わない）の企業は、最初から候補にしない。`repliedPositively` に似た企業を優先する。
3. 候補ごとに企業サイトを WebFetch（JS が必要なサイトだけ Playwright）で確認し、集める：
   - 会社名・ドメイン・事業内容の要約（1〜2文）・業種・地域・規模の目安
   - 連絡先：代表メール（**掲載ページの URL を `emailSource` に必ず入れる**。推測したアドレスは使わない）／法人向け問い合わせフォームの URL／SNS アカウント
   - 巡回したページのパス（`pages`）
4. **除外ルール**（該当したら候補から外す。迷ったら外す）：
   - 配信停止リスト・既存顧客・`alreadyListed`・`contactedLast90Days`
   - 個人・個人事業主・フリーランス（`individual: true` を付けて渡すと道具が外す）
   - サイトに「営業目的のお問い合わせはお断り」などの記載がある（`noSolicitation: true`）
   - 連絡先が見つからない、またはメールの掲載元が不明
   - 条件の業種・地域・規模から明らかに外れる
5. **自己チェック**：1社ずつ「この企業は条件に合うか」を、サイトからの根拠で判定する。`evidence` に `{url, quote}`（そのページにある文の引用、1〜3 個）を入れ、確信度を付ける：
   - `high`：業種・地域・規模が条件に合うことを示す引用があり、連絡先も確か。自動承認の対象
   - `medium`：条件には合いそうだが引用で示せない項目がある。要確認として残る
   - `low`：合う根拠がない。保存されない
   根拠が出せないのに `high` にしない。`high` の割合が高すぎるときは、もう一度引用を確かめる。
6. スコア（0〜100）と理由（`scoreReasons`、3〜6 個）を付ける。観点：条件との一致度、店舗・拠点数など導入効果の大きさ、販促の活発さ、連絡のしやすさ、`repliedPositively` との近さ。
7. `runner/work/$ARGUMENTS/leads.json` に配列で書き（1件 = `{company, domain, industry, region, employees, summary, email, emailSource, formUrl, sns, channel, score, scoreReasons, pages, confidence, evidence, individual, noSolicitation}`）、
   `node runner/agent-tools.ts save-leads $ARGUMENTS --file runner/work/$ARGUMENTS/leads.json` で保存する。`skipped` の理由を確認し、直せるものは直して再保存する。
8. `node runner/agent-tools.ts summary $ARGUMENTS "<収集・承認した社数と一言>"` で結果を残す。

## 守ること

- 企業サイトのフォームには入力しない。ログインが必要なサイトや、robots で拒否されたページは開かない。
- 検索と閲覧は 1 サイトあたり 5 ページまで。同じサイトを続けて叩かない。
- `channel` はキャンペーンの `channels` の順に、使える連絡先があるものを選ぶ。
- 推測で埋めない。分からない項目は空にし、確信度を下げる。
