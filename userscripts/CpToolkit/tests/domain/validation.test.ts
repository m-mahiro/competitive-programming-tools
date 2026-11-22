import {describe, expect, test} from "bun:test";
import {isArrayOf, isNumber, isObjectOf, isRecordOf, isString} from "@domain/validation/guards";

describe("guards", () => {
	test("配列の要素を確かめる", () => {
		expect(isArrayOf(isString)(["a", "b"])).toBe(true);
		expect(isArrayOf(isString)(["a", 1])).toBe(false);
		expect(isArrayOf(isString)("a")).toBe(false);
	});

	test("レコードの値を確かめる", () => {
		expect(isRecordOf(isNumber)({a: 1})).toBe(true);
		expect(isRecordOf(isNumber)({a: "1"})).toBe(false);
		expect(isRecordOf(isNumber)([1])).toBe(false);
		expect(isRecordOf(isNumber)(null)).toBe(false);
	});

	test("オブジェクトの項目を確かめ、他の項目は無視する", () => {
		const isRange = isObjectOf<{begin: number; end: number}>({begin: isNumber, end: isNumber});
		expect(isRange({begin: 0, end: 1, extra: true})).toBe(true);
		expect(isRange({begin: 0})).toBe(false);
	});
});
