import {beforeEach, describe, expect, test} from "bun:test";
import type {Feature, FeatureServices} from "@application/feature/definition";
import {latestContests} from "@features/latest-contests/index";
import {createFakeServices, FakeHttpClient, MemoryStore} from "../support/fakes";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const run = (feature: Feature, overrides: Partial<FeatureServices> = {}, options?: unknown) => {
	return feature.run(options, createFakeServices(overrides));
};

function setFocus(focused: boolean): void {
	document.hasFocus = () => focused;
}

beforeEach(() => {
	setFocus(false);
});

describe("latestContests", () => {
	const homePage = `<table><thead><tr class="active"><th>カテゴリ</th></tr></thead><tbody>
		<tr><th>ABC <span class="glyphicon"></span></th><td><time>11/7</time></td>
			<td><span title="Algorithm">Ⓐ</span><span class="user-blue">◉</span> <a href="/contests/abc2">AtCoder Beginner Contest 2</a><br></td></tr>
		<tr><th>ADT <span class="glyphicon"></span></th><td><time>11/2</time></td>
			<td><span title="Algorithm">Ⓐ</span><span class="">◉</span> <a href="/contests/adt_easy_1">EASY</a><br>
				<span title="Algorithm">Ⓐ</span><span class="">◉</span> <a href="/contests/adt_all_1">ALL</a><br></td></tr>
	</tbody></table>
	<table><tbody><tr><td><a href="/contests/abc1">AtCoder Beginner Contest 1</a></td></tr></tbody></table>`;
	const openMenu = async () => {
		document.querySelector(".cp-latest")?.dispatchEvent(new MouseEvent("mouseenter"));
		await flush();
		await flush();
	};
	const menuItems = () => [...document.querySelectorAll(".cp-latest-menu li")].map((item) => item.textContent);

	beforeEach(() => {
		document.body.innerHTML = '<div id="header"><ul class="header-sub_page"></ul></div>';
	});

	test("開くまで取得せず、開くと次のコンテストの表を並べる", async () => {
		const site = new FakeHttpClient(() => ({status: 200, text: homePage}));
		const dispose = await run(latestContests, {site, state: new MemoryStore()});
		expect(site.requests).toHaveLength(0);
		expect(menuItems()).toEqual(["読み込み中..."]);

		await openMenu();

		expect(site.requests.map(({url}) => url)).toEqual(["/home"]);
		expect(menuItems()).toEqual(["Ⓐ◉ AtCoder Beginner Contest 2", "Ⓐ◉ EASY", "Ⓐ◉ ALL"]);
		const mark = document.querySelector(".cp-latest-menu .user-blue");
		expect(mark?.textContent).toBe("◉");
		expect(mark?.previousElementSibling?.getAttribute("title")).toBe("Algorithm");
		const links = [...document.querySelectorAll(".cp-latest-menu a")];
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"/contests/abc2",
			"/contests/adt_easy_1",
			"/contests/adt_all_1",
		]);

		dispose?.();
		expect(document.querySelector(".cp-latest")).toBeNull();
	});

	test("取得できなければ知らせる", async () => {
		const site = new FakeHttpClient(() => ({status: 503, text: ""}));
		await run(latestContests, {site, state: new MemoryStore()});
		await openMenu();
		expect(menuItems()).toEqual(["取得できませんでした"]);
	});
});
