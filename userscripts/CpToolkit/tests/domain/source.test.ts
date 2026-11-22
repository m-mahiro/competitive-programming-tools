import {describe, expect, test} from "bun:test";
import {fillVariables, insertFooter, insertHeader, isWholeCode, replaceBlock, toComment} from "@domain/source/comment";
import {findFoldStartLines} from "@domain/source/fold-lines";
import {withoutPublicTypes} from "@domain/source/java-public";

describe("ヘッダーとフッター", () => {
	const c = {line: "//", open: "/*", close: "*/"};
	const python = {line: "#"};
	const ocaml = {open: "(*", close: "*)"};
	const php = {line: "//", preamble: "^<\\?(php)?[^\\n]*\\n", trailer: "\\?>\\s*$"};

	test("単一行コメントを並べる。空行は記号だけにする", () => {
		expect(toComment("a\n\nb", c, "line")).toBe("// a\n//\n// b");
	});

	test("複数行コメントで囲む", () => {
		expect(toComment("a\nb", c, "block")).toBe("/*\na\nb\n*/");
	});

	test("複数行コメントがない言語では単一行コメントで書く", () => {
		expect(toComment("a", python, "block")).toBe("# a");
	});

	test("閉じる記号を含む文字列は単一行コメントで書く", () => {
		expect(toComment("a */ b", c, "block")).toBe("// a */ b");
	});

	test("単一行コメントがない言語では行ごとに囲み、書けなければ null を返す", () => {
		expect(toComment("a\nb", ocaml, "line")).toBe("(* a *)\n(* b *)");
		expect(toComment("a *) b", ocaml, "line")).toBeNull();
	});

	test("変数を置き換え、知らない名前は残す", () => {
		expect(fillVariables("{task} {x}", {task: "abc1_a"})).toBe("abc1_a {x}");
		expect(fillVariables("{constructor} {__proto__}", {})).toBe("{constructor} {__proto__}");
	});

	test("貼り付けでコード全体が置き換わったか判定する", () => {
		expect(isWholeCode("a\nb\n", "a\r\nb\r\n")).toBe(true);
		expect(isWholeCode("a\nb\n", "b")).toBe(false);
	});

	test("シェバンの後ろにヘッダーを置く", () => {
		expect(insertHeader("#!/bin/sh\necho\n", "# h\n", python)).toBe("#!/bin/sh\n# h\necho\n");
	});

	test("PHP の開始タグの後ろにヘッダーを、終了タグの前にフッターを置く", () => {
		expect(insertHeader("<?php\necho 1;\n", "// h\n", php)).toBe("<?php\n// h\necho 1;\n");
		expect(insertFooter("<?php\necho 1;\n?>\n", "// f\n", php)).toBe("<?php\necho 1;\n// f\n?>\n");
	});

	test("末尾の改行の有無によらずフッターを行の頭に置く", () => {
		expect(insertFooter("code", "// f\n", c)).toBe("code\n// f\n");
		expect(insertFooter("code\n\n", "// f\n", c)).toBe("code\n// f\n");
	});

	test("挿入した部分を置き換える。見つからなければ null を返す", () => {
		expect(replaceBlock("// a\ncode\n", "// a\n", "# a\n", false)).toBe("# a\ncode\n");
		expect(replaceBlock("x\ny\nx\n", "x\n", "z\n", true)).toBe("x\ny\nz\n");
		expect(replaceBlock("code\n", "// a\n", "", false)).toBeNull();
	});
});

describe("Java の折りたたみ", () => {
	test("型の宣言とコメントの開始行を返す", () => {
		const source = ["/* a */", "import java.util.*;", "public final class Main {", "\tvoid f() {}", "}", "record P() {}"].join("\n");
		expect(findFoldStartLines(source)).toEqual([0, 2, 5]);
	});
});

describe("Java の public な型", () => {
	test("行頭から始まる型の宣言だけ public を外す", () => {
		const source = [
			"import java.util.*;",
			"public final class Main {",
			"\tpublic static void main(String[] args) {}",
			"\tpublic static final class Inner {}",
			"}",
			"final public class A {}",
			"public interface B {}",
			"public record C() {}",
			"public @interface D {}",
			"public enum E {}",
		].join("\n");
		expect(withoutPublicTypes(source)).toBe([
			"import java.util.*;",
			"final class Main {",
			"\tpublic static void main(String[] args) {}",
			"\tpublic static final class Inner {}",
			"}",
			"final class A {}",
			"interface B {}",
			"record C() {}",
			"@interface D {}",
			"enum E {}",
		].join("\n"));
	});

	test("public な型がなければ変えない", () => {
		const source = "class Main {\n\tpublic int value;\n}\n";
		expect(withoutPublicTypes(source)).toBe(source);
	});
});
