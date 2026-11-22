import {describe, expect, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import {tessokuDifficulty} from "@features/tessoku-difficulty/index";
import {createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("tessokuDifficulty", () => {
	const page = (rows: string) => `<div id="main-container"><div class="row"><div></div><div>
		<h2>問題</h2><div><table><tbody>${rows}</tbody></table></div>
	</div></div></div>`;

	test("難易度を表示し、並べ替えられる", async () => {
		document.body.innerHTML = page(`
			<tr><td>A08</td><td><a href="#">二次元累積和</a></td></tr>
			<tr><td>A01</td><td><a href="#">正方形</a></td></tr>
			<tr><td>A47</td><td><a href="#">表にない問題</a></td></tr>`);
		await run(tessokuDifficulty);

		const links = () => [...document.querySelectorAll("tbody a")].map((link) => link.textContent);
		expect(links()).toEqual(["【☆4】 二次元累積和", "【☆1】 正方形", "表にない問題"]);

		document.querySelector("button")?.click();
		expect(links()[0]).toBe("【☆1】 正方形");
		document.querySelector("button")?.click();
		expect(links()[0]).toBe("【☆1】 正方形");
		expect(links()[1]).toBe("【☆4】 二次元累積和");
	});
});
