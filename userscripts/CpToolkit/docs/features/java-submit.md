# Java の提出補助

[機能一覧へ戻る](../../README.md#4-機能一覧) ・ [English](java-submit.en.md)

> 貼り付けた Java コードを提出用に変換し、ショートカットで提出できます。

## 使い方

- Java のコード全体を貼り付けると、提出できる形に変換します。編集中のコードへ一部を貼り付けたときは変換しません。
- パッケージ宣言の削除、クラス名の `Main` への変更、`DEBUG` の無効化は、[Local Runner との連携](local-runner.md) がなくても動きます。ただし、Local Runner がないときの変換は字句の置き換えで、確実ではありません。クラス名は、`main` を持つトップレベルの型が1つに決まり、`Main` という名前がほかに無いときだけ変えます。確実に変換するには Local Runner を使ってください。
- `import` の補完には Local Runner が必要です。`lib.*` の展開（`setlib`）と提出用ヘッダーの付与（`setheader`）には、Local Runner の設定も必要です。
- 接続できない状態や、ライブラリを設定していない状態で `import lib.` を含むコードを貼り付けると、設定方法へのリンクを通知します。このまま提出するとコンパイルエラーになります。
- ショートカットで提出できます。AtCoder と Codeforces は <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>、AOJ と paiza は <kbd>Ctrl</kbd>+<kbd>Enter</kbd>、Library Checker は <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd> です。
- 変換した Java コードをエディタに反映すると、クラスとコメントを折りたたみます。<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> でも折りたためます。

## 詳細設定

設定画面でこの機能の「詳細設定」を開きます。

| 項目                                              | 既定値   |
|---------------------------------------------------|----------|
| Local Runner がないときにパッケージ宣言を削除する | ON       |
| Local Runner がないときにクラス名を Main にする   | ON       |
| Local Runner がないときに DEBUG を false にする   | ON       |
| 提出用のヘッダーを付ける                          | ON       |
| ヘッダーの名前（空欄なら既定）                    | （空欄） |
| 貼り付け後にクラスとコメントを折りたたむ          | ON       |

## 動くページ

- 問題ページ
- 提出ページ
- コードテストのページ
- Codeforces
- AOJ
- Library Checker
- paiza
