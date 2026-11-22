import {beforeEach, describe, expect, test} from "bun:test";
import type {Feature, FeatureServices} from "@application/feature/definition";
import type {HttpRequest, Notification} from "@application/ports/services";
import {resultNotifier} from "@features/result-notifier/index";
import {createFakeServices, FakeHttpClient, FakeTicker, MemoryStore} from "../support/fakes";

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

describe("resultNotifier", () => {
	const submissionTable = (status: string) => `<div class="table-responsive"><table><tbody><tr>
		<td>2026-11-01</td><td>A - Sum</td><td><span class="label">${status}</span></td>
		<td><a href="/contests/abc1/submissions/123">Detail</a></td>
	</tr></tbody></table></div>`;
	const statusJson = (status: string, extra: object = {}) => JSON.stringify({
		Result: {123: {Html: `<td><span class="label">${status}</span></td><td>12 ms</td>`}},
		...extra,
	});

	function openSubmissions(respond: (request: HttpRequest) => string) {
		history.replaceState(null, "", "/contests/abc1/submissions/me");
		document.body.innerHTML = submissionTable("WJ");
		const {notifier, sent} = recordNotifications();
		const site = new FakeHttpClient((request) => ({status: 200, text: respond(request)}));
		const ticker = new FakeTicker();
		const state = new MemoryStore();
		const services = {
			isOnRoute: (route: string) => route === "atcoder:submissions",
			notifier,
			site,
			state,
			ticker,
		};
		return {services, sent, site, state, ticker};
	}

	test("提出一覧を開いたらすぐ確認し、離席中はデスクトップへ通知する", async () => {
		const {services, sent, site} = openSubmissions(() => statusJson("AC"));
		await run(resultNotifier, services);
		await flush();

		expect(site.requests).toHaveLength(1);
		expect(site.requests[0]?.url).toContain("sids%5B%5D=123");
		expect(sent).toEqual([{
			title: "AC: A - Sum",
			text: "12 ms",
			url: "https://atcoder.jp/contests/abc1/submissions/123",
			tag: "result-notifier:123",
		}]);
	});

	test("AtCoder を操作中は画面の内側だけに通知する", async () => {
		setFocus(true);
		const {services, sent} = openSubmissions(() => statusJson("WA"));
		await run(resultNotifier, services);
		await flush();

		expect(sent).toHaveLength(0);
		expect(document.body.lastElementChild?.shadowRoot?.textContent).toContain("WA: A - Sum");
	});

	test("デスクトップ通知を切れる", async () => {
		const {services, sent} = openSubmissions(() => statusJson("AC"));
		await run(resultNotifier, services, {desktop: false});
		await flush();
		expect(sent).toHaveLength(0);
	});

	test("判定中はサイトが勧める間隔に従い、確定すると時計を止める", async () => {
		let status = "3/7";
		const {services, sent, site, ticker} = openSubmissions(() => statusJson(status, {Interval: 60_000}));
		await run(resultNotifier, services);
		await flush();
		ticker.tick();
		await flush();
		expect(site.requests).toHaveLength(1);
		expect(ticker.listeners.size).toBe(1);

		services.state.set("result-notifier:nextPoll", 0);
		status = "AC";
		ticker.tick();
		await flush();
		expect(sent).toHaveLength(1);
		ticker.tick();
		expect(ticker.listeners.size).toBe(0);
	});

	test("確認に失敗すると、失敗が続くほど間隔を広げる", async () => {
		const {services, site, state, ticker} = openSubmissions(() => "");
		const nextPoll = () => Number(state.get("result-notifier:nextPoll")) - Date.now();
		await run(resultNotifier, services);
		await flush();
		expect(site.requests).toHaveLength(1);
		const first = nextPoll();
		expect(first).toBeGreaterThan(4000);
		expect(first).toBeLessThanOrEqual(5000);

		ticker.tick();
		await flush();
		expect(site.requests).toHaveLength(1);

		state.set("result-notifier:nextPoll", 0);
		ticker.tick();
		await flush();
		expect(nextPoll()).toBeGreaterThan(9000);
	});

	test("ログインが切れてログインのページが返っても、1秒ごとに確認し続けない", async () => {
		const {services, state} = openSubmissions(() => "<html><body>login</body></html>");
		await run(resultNotifier, services);
		await flush();
		expect(Number(state.get("result-notifier:nextPoll")) - Date.now()).toBeGreaterThan(4000);
	});

	test("通信のエラーでも間隔を広げる", async () => {
		const context = openSubmissions(() => {
			throw new Error("network");
		});
		await run(resultNotifier, context.services);
		await flush();
		expect(Number(context.state.get("result-notifier:nextPoll")) - Date.now()).toBeGreaterThan(4000);
	});

	test("他のタブが操作中なら確認を任せる", async () => {
		const {services, site, state, ticker} = openSubmissions(() => statusJson("AC"));
		state.set("result-notifier:lastFocus", Date.now());
		await run(resultNotifier, services);
		await flush();
		expect(site.requests).toHaveLength(0);

		window.dispatchEvent(new Event("blur"));
		ticker.tick();
		await flush();
		expect(site.requests).toHaveLength(1);
	});

	test("別のタブの提出を受け取り、確認を始める", async () => {
		const {services, sent, state, ticker} = openSubmissions(() => statusJson("AC"));
		history.replaceState(null, "", "/contests/abc1/tasks");
		await run(resultNotifier, {...services, isOnRoute: () => false});
		expect(ticker.listeners.size).toBe(0);

		const submission = {id: "123", contestId: "abc1", taskName: "A - Sum", addedAt: Date.now()};
		state.changeRemotely("result-notifier:pending", [submission]);
		await flush();
		expect(sent).toHaveLength(1);
	});

	test("先に別のタブが通知した提出は重ねて通知しない", async () => {
		const state = new MemoryStore();
		const context = openSubmissions(() => {
			state.set("result-notifier:pending", []);
			return statusJson("AC");
		});
		await run(resultNotifier, {...context.services, state});
		await flush();
		expect(context.sent).toHaveLength(0);
	});

	test("無効にすると確認も購読も止める", async () => {
		const {services, state, ticker} = openSubmissions(() => statusJson("WJ"));
		const dispose = await run(resultNotifier, services);
		dispose?.();
		expect(ticker.listeners.size).toBe(0);

		state.changeRemotely("result-notifier:pending", [{
			id: "9",
			contestId: "abc1",
			taskName: "A",
			addedAt: Date.now()
		}]);
		expect(ticker.listeners.size).toBe(0);
	});
});
