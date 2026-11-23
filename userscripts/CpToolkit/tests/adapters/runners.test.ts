import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {AtCoderRunnerProvider} from "@adapters/runners/atcoder-custom-test";
import {PyodideRunnerProvider} from "@adapters/runners/pyodide";
import {CrossTabQueue} from "@adapters/runners/serial-queue";
import {LocalRunnerProvider, PaizaRunnerProvider} from "@adapters/runners/simple-runners";
import {WandboxRunnerProvider} from "@adapters/runners/wandbox";
import {LocalRunnerClient} from "@application/execution/local-runner";
import type {JudgeSite} from "@application/ports/judge-site";
import {FakeHttpClient, MemoryStore} from "../support/fakes";

const noHttp = new FakeHttpClient(() => ({status: 500, text: ""}));

const java = {id: "1", label: "Java 21", family: "java"};

describe("PaizaRunnerProvider の確認", () => {
	const java = {id: "1", label: "Python", family: "python3"};

	test("実行中は間隔を空けて確認する", async () => {
		const times: number[] = [];
		let checks = 0;
		const http = new FakeHttpClient(({url}) => {
			if (url.includes("/create")) return {status: 200, text: '{"id": "x", "status": "running"}'};
			if (url.includes("/get_status")) {
				times.push(Date.now());
				return {status: 200, text: `{"status": "${++checks < 2 ? "running" : "completed"}"}`};
			}
			return {
				status: 200,
				text: '{"exit_code": 0, "time": "0", "memory": "0", "stdout": "1", "result": "success"}'
			};
		});
		const [runner] = await new PaizaRunnerProvider(http).runnersFor(java);
		const result = await runner?.run("print(1)", "", {});

		expect(result?.output).toBe("1");
		expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(900);
	});
});

describe("CrossTabQueue", () => {
	const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");

	afterEach(() => {
		if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
		else Reflect.deleteProperty(navigator, "locks");
	});

	/** 同じ名前のタブの間で順番を守る、Web Locks の代役を置く。 */
	function stubLocks(): void {
		let last: Promise<unknown> = Promise.resolve();
		const request = (_name: string, task: () => Promise<unknown>): Promise<unknown> => {
			const result = last.then(task);
			last = result.catch(() => undefined);
			return result;
		};
		Object.defineProperty(navigator, "locks", {value: {request}, configurable: true});
	}

	async function runInTwoTabs(): Promise<number> {
		let running = 0;
		let peak = 0;
		const task = async (): Promise<void> => {
			peak = Math.max(peak, ++running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running--;
		};
		const tabs = [new CrossTabQueue("test"), new CrossTabQueue("test")];
		await Promise.all(tabs.flatMap((tab) => [tab.run(task), tab.run(task)]));
		return peak;
	}

	test("別のタブの処理とも重ねない", async () => {
		stubLocks();
		expect(await runInTwoTabs()).toBe(1);
	});

	test("Web Locks がなくてもタブの中では順番を守る", async () => {
		Object.defineProperty(navigator, "locks", {value: undefined, configurable: true});
		let running = 0;
		let peak = 0;
		const queue = new CrossTabQueue("test");
		const task = async (): Promise<void> => {
			peak = Math.max(peak, ++running);
			await new Promise((resolve) => setTimeout(resolve, 1));
			running--;
		};
		await Promise.all([queue.run(task), queue.run(task)]);
		expect(peak).toBe(1);
	});
});

describe("AtCoder のコードテスト", () => {
	const finished = {Result: {ExitCode: 0, TimeConsumption: 12, MemoryConsumption: 3456}, Stdout: "ok", Stderr: ""};
	const language = {id: "6056", label: "Java24 (OpenJDK 24.0.2)", family: "java"};
	const judge = async () => ({id: "atcoder", languages: () => [language]}) as unknown as JudgeSite;
	const globals = globalThis as {unsafeWindow?: unknown};

	beforeEach(() => {
		globals.unsafeWindow = {csrfToken: "token"};
	});

	afterEach(() => {
		delete globals.unsafeWindow;
	});

	async function runner(http: FakeHttpClient) {
		const [found] = await new AtCoderRunnerProvider(http, judge).runnersFor(language);
		if (!found) throw new Error("実行環境がない");
		return found;
	}

	test("前の実行が残っていたら、終わるのを待って送り直す", async () => {
		const statuses = [{Interval: 1, Result: {ExitCode: 0, TimeConsumption: 0, MemoryConsumption: 0}}, {}, finished];
		let submits = 0;
		const http = new FakeHttpClient(({url}) => {
			if (url.endsWith("/submit/json")) return {status: 200, text: ++submits === 1 ? "busy" : ""};
			return {status: 200, text: JSON.stringify(statuses.shift())};
		});
		expect(await (await runner(http)).run("code", "input", {})).toMatchObject({
			status: "OK",
			output: "ok",
			execTime: 12
		});
		expect(submits).toBe(2);
		expect(statuses).toHaveLength(0);
	});

	test("送り直しても断られたら、サイトの理由を伝える", async () => {
		let submits = 0;
		const http = new FakeHttpClient(({url}) => {
			if (url.endsWith("/submit/json")) {
				submits++;
				return {status: 200, text: "rejected"};
			}
			return {status: 200, text: "{}"};
		});
		await expect((await runner(http)).run("code", "input", {})).rejects.toThrow("rejected");
		expect(submits).toBe(3);
	});
});

describe("実行環境", () => {
	test("paiza の応答を実行結果に変換する", async () => {
		const http = new FakeHttpClient(({url}) => {
			if (url.includes("create")) return {status: 200, text: JSON.stringify({id: "x", status: "completed"})};
			return {
				status: 200, text: JSON.stringify({
					exit_code: 0,
					time: "0.01",
					memory: "2048",
					stdout: "ok",
					stderr: "",
					build_result: "success",
					result: "success",
				})
			};
		});
		const [runner] = await new PaizaRunnerProvider(http).runnersFor({id: "r", label: "Rust", family: "rust"});
		expect(await runner?.run("code", "input", {})).toMatchObject({
			status: "OK",
			output: "ok",
			execTime: 10,
			memory: 2.048,
		});
	});

	test("paiza のコンパイルエラーを判定する", async () => {
		const http = new FakeHttpClient(({url}) => {
			if (url.includes("create")) return {status: 200, text: JSON.stringify({id: "x", status: "completed"})};
			return {
				status: 200,
				text: JSON.stringify({
					build_result: "failure",
					build_exit_code: 1,
					build_stderr: "error",
					time: "0",
					memory: "0",
				})
			};
		});
		const [runner] = await new PaizaRunnerProvider(http).runnersFor({id: "r", label: "Rust", family: "rust"});
		expect(await runner?.run("code", "", {})).toMatchObject({status: "CE", error: "error"});
	});

	test("Wandbox のコンパイラ一覧は言語で絞り込み、キャッシュする", async () => {
		const compilers = [
			{name: "openjdk-21", language: "Java", version: "21", switches: []},
			{name: "gcc", language: "C++", version: "13", switches: []},
		];
		const http = new FakeHttpClient(() => ({status: 200, text: JSON.stringify(compilers)}));
		const provider = new WandboxRunnerProvider(http, new MemoryStore());
		expect((await provider.runnersFor(java)).map(({id}) => id)).toEqual(["wandbox:openjdk-21"]);
		await provider.runnersFor(java);
		expect(http.requests).toHaveLength(1);
	});

	test("Wandbox へは Java の型から public を外して送り、ほかの言語はそのまま送る", async () => {
		const compilers = [
			{name: "openjdk-21", language: "Java", version: "21", switches: []},
			{name: "gcc", language: "C++", version: "13", switches: []},
		];
		const http = new FakeHttpClient(({url}) => {
			return {status: 200, text: JSON.stringify(url.endsWith("list.json") ? compilers : {status: 0})};
		});
		const provider = new WandboxRunnerProvider(http, new MemoryStore());
		const sentCode = () => (JSON.parse(http.requests.at(-1)?.body ?? "{}") as {code?: string}).code;

		const [javaRunner] = await provider.runnersFor(java);
		await javaRunner?.run("public final class Main {\n}\n", "", {});
		expect(sentCode()).toBe("final class Main {\n}\n");

		const [cppRunner] = await provider.runnersFor({id: "2", label: "C++ 23", family: "cpp"});
		await cppRunner?.run("public final class Main {\n}\n", "", {});
		expect(sentCode()).toBe("public final class Main {\n}\n");
	});

	test("Local Runner は同じ言語のコンパイラだけを候補にする", async () => {
		const list = [{language: "Java", compilerName: "jdk24", label: "Java 24"}, {
			language: "C++",
			compilerName: "gcc",
			label: "G++",
		}];
		const client = new LocalRunnerClient(new FakeHttpClient(() => ({
			status: 200,
			text: JSON.stringify(list),
		})), () => "http://localhost:8080");
		expect((await new LocalRunnerProvider(client).runnersFor(java)).map(({label}) => label)).toEqual(["Java 24 [Local]"]);
	});

	test("Local Runner が返した種類を、表記からの判定より優先する", async () => {
		const list = [
			{language: "My runtime", compilerName: "custom", label: "Custom", family: "java"},
			{language: "Java", compilerName: "other", label: "Other", family: "cpp"},
		];
		const client = new LocalRunnerClient(new FakeHttpClient(() => ({
			status: 200,
			text: JSON.stringify(list),
		})), () => "http://localhost:8080");
		expect((await new LocalRunnerProvider(client).runnersFor(java)).map(({id}) => id)).toEqual(["local:custom"]);
	});

	test("Local Runner の候補は、ページの表記に合う処理系を先頭にし、残りをサーバーの順に並べる", async () => {
		const list = [
			{language: "Python (CPython)", compilerName: "cpython", label: "Python (CPython)", family: "python3", match: ["CPython"]},
			{language: "Python (PyPy)", compilerName: "pypy", label: "Python (PyPy)", family: "python3", match: ["PyPy"]},
			{language: "Python (Codon)", compilerName: "codon", label: "Python (Codon)", family: "python3", match: ["Codon"]},
			{language: "C++", compilerName: "cpp", label: "C++", family: "cpp", match: []},
		];
		const client = new LocalRunnerClient(new FakeHttpClient(() => ({
			status: 200,
			text: JSON.stringify(list),
		})), () => "http://localhost:8080");
		const order = async (label: string) => {
			const runners = await new LocalRunnerProvider(client).runnersFor({id: "1", label, family: "python3"});
			return runners.map(({id, preference}) => `${id}:${preference}`);
		};
		expect(await order("Python (PyPy 3.11-v7.3.20)")).toEqual(["local:pypy:0", "local:cpython:1", "local:codon:2"]);
		expect(await order("PyPy 3-64")).toEqual(["local:pypy:0", "local:cpython:1", "local:codon:2"]);
		expect(await order("Python (Codon 0.19.3)")).toEqual(["local:codon:0", "local:cpython:1", "local:pypy:2"]);
		expect(await order("Python3")).toEqual(["local:cpython:0", "local:pypy:1", "local:codon:2"]);
	});

	test("Local Runner が match を返さなければ、順位を付けずに表記の近さへ任せる", async () => {
		const list = [{language: "Java", compilerName: "a", label: "Java 21"}, {language: "Java", compilerName: "b", label: "Java 24"}];
		const client = new LocalRunnerClient(new FakeHttpClient(() => ({
			status: 200,
			text: JSON.stringify(list),
		})), () => "http://localhost:8080");
		const runners = await new LocalRunnerProvider(client).runnersFor(java);
		expect(runners.map(({preference}) => preference)).toEqual([undefined, undefined]);
	});

	test("Local Runner がメモリの最大値を返したら、使用量として返す", async () => {
		const client = new LocalRunnerClient(new FakeHttpClient(({body}) => {
			if (body?.includes('"list"')) {
				return {status: 200, text: JSON.stringify([{language: "C++", compilerName: "cpp", label: "C++", family: "cpp"}])};
			}
			const response = {status: "success", exitCode: 0, stdout: "", stderr: "", time: 1, memory: 0, peakMemory: 3616};
			return {status: 200, text: JSON.stringify(response)};
		}), () => "http://localhost:8080");
		const [runner] = await new LocalRunnerProvider(client).runnersFor({id: "1", label: "C++23 (GCC 15.2.0)", family: "cpp"});
		const result = await runner!.run("code", "", {});
		expect(result.memory).toBe(3616);
		expect(result.allocatedMemory).toBeUndefined();
	});

	test("Local Runner の計測値は累積の割り当て量として返し、計測できないときは返さない", async () => {
		const runWith = async (memory: number) => {
			const client = new LocalRunnerClient(new FakeHttpClient(({body}) => {
				if (body?.includes('"list"')) {
					return {
						status: 200,
						text: JSON.stringify([{language: "Java", compilerName: "java24", label: "Java 24"}]),
					};
				}
				return {status: 200, text: JSON.stringify({status: "success", exitCode: 0, stdout: "", stderr: "", time: 1, memory})};
			}), () => "http://localhost:8080");
			const [runner] = await new LocalRunnerProvider(client).runnersFor(java);
			return runner!.run("code", "", {});
		};

		const measured = await runWith(2048);
		expect(measured.allocatedMemory).toBe(2048);
		expect(measured.memory).toBeUndefined();
		expect((await runWith(0)).allocatedMemory).toBeUndefined();
	});

	test("Local Runner のコンパイルエラーは、実行の応答の stderr を CE として返す", async () => {
		const client = new LocalRunnerClient(new FakeHttpClient(({body}) => {
			if (body?.includes('"list"')) {
				return {status: 200, text: JSON.stringify([{language: "C++", compilerName: "cpp", label: "C++", family: "cpp"}])};
			}
			const failed = {status: "compileError", exitCode: 1, stdout: "", stderr: "Main.cpp:4: error", time: 0, memory: 0};
			return {status: 200, text: JSON.stringify(failed)};
		}), () => "http://localhost:8080");
		const [runner] = await new LocalRunnerProvider(client).runnersFor({id: "1", label: "C++23 (GCC 15.2.0)", family: "cpp"});
		expect(await runner!.run("code", "in", {})).toEqual({status: "CE", input: "in", error: "Main.cpp:4: error"});
	});

	test("Local Runner が標準出力を切り詰めたら、先頭が合っても AC にしない", async () => {
		const runWith = async (stdoutTruncated: boolean, stderrTruncated: boolean) => {
			const client = new LocalRunnerClient(new FakeHttpClient(({body}) => {
				if (body?.includes('"list"')) {
					return {status: 200, text: JSON.stringify([{language: "C++", compilerName: "cpp", label: "C++", family: "cpp"}])};
				}
				const response = {status: "success", exitCode: 0, stdout: "good", stderr: "", time: 1, memory: 0, stdoutTruncated, stderrTruncated};
				return {status: 200, text: JSON.stringify(response)};
			}), () => "http://localhost:8080");
			const [runner] = await new LocalRunnerProvider(client).runnersFor({id: "1", label: "C++23 (GCC 15.2.0)", family: "cpp"});
			return runner!.run("code", "", {});
		};
		expect((await runWith(true, false)).status).toBe("OLE");
		expect((await runWith(false, true)).status).toBe("OK");
	});

	test("Local Runner の変換で増えた行数を返し、0 や分からないときは返さない", async () => {
		const runWith = async (lineOffset: unknown) => {
			const client = new LocalRunnerClient(new FakeHttpClient(({body}) => {
				if (body?.includes('"list"')) {
					return {status: 200, text: JSON.stringify([{language: "Java", compilerName: "java24", label: "Java 24"}])};
				}
				return {status: 200, text: JSON.stringify({status: "runtimeError", exitCode: 1, stdout: "", stderr: "at Main.main(Main.java:12)", time: 1, memory: 0, lineOffset})};
			}), () => "http://localhost:8080");
			const [runner] = await new LocalRunnerProvider(client).runnersFor(java);
			return runner!.run("code", "", {});
		};
		expect((await runWith({header: 0, transform: 4})).lineOffset).toBe(4);
		expect((await runWith({header: 0, transform: 0})).lineOffset).toBeUndefined();
		expect((await runWith({header: 0, transform: null})).lineOffset).toBeUndefined();
		expect((await runWith(undefined)).lineOffset).toBeUndefined();
	});

	test("Local Runner のコンパイルエラーでも、変換で増えた行数を返す", async () => {
		const client = new LocalRunnerClient(new FakeHttpClient(({body}) => {
			if (body?.includes('"list"')) {
				return {status: 200, text: JSON.stringify([{language: "Java", compilerName: "java24", label: "Java 24"}])};
			}
			const failed = {status: "compileError", exitCode: 1, stdout: "", stderr: "ERROR 2:13 code too large", time: 0, memory: 0, lineOffset: {header: 0, transform: -1}};
			return {status: 200, text: JSON.stringify(failed)};
		}), () => "http://localhost:8080");
		const [runner] = await new LocalRunnerProvider(client).runnersFor(java);
		expect(await runner!.run("code", "", {})).toMatchObject({status: "CE", lineOffset: -1});
	});

	test("Local Runner を使わない設定なら候補にしない", async () => {
		const client = new LocalRunnerClient(noHttp, () => null);
		expect(await new LocalRunnerProvider(client).runnersFor(java)).toEqual([]);
	});
});

describe("Pyodide", () => {
	const globals = globalThis as {unsafeWindow?: unknown};
	const python = {id: "1", label: "Python (CPython 3.13.7)", family: "python3"};

	afterEach(() => {
		delete globals.unsafeWindow;
	});

	/** 実行で渡された値を記録する Pyodide の代役。読み込みは failures 回だけ失敗する。 */
	function fakePyodide(failures: number) {
		const values = new Map<string, unknown>();
		const ran: string[] = [];
		let loads = 0;
		const api = {
			globals: {
				set: (name: string, value: unknown) => values.set(name, value),
				get: (name: string) => name === "__code" ? null : {getvalue: () => name === "__stdout" ? "out" : ""},
			},
			loadPackagesFromImports: async () => undefined,
			runPythonAsync: async () => undefined,
			runPython: (code: string) => ran.push(code),
		};
		globals.unsafeWindow = {loadPyodide: async () => {
			if (++loads <= failures) throw new Error("network");
			return api;
		}};
		const scripts = {loadScript: async () => undefined, loadStylesheet: async () => undefined};
		return {values, ran, scripts, loads: () => loads};
	}

	test("提出のソースを書き換えずに渡して実行する", async () => {
		const fake = fakePyodide(0);
		const [runner] = await new PyodideRunnerProvider(fake.scripts).runnersFor(python);
		if (!runner) throw new Error("Pyodide was not offered");
		const source = 'from __future__ import annotations\ns = """a\nb"""\nprint(s)\n';
		expect(await runner.run(source, "1\n", {})).toMatchObject({status: "OK", output: "out"});
		expect(fake.values.get("__source")).toBe(source);
		expect(fake.values.get("__stdin")).toBe("1\n");
		expect(fake.ran).toEqual(["__run(__source)"]);
	});

	test("読み込みに失敗したら、次の実行で読み込み直す", async () => {
		const fake = fakePyodide(1);
		const [runner] = await new PyodideRunnerProvider(fake.scripts).runnersFor(python);
		if (!runner) throw new Error("Pyodide was not offered");
		await expect(runner.run("print(1)", "", {})).rejects.toThrow("network");
		expect(await runner.run("print(1)", "", {})).toMatchObject({status: "OK"});
		expect(fake.loads()).toBe(2);
	});
});
