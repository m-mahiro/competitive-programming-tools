# Local Runner

競技プログラミングの解答を手元で実行、判定、提出するツールです。Java の解答は、JDK があればそのまま動きます。C++、C、Python、Go、Rust、Kotlin、C# は定義を用意してあり、処理系を自分で入れると使えます。[CP Toolkit](https://github.com/nsubaru11/competitive-programming-tools/blob/main/userscripts/CpToolkit/README.md) の Easy Test+ から、問題ページの解答を手元で実行することもできます。

Windows（WSL）で動作を確認しています。

## 中身

| ファイル                                 | 内容                                                      |
|------------------------------------------|-----------------------------------------------------------|
| `local-runner/bin/local-runner.exe`      | Windows で使う CLI                                        |
| `local-runner/bin/local-runner`          | WSL の中で動くサーバー。Linux では CLI としても使います。 |
| `local-runner/bin/*.cmd`                 | `test`、`submit` などのコマンド。Windows で使います。     |
| `local-runner/bin/install-path.cmd`      | `bin` を PATH に登録するスクリプト                        |
| `local-runner/bin/start-local-runner.sh` | サーバーを起動するスクリプト。CLI が自動で使います。      |
| `local-runner/settings.schema.json`      | 設定ファイルの項目の定義。エディターが補完に使います。    |

設定ファイル(`local-runner.settings.json`)は、初めて設定したときにこのフォルダに作られます。

<a id="必須"></a>

## 必要なもの

解答に使う言語にかかわらず、サーバーの実行には JDK 24 以降が必要です。

Windows では、既定の設定でサーバーが WSL 内で動作します。JDK は WSL 内にインストールしてください。Java の解答だけを実行する場合は、[サーバー設定の `backend`](https://github.com/nsubaru11/competitive-programming-tools/blob/main/local-runner/docs/SETTINGS.md#server) を変更して Windows の JDK を使うこともできます。

<a id="任意"></a>

### 使う機能に応じた準備

- **Java 以外の言語**を使う場合は、その言語の[処理系](https://github.com/nsubaru11/competitive-programming-tools/blob/main/local-runner/README.md#言語)をサーバーと同じ環境にインストールします。
- **自分の Java ライブラリ**を使う場合は、[ソースフォルダを登録します](https://github.com/nsubaru11/competitive-programming-tools/blob/main/local-runner/README.md#ライブラリを使う)。
- **AtCoder に提出**する場合は、`setsession` で[ログイン情報を保存します](https://github.com/nsubaru11/competitive-programming-tools/blob/main/local-runner/README.md#提出の準備)。

## 使い始める

1. このフォルダを好きな場所に置きます。
2. Windows では、このフォルダで `.\local-runner\bin\install-path.cmd` を実行し、`bin` を PATH に登録します。登録のあと、新しいターミナルを開きます。
3. 解答のあるフォルダで `test abc448_d D.java` のように実行します。サーバーは自動で起動します。

Linux では、`.cmd` の代わりに `local-runner test abc448_d D.java` のように実行します。`local-runner/bin` を PATH に加えておきます。

## 更新

`update` を実行すると、最新のバージョンへ入れ替えます。設定ファイルには触れません。新しいバージョンがあるかは、サーバーの起動のログと `status` に表示します。

手動で更新するときは、新しいバージョンの zip を同じ場所へ上書きで展開します。設定ファイルは zip に含まれないので、そのまま残ります。

## 詳しい使い方

- [README](https://github.com/nsubaru11/competitive-programming-tools/blob/main/local-runner/README.md): コマンド、言語、ライブラリ、提出用ヘッダー、CP Toolkit とのつなぎ方
- [SETTINGS.md](https://github.com/nsubaru11/competitive-programming-tools/blob/main/local-runner/docs/SETTINGS.md): 設定ファイルの項目と、パスの書き方

## ライセンス

[0BSD](LICENSE)
