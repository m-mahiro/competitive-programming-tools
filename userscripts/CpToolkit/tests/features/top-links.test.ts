import {describe, expect, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import {topLinks} from "@features/top-links/index";
import {createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("topLinks", () => {
	test("一覧をリンクに置き換える", async () => {
		document.body.innerHTML = '<div class="list-group contest-list"></div><div class="list-group contest-list"></div>';
		await run(topLinks);
		expect(document.querySelectorAll(".contest-list a")).toHaveLength(5);
		expect(document.querySelector(".contest-list a")?.getAttribute("href")).toBe("https://atcoder.jp/contests");
	});
});
