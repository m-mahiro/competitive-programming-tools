import {describe, expect, test} from "bun:test";
import {TurndownStatementConverter} from "@adapters/statement/statement-converter";

describe("問題文の変換", () => {
	const katex = (tex: string) => {
		const mathml = `<span class="katex-mathml"><math><annotation encoding="application/x-tex">${tex}</annotation></math></span>`;
		return `<span class="katex">${mathml}<span class="katex-html" aria-hidden="true">描画結果</span></span>`;
	};
	const html = `<div><p>長さ <var>${katex("N")}</var> の数列と ${katex("M")} について</p>
		<p><span class="katex-display">${katex("\\sum_{i=1}^N A_i")}</span></p></div>`;
	const statement = new DOMParser().parseFromString(html, "text/html").body.firstElementChild!;
	const converter = new TurndownStatementConverter();

	test("Markdown では別行立ての数式を $$ で囲み、描画結果を含めない", () => {
		const markdown = converter.toMarkdown(statement);
		expect(markdown).toContain("$N$");
		expect(markdown).toContain("$M$");
		expect(markdown).toContain("$$\n\\sum_{i=1}^N A_i\n$$");
		expect(markdown).not.toContain("描画結果");
	});

	test("テキストでも同じように変換する", () => {
		const text = converter.toPlainText(statement);
		expect(text).toContain("$N$");
		expect(text).toContain("$M$");
		expect(text).toContain("$$\n\\sum_{i=1}^N A_i\n$$");
		expect(text).not.toContain("描画結果");
	});
});
