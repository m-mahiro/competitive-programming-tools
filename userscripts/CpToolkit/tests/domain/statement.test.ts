import {describe, expect, test} from "bun:test";
import {isPureNumber, splitLimitValue, splitNumbers} from "@domain/statement/tokens";

describe("問題文の字句分割", () => {
	const emphasized = (text: string) => splitNumbers(text).filter((part) => part.emphasized).map((part) => part.text);

	test("桁区切りや小数、指数を1つの数字として扱う", () => {
		expect(emphasized("1 以上 200,000 以下、誤差 1.5e-6")).toEqual(["1", "200,000", "1.5e-6"]);
	});

	test("分割しても元の文章を失わない", () => {
		const text = "N は 3 で、abc123 は単語です";
		expect(splitNumbers(text).map((part) => part.text).join("")).toBe(text);
		expect(emphasized(text)).toEqual(["3"]);
	});

	test("同じ文章で何度呼んでも結果が変わらない", () => {
		expect(emphasized("10 20")).toEqual(emphasized("10 20"));
	});

	test("KaTeX の数字を判定する", () => {
		expect(isPureNumber("1,000")).toBe(true);
		expect(isPureNumber("N")).toBe(false);
	});

	test("制限の値だけを強調する", () => {
		const segments = splitLimitValue("Time Limit: 2 sec / Memory Limit: 1024 MiB", "Time Limit");
		expect(segments?.filter((part) => part.emphasized).map((part) => part.text)).toEqual(["2"]);
		expect(segments?.map((part) => part.text).join("")).toBe("Time Limit: 2 sec / Memory Limit: 1024 MiB");
	});

	test("除外する値と等しい制限は強調しない", () => {
		expect(splitLimitValue("Time Limit: 2 sec", "Time Limit", 2)).toBeNull();
		expect(splitLimitValue("Memory Limit: 1,024 MiB", "Memory Limit", 1024)).toBeNull();
		const segments = splitLimitValue("実行時間制限: 3 sec", "実行時間制限", 2);
		expect(segments?.filter((part) => part.emphasized).map((part) => part.text)).toEqual(["3"]);
	});

	test("値が書かれていなければ null を返す", () => {
		expect(splitLimitValue("実行時間制限について", "実行時間制限")).toBeNull();
	});
});
