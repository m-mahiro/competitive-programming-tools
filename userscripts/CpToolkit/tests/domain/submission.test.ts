import {describe, expect, test} from "bun:test";
import {isJudging, summarizeJudgeCases} from "@domain/submission/status";

describe("提出", () => {
	test("確定していない結果を判定する", () => {
		for (const status of ["", "WJ", "WR", "3/7", "2/7 WA"]) expect(isJudging(status)).toBe(true);
		for (const status of ["AC", "WA", "TLE", "CE"]) expect(isJudging(status)).toBe(false);
	});

	test("テストケースの平均を求める", () => {
		expect(summarizeJudgeCases([
			{status: "AC", timeMs: 10, memoryKb: 100},
			{status: "TLE", timeMs: 2001, memoryKb: 300},
		])).toEqual({accepted: 1, total: 2, averageTimeMs: 1005.5, averageMemoryKb: 200, timeIsLowerBound: true});
	});
});
