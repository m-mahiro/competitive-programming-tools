import {afterEach, describe, expect, test} from "bun:test";
import {PageCodeEditorLocator} from "@adapters/page/code-editors";
import {DocumentLifecycle} from "@adapters/page/document-lifecycle";
import {SameOriginHttpClient} from "@adapters/page/same-origin-http-client";
import {WorkerTicker} from "@adapters/page/worker-ticker";

const setReadyState = (value: DocumentReadyState): void => {
	Object.defineProperty(document, "readyState", {value, configurable: true});
};

describe("SameOriginHttpClient", () => {
	test("別のサイトへは送らない", async () => {
		const client = new SameOriginHttpClient();
		await expect(client.send({url: "https://evil.example/data"})).rejects.toThrow("Cross-origin");
	});
});

describe("PageCodeEditorLocator", () => {
	const globals = globalThis as {unsafeWindow?: unknown};
	const target = {editor: "ace", editorElements: ["#editor"], submitButtons: []} as const;

	afterEach(() => {
		delete globals.unsafeWindow;
	});

	test("同じ条件の探索は1本にまとめる", async () => {
		globals.unsafeWindow = {};
		const locator = new PageCodeEditorLocator();
		const first = locator.locate(target, {timeoutMs: 10});
		expect(locator.locate(target, {timeoutMs: 10})).toBe(first);
		expect(await first).toBeNull();
	});

	test("見つからなかった結果は残さず、あとから探し直せる", async () => {
		const editor = {getSession: () => ({})};
		const locator = new PageCodeEditorLocator();
		globals.unsafeWindow = {};
		expect(await locator.locate(target, {timeoutMs: 10})).toBeNull();

		document.body.innerHTML = '<div id="editor"></div>';
		globals.unsafeWindow = {ace: {edit: () => editor}};
		expect(await locator.locate(target, {timeoutMs: 10})).not.toBeNull();
	});
});

describe("WorkerTicker", () => {
	const originalWorker = globalThis.Worker;
	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	class FakeWorker {
		static last: FakeWorker | null = null;
		onmessage: (() => void) | null = null;
		onerror: (() => void) | null = null;
		terminated = false;

		constructor() {
			FakeWorker.last = this;
		}

		postMessage(): void {
		}

		terminate(): void {
			this.terminated = true;
		}
	}

	afterEach(() => {
		globalThis.Worker = originalWorker;
	});

	test("Worker の通知で呼び出し、止めると終了する", () => {
		globalThis.Worker = FakeWorker as unknown as typeof Worker;
		let ticks = 0;
		const stop = new WorkerTicker().start(100, () => ticks++);
		FakeWorker.last?.onmessage?.();
		expect(ticks).toBe(1);
		stop();
		expect(FakeWorker.last?.terminated).toBe(true);
	});

	test("Worker を作れないページでは通常のタイマーで動く", async () => {
		globalThis.Worker = class {
			constructor() {
				throw new Error("blocked");
			}
		} as unknown as typeof Worker;
		let ticks = 0;
		const stop = new WorkerTicker().start(1, () => ticks++);
		await wait(20);
		stop();
		expect(ticks).toBeGreaterThan(0);
	});

	test("Worker の読み込みに失敗したら通常のタイマーへ切り替える", async () => {
		globalThis.Worker = FakeWorker as unknown as typeof Worker;
		let ticks = 0;
		const stop = new WorkerTicker().start(1, () => ticks++);
		FakeWorker.last?.onerror?.();
		expect(FakeWorker.last?.terminated).toBe(true);
		await wait(20);
		stop();
		const stopped = ticks;
		expect(stopped).toBeGreaterThan(0);
		await wait(20);
		expect(ticks).toBe(stopped);
	});
});

describe("DocumentLifecycle", () => {
	afterEach(() => {
		delete (document as {readyState?: DocumentReadyState}).readyState;
	});

	test("ready はサイトの DOMContentLoaded の処理が終わるまで待つ", async () => {
		setReadyState("loading");
		let reached = false;
		const ready = new DocumentLifecycle().reach("ready").then(() => {
			reached = true;
		});
		document.dispatchEvent(new Event("DOMContentLoaded"));
		for (let index = 0; index < 5; index++) await Promise.resolve();
		expect(reached).toBe(false);
		await ready;
		expect(reached).toBe(true);
	});

	test("読み込みが終わっていればすぐに到達する", async () => {
		setReadyState("complete");
		await new DocumentLifecycle().reach("ready");
		await new DocumentLifecycle().reach("load");
	});
});
