import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import {judges} from "@catalog/judges";
import {createTranslator} from "@catalog/messages";
import {matchPage} from "@domain/page/route";
import {onSites, option, sharedAcrossSites} from "@domain/settings/option";
import {defineFeature, type Feature} from "@application/feature/definition";
import {FeatureRuntime} from "@application/feature/runtime";
import {SettingsService} from "@application/settings/settings-service";
import {createSettingsPanel} from "@features/settings-panel/index";
import {addNavigationEntry} from "@features/settings-panel/navigation-entry";
import {createFakeServices, createFakeUpdates, FakeHttpClient, immediateLifecycle, MemoryStore, RecordingLogger} from "../support/fakes";

const translate = createTranslator(() => "ja");

const metadata = {
	description: "wideLayout.description",
	category: "category.layout",
	routes: ["atcoder:page"],
	phase: "start",
	defaultEnabled: true,
} as const;

const liveFeature = defineFeature({
	...metadata,
	id: "live",
	title: "wideLayout.title",
	options: {width: option.text("50%", "wideLayout.width", {validate: (value) => value.endsWith("%")})},
	live: true,
	start: () => () => {
	},
});

const reloadFeature = defineFeature({
	...metadata,
	id: "reload",
	title: "wideLayout.title",
	options: {},
	start: () => {
	},
});

const failingFeature = defineFeature({
	...metadata,
	id: "failing",
	title: "wideLayout.title",
	options: {},
	start: () => {
		throw new Error("boom");
	},
});

describe("設定画面", () => {
	let settings: SettingsService;
	let runtime: FeatureRuntime;

	async function openPanel(features: readonly Feature[]): Promise<ShadowRoot> {
		settings = new SettingsService(new MemoryStore());
		runtime = new FeatureRuntime({
			features,
			page: matchPage(judges, "https://atcoder.jp/home"),
			lifecycle: immediateLifecycle,
			settings,
			services: createFakeServices(),
			logger: new RecordingLogger(),
		});
		runtime.start();
		await runtime.settled();
		createSettingsPanel({features, settings, runtime, translate, updates: createFakeUpdates()}).open();
		const host = document.body.lastElementChild;
		if (!host?.shadowRoot) throw new Error("設定画面が表示されていません");
		return host.shadowRoot;
	}

	const query = <T extends Element>(root: ShadowRoot, selector: string): T => {
		const element = root.querySelector<T>(selector);
		if (!element) throw new Error(`${selector} が見つかりません`);
		return element;
	};

	const toggle = (input: HTMLInputElement): void => {
		input.checked = !input.checked;
		input.dispatchEvent(new Event("change", {bubbles: true}));
	};

	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	test("機能の一覧と状態を表示する", async () => {
		const root = await openPanel([liveFeature]);
		expect(query(root, "h3").textContent).toBe(translate("category.layout"));
		expect(query(root, ".feature-title").textContent).toBe(translate("wideLayout.title"));
		expect(query(root, ".status").textContent).toBe(translate("status.running"));
		expect(query(root, ".footer-version").textContent).toBe("v1.2.3");
		expect(query<HTMLDialogElement>(root, "dialog").open).toBe(true);
	});

	test("新しいバージョンがあれば入手先へのリンクを出し、確認のボタンで確かめ直す", async () => {
		let latest = "1.2.3";
		const http = new FakeHttpClient(() => ({status: 200, text: `// @version ${latest}\n`}));
		const updates = createFakeUpdates({
			host: {updateUrl: "https://updates.example/tool.meta.js", downloadUrl: "https://updates.example/tool.user.js"},
			http,
		});
		const features = [liveFeature];
		settings = new SettingsService(new MemoryStore());
		runtime = new FeatureRuntime({
			features,
			page: matchPage(judges, "https://atcoder.jp/home"),
			lifecycle: immediateLifecycle,
			settings,
			services: createFakeServices(),
			logger: new RecordingLogger(),
		});
		createSettingsPanel({features, settings, runtime, translate, updates}).open();
		const root = document.body.lastElementChild?.shadowRoot;
		if (!root) throw new Error("設定画面が表示されていません");

		// 開いただけでは通信しない
		expect(http.requests).toEqual([]);
		expect(root.querySelector(".footer-version a")).toBeNull();
		const check = (): HTMLButtonElement => query<HTMLButtonElement>(root, ".footer-version button");
		expect(check().textContent).toBe(translate("update.check"));

		check().click();
		await Promise.resolve();
		await Promise.resolve();
		expect(query(root, ".footer-version").textContent).toContain(translate("update.upToDate"));

		latest = "1.3.0";
		check().click();
		await Promise.resolve();
		await Promise.resolve();
		const link = query<HTMLAnchorElement>(root, ".footer-version a");
		expect(link.textContent).toBe(`${translate("update.install")} v1.3.0`);
		expect(link.href).toBe("https://updates.example/tool.user.js");
		expect(link.target).toBe("_blank");
	});

	test("画面を作った後にページの言語が決まっても、開いた時点の言語で表示する", async () => {
		// document-start の時点ではページの言語を読めず、ブラウザの言語になる
		let locale: "ja" | "en" = "en";
		const features = [reloadFeature];
		settings = new SettingsService(new MemoryStore());
		runtime = new FeatureRuntime({
			features,
			page: matchPage(judges, "https://atcoder.jp/home"),
			lifecycle: immediateLifecycle,
			settings,
			services: createFakeServices(),
			logger: new RecordingLogger(),
		});
		const panel = createSettingsPanel({
			features,
			settings,
			runtime,
			translate: createTranslator(() => locale),
			updates: createFakeUpdates(),
		});
		locale = "ja";
		panel.open();

		const root = document.body.lastElementChild?.shadowRoot;
		if (!root) throw new Error("設定画面が表示されていません");
		expect(query(root, ".notice span").textContent).toBe(translate("settings.reloadNotice"));
		expect(query(root, ".notice button").textContent).toBe(translate("settings.reload"));
		expect(query(root, ".error").textContent).toBe(translate("settings.importFailed"));
	});

	test("機能がなければその旨を表示する", async () => {
		const root = await openPanel([]);
		expect(query(root, ".empty").textContent).toBe(translate("settings.empty"));
	});

	test("スイッチで ON/OFF を保存し、状態を更新する", async () => {
		const root = await openPanel([liveFeature]);
		const input = query<HTMLInputElement>(root, "input[role=switch]");
		expect(input.checked).toBe(true);

		toggle(input);
		await runtime.settled();
		expect(settings.isEnabled("live", true)).toBe(false);
		expect(query(root, ".status").textContent).toBe(translate("status.disabled"));
	});

	test("再読み込みが必要になると案内を表示する", async () => {
		const root = await openPanel([reloadFeature]);
		const notice = query<HTMLElement>(root, ".notice");
		expect(notice.hidden).toBe(true);

		toggle(query<HTMLInputElement>(root, "input[role=switch]"));
		await runtime.settled();
		expect(notice.hidden).toBe(false);
		expect(query(root, ".status").textContent).toBe(translate("status.reloadRequired"));
	});

	test("起動に失敗した機能は原因を確認できる", async () => {
		const root = await openPanel([failingFeature]);
		const status = query<HTMLElement>(root, ".status");
		expect(status.textContent).toBe(translate("status.failed"));
		expect(status.title).toBe("Error: boom");
	});

	test("正しい値は保存し、不正な値は保存せずに知らせる", async () => {
		const root = await openPanel([liveFeature]);
		const input = query<HTMLInputElement>(root, ".feature-fields input");
		const error = query<HTMLElement>(root, ".field-error");
		expect(input.value).toBe("50%");

		input.value = "1200px";
		input.dispatchEvent(new Event("change", {bubbles: true}));
		expect(error.hidden).toBe(false);
		expect(settings.storedOptions("live")).toBeUndefined();

		input.value = "80%";
		input.dispatchEvent(new Event("change", {bubbles: true}));
		expect(error.hidden).toBe(true);
		expect(settings.storedOptions("live")).toEqual({width: "80%"});
	});

	test("入力の途中でも不正な値を知らせ、保存はしない", async () => {
		const root = await openPanel([liveFeature]);
		const input = query<HTMLInputElement>(root, ".feature-fields input");
		const error = query<HTMLElement>(root, ".field-error");

		input.value = "1200px";
		input.dispatchEvent(new Event("input", {bubbles: true}));
		expect(error.hidden).toBe(false);
		expect(input.getAttribute("aria-invalid")).toBe("true");

		input.value = "80%";
		input.dispatchEvent(new Event("input", {bubbles: true}));
		expect(error.hidden).toBe(true);
		expect(settings.storedOptions("live")).toBeUndefined();
	});

	test("機能が用意した案内があれば、不正な値のときに表示する", async () => {
		const root = await openPanel([defineFeature({
			...metadata,
			id: "messaged",
			title: "wideLayout.title",
			options: {
				range: option.text("20", "ratingGraph.recentRange", {invalidMessage: "ratingGraph.recentRangeInvalid"}),
			},
			live: true,
			start: () => () => {
			},
		})]);
		expect(query<HTMLElement>(root, ".field-error").textContent).toBe(translate("ratingGraph.recentRangeInvalid"));
	});

	test("初期化すると入力欄も既定値に戻る", async () => {
		const confirmMock = mock(() => true);
		const originalConfirm = window.confirm;
		window.confirm = confirmMock;
		try {
			const root = await openPanel([liveFeature]);
			settings.setOption("live", "width", "80%");
			const resetButton = [...root.querySelectorAll("button")]
				.find((button) => button.textContent === translate("settings.reset"));
			resetButton?.click();

			expect(confirmMock).toHaveBeenCalledTimes(1);
			expect(query<HTMLInputElement>(root, ".feature-fields input").value).toBe("50%");
		} finally {
			window.confirm = originalConfirm;
		}
	});
});

describe("サイトごとの設定画面", () => {
	const sites = [{id: "atcoder", name: "AtCoder"}, {id: "codeforces", name: "Codeforces"}, {id: "paiza", name: "paiza"}];
	const both = defineFeature({
		...metadata,
		id: "both",
		title: "keyboardShortcuts.title",
		routes: ["atcoder:page", "codeforces:page"],
		options: {
			key: option.text("Ctrl+I", "keyboardShortcuts.openSettings"),
			editorial: onSites(option.text("Ctrl+E", "keyboardShortcuts.openEditorial"), ["atcoder"]),
			url: sharedAcrossSites(option.text("http://localhost:8080", "localRunner.url")),
		},
		live: true,
		start: () => () => {
		},
	});

	beforeEach(() => {
		document.body.replaceChildren();
	});

	async function open(): Promise<{root: ShadowRoot; settings: SettingsService}> {
		const settings = new SettingsService(new MemoryStore());
		const features = [both, liveFeature];
		const runtime = new FeatureRuntime({
			features,
			page: matchPage(judges, "https://atcoder.jp/home"),
			lifecycle: immediateLifecycle,
			settings: settings.forSite("atcoder"),
			services: createFakeServices(),
			logger: new RecordingLogger(),
		});
		runtime.start();
		await runtime.settled();
		createSettingsPanel({features, settings, sites, currentSite: "atcoder", runtime, translate, updates: createFakeUpdates()}).open();
		const root = document.body.lastElementChild?.shadowRoot;
		if (!root) throw new Error("設定画面が表示されていません");
		return {root, settings};
	}

	const titles = (root: ShadowRoot) => [...root.querySelectorAll(".feature-title")].map(({textContent}) => textContent);
	const labels = (root: ShadowRoot) => [...root.querySelectorAll(".feature-fields label")].map((label) => label.textContent);
	const tab = (root: ShadowRoot, name: string) => [...root.querySelectorAll<HTMLButtonElement>(".site-tabs button")].find(({textContent}) => textContent === name);

	test("表示中のサイトを選んで開き、機能が動くサイトのタブだけを出す", async () => {
		const {root} = await open();
		expect([...root.querySelectorAll(".site-tabs button")].map(({textContent}) => textContent)).toEqual(["AtCoder", "Codeforces"]);
		expect(tab(root, "AtCoder")?.getAttribute("aria-selected")).toBe("true");
		expect(titles(root)).toEqual([translate("keyboardShortcuts.title"), translate("wideLayout.title")]);
	});

	test("ほかのサイトでは、そのサイトで動く機能と項目だけを出し、動作の状態は出さない", async () => {
		const {root} = await open();
		expect(labels(root).some((label) => label?.includes(translate("keyboardShortcuts.openEditorial")))).toBe(true);
		tab(root, "Codeforces")?.click();
		expect(titles(root)).toEqual([translate("keyboardShortcuts.title")]);
		expect(labels(root).some((label) => label?.includes(translate("keyboardShortcuts.openEditorial")))).toBe(false);
		expect(root.querySelector<HTMLElement>(".status")?.hidden).toBe(true);
	});

	test("バックアップの操作は機能の一覧の一番下に置き、下の欄には再読み込みのボタンを置く", async () => {
		const {root} = await open();
		const last = [...root.querySelectorAll(".category")].at(-1);
		expect(last?.querySelector("h3")?.textContent).toBe(translate("settings.backup"));
		expect([...last!.querySelectorAll("button")].map(({textContent}) => textContent))
			.toEqual([translate("settings.export"), translate("settings.import"), translate("settings.reset")]);
		tab(root, "Codeforces")?.click();
		expect([...root.querySelectorAll(".category")].at(-1)?.querySelector("h3")?.textContent).toBe(translate("settings.backup"));
		expect([...root.querySelectorAll(".modal-footer button, footer button")].some(({textContent}) => textContent === translate("settings.reload"))).toBe(true);
	});

	test("値と ON/OFF はサイトごとに保存し、共通の項目は全サイトに保存する", async () => {
		const {root, settings} = await open();
		tab(root, "Codeforces")?.click();
		const [key, url] = [...root.querySelectorAll<HTMLInputElement>(".feature-fields input")];
		key!.value = "Alt+S";
		key!.dispatchEvent(new Event("change", {bubbles: true}));
		url!.value = "http://localhost:9000";
		url!.dispatchEvent(new Event("change", {bubbles: true}));
		const toggle = root.querySelector<HTMLInputElement>("input[role=switch]")!;
		toggle.checked = false;
		toggle.dispatchEvent(new Event("change", {bubbles: true}));

		expect(settings.forSite("codeforces").storedOptions("both")).toEqual({key: "Alt+S", url: "http://localhost:9000"});
		expect(settings.forSite("codeforces").isEnabled("both", true)).toBe(false);
		expect(settings.forSite("atcoder").storedOptions("both")).toEqual({url: "http://localhost:9000"});
		expect(settings.forSite("atcoder").isEnabled("both", true)).toBe(true);
	});
});

describe("addNavigationEntry", () => {
	beforeEach(() => {
		document.body.innerHTML = '<ul class="first"></ul><ul class="second"></ul>';
	});

	test("最初に見つかったメニューにリンクを追加する", () => {
		const onOpen = mock(() => {
		});
		addNavigationEntry([".missing", ".second", ".first"], "CP Toolkit", onOpen);

		const link = document.querySelector<HTMLAnchorElement>(".second a");
		expect(link?.textContent).toBe("CP Toolkit");
		expect(link?.querySelector(".cp-settings-entry")).not.toBeNull();
		expect(document.querySelector(".first a")).toBeNull();
		link?.click();
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	test("メニューが見つからなければ何もしない", () => {
		addNavigationEntry([".missing"], "CP Toolkit", () => {
		});
		expect(document.querySelector("a")).toBeNull();
	});
});
