import {describe, expect, spyOn, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import {statementHighlight} from "@features/statement-highlight/index";
import {createFakeServices} from "../support/fakes";
import {wait} from "../support/dom";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("statementHighlight", () => {
	const renderStatement = (limits: string): void => {
		document.body.innerHTML = `
			<div id="main-container">
				<p>${limits}</p>
				<div id="task-statement">
					<section><h3>制約</h3><p>1 以上 100 以下</p></section>
					<section><h3>入力例 1</h3><p>42</p></section>
				</div>
			</div>`;
	};

	test("対象の見出しの数字と、よくある値と異なる制限を強調する", async () => {
		renderStatement("Time Limit: 3 sec / Memory Limit: 1024 MiB");
		const dispose = await run(statementHighlight);
		await wait(150);

		expect([...document.querySelectorAll(".cp-number")].map((element) => element.textContent)).toEqual(["1", "100"]);
		expect(document.querySelector(".cp-time-limit")?.textContent).toBe("3");
		expect(document.querySelector(".cp-memory-limit")).toBeNull();
		expect(document.querySelector("#main-container p")?.textContent).toBe("Time Limit: 3 sec / Memory Limit: 1024 MiB");
		dispose?.();
		expect(document.querySelector("style")).toBeNull();
	});

	test("英語の見出しでも、対象の数字を強調してサンプルは除く", async () => {
		document.body.innerHTML = `
			<div id="task-statement">
				<section><h3>Constraints</h3><p>1 to 100</p></section>
				<section><h3>Sample Input 1</h3><p>42</p></section>
			</div>`;
		const dispose = await run(statementHighlight);
		await wait(150);

		expect([...document.querySelectorAll(".cp-number")].map((element) => element.textContent)).toEqual(["1", "100"]);
		dispose?.();
	});

	test("設定すると 2 秒と 1024 MiB の制限も強調する", async () => {
		renderStatement("Time Limit: 2 sec / Memory Limit: 1024 MiB");
		const dispose = await run(statementHighlight, {alwaysEmphasizeLimits: true});
		await wait(150);

		expect(document.querySelector(".cp-time-limit")?.textContent).toBe("2");
		expect(document.querySelector(".cp-memory-limit")?.textContent).toBe("1024");
		dispose?.();
	});

	test("自分が加えた変更では走査をやり直さず、問題文の変更には追従する", async () => {
		renderStatement("Time Limit: 3 sec / Memory Limit: 1024 MiB");
		const createTreeWalker = spyOn(document, "createTreeWalker");
		try {
			const dispose = await run(statementHighlight);
			await wait(150);
			const scans = createTreeWalker.mock.calls.length;
			expect(scans).toBeGreaterThan(0);

			await wait(250);
			expect(createTreeWalker.mock.calls.length).toBe(scans);

			document.querySelector("#task-statement section p")?.append(" 合計 7 個");
			await wait(250);
			expect([...document.querySelectorAll(".cp-number")].map((element) => element.textContent)).toEqual(["1", "100", "7"]);
			dispose?.();
		} finally {
			createTreeWalker.mockRestore();
		}
	});

	test("設定した色を反映する", async () => {
		document.body.innerHTML = '<div id="task-statement"></div>';
		const dispose = await run(statementHighlight, {numberColor: "#112233"});
		expect(document.querySelector("style")?.textContent).toContain("--cp-number-color: #112233;");
		dispose?.();
	});
});
