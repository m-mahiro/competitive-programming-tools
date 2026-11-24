import {afterEach, describe, expect, mock, test} from "bun:test";
import {LocalRunnerClient} from "@application/execution/local-runner";
import {type CodeRunner, RunnerCatalogService} from "@application/execution/runner-catalog";
import type {JudgeSite, SampleCase} from "@application/ports/judge-site";
import {ShortcutActions} from "@application/shortcuts/shortcut-actions";
import {PastePipeline} from "@application/source/paste-pipeline";
import type {Translate} from "@catalog/messages";
import type {JudgeLanguage, RunResult} from "@domain/execution/result";
import {easyTest} from "@features/easy-test/index";
import {createResultView} from "@features/easy-test/views";
import {keyboardShortcuts} from "@features/keyboard-shortcuts/index";
import {createFakeServices, FakeHttpClient, MemoryStore} from "../support/fakes";
import {hover, pressKey, shadowRoots, tooltipText, wait} from "../support/dom";

describe("easyTest", () => {
	const java: JudgeLanguage = {id: "6056", label: "Java 24", family: "java"};

	function createSite(overrides: Partial<Omit<JudgeSite, "submit">> = {}): JudgeSite & {
		submit: ReturnType<typeof mock>
	} {
		const anchor = document.createElement("span");
		const secondAnchor = document.createElement("span");
		document.body.append(anchor, secondAnchor);
		const buttons = document.createElement("div");
		const results = document.createElement("div");
		document.body.append(buttons, results);
		const samples: readonly SampleCase[] = [
			{title: "Sample 1", input: "1", output: "1", anchors: [anchor, secondAnchor]},
			{title: "Sample 2", input: "2", output: "2", anchors: []},
		];
		return {
			id: "atcoder",
			mounts: {testButtons: buttons, sideButtons: buttons, results},
			taskUri: () => "https://atcoder.jp/contests/abc1/tasks/abc1_a",
			languages: () => [java],
			language: () => java,
			selectLanguage: () => undefined,
			onLanguageChange: () => undefined,
			onSourceChange: () => undefined,
			sourceCode: () => "code",
			setSourceCode: () => undefined,
			submit: mock(() => undefined),
			samples: async () => samples,
			...overrides,
		};
	}

	const runnerLookups = {count: 0};

	function createRunners(run: CodeRunner["run"]) {
		const runner: CodeRunner = {id: "local:java", label: "Java [Local]", kind: "local", run};
		return new RunnerCatalogService(() => [{
			runnersFor: async () => {
				runnerLookups.count++;
				return [runner];
			},
		}], ["local"], 3);
	}

	const echo = async (_code: string, input: string): Promise<RunResult> => ({status: "OK", input, output: input});

	async function start(site: JudgeSite, run: CodeRunner["run"], extra = {}) {
		await easyTest.run(undefined, createFakeServices({
			judgeSite: async () => site,
			paste: new PastePipeline({locate: async () => null}),
			openSettings: () => undefined,
			runners: createRunners(run),
			localRunner: new LocalRunnerClient(new FakeHttpClient(() => ({status: 500, text: ""})), () => null),
			...extra,
		}));
		await wait();
	}

	const button = (label: string) => [...document.querySelectorAll("button")].find(({textContent}) => textContent === label);
	const dock = () => shadowRoots().find((root) => root.querySelector(".dock"));
	const tabs = () => [...(dock()?.querySelectorAll<HTMLElement>(".dock-tab") ?? [])];
	const tabLabels = () => tabs().map(({firstChild}) => firstChild?.textContent);
	const activeTab = () => tabs().find(({dataset}) => dataset.active === "true")?.firstChild?.textContent;
	const row = () => document.querySelector<HTMLElement>(".cp-et-row");

	/** ショートカットキーの機能でキーを割り当ててから起動する。 */
	async function startWithKeys(site: JudgeSite, run: CodeRunner["run"], keys: Record<string, string> = {}) {
		const shortcuts = new ShortcutActions();
		await keyboardShortcuts.run(keys, createFakeServices({shortcuts, openSettings: () => undefined}));
		await start(site, run, {shortcuts});
	}

	describe("ショートカット", () => {
		test("ショートカットキーの機能で決めたキーで実行する", async () => {
			const site = createSite();
			await startWithKeys(site, echo, {testAndSubmit: "Alt+T"});
			pressKey("t", {altKey: true, code: "KeyT"});
			await wait(30);
			expect(site.submit).toHaveBeenCalledTimes(1);
		});

		test("カーソルを乗せるとすぐに表示し、離すと消す", async () => {
			await startWithKeys(createSite(), echo);
			hover(button("Test & Submit"));
			expect(tooltipText()).toBe("Ctrl+Enter");
			hover(button("Test All Samples"));
			expect(tooltipText()).toBe("Alt+Enter");
			hover(document.body);
			expect(tooltipText()).toBeNull();
		});

		test("中止のボタンの間は表示しない", async () => {
			await startWithKeys(createSite(), () => new Promise(() => undefined));
			hover(button("Test & Submit"));
			button("Test & Submit")?.click();
			await wait();
			expect(tooltipText()).toBeNull();
			hover(document.querySelector(".btn-warning"));
			expect(tooltipText()).toBeNull();
		});

		test("キーを割り当てていなければ表示しない", async () => {
			await startWithKeys(createSite(), echo, {testAndSubmit: "none"});
			hover(button("Test & Submit"));
			expect(tooltipText()).toBeNull();
		});
	});

	test("サンプルの実行ボタンは、置ける場所のすべてに追加する", async () => {
		await start(createSite(), echo);
		expect([...document.querySelectorAll("button")].filter(({textContent}) => textContent === "Run")).toHaveLength(2);
	});

	test("すべて正解なら提出する", async () => {
		const site = createSite();
		await start(site, echo);
		button("Test & Submit")?.click();
		await wait(30);
		expect(site.submit).toHaveBeenCalledTimes(1);
		expect(row()?.dataset.tone).toBe("success");
	});

	test("不正解があれば提出しない", async () => {
		const site = createSite();
		await start(site, async (_code, input) => ({status: "OK", input, output: "wrong"}));
		button("Test & Submit")?.click();
		await wait(30);
		expect(site.submit).not.toHaveBeenCalled();
		expect(row()?.dataset.tone).toBe("warning");
	});

	describe("提出の中止", () => {
		const CANCEL = "提出を中止";

		function createGate() {
			let open: () => void = () => undefined;
			const gate = new Promise<void>((resolve) => {
				open = resolve;
			});
			const run: CodeRunner["run"] = async (_code, input) => {
				await gate;
				return {status: "OK", input, output: input};
			};
			return {run, open: () => open()};
		}

		test("テスト中はボタンが中止に変わり、押すと提出だけを取り消す", async () => {
			const site = createSite();
			const {run, open} = createGate();
			await start(site, run);
			button("Test & Submit")?.click();
			await wait();
			expect(button(CANCEL)?.classList.contains("btn-warning")).toBe(true);
			expect(button(CANCEL)?.classList.contains("disabled")).toBe(false);
			button(CANCEL)?.click();
			expect(button(CANCEL)).toBeUndefined();
			open();
			await wait(30);
			expect(site.submit).not.toHaveBeenCalled();
			expect(row()?.dataset.tone).toBe("success");
			expect(button("Test & Submit")?.classList.contains("btn-info")).toBe(true);
		});

		test("結果の行を閉じても提出しない", async () => {
			const site = createSite();
			const {run, open} = createGate();
			await start(site, run);
			button("Test & Submit")?.click();
			await wait();
			row()?.querySelector<HTMLElement>(".cp-et-close")?.click();
			expect(button("Test & Submit")).toBeDefined();
			open();
			await wait(30);
			expect(site.submit).not.toHaveBeenCalled();
		});

		test("中止のあとに押し直した分は提出する", async () => {
			const site = createSite();
			const {run, open} = createGate();
			await start(site, run);
			button("Test & Submit")?.click();
			await wait();
			button(CANCEL)?.click();
			button("Test & Submit")?.click();
			await wait();
			open();
			await wait(30);
			expect(site.submit).toHaveBeenCalledTimes(1);
		});

		test("テスト中のショートカットは無視し、二重に提出しない", async () => {
			const site = createSite();
			const {run, open} = createGate();
			await startWithKeys(site, run);
			pressKey("Enter", {ctrlKey: true});
			await wait();
			pressKey("Enter", {ctrlKey: true});
			await wait();
			expect(tabLabels()).toEqual(["Easy Test+", "#1 Sample 1", "#2 Sample 2"]);
			open();
			await wait(30);
			expect(site.submit).toHaveBeenCalledTimes(1);
		});
	});

	describe("サンプルがないとき", () => {
		const originalAlert = window.alert;

		afterEach(() => {
			window.alert = originalAlert;
		});

		for (const [name, samples] of [
			["0件", async () => []],
			["取得に失敗", () => Promise.reject(new Error("offline"))],
		] as const) {
			test(`${name}なら提出せず知らせる`, async () => {
				const alert = mock(() => undefined);
				window.alert = alert;
				const site = createSite({samples});
				await start(site, echo);
				button("Test & Submit")?.click();
				await wait(30);
				expect(site.submit).not.toHaveBeenCalled();
				expect(alert).toHaveBeenCalledTimes(1);
				expect(row()).toBeNull();
				expect(button("Test & Submit")?.classList.contains("btn-info")).toBe(true);
			});
		}
	});

	describe("ソースが空のとき", () => {
		const originalAlert = window.alert;

		afterEach(() => {
			window.alert = originalAlert;
		});

		test("実行も提出もせず知らせる", async () => {
			const alert = mock(() => undefined);
			window.alert = alert;
			const run = mock(echo);
			const site = createSite({sourceCode: () => ""});
			await start(site, run);
			button("Test & Submit")?.click();
			await wait(30);
			expect(run).not.toHaveBeenCalled();
			expect(site.submit).not.toHaveBeenCalled();
			expect(alert).toHaveBeenCalledTimes(1);
			expect(row()).toBeNull();
			expect(button("Test & Submit")?.classList.contains("btn-info")).toBe(true);
		});
	});

	describe("許容誤差が数として読めないとき", () => {
		const originalAlert = window.alert;

		afterEach(() => {
			window.alert = originalAlert;
		});

		test("欄を赤くし、実行も提出もせず知らせる", async () => {
			const alert = mock(() => undefined);
			window.alert = alert;
			const run = mock(echo);
			const site = createSite();
			await start(site, run);
			const allowable = dock()?.querySelector<HTMLInputElement>('.input-group input[type="text"]');
			if (!allowable) throw new Error("the allowed error field was not found");
			allowable.value = "10^-6";
			allowable.dispatchEvent(new Event("input"));
			expect(allowable.getAttribute("aria-invalid")).toBe("true");
			button("Test & Submit")?.click();
			await wait(30);
			expect(run).not.toHaveBeenCalled();
			expect(site.submit).not.toHaveBeenCalled();
			expect(alert).toHaveBeenCalledTimes(1);
			expect(allowable.disabled).toBe(false);
			allowable.value = "1e-6";
			allowable.dispatchEvent(new Event("input"));
			expect(allowable.getAttribute("aria-invalid")).toBe("false");
		});

		// 10 なら WA が AC に、読めない 10^-6 なら文字列の比較になって AC が WA に変わる
		for (const [changed, expected, output, tone] of [["10", "1000.0", "1.0", "warning"], ["10^-6", "1.0", "1.0000001", "success"]] as const) {
			test(`押した直後から許容誤差を固定し、スクリプトが欄を ${changed} に変えても当初の値で判定する`, async () => {
				window.alert = mock(() => undefined);
				const fetched = Promise.withResolvers<void>();
				const release = Promise.withResolvers<void>();
				// 起動時にもボタンを置くために読むので、Test & Submit が読む2回目で止める
				let reads = 0;
				const site = createSite({
					samples: async () => {
						if (++reads === 2) {
							fetched.resolve();
							await release.promise;
						}
						return [{title: "Sample 1", input: "1", output: expected, anchors: []}];
					},
				});
				await start(site, async (_code, input) => ({status: "OK", input, output}));
				const allowable = dock()?.querySelector<HTMLInputElement>('.input-group input[type="text"]');
				const checkbox = dock()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
				if (!allowable || !checkbox) throw new Error("the allowed error controls were not found");
				button("Test & Submit")?.click();
				expect(allowable.disabled).toBe(true);
				expect(checkbox.disabled).toBe(true);
				checkbox.click();
				expect(checkbox.checked).toBe(true);
				allowable.value = changed;
				allowable.dispatchEvent(new Event("input"));
				await fetched.promise;
				expect(allowable.disabled).toBe(true);
				release.resolve();
				await wait(30);
				expect(site.submit).toHaveBeenCalledTimes(tone === "success" ? 1 : 0);
				expect(row()?.dataset.tone).toBe(tone);
				expect(allowable.disabled).toBe(false);
				expect(checkbox.disabled).toBe(false);
			});
		}
	});

	test("実行環境がなければボタンを無効の表示にして理由を示す", async () => {
		await start(createSite({language: () => null}), echo);
		expect(button("Test & Submit")?.classList.contains("disabled")).toBe(true);
		expect(dock()?.querySelector("select")?.textContent).toBe("実行環境がありません");
	});

	describe("サイトの言語の切り替え", () => {
		const cpython: JudgeLanguage = {id: "6082", label: "Python (CPython 3.13.7)", family: "python3"};
		const pypy: JudgeLanguage = {id: "6083", label: "Python (PyPy 3.11-v7.3.20)", family: "python3"};

		function createJudgeRunners(ran: string[]) {
			const runner = ({id, label}: JudgeLanguage): CodeRunner => ({
				id: `atcoder:${id}`,
				label: `${label} [AtCoder]`,
				kind: "judge",
				run: async (_code, input) => {
					ran.push(id);
					return {status: "OK", input, output: input};
				},
			});
			return new RunnerCatalogService(() => [{runnersFor: async () => [runner(cpython), runner(pypy)]}], ["judge"], 3);
		}

		test("押した時点の言語で実行する", async () => {
			const ran: string[] = [];
			let language = cpython;
			await start(createSite({language: () => language}), echo, {runners: createJudgeRunners(ran)});
			language = pypy;
			button("Test All Samples")?.click();
			await wait(30);
			expect(ran).toEqual([pypy.id, pypy.id]);
		});

		test("言語ごとに選んだ実行環境は、戻したときに復元する", async () => {
			const ran: string[] = [];
			let language = cpython;
			await start(createSite({language: () => language}), echo, {runners: createJudgeRunners(ran)});
			const environment = dock()?.querySelector("select");
			if (!environment) throw new Error("実行環境の選択欄がない");
			environment.value = `atcoder:${pypy.id}`;
			environment.dispatchEvent(new Event("change"));
			language = pypy;
			button("Test All Samples")?.click();
			await wait(30);
			language = cpython;
			button("Test All Samples")?.click();
			await wait(30);
			expect(ran).toEqual([pypy.id, pypy.id, pypy.id, pypy.id]);
		});
	});

	test("すべてのサンプルを順番どおりに実行する", async () => {
		await start(createSite(), async (_code, input) => {
			await wait(input === "1" ? 20 : 0);
			return {status: "OK", input, output: input};
		});
		button("Test All Samples")?.click();
		await wait(60);
		expect(tabLabels()).toEqual(["Easy Test+", "#1 Sample 1", "#2 Sample 2"]);
		const [input, , expected] = [...(dock()?.querySelector(".result")?.querySelectorAll("textarea") ?? [])];
		expect(input?.value).toBe("1");
		expect(expected?.value).toBe("1");
		expect(tabs()[1]?.dataset.tone).toBe("success");
	});

	test("サンプル実行中に本文が変われば、合格しても提出しない", async () => {
		let code = "original";
		const site = createSite({sourceCode: () => code});
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		await start(site, async (_source, input) => {
			started.resolve();
			await finish.promise;
			return {status: "OK", input, output: input};
		});
		button("Test & Submit")?.click();
		await started.promise;
		code = "edited";
		finish.resolve();
		await wait(30);
		expect(site.submit).not.toHaveBeenCalled();
	});

	test("実行環境の一覧はテスト1回につき1回だけ取得する", async () => {
		await start(createSite(), echo);
		const before = runnerLookups.count;
		button("Test All Samples")?.click();
		await wait(30);
		expect(runnerLookups.count - before).toBe(1);
	});

	test("次に開くときは最後のテストの先頭の結果を表示する", async () => {
		await start(createSite(), echo);
		button("Test All Samples")?.click();
		await wait(30);
		button("Test All Samples")?.click();
		await wait(30);
		expect(activeTab()).toBe("#3 Sample 1");
		expect(dock()?.querySelector<HTMLElement>(".dock-panel")?.hidden).toBe(true);
		dock()?.querySelector<HTMLElement>(".dock-toggle")?.click();
		expect(dock()?.querySelector<HTMLElement>(".dock-panel")?.hidden).toBe(false);
		expect(activeTab()).toBe("#3 Sample 1");
	});

	test("実行中でも次の実行を受け付ける", async () => {
		await start(createSite(), () => new Promise(() => undefined));
		button("Test All Samples")?.click();
		await wait();
		expect(button("Test All Samples")?.classList.contains("disabled")).toBe(true);
		button("Test All Samples")?.click();
		await wait();
		expect(tabLabels()).toHaveLength(5);
	});

	test("実行を重ねると、最後の実行が終了してから許容誤差を編集できる", async () => {
		const first = Promise.withResolvers<void>();
		const second = Promise.withResolvers<void>();
		const seen: Array<number | undefined> = [];
		await start(createSite(), async (_code, input, options) => {
			seen.push(options.allowableError);
			await (seen.length === 1 ? first : second).promise;
			return {status: "OK", input, output: input};
		});
		const allowable = dock()?.querySelector<HTMLInputElement>('.input-group input[type="text"]');
		const checkbox = dock()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
		if (!allowable || !checkbox) throw new Error("the allowed error controls were not found");
		checkbox.click();
		dock()?.querySelector<HTMLButtonElement>(".run-button")?.click();
		button("Run")?.click();
		await wait();
		expect(seen).toEqual([undefined, undefined]);
		first.resolve();
		await wait();
		expect(checkbox.disabled).toBe(true);
		second.resolve();
		await wait();
		expect(checkbox.disabled).toBe(false);
		expect(allowable.disabled).toBe(true);
		checkbox.click();
		expect(allowable.disabled).toBe(false);
	});

	test("行に進捗を表示し、閉じると結果のタブも閉じる", async () => {
		let finish: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		await start(createSite(), async (_code, input) => {
			if (input === "2") await gate;
			return {status: "OK", input, output: input};
		});
		button("Test All Samples")?.click();
		await wait();
		const labels = () => [...(row()?.querySelectorAll(".cp-et-label") ?? [])].map(({textContent}) => textContent);
		expect(labels()).toEqual(["AC", "WJ"]);
		expect(row()?.querySelector(".cp-et-progress-bar")?.textContent).toBe("1 / 2");
		finish();
		await wait();
		expect(labels()).toEqual(["AC", "AC"]);
		row()?.querySelector<HTMLElement>(".cp-et-close")?.click();
		expect(row()).toBeNull();
		expect(tabLabels()).toEqual(["Easy Test+"]);
		expect(activeTab()).toBe("Easy Test+");
	});

	test("行のラベルからその結果を開ける", async () => {
		await start(createSite(), echo);
		button("Test All Samples")?.click();
		await wait(30);
		document.querySelectorAll<HTMLElement>(".cp-et-label")[1]?.click();
		expect(activeTab()).toBe("#2 Sample 2");
		expect(dock()?.querySelector<HTMLElement>(".dock-panel")?.hidden).toBe(false);
	});

	test("サンプルの Run は結果が出てから開く", async () => {
		let finish: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		await start(createSite(), async (_code, input) => {
			await gate;
			return {status: "OK", input, output: input};
		});
		button("Run")?.click();
		await wait();
		expect(dock()?.querySelector<HTMLElement>(".dock-panel")?.hidden).toBe(true);
		finish();
		await wait();
		expect(dock()?.querySelector<HTMLElement>(".dock-panel")?.hidden).toBe(false);
		expect(activeTab()).toBe("#1 Sample 1");
	});

	test("許容誤差のチェックを外すと使わない", async () => {
		const options: unknown[] = [];
		await start(createSite(), async (_code, input, runOptions) => {
			options.push(runOptions.allowableError);
			return {status: "OK", input, output: input};
		});
		button("Test All Samples")?.click();
		await wait(30);
		const checkbox = dock()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
		checkbox?.click();
		button("Test All Samples")?.click();
		await wait(30);
		expect(options).toEqual([1e-6, 1e-6, undefined, undefined]);
	});

	test("ショートカットは入力欄の中でも動く", async () => {
		const site = createSite();
		await startWithKeys(site, echo);
		const textarea = document.createElement("textarea");
		document.body.append(textarea);
		pressKey("Enter", {ctrlKey: true}, textarea);
		await wait(30);
		expect(site.submit).toHaveBeenCalledTimes(1);
	});

	test("実行したコードを記憶し、呼び戻せる", async () => {
		const setSourceCode = mock((_code: string) => undefined);
		const state = new MemoryStore();
		const originalConfirm = window.confirm;
		window.confirm = () => true;
		try {
			await start(createSite({setSourceCode}), echo, {state});
			button("Test All Samples")?.click();
			await wait(30);
			[...document.querySelectorAll<HTMLElement>("a")].find(({textContent}) => textContent === "Restore Last Code")?.click();
			expect(setSourceCode).toHaveBeenCalledWith("code");
		} finally {
			window.confirm = originalConfirm;
		}
	});

	test("Restore Last Code は実行中も押せる", async () => {
		await start(createSite(), () => new Promise(() => undefined));
		button("Test All Samples")?.click();
		await wait();
		const restore = [...document.querySelectorAll("a")].find(({textContent}) => textContent === "Restore Last Code");
		expect(restore?.classList.contains("disabled")).toBe(false);
	});
});

describe("Easy Test の結果の表示", () => {
	test("内部エラーは案内の文言を表示し、詳細があれば続けて表示する", () => {
		const view = createResultView(((key: string) => key) as Translate);
		view.show({status: "IE", input: "", error: "Error: boom"});
		const errorField = view.element.querySelectorAll("textarea")[3]!;
		expect(errorField.value).toBe("easyTest.internalError\nError: boom");
		expect(errorField.closest("label")!.hidden).toBe(false);
	});

	test("実行したソースで行が増えていれば、エラーの前に増えた行数を知らせる", () => {
		const translate = ((key: string) => key === "easyTest.lineOffset" ? "shifted {lines}" : key) as Translate;
		const view = createResultView(translate);
		view.show({status: "RE", input: "", error: "at Main.main(Main.java:12)", lineOffset: 4});
		expect(view.element.querySelectorAll("textarea")[3]!.value).toBe("shifted +4\nat Main.main(Main.java:12)");
		// エラーが無ければ知らせない
		const quiet = createResultView(translate);
		quiet.show({status: "OK", input: "", output: "1", lineOffset: 4});
		expect(quiet.element.querySelectorAll("textarea")[3]!.closest("label")!.hidden).toBe(true);
	});

	test("内部エラーは詳細がなくても案内の文言を表示する", () => {
		const view = createResultView(((key: string) => key) as Translate);
		view.show({status: "IE", input: ""});
		expect(view.element.querySelectorAll("textarea")[3]!.value).toBe("easyTest.internalError");
	});

	const memoryCell = (result: Partial<RunResult>): string | null => {
		const view = createResultView(((key: string) => key) as Translate);
		view.show({status: "OK", input: "", ...result});
		return view.element.querySelectorAll("td")[2]!.textContent;
	};

	test("判定サーバーの使用量と、Local Runner の累積の割り当て量を区別する", () => {
		expect(memoryCell({memory: 2048})).toBe("2048 KB");
		expect(memoryCell({allocatedMemory: 2048})).toBe("2048 KB (easyTest.allocated)");
		expect(memoryCell({})).toBe("");
	});
});
