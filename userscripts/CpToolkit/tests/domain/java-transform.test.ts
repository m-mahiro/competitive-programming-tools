import {describe, expect, test} from "bun:test";
import {modifyJavaCode} from "@atcoder-tools/shared";

const rename = (code: string) => modifyJavaCode(code).modified;
const withMain = (signature: string) => `class Helper {}\nclass Solver {\n\t${signature} {}\n}\n`;

describe("modifyJavaCode の Main への改名", () => {
	test.each([
		"public static void main(String[] args)",
		"static public void main(String[] args)",
		"public static void main(String... args)",
		"public static void main(final String[] args)",
		"public static void main(String args[])",
		"public static void main(String []args)",
		"public final static void main(String[] args)",
		"public static synchronized void main(String[] args)",
		"@Deprecated public static void main(String[] args)",
		"public static void main(@SuppressWarnings(\"unused\") String[] args)",
		"public static void main(final @SuppressWarnings(\"unused\") String[] args)",
		"public static void main(\n\t\tString[] args\n\t)",
	])("%s を持つ型を選ぶ", (signature) => {
		const result = rename(withMain(signature));
		expect(result).toContain("class Helper {}");
		expect(result).toContain("class Main {");
	});

	test.each([
		"public static int main(String[] args)",
		"public void main(String[] args)",
		"static void main(String[] args)",
		"public static void main(int[] args)",
		"public static void main(String args)",
	])("%s は main として扱わない", (signature) => {
		const result = rename(`class First {\n\t${signature} {}\n}\nclass Second {\n\tpublic static void main(String[] args) {}\n}\n`);
		expect(result).toContain("class First {");
		expect(result).toContain("class Main {");
	});

	test("main を持つ型が複数あれば Main を残す", () => {
		const code = "class Tool {\n\tpublic static void main(String[] args) {}\n}\npublic class Main {\n\tpublic static void main(String[] args) {}\n}\n";
		expect(modifyJavaCode(code).classReplaced).toBe(false);
	});

	test("コメントと文字列の中の main は無視する", () => {
		const code = "class First {\n\t// public static void main(String[] args)\n\tString s = \"public static void main(String[] args)\";\n}\nclass Second {\n\tpublic static void main(String[] args) {}\n}\n";
		const result = rename(code);
		expect(result).toContain("class First {");
		expect(result).toContain("class Main {");
	});

	test("main を持つ型が複数あり Main も無ければ改名しない", () => {
		const code = "class First {\n\tpublic static void main(String[] args) {}\n}\nclass Second {\n\tpublic static void main(String[] args) {}\n}\n";
		expect(modifyJavaCode(code).classReplaced).toBe(false);
	});

	test("入れ子の型にしか main が無ければ改名しない", () => {
		const code = "class Outer {\n\tstatic class Inner {\n\t\tpublic static void main(String[] args) {}\n\t}\n}\n";
		expect(modifyJavaCode(code).classReplaced).toBe(false);
	});

	test("main が無ければ改名しない", () => {
		expect(modifyJavaCode("class Helper {}\npublic class Solver {}\n").classReplaced).toBe(false);
	});

	test("record と interface の main も見つける", () => {
		expect(rename("record A(int x) {\n\tpublic static void main(String[] args) {}\n}\nclass Helper {}\n"))
			.toBe("record Main(int x) {\n\tpublic static void main(String[] args) {}\n}\nclass Helper {}\n");
		expect(rename("interface A {\n\tstatic void main(String[] args) {}\n}\n")).toBe("interface Main {\n\tstatic void main(String[] args) {}\n}\n");
	});

	test("同じ名前の変数もそろえて変え、. の付く名前は変えない", () => {
		const code = "import java.util.*;\npublic final class A {\n\tpublic static void main(String... args) {\n\t\tint[] A = new int[3];\n\t\tSystem.out.println(A.length);\n"
			+ "\t\tMap.A x = null;\n\t\tA.class.getName();\n\t}\n\tstatic void f(int... A) {}\n}\n";
		expect(rename(code)).toBe("import java.util.*;\npublic final class Main {\n\tpublic static void main(String... args) {\n\t\tint[] Main = new int[3];\n\t\tSystem.out.println(Main.length);\n"
			+ "\t\tMap.A x = null;\n\t\tMain.class.getName();\n\t}\n\tstatic void f(int... Main) {}\n}\n");
	});

	test("Main という名前がすでにあれば改名しない", () => {
		expect(modifyJavaCode("public class A {\n\tstatic class Main {}\n\tpublic static void main(String[] args) {}\n}\n").classReplaced).toBe(false);
		expect(modifyJavaCode("public class A {\n\tpublic static void main(String[] args) { int Main = 1; }\n}\n").classReplaced).toBe(false);
	});

	test(". の付く Main はほかの型のものなので、改名を妨げない", () => {
		expect(rename("public class A {\n\tpublic static void main(String[] args) { other.Main.run(); }\n}\n")).toContain("public class Main {");
	});
});

describe("modifyJavaCode のデバッグ用の変数", () => {
	const code = "public class Main {\n\tprivate static final boolean DEBUG = true;\n\tstatic class Inner { static boolean DEBUG = true; }\n"
		+ "\tpublic static void main(String[] args) {\n\t\tboolean DEBUG = true;\n\t}\n}\n";

	test("起動クラスの直下の宣言だけを false にする", () => {
		const result = modifyJavaCode(code, {debugFlag: "DEBUG"});
		expect(result.modified).toBe(code.replace("private static final boolean DEBUG = true;", "private static final boolean DEBUG = false;"));
		expect(result.debugReplaced).toBe(true);
	});

	test("名前を設定しなければ変えない", () => {
		expect(modifyJavaCode(code, {debugFlag: ""}).modified).toBe(code);
		expect(modifyJavaCode(code.replaceAll("DEBUG", "LOCAL"), {debugFlag: "DEBUG"}).debugReplaced).toBe(false);
	});
});

describe("createMaskedCode", () => {
	test("テキストブロックの中を書き換えない", () => {
		const code = "public class A {\n\tpublic static void main(String[] args) {\n\t\tString s = \"\"\"\n\t\t\tsay \"DEBUG = true\" and A\n\t\t\t\"\"\";\n\t}\n}\n";
		const result = modifyJavaCode(code, {debugFlag: "DEBUG"});
		expect(result.modified).toContain("say \"DEBUG = true\" and A");
		expect(result.debugReplaced).toBe(false);
		expect(result.modified).toContain("public class Main {");
	});
});
