import {runnerCatalog} from "@catalog/tables";
import type {JudgeLanguage, RunResult} from "@domain/execution/result";
import type {CodeRunner, RunnerProvider} from "@application/execution/runner-catalog";
import type {ScriptLoader} from "@application/ports/services";
import {pageGlobals, type PyodideApi} from "@adapters/page/globals";
import {SerialQueue} from "./serial-queue";

// 標準入力の差し替えは contextlib の非公開クラスを使わずに書く。
// sys.stdin.buffer で読む提出もあるので、バイト列の層を持つ TextIOWrapper にする。
const SETUP_CODE = `
import contextlib, io, platform, sys

@contextlib.contextmanager
def __redirect_stdin(text):
  previous = sys.stdin
  sys.stdin = io.TextIOWrapper(io.BytesIO(text.encode()), encoding="utf-8")
  try:
    yield sys.stdin
  finally:
    sys.stdin = previous

# 提出のソースは書き換えずにコンパイルし、実行ごとに新しいモジュールの名前空間で動かす。
# 関数の本体へ埋め込むと、from __future__ や複数行の文字列の中身が変わってしまう。
# __code は Python 側で初期化する。JS の null は Pyodide 0.28 から None ではなく jsnull になる
def __run(source):
  global __stdout, __stderr, __code
  __code = None
  namespace = {"__name__": "__main__", "__builtins__": __builtins__}
  with __redirect_stdin(__stdin):
    with contextlib.redirect_stdout(io.StringIO()) as __stdout:
      with contextlib.redirect_stderr(io.StringIO()) as __stderr:
        try:
          exec(compile(source, "Main.py", "exec", dont_inherit=True), namespace)
        except SystemExit as e:
          __code = e.code
`;

class PyodideRunner implements CodeRunner {
	readonly kind = "browser";
	readonly id = "browser:pyodide";
	readonly label = "Python3 Pyodide [Browser]";
	private pyodide: Promise<PyodideApi> | null = null;
	private readonly queue = new SerialQueue();
	private readonly scripts: ScriptLoader;

	constructor(scripts: ScriptLoader) {
		this.scripts = scripts;
	}

	run(sourceCode: string, input: string): Promise<RunResult> {
		return this.queue.run(() => this.execute(sourceCode, input));
	}

	private async load(): Promise<PyodideApi> {
		const {baseUrl, integrity} = runnerCatalog.pyodide;
		await this.scripts.loadScript({url: `${baseUrl}pyodide.js`, integrity});
		const pyodide = await pageGlobals().loadPyodide?.({indexURL: baseUrl});
		if (!pyodide) throw new Error("Pyodide was not loaded.");
		await pyodide.runPythonAsync(SETUP_CODE);
		return pyodide;
	}

	private async execute(sourceCode: string, input: string): Promise<RunResult> {
		// 読み込みに失敗したら覚えずに、次の実行で読み込み直す。一時的な通信の失敗から戻れるようにする。
		const loading = this.pyodide ??= this.load().catch((error: unknown) => {
			if (this.pyodide === loading) this.pyodide = null;
			throw error;
		});
		const pyodide = await loading;
		pyodide.globals.set("__stdin", input);
		pyodide.globals.set("__source", sourceCode);
		const startedAt = Date.now();
		try {
			await pyodide.loadPackagesFromImports(sourceCode);
			pyodide.runPython("__run(__source)");
		} catch (error) {
			return {status: "RE", exitCode: "-1", input, error: error instanceof Error ? error.message : String(error)};
		}
		const exitCode = pyodide.globals.get("__code");
		return {
			status: typeof exitCode === "number" && exitCode !== 0 ? "RE" : "OK",
			exitCode: String(exitCode ?? 0),
			execTime: Date.now() - startedAt,
			input,
			output: pyodide.globals.get("__stdout").getvalue(),
			error: pyodide.globals.get("__stderr").getvalue(),
		};
	}
}

export class PyodideRunnerProvider implements RunnerProvider {
	private readonly runner: PyodideRunner;

	constructor(scripts: ScriptLoader) {
		this.runner = new PyodideRunner(scripts);
	}

	async runnersFor({family}: JudgeLanguage): Promise<readonly CodeRunner[]> {
		return family === "python3" ? [this.runner] : [];
	}
}
