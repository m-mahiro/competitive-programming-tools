import {describe, expect, test} from "bun:test";
import {modifyJavaCode, transformJavaForSubmission} from "@atcoder-tools/shared";

const rename = (code: string) => modifyJavaCode(code);

const withMain = (signature: string) => `class Helper {}\nclass Solver {\n\t${signature} {}\n}\n`;

describe("modifyJavaCode の Main への改名", () => {
	test.each([
		"public static void main(String[] args)",
		"static public void main(String[] args)",
		"public static void main(String... args)",
		"public static void main(java.lang.String[] args)",
		"public static void main(java.lang.String args[])",
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
		"public static void main(String[][] args)",
		"public static void main(String[] args, int extra)",
	])("%s は main として扱わない", (signature) => {
		const result = rename(`class First {\n\t${signature} {}\n}\nclass Second {\n\tpublic static void main(String[] args) {}\n}\n`);
		expect(result).toContain("class First {");
		expect(result).toContain("class Main {");
	});

	test("main を持つ型が複数あれば Main を残す", () => {
		const code = "class Tool {\n\tpublic static void main(String[] args) {}\n}\npublic class Main {\n\tpublic static void main(String[] args) {}\n}\n";
		expect(modifyJavaCode(code)).toBe(code);
	});

	test("コメントと文字列の中の main は無視する", () => {
		const code = "class First {\n\t// public static void main(String[] args)\n\tString s = \"public static void main(String[] args)\";\n}\nclass Second {\n\tpublic static void main(String[] args) {}\n}\n";
		const result = rename(code);
		expect(result).toContain("class First {");
		expect(result).toContain("class Main {");
	});

	test("main を持つ型が複数あり Main も無ければ改名しない", () => {
		const code = "class First {\n\tpublic static void main(String[] args) {}\n}\nclass Second {\n\tpublic static void main(String[] args) {}\n}\n";
		expect(modifyJavaCode(code)).toBe(code);
	});

	test("入れ子の型にしか main が無ければ改名しない", () => {
		const code = "class Outer {\n\tstatic class Inner {\n\t\tpublic static void main(String[] args) {}\n\t}\n}\n";
		expect(modifyJavaCode(code)).toBe(code);
	});

	test("main が無ければ改名しない", () => {
		expect(modifyJavaCode("class Helper {}\npublic class Solver {}\n")).toBe("class Helper {}\npublic class Solver {}\n");
	});

	test("record と interface の main も見つける", () => {
		expect(rename("record A(int x) {\n\tpublic static void main(String[] args) {}\n}\nclass Helper {}\n"))
			.toBe("record Main(int x) {\n\tpublic static void main(String[] args) {}\n}\nclass Helper {}\n");
		expect(rename("interface A {\n\tstatic void main(String[] args) {}\n}\n")).toBe("interface Main {\n\tstatic void main(String[] args) {}\n}\n");
	});

	test("同じ名前の変数もそろえて変える", () => {
		const code = "import java.util.*;\npublic final class A {\n\tpublic static void main(String... args) {\n\t\tint[] A = new int[3];\n\t\tSystem.out.println(A.length);\n"
			+ "\t\tA.class.getName();\n\t}\n\tstatic void f(int... A) {}\n}\n";
		expect(transformJavaForSubmission("package p;\r\n" + code.replaceAll("\n", "\r\n"))).toEqual({
			sourceCode: "import java.util.*;\npublic final class Main {\n\tpublic static void main(String... args) {\n\t\tint[] Main = new int[3];\n\t\tSystem.out.println(Main.length);\n"
				+ "\t\tMain.class.getName();\n\t}\n\tstatic void f(int... Main) {}\n}\n",
			issue: null,
		});
	});

	test("ほかの型のメンバーは変えず、同じ名前の変数がそれと重なるときは元のコードを残す", () => {
		const entry = "import java.util.*;\npublic class Entry {\n\tpublic static void main(String[] args) {\n\t\tfor (Map.Entry<Integer, Integer> e : new HashMap<Integer, Integer>().entrySet()) {}\n\t}\n}\n";
		expect(rename(entry)).toBe(entry.replace("public class Entry", "public class Main"));
		const both = "public class A {\n\tpublic static void main(String[] args) {\n\t\tint A = 1;\n\t\tSystem.out.println(Other.A + A);\n\t}\n}\n";
		expect(transformJavaForSubmission(both)).toEqual({sourceCode: both, issue: "ambiguousReference"});
	});

	test("同じ名前のフィールドをほかの値のメンバーとしても使うときは、どちらか決められないので元のコードを残す", () => {
		const code = "class A$Impl { int A$Impl = 4; A$Impl() {} public static void main(String[] a) { System.out.print(new A$Impl().A$Impl); } }";
		expect(transformJavaForSubmission(code)).toEqual({sourceCode: code, issue: "ambiguousReference"});
		const own = "class A { int A = 4; public static void main(String[] a) { System.out.print(this.A + A.A); } }";
		expect(rename(own)).toBe("class Main { int Main = 4; public static void main(String[] a) { System.out.print(this.Main + Main.Main); } }");
	});

	test("起動型の同名 import と自分のパッケージの修飾参照を報告する", () => {
		expect(transformJavaForSubmission("import foo.Main; " + withMain("public static void main(String[] a)")).issue).toBe("nameCollision");
		const source = "package x; class A { public static void main(String[] a) { new x.A(); } }";
		expect(transformJavaForSubmission(source)).toEqual({sourceCode: source, issue: "ambiguousReference"});
	});

	test("型引数の String は起動引数を隠さず、自分の静的メソッド参照を改名する", () => {
		const source = "class Solver { static void go() {} java.util.List<String> words; public static void main(String[] args) { Runnable r = Solver::go; Solver.go(); } }";
		expect(rename(source)).toBe(source.replaceAll("Solver", "Main"));
		expect(transformJavaForSubmission(source.replace("class Solver", "class Solver<String>")).issue).toBe("mainNotFound");
	});

	test("Main という名前がすでにあれば改名しない", () => {
		expect(modifyJavaCode("public class A {\n\tstatic class Main {}\n\tpublic static void main(String[] args) {}\n}\n")).toBe("public class A {\n\tstatic class Main {}\n\tpublic static void main(String[] args) {}\n}\n");
		expect(modifyJavaCode("public class A {\n\tpublic static void main(String[] args) { int Main = 1; }\n}\n")).toBe("public class A {\n\tpublic static void main(String[] args) { int Main = 1; }\n}\n");
	});

	test(". の付く Main はほかの型のものなので、改名を妨げない", () => {
		expect(rename("public class A {\n\tpublic static void main(String[] args) { other.Main.run(); }\n}\n")).toContain("public class Main {");
	});
});

describe("modifyJavaCode のデバッグ用の変数", () => {
	const code = "public class Main {\n\tprivate static final boolean DEBUG = true;\n\tstatic class Inner { static boolean DEBUG = true; }\n"
		+ "\tpublic static void main(String[] args) {\n\t\tboolean DEBUG = true;\n\t}\n}\n";

	test("起動クラスの直下の宣言だけを false にする", () => {
		expect(modifyJavaCode(code, {debugFlag: "DEBUG"})).toBe(code.replace("private static final boolean DEBUG = true;", "private static final boolean DEBUG = false;"));
	});

	test("名前を設定しなければ変えない", () => {
		expect(modifyJavaCode(code, {debugFlag: ""})).toBe(code);
		const local = code.replaceAll("DEBUG", "LOCAL");
		expect(modifyJavaCode(local, {debugFlag: "DEBUG"})).toBe(local);
	});

	test("複合式を維持し、カンマ区切りの宣言でも単独リテラルだけを書き換える", () => {
		for (const expression of ["true == false", "true || other", "true ? false : true"]) {
			const original = code.replace("DEBUG = true;", "DEBUG = " + expression + ";");
			expect(modifyJavaCode(original, {debugFlag: "DEBUG"})).toBe(original);
		}
		const original = code.replace("boolean DEBUG = true;", "boolean A = false, DEBUG = /*flag*/ true;");
		expect(modifyJavaCode(original, {debugFlag: "DEBUG"})).toBe(original.replace("/*flag*/ true", "/*flag*/ false"));
	});
});

describe("createMaskedCode", () => {
	test("テキストブロックの中を書き換えない", () => {
		const code = "public class A {\n\tpublic static void main(String[] args) {\n\t\tString s = \"\"\"\n\t\t\tsay \"DEBUG = true\" and A\n\t\t\t\"\"\";\n\t}\n}\n";
		const result = modifyJavaCode(code, {debugFlag: "DEBUG"});
		expect(result).toContain("say \"DEBUG = true\" and A");
		expect(result).toContain("public class Main {");
	});
});
