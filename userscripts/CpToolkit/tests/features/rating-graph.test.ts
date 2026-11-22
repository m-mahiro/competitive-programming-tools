import {describe, expect, mock, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import type {RatingGraphView} from "@application/ports/rating-graph";
import {ratingGraph} from "@features/rating-graph/index";
import {createFakeServices, FakeHttpClient} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("ratingGraph", () => {
	async function start(options?: unknown) {
		history.replaceState(null, "", "/users/tester");
		document.body.innerHTML = '<div class="btn-text-group"></div>';
		const draw = mock((_view: RatingGraphView) => undefined);
		await run(ratingGraph, options, {
			ratingGraph: {prepare: async () => true, draw},
			site: new FakeHttpClient(() => ({status: 200, text: "[]"})),
		});
		return draw;
	}

	test("指定した最近の範囲で描画する", async () => {
		const draw = await start({recentRange: "50%"});
		expect(draw).toHaveBeenLastCalledWith({showPerformance: true, recent: {unit: "percent", value: 50}});
	});

	test("既定では直近20回を表示する", async () => {
		const draw = await start();
		expect(draw).toHaveBeenLastCalledWith({showPerformance: true, recent: {unit: "count", value: 20}});
	});

	test("不正な保存値は既定の範囲に置き換える", async () => {
		const draw = await start({recentRange: "abc"});
		expect(draw).toHaveBeenLastCalledWith({showPerformance: true, recent: {unit: "count", value: 20}});
	});

	test("すべて表示に切り替えられる", async () => {
		const draw = await start({recentRange: "5"});
		[...document.querySelectorAll("button")].find(({textContent}) => textContent === "all")?.click();
		expect(draw).toHaveBeenLastCalledWith({showPerformance: true, recent: null});
	});
});
