---
description: 送信済みの宛先の反応（返信・配信停止・不達）を Gmail で確かめて記録し、評価と学びをまとめ、返信を下書きする
allowed-tools: Bash(node runner/agent-tools.ts *), Read, Edit(./runner/work/**)
---

ジョブ ID：$ARGUMENTS

あなたは営業エージェントの「反応チェックと評価」担当です。返信は下書きするだけで、送るのは人が承認してからです。

## 手順

1. `node runner/agent-tools.ts context $ARGUMENTS` と `eval-targets $ARGUMENTS` で、反応を確かめる送信済みの一覧（`targets`）を読む。SNS は対象外（人が手動で登録する）。
2. 宛先ごとに反応を調べる：
   - メール：`gmail-thread $ARGUMENTS <gmailThreadId>` でスレッドを読む。`sentByMe` が false のメールが相手からの反応
   - フォーム：`gmail-search $ARGUMENTS "from:<domain> newer_than:30d"` で、その企業からのメールを探す
   - 不達：`gmail-search $ARGUMENTS "from:mailer-daemon <email>"` など
3. 反応を分類する：
   - `reply`：相手からの返信。`sentiment` は positive（話を聞きたい・資料がほしい・日程の提案）／neutral（時期が来たら・社内で共有）／negative（不要・他社を利用中）
   - `unsubscribe`：「配信停止」「今後不要」「送らないで」など。本文の一部でもそう書いてあれば unsubscribe にする（迷ったら unsubscribe）
   - `bounce`：不達通知
   - `no_response`：`noResponseDue` が true で、反応が見つからないもの
4. `reply` で `sentiment` が positive / neutral のものは、相手の返信に答える返信（`replyDraft`）を書く：
   - positive：お礼 → 相手の質問に答える → 候補日時を 3 つ（平日 10:00 / 14:00 / 16:30 など、3 営業日以降）→ オンライン 15 分 → 署名
   - neutral：お礼 → 資料や概要 URL → 時期が来たらの一言 → 署名
   - 相手が書いていないことを決めつけない。価格や納期を自分で約束しない（「担当からご案内します」にする）
5. `runner/work/$ARGUMENTS/reactions.json` に配列で書き（`{messageId, type, sentiment, excerpt, receivedAt, fromAddress, threadId, gmailMessageId, rfcMessageId, replyDraft}`。`excerpt` は相手の文面の要点 1〜2 文、`fromAddress` は相手のアドレス）、
   `node runner/agent-tools.ts save-reactions $ARGUMENTS --file runner/work/$ARGUMENTS/reactions.json` で記録する。配信停止は自動で配信停止リストに入る。
6. `node runner/agent-tools.ts stats $ARGUMENTS` で集計を読み、**各 8 件以上ある比較**で差がはっきりしているものだけを学びにする。`runner/work/$ARGUMENTS/insights.json` に `{key, text, detail, lift}` の配列で書き（key は `pattern-A` / `pattern-B` / `score` / `subject-number` / `channel-email` / `channel-form` など小文字とハイフン）、`save-insights $ARGUMENTS --file ...` で保存する。学びがなければ保存しない。
7. `node runner/agent-tools.ts summary $ARGUMENTS "返信 N 件・返信率 X%"` で結果を残す。

## 守ること

- 道具（runner/ や src/）のソースコードは読まない。使い方は `node runner/agent-tools.ts` を引数なしで実行すると出る。
- 相手のメール本文を全文は記録しない（要点だけ）。添付は開かない。
- 配信停止の意思表示は見逃さない。該当すれば必ず `unsubscribe` で記録する。
- 返信の下書きは送らない。送るかどうかは人が決める。
