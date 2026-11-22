import {beforeEach, describe, expect, test} from "bun:test";
import type {Feature, FeatureServices} from "@application/feature/definition";
import {variableHover} from "@features/variable-hover/index";
import {createFakeServices} from "../support/fakes";

const run = (feature: Feature, overrides: Partial<FeatureServices> = {}, options?: unknown) => {
	return feature.run(options, createFakeServices(overrides));
};

function setFocus(focused: boolean): void {
	document.hasFocus = () => focused;
}

beforeEach(() => {
	setFocus(false);
});

describe("variableHover", () => {
	const symbol = (text: string) => `<span class="mord mathnormal">${text}</span>`;
	const highlighted = () => [...document.querySelectorAll(".cp-variable")].map((element) => element.textContent);
	const fire = (index: number, type: string) => {
		document.querySelectorAll(".mathnormal")[index]?.dispatchEvent(new MouseEvent(type, {bubbles: true}));
	};

	beforeEach(() => {
		document.body.innerHTML = `<div id="task-statement">
			<span class="katex"><span class="katex-html">${symbol("N")}${symbol("M")}</span></span>
			<span class="katex"><span class="katex-html">${symbol("N")}</span></span>
		</div>`;
	});

	test("同じ変数をすべて強調し、離れると消す", async () => {
		await run(variableHover);
		fire(0, "mouseover");
		expect(highlighted()).toEqual(["N", "N"]);
		fire(0, "mouseout");
		expect(highlighted()).toEqual([]);
	});

	test("クリックで固定し、Esc で解除する", async () => {
		await run(variableHover);
		fire(0, "click");
		fire(0, "mouseout");
		fire(1, "mouseover");
		expect(highlighted()).toEqual(["N", "N"]);
		expect(document.querySelectorAll(".cp-variable-pinned")).toHaveLength(2);

		document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
		expect(highlighted()).toEqual([]);
	});

	test("無効にすると強調を消す", async () => {
		const dispose = await run(variableHover);
		fire(0, "click");
		dispose?.();
		expect(highlighted()).toEqual([]);
		fire(0, "mouseover");
		expect(highlighted()).toEqual([]);
	});

	test("問題の一括表示では、どの問題文でも、その問題の中だけを強調する", async () => {
		// 一括表示のページには、問題ごとに同じ ID の問題文がある
		const statement = (...symbols: string[]) => `<div id="task-statement">
			<span class="katex"><span class="katex-html">${symbols.map(symbol).join("")}</span></span>
		</div>`;
		document.body.innerHTML = statement("N", "M") + statement("N", "K", "N");
		const inStatement = (index: number) => {
			return [...(document.querySelectorAll("#task-statement")[index]?.querySelectorAll(".cp-variable") ?? [])]
				.map((element) => element.textContent);
		};
		const dispose = await run(variableHover);

		fire(2, "mouseover");
		expect(inStatement(0)).toEqual([]);
		expect(inStatement(1)).toEqual(["N", "N"]);
		fire(2, "mouseout");

		fire(3, "click");
		fire(0, "mouseover");
		expect(inStatement(0)).toEqual(["N"]);
		expect(inStatement(1)).toEqual(["K"]);

		document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
		fire(0, "mouseout");
		expect(highlighted()).toEqual([]);
		dispose?.();
	});

	describe("数値", () => {
		const digit = (text: string, id = "") => `<span class="mord"${id && ` id="${id}"`}>${text}</span>`;
		// KaTeX は数字を1文字ずつ描き、「10^5」は「1」と、指数を包む要素の中の「0」に分けて描く
		const power = (id = "", exponentId = "") => `${digit("1", id)}<span class="mord">${digit("0")}`
			+ `<span class="msupsub">${digit("5", exponentId)}</span></span>`;
		const katex = (html: string) => `<span class="katex"><span class="katex-html">${html}</span></span>`;
		const hover = (id: string) => {
			document.querySelector(`#${id}`)?.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
		};

		beforeEach(() => {
			document.body.innerHTML = `<div id="task-statement">
				${katex(`${symbol("N")}${power("power", "exponent")}`)}
				${katex(`${digit("3")}<span class="mbin">×</span>${power()}`)}
				${katex(`${digit("1", "ten")}${digit("0")}`)}
				${katex(`${digit("2")}${digit(".")}${digit("5", "decimal")}`)}
				${katex(`${digit("0", "zero")}<span class="mpunct">,</span>${digit("5")}`)}
			</div>`;
		});

		test("1文字ずつ描かれた数字を1つの数値として強調する", async () => {
			await run(variableHover);
			hover("ten");
			expect(highlighted()).toEqual(["1", "0"]);
			hover("decimal");
			expect(highlighted()).toEqual(["2", ".", "5"]);
		});

		test("指数の付く数値は指数までを1つの数値とする", async () => {
			await run(variableHover);
			hover("power");
			expect(highlighted()).toEqual(["1", "05", "1", "05"]);
			hover("exponent");
			expect(highlighted()).toEqual(["1", "05", "1", "05"]);
			hover("zero");
			expect(highlighted()).toEqual(["0"]);
		});

		test("詳細設定で数値をオフにできる", async () => {
			await run(variableHover, {}, {variables: true, numbers: false});
			hover("zero");
			expect(highlighted()).toEqual([]);
			fire(0, "mouseover");
			expect(highlighted()).toEqual(["N"]);
		});

		test("詳細設定で変数をオフにできる", async () => {
			await run(variableHover, {}, {variables: false, numbers: true});
			fire(0, "mouseover");
			expect(highlighted()).toEqual([]);
			hover("zero");
			expect(highlighted()).toEqual(["0"]);
		});
	});
});
