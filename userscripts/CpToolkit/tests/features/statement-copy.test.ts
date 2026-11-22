import {describe, expect, mock, test} from "bun:test";
import {TurndownStatementConverter} from "@adapters/statement/statement-converter";
import type {Feature} from "@application/feature/definition";
import {statementCopy} from "@features/statement-copy/index";
import {createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("statementCopy", () => {
	function renderStatement(): void {
		document.body.innerHTML = `
			<h2 class="h2">A - Sample</h2>
			<div id="task-statement">
				<span class="lang-ja">
					<div class="part"><section><h3>問題文</h3><p><var>N</var> を出力してください。</p><ul><li>a</li></ul></section></div>
					<div class="part"><section><h3>入力例 1</h3><pre>1</pre></section></div>
				</span>
			</div>`;
	}

	const clipboard = () => {
		const write = mock((_text: string) => undefined);
		return {write};
	};

	test("Markdown で全体をコピーし、サンプルを含めない", async () => {
		renderStatement();
		const target = clipboard();
		await run(statementCopy, undefined, {clipboard: target, statementConverter: new TurndownStatementConverter()});
		document.querySelector<HTMLElement>(".pull-right button")?.click();

		const text = target.write.mock.calls[0]?.[0] ?? "";
		expect(text).toStartWith("# A - Sample");
		expect(text).toContain("### 問題文");
		expect(text).toContain("$N$");
		expect(text).toContain("- a");
		expect(text).not.toContain("入力例");
	});

	test("英語の問題文でも、サンプルを含めずにコピーする", async () => {
		document.body.innerHTML = `
			<h2 class="h2">A - Sample</h2>
			<div id="task-statement">
				<span class="lang-en">
					<div class="part"><section><h3>Problem Statement</h3><p>Print <var>N</var>.</p></section></div>
					<div class="part"><section><h3>Sample Input 1</h3><pre>1</pre></section></div>
				</span>
			</div>`;
		const target = clipboard();
		await run(statementCopy, undefined, {clipboard: target, statementConverter: new TurndownStatementConverter()});
		document.querySelector<HTMLElement>(".pull-right button")?.click();

		const text = target.write.mock.calls[0]?.[0] ?? "";
		expect(text).toContain("### Problem Statement");
		expect(text).not.toContain("Sample Input");
	});

	test("プレーンテキストでもコピーできる", async () => {
		renderStatement();
		const target = clipboard();
		await run(statementCopy, {format: "plain"}, {
			clipboard: target,
			statementConverter: new TurndownStatementConverter(),
		});
		document.querySelector<HTMLElement>("h3 button")?.click();

		const text = target.write.mock.calls[0]?.[0] ?? "";
		expect(text).toContain("【問題文】");
		expect(text).toContain("$N$ を出力してください。");
		expect(text).toContain("- a");
	});

	test("サンプルの見出しにはボタンを追加せず、後始末で取り除く", async () => {
		renderStatement();
		const dispose = await run(statementCopy, undefined, {
			clipboard: clipboard(),
			statementConverter: new TurndownStatementConverter(),
		});
		expect(document.querySelectorAll("h3 button")).toHaveLength(1);
		dispose?.();
		expect(document.querySelectorAll("button")).toHaveLength(0);
	});
});
