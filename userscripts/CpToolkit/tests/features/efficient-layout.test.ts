import {describe, expect, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import {efficientLayout} from "@features/efficient-layout/index";
import {createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("efficientLayout", () => {
	test("サンプルを2個ずつ横に並べ、入出力形式を折りたためるようにする", async () => {
		document.body.innerHTML = `<span class="lang">
			<div class="io-style"><div class="part">入力</div><div class="part">出力</div></div>
			<hr>
			<div class="part"><h3>入力例 1</h3></div><div class="part"><h3>出力例 1</h3></div>
		</span>`;
		await run(efficientLayout);

		expect(document.querySelector(".cp-samples-row")?.children).toHaveLength(1);
		expect(document.querySelector(".cp-samples-row > div")?.children).toHaveLength(2);
		expect(document.querySelector("details > .io-style")).not.toBeNull();
		expect(document.querySelector("hr")).toBeNull();
	});

	test("日英併記の問題文では、言語ごとにサンプルを並べる", async () => {
		const language = (name: string, input: string, output: string) => `<span class="lang-${name}">
			<div class="io-style"><div class="part">I</div></div>
			<div class="part"><h3>${input} 1</h3></div><div class="part"><h3>${output} 1</h3></div>
		</span>`;
		document.body.innerHTML = `<span class="lang">${language("ja", "入力例", "出力例")}${language("en", "Sample Input", "Sample Output")}</span>`;
		await run(efficientLayout);

		for (const name of ["ja", "en"]) {
			expect(document.querySelectorAll(`.lang-${name} .cp-samples-row > div`)).toHaveLength(1);
			expect(document.querySelector(`.lang-${name} .cp-samples-row > div`)?.children).toHaveLength(2);
		}
	});

	test("部分点はサンプルに含めず、入力例と出力例の組を保つ", async () => {
		document.body.innerHTML = `<span class="lang">
			<div class="io-style"><div class="part">入力</div></div>
			<div class="part" id="partial"><h3>部分点</h3></div>
			<div class="part"><h3>入力例 1</h3></div><div class="part"><h3>出力例 1</h3></div>
			<div class="part"><h3>入力例 2</h3></div><div class="part"><h3>出力例 2</h3></div>
		</span>`;
		await run(efficientLayout);

		expect(document.querySelector(".cp-samples-row")?.children).toHaveLength(2);
		expect(document.querySelector(".cp-samples-row > div")?.children).toHaveLength(2);
		expect(document.querySelector("#partial")?.closest(".cp-samples-row")).toBeNull();
		expect(document.querySelector("#partial")?.parentElement?.className).toBe("lang");
	});

	test("KaTeX の絶対配置の要素が外へ漏れないように、サンプルの枠を基準にする", async () => {
		document.body.innerHTML = `<span class="lang">
			<div class="io-style"><div class="part">入力</div></div>
			<div class="part"><h3>入力例 1</h3></div><div class="part"><h3>出力例 1</h3></div>
		</span>`;
		await run(efficientLayout);

		const container = document.querySelector(".cp-samples-container");
		expect(container && getComputedStyle(container).position).toBe("relative");
	});

	const twoSamples = `<span class="lang">
		<div class="io-style"><div class="part">入力</div></div>
		<div class="part"><h3>入力例 1</h3></div><div class="part"><h3>出力例 1</h3></div>
		<div class="part"><h3>入力例 2</h3></div><div class="part"><h3>出力例 2</h3></div>
	</span>`;

	test("既定は自動で、行の幅を指定しない", async () => {
		document.body.innerHTML = twoSamples;
		await run(efficientLayout);

		const row = document.querySelector<HTMLElement>(".cp-samples-row");
		expect(row?.dataset.width).toBe("auto");
		expect(row?.style.width).toBe("");
	});

	test("固定のときは組数に応じて行の幅を決める", async () => {
		document.body.innerHTML = twoSamples;
		await run(efficientLayout, {widthMode: "fixed"});

		const row = document.querySelector<HTMLElement>(".cp-samples-row");
		expect(row?.dataset.width).toBe("fixed");
		expect(row?.style.width).toBe("calc(var(--cp-sample-width) * 2)");
	});
});
