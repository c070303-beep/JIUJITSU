# RRT 技術教材データベース

**指定PDFはまだ取得・分析できていません。** このコミットは出典登録と、今後の複数教材追加に対応する枠組みです。

## 対象PDF
https://jiujitsu.co.jp/textbook/yawara-sweep-textbook-ja.pdf
PDFの正式題名、著作権者、ページ数、技術内容、利用許諾は未確認です。元資料の本文・画像・技の詳細手順をGitHubに無断収録しません。

## ファイル
- sources.json: 教材ごとの出典/権利/確認状態。複数教材は sources の配列に追記。
- techniques.json: 個別技の承認済み独立指導メモ。現在0件、AIに新しい知識は未投入。
- technique.template.json: 技名、グリップ、崩し、身体操作、相手の反応、連係、出典URL、PDFページ、権利、技術検証の入力様式。
- overlap_candidates.json: 既存シュラプネル目次の**タイトルのみ**から選んだ関連候補16件。PDFとの重複・差異・新規性は未判定。
- ../scripts/validate_knowledge.cjs: 記載漏れ・出典番号・許諾・指導レビュー確認スクリプト。

## AIの参照条件
技術レコードは `ai_enabled: true` だけでは不十分です。出典が `verified` かつ `ai_enabled: true`、出典の権利確認が `verified_for_ai_use`、PDF該当ページがページ数以内、技術メモ自身も権利根拠と人間による内容レビューが揃っていることが必要です。

権利未確認の元PDFや詳細再現はGeminiへ渡しません。データの技術的な事実についても、PDFで確認した事実か既存メモかを区別してください。

PDFを閲覧できてから、原本を人が全ページレビューし、ページ別に独自説明を作って追加します。
