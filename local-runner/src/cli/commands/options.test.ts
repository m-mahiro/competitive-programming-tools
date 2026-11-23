import {describe, expect, test} from "bun:test";
import {CliUsageError} from "./Command";
import {parseDisplayFlag, parseHeaderFlag, parseIntFlag} from "./options";

describe("parseIntFlag", () => {
	test("数字だけの値を受け付ける", () => {
		expect(parseIntFlag("--max-lines=50", "--max-lines")).toBe(50);
		expect(parseIntFlag("--max-lines=0", "--max-lines")).toBe(0);
		expect(parseIntFlag("--other=1", "--max-lines")).toBeUndefined();
	});

	test("指数、16進数、空白、小数、符号、空の値は使い方の誤りにする", () => {
		for (const value of ["1e3", "0x10", " 5", "1.0", "+5", "-1", "", "99999999999999999999"]) {
			expect(() => parseIntFlag(`--max-lines=${value}`, "--max-lines")).toThrow(CliUsageError);
		}
		expect(() => parseIntFlag("--max-lines", "--max-lines")).toThrow(CliUsageError);
	});

	test("--time-limit は 1 以上だけを受け付ける", () => {
		const display = {};
		expect(parseDisplayFlag("--time-limit=3000", display)).toBe(true);
		expect(display).toEqual({timeLimitMs: 3000});
		expect(() => parseDisplayFlag("--time-limit=0", {})).toThrow("an integer of 1 or more");
	});
});

describe("parseHeaderFlag", () => {
	test("--no-header と、setheader と同じ規則の名前を受け付ける", () => {
		expect(parseHeaderFlag("--no-header")).toBe(false);
		expect(parseHeaderFlag("--header=short")).toBe("short");
		expect(parseHeaderFlag("--header=java-2")).toBe("java-2");
		expect(parseHeaderFlag("--lang=java")).toBeUndefined();
	});

	test("空の名前や、規則に合わない名前は使い方の誤りにする", () => {
		for (const name of ["", "../x", "-a", "a b"]) {
			expect(() => parseHeaderFlag(`--header=${name}`)).toThrow(CliUsageError);
		}
	});
});
