# 提出補助

[機能一覧へ戻る](../../README.md#4-機能一覧) ・ [English](java-submit.en.md)

> 貼り付けたコードを提出用に変換し、ショートカットで提出できます。

## 使い方

- コード全体を貼り付けると、提出できる形に変換します。編集中のコードへ一部を貼り付けたときは変換しません。
- [Local Runner との連携](local-runner.md)があれば、ページで選んだ言語に合う Local Runner の言語で変換します。変換の内容は Local Runner の設定で決まります。Java ならライブラリの展開と `Main` への改名、ほかの言語なら `bundle` とデバッグ用の変数の書き換えです。
- 言語は、AtCoder と Codeforces ではページの言語の選択欄から決めます。AOJ、paiza、Library Checker ではエディタが Java と判定したときだけ変換します。
- Local Runner がないときは、言語ごとの簡易の変換だけを行います。今は Java だけが対象です。
- 提出用のヘッダーは[コードのヘッダーとフッター](source-comments.md)が付けます。
- Local Runner で変換できなかったときは、コードを変えずに知らせます。見つからない import があればその名前を、ほかのエラーなら最初のエラーを示します。診断の全文は、通知の「診断の全文」を開くと読めます。
- ショートカットで提出できます。AtCoder と Codeforces は <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>、AOJ と paiza は <kbd>Ctrl</kbd>+<kbd>Enter</kbd>、Library Checker は <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd> です。

## Java

- Local Runner がないときは、パッケージ宣言を削除し、クラス名を `Main` に変えます。字句の置き換えなので、確実ではありません。クラス名は、`main` を持つトップレベルの型が1つに決まり、`Main` という名前がほかに無いときだけ変えます。確実に変換するには Local Runner を使ってください。
- デバッグ用の変数は、詳細設定に名前を入れたときだけ、起動するクラスの直下にある `boolean 名前 = true` の宣言を `false` にします。Local Runner での書き換えは、Local Runner の設定の `debugFlag` で決めます。
- 詳細設定にライブラリのパッケージ（例：`lib`）を入れておくと、Local Runner に接続できないときにそのパッケージを import したコードを貼り付けたとき、導入方法へのリンクを通知します。このまま提出するとコンパイルエラーになります。
- 変換したコードをエディタに反映すると、クラスとコメントを折りたたみます。<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> でも折りたためます。

## 詳細設定

設定画面でこの機能の「詳細設定」を開きます。

| 項目                                                     | 既定値   |
|----------------------------------------------------------|----------|
| Local Runner がないときに false にする Java の変数の名前  | （空欄） |
| Local Runner で展開する Java のライブラリのパッケージ    | （空欄） |
| 貼り付け後に Java のクラスとコメントを折りたたむ         | ON       |

## 動くページ

- 問題ページ
- 提出ページ
- コードテストのページ
- Codeforces
- AOJ
- Library Checker
- paiza
