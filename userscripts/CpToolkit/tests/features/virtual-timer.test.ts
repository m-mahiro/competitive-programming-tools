import {beforeEach, describe, expect, test} from "bun:test";
import type {Feature, FeatureServices} from "@application/feature/definition";
import {virtualTimer} from "@features/virtual-timer/index";
import {createFakePage, createFakeServices, MemoryStore} from "../support/fakes";

const HOUR_MS = 60 * 60 * 1000;

const run = (feature: Feature, overrides: Partial<FeatureServices> = {}, options?: unknown) => {
	return feature.run(options, createFakeServices(overrides));
};

function setFocus(focused: boolean): void {
	document.hasFocus = () => focused;
}

beforeEach(() => {
	setFocus(false);
});

describe("virtualTimer", () => {
	const period = {startMs: 0, endMs: 2 * HOUR_MS};

	function openContest(now: () => number, body = "") {
		history.replaceState(null, "", "/contests/abc1/virtual");
		document.body.innerHTML = `<div id="main-container">${body}</div><p id="fixed-server-timer">server</p>`;
		return createFakePage({contestPeriod: () => period, serverNow: now});
	}

	test("参加のページで開始時刻を記憶し、残り時間を表示する", async () => {
		const start = Date.parse("2026-11-01 21:00:00");
		const page = openContest(() => start + 30 * 60 * 1000, '<time class="fixtime-second">2026-11-01 21:00:00</time>');
		const state = new MemoryStore();
		const dispose = await run(virtualTimer, {isOnRoute: () => true, page, state});

		const timer = document.querySelector<HTMLElement>(".cp-virtual-timer");
		expect(timer?.textContent).toBe("残り時間01:30:00");
		expect(document.querySelector<HTMLElement>("#fixed-server-timer")?.style.display).toBe("none");

		timer?.click();
		expect(timer?.hidden).toBe(true);
		expect(document.querySelector<HTMLElement>("#fixed-server-timer")?.style.display).toBe("");

		dispose?.();
		expect(state.get("virtual-timer:starts")).toEqual({abc1: start});
		expect(document.querySelector(".cp-virtual-timer")).toBeNull();
	});

	test("記憶した開始時刻を他のページでも使い、開始前は開始までの時間を表示する", async () => {
		const state = new MemoryStore();
		state.set("virtual-timer:starts", {abc1: 10 * HOUR_MS});
		const page = openContest(() => 9 * HOUR_MS);
		const dispose = await run(virtualTimer, {isOnRoute: () => false, page, state});
		expect(document.querySelector(".cp-virtual-timer")?.textContent).toBe("開始まであと01:00:00");
		dispose?.();
	});

	test("終了した参加は忘れて、サイトの時計に戻す", async () => {
		const state = new MemoryStore();
		state.set("virtual-timer:starts", {abc1: 0});
		await run(virtualTimer, {isOnRoute: () => false, page: openContest(() => 3 * HOUR_MS), state});
		expect(document.querySelector(".cp-virtual-timer")).toBeNull();
		expect(state.get("virtual-timer:starts")).toEqual({});
	});

	test("登録を取り消すと参加のページを開いたときに忘れる", async () => {
		const state = new MemoryStore();
		state.set("virtual-timer:starts", {abc1: 0});
		await run(virtualTimer, {isOnRoute: () => true, page: openContest(() => 0), state});
		expect(document.querySelector(".cp-virtual-timer")).toBeNull();
		expect(state.get("virtual-timer:starts")).toEqual({});
	});

	test("参加していなければ何も表示しない", async () => {
		await run(virtualTimer, {isOnRoute: () => false, page: openContest(() => 0), state: new MemoryStore()});
		expect(document.querySelector(".cp-virtual-timer")).toBeNull();
	});
});
