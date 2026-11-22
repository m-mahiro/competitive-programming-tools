import {describe, expect, test} from "bun:test";
import {contestCatalog} from "@catalog/tables";
import {buildCalendarUrl} from "@domain/contest/calendar";
import {adjustRange, contestCategory, defaultRange, rangeIndices} from "@domain/contest/category";
import {contestPagesOf, neighborTask, taskKeyOf} from "@domain/contest/pages";
import {formatClock, virtualClock} from "@domain/contest/virtual";

describe("コンテストのページ", () => {
	test("AtCoder は問題のページなら、その問題の解説を開く", () => {
		expect(contestPagesOf("atcoder", "/contests/abc485/tasks/abc485_c")).toEqual({
			tasks: "/contests/abc485/tasks",
			mySubmissions: "/contests/abc485/submissions/me",
			standings: "/contests/abc485/standings",
			editorial: "/contests/abc485/tasks/abc485_c/editorial",
			customTest: "/contests/abc485/custom_test",
		});
		expect(contestPagesOf("atcoder", "/contests/abc485/standings")?.editorial).toBe("/contests/abc485/editorial");
		expect(contestPagesOf("atcoder", "/contests/archive")).toBeNull();
		expect(contestPagesOf("atcoder", "/users/someone")).toBeNull();
	});

	test("Codeforces は Gym と問題集の問題も、コンテストのページを開く", () => {
		expect(contestPagesOf("codeforces", "/contest/2000/problem/A")?.standings).toBe("/contest/2000/standings");
		expect(contestPagesOf("codeforces", "/gym/100001/problem/B")?.mySubmissions).toBe("/gym/100001/my");
		expect(contestPagesOf("codeforces", "/problemset/problem/2000/A")?.tasks).toBe("/contest/2000");
		expect(contestPagesOf("codeforces", "/contest/2000/problem/A")?.editorial).toBeNull();
		expect(contestPagesOf("yukicoder", "/problems/no/1")).toBeNull();
	});
});

describe("問題の切り替え", () => {
	const atcoder = ["a", "b", "c"].map((id) => ({url: `/contests/abc1/tasks/abc1_${id}`, label: id.toUpperCase()}));
	const codeforces = ["A", "B", "C1", "C2"].map((id) => ({url: `/contest/2000/problem/${id}`, label: id}));

	test("前後の問題を選び、端では選ばない", () => {
		expect(neighborTask(atcoder, "/contests/abc1/tasks/abc1_b", 1)?.label).toBe("C");
		expect(neighborTask(atcoder, "/contests/abc1/tasks/abc1_a", -1)).toBeNull();
		expect(neighborTask(atcoder, "/contests/abc1/tasks", 1)).toBeNull();
		expect(neighborTask(codeforces, "/problemset/problem/2000/b", 1)?.label).toBe("C1");
	});

	test("URL の書き方が違っても同じ問題とみなす", () => {
		expect(taskKeyOf("/problemset/problem/2000/A")).toBe(taskKeyOf("/contest/2000/problem/a"));
		expect(taskKeyOf("/contests/abc1/tasks")).toBeNull();
	});
});

describe("コンテストの分類と範囲", () => {
	test("定期開催は問題数ごとに分ける", () => {
		expect(contestCategory(contestCatalog, "abc420", 7)).toBe("abc-7");
		expect(contestCategory(contestCatalog, "typical90", 90)).toBe("typical90");
		expect(contestCategory(contestCatalog, "unknown2026", 5)).toBe("other");
	});

	test("既定の範囲は上限を超えない", () => {
		expect(defaultRange(5, 20)).toEqual({begin: 0, end: 4});
		expect(defaultRange(90, 20)).toEqual({begin: 0, end: 19});
	});

	test("片方を動かすともう片方が順序と上限に追従する", () => {
		expect(adjustRange({begin: 5, end: 3}, "begin", 20)).toEqual({begin: 5, end: 5});
		expect(adjustRange({begin: 0, end: 30}, "begin", 20)).toEqual({begin: 0, end: 19});
		expect(adjustRange({begin: 5, end: 3}, "end", 20)).toEqual({begin: 3, end: 3});
		expect(adjustRange({begin: 0, end: 30}, "end", 20)).toEqual({begin: 11, end: 30});
	});

	test("逆順でも範囲全体を返す", () => {
		expect(rangeIndices({begin: 1, end: 3}, false)).toEqual([1, 2, 3]);
		expect(rangeIndices({begin: 1, end: 3}, true)).toEqual([3, 2, 1]);
	});
});

describe("カレンダー", () => {
	test("時刻を UTC にして登録の URL を作る", () => {
		const url = new URL(buildCalendarUrl({
			title: "ABC 1",
			startMs: Date.UTC(2026, 0, 2, 3, 4, 5),
			endMs: Date.UTC(2026, 0, 2, 4, 44, 5),
			location: "https://atcoder.jp/contests/abc1",
		}));
		expect(url.searchParams.get("action")).toBe("TEMPLATE");
		expect(url.searchParams.get("dates")).toBe("20260102T030405Z/20260102T044405Z");
	});
});

describe("バーチャル参加の時計", () => {
	test("開始前、参加中、終了後を区別する", () => {
		expect(virtualClock(50, 100, 1000)).toEqual({phase: "before", remainingMs: 50});
		expect(virtualClock(100, 100, 1000)).toEqual({phase: "running", remainingMs: 1000});
		expect(virtualClock(1100, 100, 1000)).toEqual({phase: "finished"});
	});

	test("残り時間を切り上げて表す", () => {
		expect(formatClock(1)).toBe("00:00:01");
		expect(formatClock(3_661_000)).toBe("01:01:01");
		expect(formatClock(90_000_000)).toBe("25:00:00");
	});
});
