# AtCoder の URL 復元

CLI の URL 復元の例外は [atcoder-task-exceptions.json](../data/atcoder-task-exceptions.json)で管理する。旧 ABC/ARC、共有問題、企業コンテスト、教材などを対象とし、ローカルに作成済みのコンテストだけには限定しない。

## コマンド

既存の完全指定 `test <taskScreenName> <sourceFile>`・`submit <taskScreenName> <sourceFile>` を使う。`taskScreenName` には実際の問題 URL の `/tasks/` 以降を、ソースには実際のファイル名を指定する。

```bash
test abc001_1 A.java
test abc250_h Ex.java
test typical90_a Q001.java
test tessoku_book_a A01.java
test codequeen2024_final_c C.java
```

完全指定ではタスク ID を書き換えず、接頭辞と掲載コンテスト名が異なる場合だけ JSON から開催回を復元する。たとえば `tessoku_book_a` は `tessoku-book`、`codequeen2024_final_c` は `codequeen2024-final-N9tn8QqD` の URL を使う。共有問題は、接頭辞と同名のコンテストにも掲載されていればそこを優先し、それ以外は公開問題一覧の開催回を使う。

ソースだけを指定する場合は、フォルダから開催回、ファイル名から問題記号を決める。ファイル名は拡張子を除き、最後の `_` 以降を実装名として除く。`C_deque.java` は `c`、`A_2.java` は `a`、`A01.java` は `a01`。拡張子を省いても同じ規則を使い、末尾の数字は落とさない。ソースの選択は元のファイル名で行う。

推定した問題記号からの URL 復元にも例外表を適用する。ABC001 のフォルダの `test a` は `abc001_1`、ABC042 の `test c` は `arc058_a` を使い、URL の開催回はフォルダのものを維持する。ARC058 の `test c` は表示上の C 問題（`arc058_a`）だが、完全指定の `arc058_c` は正式 ID が示す E 問題になる。

ファイル名だけで問題を表せない場合は、正式タスク ID とソースを完全指定する。

## 対応表

JSON には、公式コンテスト名の大文字・小文字、コンテストごとのタスク ID の接頭辞と個別例外、正式タスク ID から掲載コンテストを復元するための対応を記録する。フォルダ名は公式コンテスト ID にそろえ、ローカル専用の別名設定を持たない。

実行時に AtCoder Problems へ通信しない。JSON はビルド時に取り込まれるため、配布実行ファイルへの反映には再ビルドが必要。公開データにない今後のコンテストは通常の復元規則を使い、特殊な ID の開催回は表の更新で対応する。

## 更新方法

[contest-problem.json](https://kenkoooo.com/atcoder/resources/contest-problem.json)と [problems.json](https://kenkoooo.com/atcoder/resources/problems.json)を保存し、`local-runner` で次を実行する。取得時は API の注意事項に従い、1 秒以上間隔を空ける。

```bash
bun scripts/generate-atcoder-task-exceptions.ts /path/to/contest-problem.json /path/to/problems.json 2026-11-16
bun test src/cli/task.test.ts src/cli/language.test.ts
bun run typecheck
```

生成スクリプトは通常の復元規則との差分だけを記録し、ローカルのフォルダを参照しない。生成後は差分と、上のテストの結果を確認する。
