import {describe, expect, test} from "bun:test";
import type {JudgeLanguage, RunResult} from "@domain/execution/result";
import {type CodeRunner, RunnerCatalogService} from "@application/execution/runner-catalog";
import {type EnvironmentView, RunnerSelection} from "@application/execution/runner-selection";
import {TestSession} from "@application/execution/test-session";
import {MemoryStore} from "../support/fakes";

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
