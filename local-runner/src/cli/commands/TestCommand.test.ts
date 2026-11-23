import {describe, expect, test} from "bun:test";

// 利用者の設定を読まないよう、テスト用の設定ファイルを使う。
await import("../../testSettings");
const {TestCommand} = await import("./TestCommand");
const {CliUsageError} = await import("./Command");

/** 引数を検査したあと、ソースを探す前までの結果。ソースが無いので、使い方が正しければファイルの誤りで止まる。 */
async function failureOf(args: string[]): Promise<unknown> {
	return new TestCommand().execute(args).then(() => null, (error: unknown) => error);
}

describe("TestCommand", () => {
	test("submit と同じく、ヘッダーの指定を受け付ける", async () => {
		for (const option of ["--no-header", "--header=short"]) {
			const error = await failureOf([option, "abc1_a", "missing-test-source.java"]);
			expect(error).not.toBeInstanceOf(CliUsageError);
			expect(String(error)).toContain("Source file not found");
		}
	});

	test("ヘッダー以外の不明な指定は、使い方の誤りにする", async () => {
		expect(await failureOf(["--unknown", "abc1_a", "missing-test-source.java"])).toBeInstanceOf(CliUsageError);
	});
});
