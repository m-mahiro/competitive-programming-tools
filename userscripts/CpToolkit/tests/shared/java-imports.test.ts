import {describe, expect, test} from "bun:test";
import {importsPackage, unresolvedImports} from "@atcoder-tools/shared";

describe("importsPackage", () => {
	test("コメントの中の import は数えない", () => {
		expect(importsPackage("// import lib.ds.UnionFind;\nclass Main {}\n", "lib")).toBe(false);
		expect(importsPackage("import static lib.math.Mod.pow;\nclass Main {}\n", "lib")).toBe(true);
	});

	test("名前の途中が一致するだけのパッケージは数えない", () => {
		expect(importsPackage("import library.Foo;\nclass Main {}\n", "lib")).toBe(false);
		expect(importsPackage("import library.Foo;\nclass Main {}\n", "library")).toBe(true);
	});

	test("パッケージと同じ行の import、コメントと改行を含む static import を含める", () => {
		expect(importsPackage("package demo; import lib.Foo; class Main {}", "lib")).toBe(true);
		expect(importsPackage("import java.util.List; import static lib.\r\n /* group */ math.Mod.pow;", "lib")).toBe(true);
	});
});

describe("unresolvedImports", () => {
	test("エラーのある行の import の名前を返す", () => {
		const code = "import java.util.*;\nimport foo.Bar;\nimport baz.*;\nclass Main { Missing m; }\n";
		const error = (line: number) => ({kind: "ERROR", line, column: 1, code: "compiler.err.doesnt.exist", message: ""});
		expect(unresolvedImports(code, [error(2), error(3), error(4), {...error(1), kind: "WARNING"}])).toEqual(["foo.Bar", "baz.*"]);
	});

	test("同じ行の複数の import と本体のエラーを列で区別する", () => {
		const code = "\timport java.util.List; import missing.Foo; class Main { Missing x; }";
		const error = {kind: "ERROR", code: "compiler.err.doesnt.exist", line: 1, column: 46, message: ""};
		expect(unresolvedImports(code, [error])).toEqual(["missing.Foo"]);
		expect(unresolvedImports(code, [{...error, column: 68}])).toEqual([]);
		expect(unresolvedImports(code, [{...error, code: "compiler.err.expected"}])).toEqual([]);
		expect(unresolvedImports(code, [{...error, column: -1, importName: "missing.Foo"}])).toEqual(["missing.Foo"]);
	});
});
