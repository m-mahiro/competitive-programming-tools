import {describe, expect, test} from "bun:test";
import {decodeUnicodeEscapes, firstDeclarationLine} from "@atcoder-tools/shared";

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

	test("文字列の中の Unicode エスケープがあっても数える", () => {
		expect(firstDeclarationLine('import java.util.*;\n\nclass Main { String s = "\\u00d7"; }\n')).toBe(3);
	});

	test("コメントの中の改行のエスケープは、javac と同じく改行として読み、行は元のソースで数える", () => {
		// 1行目のコメントは改行のエスケープで終わり、その後ろの import は文になる
		expect(firstDeclarationLine("// c \\u000a import java.util.*;\nclass Main {}\n")).toBe(2);
	});
});

describe("decodeUnicodeEscapes", () => {
	test("エスケープを文字に訳し、元の位置を返す", () => {
		expect(decodeUnicodeEscapes("a\\u0041b")).toEqual({text: "aAb", offsets: [0, 1, 7, 8]});
		expect(decodeUnicodeEscapes("\\u00DF").text).toBe("ß");
		expect(decodeUnicodeEscapes("\\uuu0022").text).toBe('"');
	});

	test("前にバックスラッシュが奇数個あるものは訳さない", () => {
		expect(decodeUnicodeEscapes('"\\\\u0041"').text).toBe('"\\\\u0041"');
	});

	test("宣言が無いか、字句を読み切れなければ null を返す", () => {
		expect(firstDeclarationLine("import java.util.*;\n")).toBeNull();
		expect(firstDeclarationLine("class Main { /* open")).toBeNull();
	});
});
