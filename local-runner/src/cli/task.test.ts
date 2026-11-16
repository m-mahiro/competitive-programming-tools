import {describe, expect, test} from "bun:test";
import {createTask, parseTask} from "./task";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {detectContestId, inferTask, resolveShortTask} from "./localTask";
import {resolveTaskScreenName, taskIndexFromSourceArg} from "./taskScreenName";

function expectTask(contestId: string, taskScreenName: string, actual: ReturnType<typeof parseTask>): void {
	expect(actual).toEqual({
		contestId,
		taskScreenName,
		taskUrl: `https://atcoder.jp/contests/${contestId}/tasks/${taskScreenName}`,
		submitUrl: `https://atcoder.jp/contests/${contestId}/submit?taskScreenName=${taskScreenName}`,
		submitPostUrl: `https://atcoder.jp/contests/${contestId}/submit`,
	});
}

describe("ローカルからの AtCoder URL 復元", () => {
	test("ABC001〜019・ARC001〜034 は A〜D を 1〜4 にする", () => {
		for (const [series, lastRound] of [["abc", 19], ["arc", 34]] as const) {
			for (let round = 1; round <= lastRound; round++) {
				const contestId = `${series}${String(round).padStart(3, "0")}`;
				for (const [index, letter] of [..."abcd"].entries()) {
					const taskId = `${contestId}_${index + 1}`;
					expectTask(contestId, taskId, resolveShortTask(contestId, letter));
					expectTask(contestId, taskId, parseTask(taskId));
				}
			}
		}
	});

	test("数字IDの境界外は通常の英字IDを使う", () => {
		for (const contestId of ["abc000", "abc020", "arc000", "arc035"]) {
			expectTask(contestId, `${contestId}_a`, resolveShortTask(contestId, "a"));
		}
	});

	test("同時開催 ABC の C/D は対応する ARC の a/b を使う", () => {
		for (const [abc, arc] of [["abc042", "arc058"], ["abc052", "arc067"], ["abc097", "arc097"], ["abc111", "arc103"]]) {
			for (const [letter, suffix] of [["c", "a"], ["d", "b"]]) {
				expectTask(abc, `${arc}_${suffix}`, resolveShortTask(abc, letter));
			}
			for (const letter of "ab") expectTask(abc, `${abc}_${letter}`, resolveShortTask(abc, letter));
		}
	});

	test("同時開催の間にある ABC や開催期間外には適用しない", () => {
		for (const contestId of ["abc041", "abc051", "abc054", "abc096", "abc100", "abc110", "abc112"]) {
			expectTask(contestId, `${contestId}_c`, resolveShortTask(contestId, "c"));
		}
	});

	test("ARC058〜103 は表示の C〜F を a〜d にする", () => {
		for (let round = 58; round <= 103; round++) {
			const contestId = `arc${String(round).padStart(3, "0")}`;
			for (const [index, letter] of [..."cdef"].entries()) {
				expectTask(contestId, `${contestId}_${"abcd"[index]}`, resolveShortTask(contestId, letter));
			}
		}
		for (const contestId of ["arc057", "arc104"]) {
			expectTask(contestId, `${contestId}_c`, resolveShortTask(contestId, "c"));
		}
	});

	test("完全指定の正式IDを表示上の問題記号として読み替えない", () => {
		for (const taskId of ["arc058_a", "arc058_b", "arc058_c", "arc058_d", "arc103_c", "abc250_h"]) {
			expectTask(taskId.split("_")[0], taskId, parseTask(taskId));
		}
		expectTask("abc042", "arc058_a", createTask("abc042", "arc058_a"));
	});

	test("通常・Ex・並行開催コンテストのIDを復元する", () => {
		for (const [contestId, letter, taskId] of [
			["abc448", "d", "abc448_d"],
			["abc250", "ex", "abc250_h"],
			["jsc2025advance-final", "c", "abc422_c"],
			["jsc2026advance-final", "d", "abc474_d"],
		]) expectTask(contestId, taskId, resolveShortTask(contestId, letter));
	});

	test("ローカル未作成の開催回を含めて、企業コンテスト・教材の例外を参照する", () => {
		for (const [contestId, index, taskId] of [
			["agc001", "a", "agc001_a"],
			["agc079", "a", "agc079_a"],
			["c-league2026-1", "a", "c_league2026_1_a"],
			["ndpc", "a", "ndpc2026_a"],
			["typical90", "001", "typical90_a"],
			["typical90", "027", "typical90_aa"],
			["tessoku-book", "a01", "tessoku_book_a"],
			["tessoku-book", "b63", "abc007_3"],
			["abs", "abc049c", "arc065_a"],
			["APG4b", "ex1", "APG4b_cv"],
		]) expect(resolveTaskScreenName(contestId, index)).toBe(taskId);
	});

	test("正式IDからハイフン・大文字・区切りなしの開催回を復元する", () => {
		for (const [taskId, contestId] of [
			["tessoku_book_a", "tessoku-book"],
			["codequeen2024_final_c", "codequeen2024-final-N9tn8QqD"],
			["c_league2026_1_a", "c-league2026-1"],
			["ndpc2026_a", "ndpc"],
			["APG4b_cv", "APG4b"],
			["joi2011ho1", "joi2011ho"],
			["joisc2009_starry_sky", "joisc2009"],
		]) expectTask(contestId, taskId, parseTask(taskId));
	});

	test("公式コンテストIDのフォルダから開催回を復元する", () => {
		for (const contestId of [
			"ahc040", "intro-heuristics", "codequeen2024-final-N9tn8QqD", "codequeen2025-final-Public",
		]) expect(detectContestId(`atcoder/${contestId}/src/java`)).toBe(contestId);
		const contestId = detectContestId("atcoder/abc/001-050/abc042/src/java");
		expectTask("abc042", "arc058_a", resolveShortTask(contestId, "c"));
	});

	test("不正な完全指定を拒否する", () => {
		for (const taskId of ["abc001", "abc001_", "../abc001_a", "abc001_a?lang=ja"]) {
			expect(() => parseTask(taskId)).toThrow("Invalid taskScreenName");
		}
	});
});

describe("ソース名からの問題指定", () => {
	test("拡張子と最後のアンダースコア以降だけを除く", () => {
		for (const [sourceArg, expected] of [
			["C_deque.java", "c"], ["C_deque", "c"], ["./C_deque.cpp", "c"],
			["A_2.java", "a"], ["A15_1.java", "a15"], ["ABC081B_2.java", "abc081b"],
			["C_dp_memo.java", "c_dp"], ["d", "d"], ["D1.java", "d1"], ["Q001.java", "q001"],
		]) expect(taskIndexFromSourceArg(sourceArg)).toBe(expected);
	});

	test("問題記号や実装名が空になる指定を拒否する", () => {
		for (const sourceArg of ["_memo.java", "A_.java", ".java"]) {
			expect(() => taskIndexFromSourceArg(sourceArg)).toThrow("Could not infer the task");
		}
	});

	test("フォルダのコンテストとファイル名から問題を決める", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "infer-task-"));
		const originalCwd = process.cwd();
		try {
			for (const [contestId, sourceName, taskId] of [
				["abc351", "C_deque.java", "abc351_c"],
				["abs", "ABC081B_2.java", "abc081_b"],
				["tessoku-book", "A01.java", "tessoku_book_a"],
				["abc001", "A_2.java", "abc001_1"],
			]) {
				const dir = path.join(root, contestId, "src", "java");
				fs.mkdirSync(dir, {recursive: true});
				process.chdir(dir);
				for (const arg of [sourceName, path.parse(sourceName).name.toLowerCase()]) {
					expect(inferTask(arg).taskScreenName).toBe(taskId);
					expect(inferTask(arg).contestId).toBe(contestId);
				}
			}
		} finally {
			process.chdir(originalCwd);
			fs.rmSync(root, {recursive: true, force: true});
		}
	});
});
