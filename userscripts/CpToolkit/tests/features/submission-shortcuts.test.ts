import {describe, expect, mock, test} from "bun:test";
import {TurndownStatementConverter} from "@adapters/statement/statement-converter";
import type {Feature} from "@application/feature/definition";
import {statementCopy} from "@features/statement-copy/index";
import {submissionShortcuts} from "@features/submission-shortcuts/index";
import {createFakePage, createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("submissionShortcuts", () => {
	const renderTitle = (): void => {
		history.replaceState(null, "", "/contests/abc420/tasks/abc420_a");
		document.body.innerHTML = '<span class="h2">A - Sample<a class="btn btn-default btn-sm">解説</a></span>';
	};

	test("AC 提出へのボタンであることが分かるようにまとめて表示する", async () => {
		renderTitle();
		await run(submissionShortcuts, {language: "Java"}, {page: createFakePage()});
		const control = document.querySelector(".cp-title-control");
		expect(control?.firstElementChild?.textContent).toBe("AC 提出:");
		const links = [...(control?.querySelectorAll<HTMLAnchorElement>(".btn-group a") ?? [])];
		expect(links.map(({textContent}) => textContent)).toEqual(["実行時間", "コード長", "提出時間", "メモリ"]);
		expect(links[0]?.getAttribute("href")).toContain("orderBy=time_consumption");
		expect(links[0]?.getAttribute("href")).toContain("f.LanguageName=Java");
		expect(links[1]?.getAttribute("href")).toContain("orderBy=source_length");
		expect(links[1]?.getAttribute("href")).toContain("f.Task=abc420_a");
		expect(links[2]?.getAttribute("href")).toContain("orderBy=created");
		expect(links[3]?.getAttribute("href")).toContain("orderBy=memory_consumption");
	});

	test("詳細設定で選んだボタンだけを出し、1つもなければ何も出さない", async () => {
		renderTitle();
		await run(submissionShortcuts, {
			byTime: false,
			byLength: true,
			byCreated: false,
			byMemory: true
		}, {page: createFakePage()});
		const links = [...document.querySelectorAll(".cp-title-control .btn-group a")];
		expect(links.map(({textContent}) => textContent)).toEqual(["コード長", "メモリ"]);

		renderTitle();
		await run(submissionShortcuts, {
			byTime: false,
			byLength: false,
			byCreated: false,
			byMemory: false
		}, {page: createFakePage()});
		expect(document.querySelector(".cp-title-control")).toBeNull();
	});

	test("コンテスト中は出さない", async () => {
		renderTitle();
		const period = {startMs: Date.now() - 60_000, endMs: Date.now() + 60_000};
		await run(submissionShortcuts, undefined, {page: createFakePage({contestPeriod: () => period})});
		expect(document.querySelector(".cp-title-control")).toBeNull();
	});

	test("後始末で取り除く", async () => {
		renderTitle();
		const dispose = await run(submissionShortcuts, undefined, {page: createFakePage()});
		dispose?.();
		expect(document.querySelector(".cp-title-control")).toBeNull();
	});

	test("すべてコピーの見出しに含めない", async () => {
		renderTitle();
		document.body.insertAdjacentHTML("beforeend", '<div id="task-statement"></div>');
		const write = mock((_text: string) => undefined);
		await run(submissionShortcuts, undefined, {page: createFakePage()});
		await run(statementCopy, undefined, {clipboard: {write}, statementConverter: new TurndownStatementConverter()});
		document.querySelector<HTMLElement>(".pull-right button")?.click();
		expect(write.mock.calls[0]?.[0]).toStartWith("# A - Sample\n");
	});
});
