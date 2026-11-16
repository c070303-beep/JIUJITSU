# 白帯・青帯向けの基礎知識と道場マナー

調査日 2026-11-17（日本時間）。公開資料17件と既存のRRTルール1件を参照し、白帯・青帯向けの独自解説30項目を作成した。各項目に適用範囲、出典、確認箇所、関連する技術IDを記録した。[知識データと出典](../knowledge/general.json)

| テーマ | 公開資料の共通点・相違点 | アプリの実践案 |
| --- | --- | --- |
| 道場と相手への配慮 | High Noonの生徒向け案内は清潔な服装、短い爪、遅刻時の待機、相手への強度調整を扱う。早川光由はマットに入れる携帯電話を例に、全員が同じ行動をしたときも練習環境を保てるかを考える。撮影規定は道場ごとに異なる。[High Noon](https://highnoonbjj.com/handbook)、[早川の寄稿](https://www.triforce-bjj.com/mobile-phone-etiquette/)、[Academy Jiu-Jitsuの規定](https://academyjiujitsu.com.au/docs/AJJ-Code_of_Conduct.pdf) | 清潔な服装と短い爪を準備。遅刻時は先生に確認。撮影とSNS公開はそれぞれ相手と道場へ確認。 |
| 初スパー・出稽古 | トライフォース仙台の木村謙太は初心者に早めのタップと即時の解除を案内する。カルペディエム青山・自由が丘はスパーへの参加を任意と案内する。トライフォースの公式案内は、他道場へ出稽古する会員に所属指導者への声かけを求める。[木村の寄稿](https://www.triforce-bjj.com/20260224sendai-beginner/)、[青山](https://www.carpediem-aoyama.com/first-time)、[自由が丘](https://www.carpediembjj-jiyugaoka.com/faq)、[トライフォースの出稽古案内](https://www.triforce-bjj.com/tournament-visitors/) | 初参加と希望する強度を先に伝える。出稽古では訪問先の予約、クラス、料金、服装と、所属先の連絡手順を確認する。 |
| クラス設計と指導方針 | トライフォースの入門・ベーシックは基礎カリキュラムと反復を案内する。青山の白帯クラスも反復を行い、開始位置を決めたスパーを取り入れる。石川祐樹は仲間と技術を身につける場としての道場を語っている。[トライフォース](https://www.triforce-bjj.com/program/jiu-jitsu/)、[青山のクラス案内](https://www.carpediem-aoyama.com/class-schedule)、[石川の寄稿](https://www.carpediembjj.com/story) | 白帯は同じ基本動作を繰り返し、相手が抵抗すると止まる場合は開始位置と目的を絞る。青帯はその位置への入り方を自由スパーで試す。 |
| 基本技の精度・連係 | ロジャー・グレイシーは、基本を教える生徒と練習する中で自分の基本も磨いたと振り返る。金古一朗は早い段階から技術の習得を重視する。マルセロ・ガルシアの講話を紹介した記事は、技の連係と相手に応じた練習の考え方を扱う。[ロジャーの対談抜粋](https://www.bjjee.com/articles/roger-gracie-explains-why-his-jiu-jitsu-is-basic/)、[金古のインタビュー](https://myfight.style/kaneko01)、[マルセロの講話記事](https://letsbjj.com/en/news/news-20251028-guide-marcelo-garcia-how-he-trains/) | 白帯は手・膝の置き場所など一つ確かめる。青帯は得意技が止まる一つ手前を練習し、相手の反応で二手目を選ぶ。 |
| 基礎用語と練習課題 | ラクラン・ジャイルズの公開コース概要はガードの保持と攻撃を別々に扱う。BJJ Notesを用語の参照にした。[SUBMETAの公開概要](https://submeta.io/@lachlangiles/courses/foundations-ii-guard)、[用語集](https://bjj.tw/en/fundamentals/terminology/) | トップとボトム、脚が二人の間にあるか、姿勢と支点を見分ける。脚を戻す課題と、脚が戻った後に相手を崩す課題を切り出せる。 |
| 道場練習と競技 | RRTの試用版にある最大7組などのルールはRRTの運用。IBJJFは公式規則と禁止行為の資料を案内する。[RRTの既存運用](https://github.com/c070303-beep/JIUJITSU/blob/9bdfe44705e637c087ba9107a5f4c042b6aed28e/lib/coach.cjs)、[IBJJF公式資料](https://ibjjf.com/books-videos)、[IBJJF Help Desk](https://help.ibjjf.com/rules/) | 道場・支部または主催団体の範囲を明示する。技の使用可否や得点では大会と部門を確認し、対象大会のルール資料へ案内する。 |

## 確認範囲と運用

- 公式クラス案内、公式寄稿、ハンドブック、本人発言を掲載した記事、公式公開コース概要を使用した。インタビュー動画と講話映像の照合、会員向けコースの本編の確認は残っている。アプリの練習例は資料から得た考え方をRRT向けに具体化したもので、各指導者固有の技術手順や推奨メニューとして帰属させない。
- 公開リポジトリには独自解説と出典を記録した。Geminiを使う場合は、既存の一回の分類リクエストで一般知識の項目ID・タイトル・分類・適用範囲を候補として渡し、選択されたIDに対応する登録文をNode.jsで返す。同じ別名から解決できる質問はNode.jsで処理する。
- 項目を追加する際は、実際に確認した公開箇所、適用範囲、短い通常回答、詳細指定時の補足、既存の関連技術と質問の言い換えを同じ項目に登録する。追加した項目と隣接テーマが混ざらないケースをテストに加え、`npm test` を実行する。
