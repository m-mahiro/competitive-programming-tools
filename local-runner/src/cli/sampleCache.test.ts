import {afterAll, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {Task} from "../types";

// 利用者の設定とキャッシュに触れないよう、一時フォルダを設定とホームにする。
await import("../testSettings");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sample-cache-"));
const savedHome = {USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME};
process.env.USERPROFILE = dir;
process.env.HOME = dir;
const {getSampleCacheDir, readCachedSamples, writeCachedSamples} = await import("./sampleCache");

const task = {taskScreenName: "abc1_a"} as Task;

function writeRaw(samples: unknown, version = 3): void {
	fs.mkdirSync(getSampleCacheDir(), {recursive: true});
	fs.writeFileSync(path.join(getSampleCacheDir(), "abc1_a.json"), JSON.stringify({version, taskScreenName: "abc1_a", fetchedAt: 0, samples}));
}

beforeEach(() => {
	fs.rmSync(path.join(dir, ".atcoder"), {recursive: true, force: true});
});

afterAll(() => {
	for (const [key, value] of Object.entries(savedHome)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(dir, {recursive: true, force: true});
});

describe("readCachedSamples", () => {
	test("見出しをまたいで取得した可能性がある旧形式のサンプルは取り直す", () => {
		writeRaw([{index: 1, input: "42", expectedOutput: "42"}], 2);
		expect(readCachedSamples(task)).toBeNull();
	});
	test("保存したサンプルを読む", () => {
		const samples = [{index: 1, input: "1\n", expectedOutput: "2\n"}];
		writeCachedSamples(task, samples, 2000);
		expect(readCachedSamples(task)).toEqual({samples, timeLimitMs: 2000});
	});

	test("空の配列や期待出力の無いサンプルは、壊れたキャッシュとして取り直す", () => {
		for (const samples of [[], [{index: 1, input: "1\n"}], [null], [{index: "1", input: "1\n", expectedOutput: "2\n"}]]) {
			writeRaw(samples);
			expect(readCachedSamples(task)).toBeNull();
		}
	});
});
