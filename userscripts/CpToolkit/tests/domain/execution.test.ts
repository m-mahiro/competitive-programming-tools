import {describe, expect, test} from "bun:test";
import {languageCatalog} from "@catalog/tables";
import {isLanguageOption, labelDistance, resolveFamily} from "@domain/execution/language";
import {judgeResult, parseAllowableError} from "@domain/execution/result";

describe("言語の判定", () => {
	const cases: ReadonlyArray<readonly [string, string | null]> = [
		["Java 24 OpenJDK 24.0.2", "java"],
		["Java24 (OpenJDK 24.0.2)", "java"],
		["JavaScript (Node.js 22.19.0)", "javascript"],
		["C++23(gcc16)", "cpp"],
		["C++ 23 GCC 15.2.0", "cpp"],
		["GNU G++23 14.2 (64 bit, msys2)", "cpp"],
		["GNU GCC C11 5.1.0", "c"],
		["C 23 Clang Clang 21.1.0", "c"],
		["C#(csc)", "csharp"],
		["Python (CPython 3.13.7)", "python3"],
		["Python (PyPy 3.11-v7.3.20)", "python3"],
		["PyPy3", "python3"],
		["PyPy2", "python2"],
		["Python 3.13.2", "python3"],
		["Rust 1.89.0", "rust"],
		["Go 1.25.1", "go"],
		["COBOL Free GnuCOBOL 3.2", "cobol"],
		["Crystal 1.17.0", "crystal"],
		["Whitespace", null],
	];

	test.each(cases)("%s を判定する", (label, family) => {
		expect(resolveFamily(languageCatalog, label)).toBe(family);
	});

	test("近い表記ほど距離が小さい", () => {
		expect(labelDistance("Java 24", "Java 24")).toBe(0);
		expect(labelDistance("Java 24", "Java 21")).toBeLessThan(labelDistance("Java 24", "Kotlin 2"));
	});

	test("paiza の選択肢は JavaScript を Java と取り違えない", () => {
		expect(isLanguageOption("Java (OpenJDK 21)", "java")).toBe(true);
		expect(isLanguageOption("JavaScript", "java")).toBe(false);
		expect(isLanguageOption("JavaScript", "javascript")).toBe(true);
		expect(isLanguageOption("C++(gcc)", "c++")).toBe(true);
		expect(isLanguageOption("Objective-C", "c")).toBe(false);
	});
});

describe("実行結果の判定", () => {
	test("空白の違いを無視して比較する", () => {
		const result = judgeResult({status: "OK", input: "", output: "1  2\n"}, "1 2", {trim: true, split: true});
		expect(result.status).toBe("AC");
	});

	test("誤差を許容する", () => {
		const options = {trim: true, split: true, allowableError: 1e-3};
		expect(judgeResult({status: "OK", input: "", output: "1.0005"}, "1.0", options).status).toBe("AC");
		expect(judgeResult({status: "OK", input: "", output: "1.5"}, "1.0", options).status).toBe("WA");
	});

	test("誤差は、両方のトークンが末尾まで整数か小数の表記のときだけ許容する", () => {
		const options = {trim: true, split: true, allowableError: 1e-6};
		const status = (output: string, expected: string) => judgeResult({status: "OK", input: "", output}, expected, options).status;
		expect(status("1garbage", "1.0")).toBe("WA");
		expect(status("1.0", "1garbage")).toBe("WA");
		// 指数の表記は、ジャッジが受け付けるか分からないので文字列で比べる
		expect(status("1e3", "1000")).toBe("WA");
		expect(status("1.0e3", "1000.0")).toBe("WA");
		expect(status("1e3", "1e3")).toBe("AC");
		// 310 桁の数は Infinity になるので、誤差では比べない
		expect(status("0.0", "9".repeat(310))).toBe("WA");
		expect(judgeResult({status: "OK", input: "", output: "1.5"}, "1.0", {trim: true, split: true, allowableError: Infinity}).status).toBe("WA");
		expect(status("1000.0000001", "1000")).toBe("AC");
		expect(status("1000000007", "1000000008")).toBe("WA");
		expect(status("-.5", "-0.5")).toBe("AC");
	});

	test("許容誤差の欄は、全体が有限の正の数の表記のときだけ読む", () => {
		expect(parseAllowableError("1e-6")).toBe(1e-6);
		expect(parseAllowableError(" 0.001 ")).toBe(0.001);
		expect(parseAllowableError(".5")).toBe(0.5);
		for (const text of ["10^-6", "1e", "1e-6x", "", "0", "-1e-6", "1e999", "abc"]) {
			expect(parseAllowableError(text)).toBeNull();
		}
	});

	test("標準出力を切り詰めた結果はそのまま返す", () => {
		expect(judgeResult({status: "OLE", input: "", output: "good"}, "good", {}).status).toBe("OLE");
	});

	test("実行に失敗した結果はそのまま返す", () => {
		expect(judgeResult({status: "RE", input: ""}, "1", {}).status).toBe("RE");
	});

	test("期待する出力がなければ判定しない", () => {
		expect(judgeResult({status: "OK", input: "", output: "1"}, null, {}).status).toBe("OK");
	});
});
