import {describe, expect, test} from "bun:test";
import type {LocalRunnerTransformResponse} from "@atcoder-tools/shared";
import type {CommandLanguage} from "./commandEngine";
import type {RunnerLanguage} from "./languages";

// 利用者の設定を読まないよう、テスト用の設定ファイルを使う。
await import("../testSettings");
const {withLineOffset} = await import("./execution");

const java: RunnerLanguage = {name: "java", family: "java", displayName: "Java", label: "Java", match: [], command: null};
const command = (bundle: string[] | null): RunnerLanguage => ({...java, name: "cpp", family: "cpp", command: {bundle} as unknown as CommandLanguage});
const response = (sourceCode: string): LocalRunnerTransformResponse => ({status: "success", sourceCode, diagnostics: "", inlinedClasses: [], diagnosticItems: []});

describe("withLineOffset", () => {
	test("Java は、展開で足した import とヘッダーの行数を分けて返す", () => {
		const source = "import lib.io.*;\n\npublic class A {}\n";
		const finished = "// h\n\nimport java.io.*;\nimport java.util.*;\n// import lib.io.*;\n\npublic class Main {}\n";
		expect(withLineOffset(java, source, response(finished), 2).lineOffset).toEqual({header: 2, transform: 2});
	});

	test("Java の変換の前に見つかったエラーは、元のソースのままなので 0 にする", () => {
		const source = "import lib.io.*;\n\npublic class A { int x = \"\"; }\n";
		expect(withLineOffset(java, source, {...response(source), status: "compileError"}).lineOffset).toEqual({header: 0, transform: 0});
	});

	test("コマンドで動かす言語は、bundle が無ければ変換の行数は 0、あれば分からない", () => {
		expect(withLineOffset(command(null), "int main() {}\n", response("// h\n\nint main() {}\n"), 2).lineOffset).toEqual({header: 2, transform: 0});
		expect(withLineOffset(command(["bundle"]), "int main() {}\n", response("int main() {}\n")).lineOffset).toEqual({header: 0, transform: null});
	});
});
