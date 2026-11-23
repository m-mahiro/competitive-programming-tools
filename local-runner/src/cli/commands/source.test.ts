import {describe, expect, test} from "bun:test";

// 利用者の設定を読まないよう、テスト用の設定ファイルを使う。
await import("../../testSettings");
const {describeLineOffset} = await import("./source");

describe("describeLineOffset", () => {
	test("増えた行数をヘッダーと import に分けて示す", () => {
		expect(describeLineOffset({header: 2, transform: 4})).toBe("Line offset: header +2, imports +4.");
		expect(describeLineOffset({header: 2, transform: 0})).toBe("Line offset: header +2.");
		expect(describeLineOffset({header: 0, transform: -1})).toBe("Line offset: imports -1.");
	});

	test("bundle で分からないときはそう示し、増えていなければ何も示さない", () => {
		expect(describeLineOffset({header: 1, transform: null})).toBe("Line offset: header +1, bundle (unknown).");
		expect(describeLineOffset({header: 0, transform: 0})).toBeNull();
		expect(describeLineOffset(undefined)).toBeNull();
	});
});
