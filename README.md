# competitive-programming-tools

競技プログラミング向けの補助ツールです。

| ツール                                          | 内容                                                         | 導入方法                                                                         |
|-------------------------------------------------|--------------------------------------------------------------|----------------------------------------------------------------------------------|
| [CP Toolkit](./userscripts/CpToolkit/README.md) | AtCoder を中心に使える26の補助機能を1本にまとめた UserScript | [Greasy Fork からインストール](https://greasyfork.org/scripts/603262-cp-toolkit) |
| [Local Runner](./local-runner/README.md)        | 解答を手元で実行・判定・提出する CLI とサーバー              | [導入方法](./local-runner/README.md#導入)                                        |

CP Toolkit は単体で使えます。Java のライブラリを展開したり、問題ページから手元の環境で解答を実行したりする場合は、Local Runner を併用します。Java 以外の言語を実行するには、その言語の処理系も必要です。

不具合や要望は [Issue](https://github.com/nsubaru11/competitive-programming-tools/issues) へお寄せください。

## 開発

開発には Claude を使用しています。設計と仕様は作者が決めています。

開発の情報は [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) にまとめています。

## ライセンス

本リポジトリの内容は、[0BSD(Zero-Clause BSD)](./LICENSE)で提供します。第三者のスクリプトを改変した UserScript は元のライセンスに従います。対象と条件は [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。
