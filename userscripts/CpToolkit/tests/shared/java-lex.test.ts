import {describe, expect, test} from "bun:test";
import {firstDeclarationLine} from "@atcoder-tools/shared";

describe("firstDeclarationLine", () => {
	test("package と import の後の、最初の宣言の行を返す", () => {
		expect(firstDeclarationLine("package a;\nimport java.util.*;\n\n// comment\n@SuppressWarnings(\"x\")\npublic class Main {}\n")).toBe(5);
		expect(firstDeclarationLine("class Main {}\n")).toBe(1);
	});

	test("Local Runner がライブラリのために足した import の分だけ、前後で差が出る", () => {
		const before = "import java.util.*;\n\nimport lib.io.*;\n\npublic class Main {}\n";
		const after = "import java.util.*;\n\nimport java.nio.*;\nimport java.io.*;\n\n// import lib.io.*;\n\npublic class Main {}\n";
		expect(firstDeclarationLine(after)! - firstDeclarationLine(before)!).toBe(3);
	});

	test("宣言が無いか、字句を読み切れなければ null を返す", () => {
		expect(firstDeclarationLine("import java.util.*;\n")).toBeNull();
		expect(firstDeclarationLine("class Main { /* open")).toBeNull();
	});
});
