# Java の提出補助

[機能一覧へ戻る](../../README.md#4-機能一覧) ・ [English](java-submit.en.md)

> 貼り付けた Java コードを提出用に変換し、ショートカットで提出できます。

## 使い方

- Java のコードを貼り付けると、提出できる形に変換します。
- パッケージ宣言の削除、クラス名の `Main` への変更、`DEBUG` の無効化は、[Local Runner との連携](local-runner.md) がなくても動きます。
- `import` の補完には Local Runner が必要です。`lib.*` の展開(`setlib`)と提出用ヘッダーの付与(`setheader`)には、Local Runner の設定も必要です。
- 接続できない状態や、ライブラリを設定していない状態で `import lib.` を含むコードを貼り付けると、設定方法へのリンクを通知します。このまま提出するとコンパイルエラーになります。
- ショートカットで提出できます。AtCoder と Codeforces は <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>、AOJ と paiza は <kbd>Ctrl</kbd>+<kbd>Enter</kbd>、Library Checker は <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd> です。
- 変換した Java コードをエディタに反映すると、クラスとコメントを折りたたみます。<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> でも折りたためます。

## 詳細設定

設定画面でこの機能の「詳細設定」を開きます。

| 項目                                                  | 既定値 |
|-------------------------------------------------------|--------|
| Local Runner がないときにパッケージ宣言を削除します。 | ON     |
| Local Runner がないときにクラス名を Main にします。   | ON     |
| Local Runner がないときに DEBUG を false にします。   | ON     |
| 提出用のヘッダーを付けます。                          | ON     |
| ヘッダーの名前(空欄なら既定)                          | (空欄) |
| 貼り付け後にクラスとコメントを折りたたみます。        | ON     |

## 動くページ

- 問題ページ
- 提出ページ
- コードテストのページ
- Codeforces
- AOJ
- Library Checker
- paiza
