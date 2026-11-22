import {describe, expect, test} from "bun:test";
import {ClarificationCounter} from "@application/contest/clarification-counter";
import {loadLatestContests} from "@application/contest/latest-contests";
import {loadContestTasks} from "@application/contest/task-list";
import {VirtualParticipations} from "@application/contest/virtual-participation";
import {FakeHttpClient, MemoryStore} from "../support/fakes";

describe("loadContestTasks", () => {
	const tasks = [{url: "/contests/abc1/tasks/abc1_a", label: "A", name: "First"}];
	const dependencies = (http: FakeHttpClient, state = new MemoryStore()) => ({
		site: http,
		state,
		parse: () => tasks,
		cacheDays: 10,
	});

	test("一度取得した問題一覧はキャッシュを使う", async () => {
		const http = new FakeHttpClient(() => ({status: 200, text: ""}));
		const state = new MemoryStore();
		await loadContestTasks("abc1", dependencies(http, state));
		expect(await loadContestTasks("abc1", dependencies(http, state))).toEqual(tasks);
		expect(http.requests).toHaveLength(1);
	});

	test("取得に失敗したら null を返す", async () => {
		const http = new FakeHttpClient(() => ({status: 404, text: ""}));
		expect(await loadContestTasks("abc1", dependencies(http))).toBeNull();
	});

	test("保持期間を過ぎたコンテストをキャッシュから消す", async () => {
		const http = new FakeHttpClient(() => ({status: 200, text: ""}));
		const state = new MemoryStore();
		state.set("task-dropdown:tasks", {old: {tasks: [], lastAccess: 0}});
		await loadContestTasks("abc1", dependencies(http, state));
		expect(Object.keys(state.get("task-dropdown:tasks") as object)).toEqual(["abc1"]);
	});
});

describe("ClarificationCounter", () => {
	test("増えた件数を返す", () => {
		const counter = new ClarificationCounter(new MemoryStore());
		expect(counter.update("abc1", 2)).toBe(2);
		expect(counter.update("abc1", 2)).toBe(0);
		expect(counter.update("abc1", 3)).toBe(1);
		expect(counter.update("abc2", 1)).toBe(1);
	});

	test("件数が減っても通知しない", () => {
		const counter = new ClarificationCounter(new MemoryStore());
		counter.update("abc1", 3);
		expect(counter.update("abc1", 2)).toBe(0);
		expect(counter.update("abc1", 3)).toBe(1);
	});

	test("確認はタブ間で重複しない", () => {
		const state = new MemoryStore();
		expect(new ClarificationCounter(state).claimPoll(100_000, 60_000)).toBe(true);
		expect(new ClarificationCounter(state).claimPoll(130_000, 60_000)).toBe(false);
		expect(new ClarificationCounter(state).claimPoll(160_000, 60_000)).toBe(true);
	});
});

describe("VirtualParticipations", () => {
	test("コンテストごとに開始時刻を記憶して忘れる", () => {
		const participations = new VirtualParticipations(new MemoryStore());
		participations.record("abc1", 100);
		participations.record("abc2", 200);
		participations.forget("abc1");
		expect(participations.startOf("abc1")).toBeNull();
		expect(participations.startOf("abc2")).toBe(200);
	});
});

describe("loadContestTasks の記憶", () => {
	test("空の一覧は記憶せず、次回に取得し直す", async () => {
		const state = new MemoryStore();
		const site = new FakeHttpClient(() => ({status: 200, text: ""}));
		const parse = () => [];
		await loadContestTasks("abc1", {site, state, parse, cacheDays: 10});
		await loadContestTasks("abc1", {site, state, parse, cacheDays: 10});
		expect(site.requests).toHaveLength(2);
	});
});

describe("loadLatestContests", () => {
	const contest = {
		category: "ABC",
		id: "abc2",
		name: "AtCoder Beginner Contest 2",
		marks: [{text: "◉", className: "user-blue", title: ""}],
	};
	const parse = (html: string) => (html === "table" ? [contest] : []);
	const home = () => new FakeHttpClient(() => ({status: 200, text: "table"}));

	test("ホームの表を読み、保持期間内は通信しない", async () => {
		const state = new MemoryStore();
		const site = home();
		expect(await loadLatestContests(60, {site, state, parse, now: 0})).toEqual([contest]);
		expect(site.requests.map(({url}) => url)).toEqual(["/home"]);

		await loadLatestContests(60, {site, state, parse, now: 59 * 60 * 1000});
		expect(site.requests).toHaveLength(1);
		await loadLatestContests(60, {site, state, parse, now: 60 * 60 * 1000});
		expect(site.requests).toHaveLength(2);
	});

	test("取得に失敗したら記憶しない", async () => {
		const state = new MemoryStore();
		const site = new FakeHttpClient(() => ({status: 503, text: ""}));
		await expect(loadLatestContests(60, {site, state, parse, now: 0})).rejects.toThrow();
		expect(site.requests).toHaveLength(1);
		expect(state.get("latest-contests:cache")).toBeUndefined();
	});

	test("表を読めなかった結果は記憶しない", async () => {
		const state = new MemoryStore();
		const site = new FakeHttpClient(() => ({status: 200, text: "changed"}));
		expect(await loadLatestContests(60, {site, state, parse, now: 0})).toEqual([]);
		expect(state.get("latest-contests:cache")).toBeUndefined();
	});

	test("以前の形式の記憶は使わない", async () => {
		const state = new MemoryStore();
		state.set("latest-contests:cache", {fetchedAt: 0, contests: {ABC: "abc1"}});
		expect(await loadLatestContests(60, {site: home(), state, parse, now: 0})).toEqual([contest]);

		const {marks: _, ...withoutMarks} = contest;
		state.set("latest-contests:cache", {fetchedAt: 0, contests: [withoutMarks]});
		const site = home();
		await loadLatestContests(60, {site, state, parse, now: 0});
		expect(site.requests).toHaveLength(1);
	});
});
