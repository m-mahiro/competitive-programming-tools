import {beforeEach, describe, expect, test} from "bun:test";
import type {Feature, FeatureServices} from "@application/feature/definition";
import {contestCalendar} from "@features/contest-calendar/index";
import {createFakePage, createFakeServices} from "../support/fakes";

const run = (feature: Feature, overrides: Partial<FeatureServices> = {}, options?: unknown) => {
	return feature.run(options, createFakeServices(overrides));
};

function setFocus(focused: boolean): void {
	document.hasFocus = () => focused;
}

beforeEach(() => {
	setFocus(false);
});

describe("contestCalendar", () => {
	const period = {startMs: Date.UTC(2099, 0, 1, 12), endMs: Date.UTC(2099, 0, 1, 14)};

	beforeEach(() => {
		document.body.innerHTML = `<a class="contest-title" href="https://atcoder.jp/contests/abc1">ABC 1</a>
			<small class="contest-duration">Contest Duration</small>`;
	});

	test("開催前のコンテストに登録のリンクを追加する", async () => {
		const dispose = await run(contestCalendar, {page: createFakePage({contestPeriod: () => period})});
		const link = document.querySelector<HTMLAnchorElement>(".contest-duration a");
		expect(link?.classList.contains("btn")).toBe(true);
		const query = new URL(link?.href ?? "").searchParams;
		expect(query.get("text")).toBe("ABC 1");
		expect(query.get("dates")).toBe("20990101T120000Z/20990101T140000Z");
		expect(query.get("location")).toBe("https://atcoder.jp/contests/abc1");

		dispose?.();
		expect(document.querySelector(".contest-duration a")).toBeNull();
	});

	test("終了したコンテストには追加しない", async () => {
		const page = createFakePage({contestPeriod: () => period, serverNow: () => period.endMs});
		await run(contestCalendar, {page});
		expect(document.querySelector(".contest-duration a")).toBeNull();
	});
});
