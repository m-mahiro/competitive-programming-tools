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
});

describe("unresolvedImports", () => {
	test("エラーのある行の import の名前を返す", () => {
		const code = "import java.util.*;\nimport foo.Bar;\nimport baz.*;\nclass Main { Missing m; }\n";
		const error = (line: number) => ({kind: "ERROR", line, column: 1, code: "compiler.err.doesnt.exist", message: ""});
		expect(unresolvedImports(code, [error(2), error(3), error(4), {...error(1), kind: "WARNING"}])).toEqual(["foo.Bar", "baz.*"]);
	});
});
