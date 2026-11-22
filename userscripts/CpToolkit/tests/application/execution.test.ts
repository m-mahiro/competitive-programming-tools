import {describe, expect, mock, test} from "bun:test";
import {LocalRunnerClient} from "@application/execution/local-runner";
import {type CodeRunner, RunnerCatalogService} from "@application/execution/runner-catalog";
import {type EnvironmentView, RunnerSelection} from "@application/execution/runner-selection";
import {TestSession} from "@application/execution/test-session";
import type {JudgeLanguage, RunResult} from "@domain/execution/result";
import {FakeHttpClient, MemoryStore} from "../support/fakes";

const JSON_OK = (body: unknown) => ({status: 200, text: JSON.stringify(body)});

const ok = async (): Promise<RunResult> => ({status: "OK", input: "", output: "1"});

const runner = (id: string, kind: CodeRunner["kind"]): CodeRunner => ({id, kind, label: id, run: ok});

function setup(runners: readonly CodeRunner[]) {
	let language: JudgeLanguage | null = {id: "L1", label: "Java 24", family: "java"};
	const catalog = new RunnerCatalogService(() => [{runnersFor: async () => runners}], ["local", "judge", "paiza"], 3);
	const state = new MemoryStore();
	const selection = new RunnerSelection(() => language, catalog, state);
	const shown: (string | undefined)[] = [];
	const view: EnvironmentView = {
		show: (_candidates, selected) => {
			shown.push(selected);
		},
	};
	return {
		catalog, selection, state, view, shown,
		setLanguage: (next: JudgeLanguage | null) => void (language = next),
	};
}

describe("LocalRunnerClient", () => {
	const output = {status: "success", exitCode: 0, stdout: "ok", stderr: "", time: 1, memory: 1};

	test("URL が未設定なら利用できない", () => {
		const client = new LocalRunnerClient(new FakeHttpClient(() => JSON_OK([])), () => null);
		expect(client.isAvailable()).toBe(false);
	});

	test("事前コンパイルは、言語とソースを送るだけで結果を待たない", async () => {
		const http = new FakeHttpClient(() => JSON_OK({status: "accepted"}));
		const client = new LocalRunnerClient(http, () => "http://localhost:8080");
		await client.precompile("code", "cpp");
		expect(JSON.parse(http.requests[0]?.body ?? "{}")).toEqual({
			mode: "precompile", sourceCode: "code", compilerName: "cpp", debug: true,
		});
	});

	test("実行は1回の要求で、ソースと入力を送る", async () => {
		const http = new FakeHttpClient(() => JSON_OK(output));
		const client = new LocalRunnerClient(http, () => "http://localhost:8080");
		expect(await client.run("code", "in", "python3")).toEqual(output as never);
		expect(http.requests.map(({body}) => JSON.parse(body ?? "{}"))).toEqual([
			{mode: "run", sourceCode: "code", compilerName: "python3", stdin: "in", debug: true},
		]);
	});

	test("言語を指定しなければ送らない", async () => {
		const http = new FakeHttpClient(() => JSON_OK(output));
		const client = new LocalRunnerClient(http, () => "http://localhost:8080");
		await client.run("code", "");
		expect(JSON.parse(http.requests[0]?.body ?? "{}")).not.toHaveProperty("compilerName");
	});

	test("サーバーの失敗はそのまま伝える", async () => {
		const http = new FakeHttpClient(() => ({status: 400, text: ""}));
		const client = new LocalRunnerClient(http, () => "http://localhost:8080");
		await expect(client.run("code", "")).rejects.toThrow("Local Runner returned 400.");
		expect(http.requests).toHaveLength(1);
	});

	test("言語の一覧は覚えておき、通信に失敗したら取り直す", async () => {
		let fail = false;
		const http = new FakeHttpClient(() => (fail ? {status: 500, text: ""} : JSON_OK([])));
		const client = new LocalRunnerClient(http, () => "http://localhost:8080");
		await client.list();
		await client.list();
		expect(http.requests).toHaveLength(1);
		fail = true;
		await expect(client.run("code", "")).rejects.toThrow("Local Runner returned 500.");
		fail = false;
		await client.list();
		expect(http.requests).toHaveLength(3);
	});

	test("ヘッダーを先に返すサーバーの、先頭に改行の付いた応答を読める", async () => {
		const http = new FakeHttpClient(() => ({status: 200, text: `\n${JSON.stringify(output)}`}));
		const client = new LocalRunnerClient(http, () => "http://localhost:8080");
		expect(await client.run("code", "")).toEqual(output as never);
	});
	test("壊れた一覧のあとは次の要求で取り直す", async () => {
		let calls = 0;
		const http = new FakeHttpClient(() => ++calls === 1 ? {status: 200, text: "{"} : JSON_OK([]));
		const client = new LocalRunnerClient(http, () => "http://localhost");
		await expect(client.list()).rejects.toThrow("Invalid JSON");
		expect(await client.list()).toEqual([]);
		expect(calls).toBe(2);
	});

	test("準備要求を送ったあとの切断はオフラインの簡易変換へ戻さない", async () => {
		const http = new FakeHttpClient(({body}) => {
			if (JSON.parse(String(body)).mode === "status") return JSON_OK({status: "running", version: "2.0.0"});
			return {status: 0, text: ""};
		});
		const client = new LocalRunnerClient(http, () => "http://localhost");
		await expect(client.transform("source")).rejects.toMatchObject({status: -1});
		await expect(client.header("java", true)).rejects.toMatchObject({status: -1});
	});

	test("1.x では実行を許し、提出用 API には送信せず更新を案内する", async () => {
		const modes: string[] = [];
		const http = new FakeHttpClient(({body}) => {
			const {mode} = JSON.parse(String(body));
			modes.push(mode);
			return JSON_OK(mode === "status" ? {status: "running", version: "1.1.0"} : output);
		});
		const client = new LocalRunnerClient(http, () => "http://localhost");
		await expect(client.header("java", true)).rejects.toMatchObject({notify: true});
		await expect(client.transform("source")).rejects.toMatchObject({notify: false});
		await client.run("source", "");
		expect(modes).toEqual(["status", "run"]);
	});

});

describe("RunnerCatalogService", () => {
	const language: JudgeLanguage = {id: "6056", label: "Java 24", family: "java"};
	const runner = (id: string, kind: CodeRunner["kind"], run: () => Promise<RunResult>, label = id): CodeRunner => ({
		id,
		kind,
		label,
		run,
	});
	const ok = async (): Promise<RunResult> => ({status: "OK", input: "", output: "1"});
	const catalog = (runners: readonly CodeRunner[]) => new RunnerCatalogService(
		() => [{runnersFor: async () => runners}, {runnersFor: () => Promise.reject(new Error("offline"))}],
		["local", "judge", "paiza"],
		3,
	);

	test("設定の順に並べ、取得に失敗した候補は無視する", async () => {
		const candidates = await catalog([runner("p", "paiza", ok), runner("j", "judge", ok), runner("l", "local", ok)]).candidates(language);
		expect(candidates.map(({id}) => id)).toEqual(["l", "j", "p"]);
	});

	test("同じ種類の中では表記が近い順に並べる", async () => {
		const candidates = await catalog([runner("far", "judge", ok, "Rust"), runner("near", "judge", ok, "Java 24")]).candidates(language);
		expect(candidates[0]?.id).toBe("near");
	});

	test("実行環境が順位を決めていれば、表記の近さより優先する", async () => {
		const runners: CodeRunner[] = [
			{...runner("far", "local", ok, "Rust"), preference: 0},
			{...runner("near", "local", ok, "Java 24"), preference: 1},
			runner("judge", "judge", ok, "Java 24"),
		];
		const candidates = await catalog(runners).candidates(language);
		expect(candidates.map(({id}) => id)).toEqual(["far", "near", "judge"]);
	});

	test("サイトの言語と同じ表記の環境を、同じ種類の先頭に並べる", async () => {
		const labels = ["C++23 (GCC 15.2.0)", "C++23 (Clang 21.1.0)", "C++20 (GCC 12.2.0)"];
		for (const label of labels) {
			const runners = labels.map((item) => runner(item, "judge", ok, `${item} [AtCoder]`));
			const candidates = await catalog(runners).candidates({id: "1", label, family: "cpp"});
			expect(candidates[0]?.id).toBe(label);
		}
	});

	test("内部エラーなら次の候補で実行する", async () => {
		const failing = mock(async (): Promise<RunResult> => ({status: "IE", input: ""}));
		const service = catalog([]);
		const result = await service.test(
			[runner("a", "local", failing), runner("b", "judge", ok)],
			"a",
			"code",
			{title: "t", input: "", output: "1"},
			{trim: true, split: true},
		);
		expect(failing).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("AC");
	});

	test("内部エラーでも、外部のサービスへは自動で切り替えない", async () => {
		const failing = mock(async (): Promise<RunResult> => ({status: "IE", input: ""}));
		const external = mock(ok);
		const service = new RunnerCatalogService(() => [], ["local", "paiza"], 3, ["paiza"]);
		const result = await service.test(
			[runner("a", "local", failing), runner("b", "paiza", external)],
			"a",
			"code",
			{title: "t", input: "", output: "1"},
			{trim: true, split: true},
		);
		expect(external).not.toHaveBeenCalled();
		expect(failing).toHaveBeenCalledTimes(3);
		expect(result.status).toBe("IE");
	});

	test("外部のサービスを選んだときは、そのサービスで実行する", async () => {
		const external = mock(ok);
		const service = new RunnerCatalogService(() => [], ["local", "paiza"], 3, ["paiza"]);
		const result = await service.test(
			[runner("a", "local", ok), runner("b", "paiza", external)],
			"b",
			"code",
			{title: "t", input: "", output: "1"},
			{trim: true, split: true},
		);
		expect(external).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("AC");
	});

	test("例外も内部エラーとして扱う", async () => {
		const service = catalog([]);
		const result = await service.test(
			[runner("a", "local", () => Promise.reject(new Error("boom")))],
			"a",
			"code",
			{title: "t", input: "", output: null},
			{},
		);
		expect(result).toMatchObject({status: "IE", error: "Error: boom"});
	});
});

describe("RunnerSelection", () => {
	test("Local Runner が使えるときは、それを選ぶ", async () => {
		const {selection, view, shown} = setup([runner("j", "judge"), runner("l", "local")]);
		await selection.refresh(view);
		expect(shown).toEqual(["l"]);
		expect(selection.local()?.id).toBe("l");
	});

	test("同じ言語のままなら前の選択を引き継ぎ、言語が変われば保存した選択を使う", async () => {
		const {selection, view, shown, setLanguage} = setup([runner("j", "judge"), runner("p", "paiza")]);
		await selection.refresh(view);
		selection.remember("p");
		await selection.refresh(view);
		expect(shown).toEqual(["j", "p"]);
		setLanguage({id: "L2", label: "C++ 23", family: "cpp"});
		await selection.refresh(view);
		expect(shown.at(-1)).toBe("j");
		setLanguage({id: "L1", label: "Java 24", family: "java"});
		await selection.refresh(view);
		expect(shown.at(-1)).toBe("p");
	});

	test("自動選択は後から起動した Local Runner を次の実行で選ぶ", async () => {
		const available = [runner("j", "judge")];
		const {selection, view, shown} = setup(available);
		await selection.refresh(view);
		available.push(runner("l", "local"));
		await selection.refresh(view);
		expect(shown).toEqual(["j", "l"]);
	});

	test("手動選択はローカルより優先し、自動に戻せる", async () => {
		const {selection, view, shown} = setup([runner("j", "judge"), runner("l", "local")]);
		selection.remember("j");
		await selection.refresh(view);
		expect(shown.at(-1)).toBe("j");
		selection.remember("");
		await selection.refresh(view);
		expect(shown.at(-1)).toBe("l");
	});

	test("言語が選ばれていなければ、候補は空で何も記憶しない", async () => {
		const {selection, view, shown, state, setLanguage} = setup([runner("j", "judge")]);
		setLanguage(null);
		await selection.refresh(view);
		selection.remember("j");
		expect(shown).toEqual([undefined]);
		expect(selection.candidates).toEqual([]);
		expect(state.get("easy-test:runner-selection")).toBeUndefined();
	});

	test("更新が重なっても、呼んだ順に1件ずつ反映する", async () => {
		const {selection, view, shown} = setup([runner("j", "judge")]);
		await Promise.all([selection.refresh(view), selection.refresh(view), selection.refresh(view)]);
		expect(shown).toEqual(["j", "j", "j"]);
	});
});

describe("TestSession", () => {
	const testCase = {title: "Sample 1", input: "", output: "1"};
	const create = () => {
		const {catalog, selection, view} = setup([runner("j", "judge")]);
		const events: string[] = [];
		const session = new TestSession(catalog, selection, {
			onBusyChange: () => void events.push("busy"),
			onSubmitChange: () => void events.push("submit"),
		});
		return {session, selection, view, events};
	};

	test("手動で選んだ実行先が失敗しても他の実行先に送らない", async () => {
		const calls: string[] = [];
		const manual: CodeRunner = {...runner("chosen", "judge"), async run() {
			calls.push("chosen");
			throw new Error("unavailable");
		}};
		const local: CodeRunner = {...runner("local", "local"), async run() {
			calls.push("local");
			return ok();
		}};
		const {catalog, selection, view} = setup([local, manual]);
		selection.remember("chosen");
		await selection.refresh(view);
		const session = new TestSession(catalog, selection, {onBusyChange() {}, onSubmitChange() {}});
		expect((await session.start(testCase, "code", "chosen", undefined, {})).status).toBe("IE");
		expect(calls).toEqual(["chosen", "chosen", "chosen"]);
	});

	test("実行の番号は1から順に付く", () => {
		const {session} = create();
		expect([session.nextNumber(), session.nextNumber()]).toEqual([1, 2]);
	});

	test("実行を始めるたびと、実行中の件数が 0 になったときに通知を送る", async () => {
		const {session, selection, view, events} = create();
		await selection.refresh(view);
		const first = session.start(testCase, "code", "j", undefined, {});
		const second = session.start(testCase, "code", "j", undefined, {});
		expect(session.busy).toBe(true);
		await Promise.all([first, second]);
		expect(session.busy).toBe(false);
		expect(events).toEqual(["busy", "busy", "busy"]);
	});

	test("提出の予定がある間は、新しいテストを始めない", async () => {
		const {session} = create();
		let release!: (passed: boolean) => void;
		let submitted = 0;
		const first = session.testAndSubmit(() => new Promise<boolean>((resolve) => void (release = resolve)), () => void submitted++);
		expect(session.submitPending).toBe(true);
		await session.testAndSubmit(async () => true, () => void submitted++);
		expect(submitted).toBe(0);
		release(true);
		await first;
		expect(submitted).toBe(1);
		expect(session.submitPending).toBe(false);
	});

	test("全問正解でなければ、提出しない", async () => {
		const {session} = create();
		let submitted = 0;
		await session.testAndSubmit(async () => false, () => void submitted++);
		expect(submitted).toBe(0);
		expect(session.submitPending).toBe(false);
	});

	test("中止すれば提出しない。中止した後の予定は妨げない", async () => {
		const {session} = create();
		let release!: (passed: boolean) => void;
		let submitted = 0;
		const first = session.testAndSubmit(() => new Promise<boolean>((resolve) => void (release = resolve)), () => void submitted++);
		session.cancelSubmit();
		expect(session.submitPending).toBe(false);
		await session.testAndSubmit(async () => true, () => void submitted++);
		release(true);
		await first;
		expect(submitted).toBe(1);
	});
});
