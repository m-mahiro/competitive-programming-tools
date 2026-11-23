import {describe, expect, test} from "bun:test";

// 利用者の設定を読まないよう、テスト用の設定ファイルを使う。
await import("../../testSettings");
const {describeLineOffset, preparedProgram} = await import("./source");

describe("preparedProgram", () => {
	const response = (sourceCode: string, programId: string) =>
		({status: "success", sourceCode, programId, diagnostics: "", inlinedClasses: [], diagnosticItems: []}) as const;

	test("同じソースで作り直したら、新しい programId を使う", async () => {
		const program = preparedProgram(response("// h\n\nA", "1"), async () => response("// h\n\nA", "2"));
		expect(await program.refresh()).toBe("2");
	});

	test("作り直したソースが最初と違えば、試したものと提出物が食い違うので止める", async () => {
		const program = preparedProgram(response("return 1", "1"), async () => response("return 2", "2"));
		await expect(program.refresh()).rejects.toThrow("The source changed while running the samples");
	});
});

describe("describeLineOffset", () => {
	test("増えた行数をヘッダーと import に分けて示す", () => {
		expect(describeLineOffset({header: 2, transform: 4})).toBe("Line offset: header +2, imports +4.");
		expect(describeLineOffset({header: 2, transform: 0})).toBe("Line offset: header +2.");
		expect(describeLineOffset({header: 0, transform: -1})).toBe("Line offset: imports -1.");
	});

	test("bundle で分からないときはそう示し、増えていなければ何も示さない", () => {
		expect(describeLineOffset({header: 1, transform: null})).toBe("Line offset: header +1, bundle (unknown).");
		expect(describeLineOffset({header: 0, transform: null}, true)).toBe("Line offset: imports (unknown).");
		expect(describeLineOffset({header: 0, transform: 0})).toBeNull();
		expect(describeLineOffset(undefined)).toBeNull();
	});
});
