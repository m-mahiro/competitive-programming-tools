import {beforeEach, describe, expect, test} from "bun:test";
import type {Feature, FeatureServices} from "@application/feature/definition";
import type {ContestPeriod} from "@application/ports/page-bridge";
import type {Notification} from "@application/ports/services";
import {clarNotifier} from "@features/clar-notifier/index";
import {createFakePage, createFakeServices, FakeHttpClient, FakeTicker, MemoryStore} from "../support/fakes";

const HOUR_MS = 60 * 60 * 1000;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const run = (feature: Feature, overrides: Partial<FeatureServices> = {}, options?: unknown) => {
	return feature.run(options, createFakeServices(overrides));
};

function recordNotifications(): {notifier: FeatureServices["notifier"]; sent: Notification[]} {
	const sent: Notification[] = [];
	return {notifier: {notify: (notification) => sent.push(notification)}, sent};
}

function setFocus(focused: boolean): void {
	document.hasFocus = () => focused;
}

beforeEach(() => {
	setFocus(false);
});

describe("clarNotifier", () => {
	function openContest(period: ContestPeriod, counts: readonly string[] = []) {
		history.replaceState(null, "", "/contests/abc1/tasks");
		document.body.innerHTML = '<a class="contest-title">ABC 1</a><span id="clar-badge"></span>';
		let now = period.startMs + HOUR_MS / 2;
		let index = 0;
		const {notifier, sent} = recordNotifications();
		const site = new FakeHttpClient(() => ({status: 200, text: counts[index++] ?? "0"}));
		const ticker = new FakeTicker();
		const page = createFakePage({contestPeriod: () => period, serverNow: () => now});
		const services = {notifier, page, site, ticker, state: new MemoryStore()};
		return {services, sent, site, ticker, setNow: (time: number) => void (now = time)};
	}

	const contest = {startMs: 100 * HOUR_MS, endMs: 102 * HOUR_MS};

	test("件数が増えたときだけ通知する", async () => {
		const {services, sent, site, ticker, setNow} = openContest(contest, ["1", "1", "3"]);
		await run(clarNotifier, services);

		for (const minutes of [30, 31, 32]) {
			setNow(contest.startMs + minutes * 60 * 1000);
			ticker.tick();
			await flush();
		}

		expect(site.requests).toHaveLength(3);
		expect(site.requests[0]?.url).toContain("/contests/abc1/clarifications/count?t=");
		expect(sent.map(({title}) => title)).toEqual(["新しい Clar が 1 件あります", "新しい Clar が 2 件あります"]);
		expect(sent[0]).toMatchObject({
			text: "ABC 1",
			url: "https://atcoder.jp/contests/abc1/clarifications",
			tag: "clar-notifier:abc1:1",
		});
		expect(sent[1]?.tag).toBe("clar-notifier:abc1:3");
	});

	test("確認は1分に1回までにする", async () => {
		const {services, site, ticker} = openContest(contest);
		await run(clarNotifier, services);
		ticker.tick();
		ticker.tick();
		await flush();
		expect(site.requests).toHaveLength(1);
	});

	test("開始直後は確認せず、終了したら止める", async () => {
		const {services, site, ticker, setNow} = openContest(contest);
		await run(clarNotifier, services);

		setNow(contest.startMs + 60 * 1000);
		ticker.tick();
		await flush();
		expect(site.requests).toHaveLength(0);

		setNow(contest.endMs);
		ticker.tick();
		expect(ticker.listeners.size).toBe(0);
	});

	test("終了したコンテストでは時計を動かさない", async () => {
		const {services, ticker, setNow} = openContest(contest);
		setNow(contest.endMs + HOUR_MS);
		await run(clarNotifier, services);
		expect(ticker.listeners.size).toBe(0);
	});

	test("常設のコンテストでは確認しない", async () => {
		const {services, ticker} = openContest({startMs: 0, endMs: 24 * 365 * HOUR_MS});
		await run(clarNotifier, services);
		expect(ticker.listeners.size).toBe(0);
	});
});
