import {describe, expect, test} from "bun:test";
import {ratingScale} from "@catalog/tables";
import {parseRecentRange, ratedPerformances, recentCount} from "@domain/rating/history";
import {tierOf, tierProgress} from "@domain/rating/scale";

describe("レーティング", () => {
	test("色の区分を判定する", () => {
		expect(tierOf(ratingScale, 399).className).toBe("user-gray");
		expect(tierOf(ratingScale, 400).className).toBe("user-brown");
		expect(tierOf(ratingScale, 5000).className).toBe("user-red");
	});

	test("区分の中での位置を返す", () => {
		expect(tierProgress(ratingScale, 600)).toBe(0.5);
	});

	test("最近の範囲は回数か割合で指定できる", () => {
		expect(parseRecentRange("20")).toEqual({unit: "count", value: 20});
		expect(parseRecentRange(" 50% ")).toEqual({unit: "percent", value: 50});
		expect(parseRecentRange("１００％")).toEqual({unit: "percent", value: 100});
		expect(parseRecentRange("50 %")).toEqual({unit: "percent", value: 50});
	});

	test.each(["", "0", "0%", "101%", "-5", "1.5", "50%%", "abc", "99999999999999999999"])("不正な範囲は読み取らない: %s", (text) => {
		expect(parseRecentRange(text)).toBeNull();
	});

	test("最近の範囲から表示する回数を決める", () => {
		expect(recentCount({unit: "count", value: 20}, 37)).toBe(20);
		expect(recentCount({unit: "count", value: 50}, 37)).toBe(37);
		expect(recentCount({unit: "percent", value: 50}, 37)).toBe(19);
		expect(recentCount({unit: "percent", value: 100}, 37)).toBe(37);
		expect(recentCount({unit: "percent", value: 1}, 3)).toBe(1);
	});

	test("レート変動のあった回だけを取り出す", () => {
		expect(ratedPerformances([
			{IsRated: true, Performance: 1200},
			{IsRated: false, Performance: 900},
			{IsRated: true, Performance: -5},
		])).toEqual([1200, 0]);
	});
});
