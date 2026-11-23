import {describe, expect, test} from "bun:test";

// 利用者の設定を読まないよう、テスト用の設定ファイルを使う。
await import("../../testSettings");
const {describeLineOffset} = await import("./source");

describe("describeLineOffset", () => {
	test("増えた行数をヘッダーと import に分けて示す", () => {
		expect(describeLineOffset({header: 2, transform: 4}, true, "A.java"))
			.toBe("Line offset: header +2, imports +4. Subtract it from line numbers in errors to find the line in A.java. Java compile errors are shifted only by the header.");
		expect(describeLineOffset({header: 2, transform: 0}, false, "a.py"))
			.toBe("Line offset: header +2. Subtract it from line numbers in errors to find the line in a.py.");
		expect(describeLineOffset({header: 0, transform: -1}, true, "A.java")).toContain("imports -1.");
	});

	test("bundle で分からないときはそう示し、増えていなければ何も示さない", () => {
		expect(describeLineOffset({header: 0, transform: null}, false, "a.py")).toContain("bundle (unknown)");
		expect(describeLineOffset({header: 0, transform: 0}, true, "A.java")).toBeNull();
		expect(describeLineOffset(undefined, true, "A.java")).toBeNull();
	});
});
