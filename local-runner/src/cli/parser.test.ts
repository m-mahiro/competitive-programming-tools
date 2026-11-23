import {describe, expect, test} from "bun:test";
import {chooseSubmitLanguageIds, extractSamples, findNewestSubmissionId, isAtCoderLoginPage} from "./parser";

const JAVA = {name: "java", family: "java", isJava: true, runtimeFileName: "Main.java"};

function sampleSection(kind: "入力例" | "出力例", index: number, text: string): string {
	return `<div class="part"><section><h3>${kind} ${index}</h3><pre>${text}</pre></section></div>`;
}

describe("isAtCoderLoginPage", () => {
	const publicTask = `<html><head><title>A - Past ABCs</title></head><body>
		<ul class="nav"><li><a href="/login?continue=https%3A%2F%2Fatcoder.jp%2Fcontests%2Fabc350%2Ftasks%2Fabc350_a">ログイン</a></li></ul>
		<h3>入力例 1</h3><pre>ABC349</pre></body></html>`;

	test("未ログインでも読めるページのログインのリンクでは、ログイン画面としない", () => {
		expect(isAtCoderLoginPage(publicTask, "https://atcoder.jp/contests/abc350/tasks/abc350_a")).toBe(false);
	});

	test("ログイン画面への転送、題名、パスワードの入力欄で判定する", () => {
		expect(isAtCoderLoginPage("", "https://atcoder.jp/login?continue=https%3A%2F%2Fatcoder.jp%2F")).toBe(true);
		expect(isAtCoderLoginPage("<title>Sign In - AtCoder</title>")).toBe(true);
		expect(isAtCoderLoginPage("<title>ログイン - AtCoder</title>")).toBe(true);
		expect(isAtCoderLoginPage('<form><input type="password" name="password"></form>')).toBe(true);
	});
});

describe("extractSamples", () => {
	test("番号で入力と出力を組にし、日本語と英語の同じ例は1つにする", () => {
		const html = sampleSection("入力例", 1, "1") +sampleSection("出力例", 1, "2")
			+ sampleSection("入力例", 2, "3") + sampleSection("出力例", 2, "4")
			+ "<h3>Sample Input 1</h3><pre>1</pre><h3>Sample Output 1</h3><pre>2</pre>";
		expect(extractSamples(html)).toEqual([
			{index: 1, input: "1", expectedOutput: "2"},
			{index: 2, input: "3", expectedOutput: "4"},
		]);
	});

	test("<pre> の直後の改行は、HTML と同じく例に含めない", () => {
		const html = '<h3>入力例 1</h3><pre class="prettyprint linenums">\n15\n10\n</pre><h3>出力例 1</h3><pre>\r\n5\n</pre>';
		expect(extractSamples(html)).toEqual([{index: 1, input: "15\n10\n", expectedOutput: "5\n"}]);
	});

	test("片方しか無い番号があれば、別の番号と組にせず止める", () => {
		const html = sampleSection("入力例", 1, "1") + sampleSection("入力例", 2, "3") + sampleSection("出力例", 2, "4");
		expect(() => extractSamples(html)).toThrow("Sample 1 has only an input or only an output");
	});

	test("同じ番号で内容の違う例があれば止める", () => {
		const html = sampleSection("入力例", 1, "1") + sampleSection("出力例", 1, "2")
			+ "<h3>Sample Input 1</h3><pre>9</pre>";
		expect(() => extractSamples(html)).toThrow("Sample 1 has different inputs");
	});
});

describe("chooseSubmitLanguageIds", () => {
	test("JavaScript しか無いフォームでは、Java の ID を返さない", () => {
		const options = [{value: "6056", label: "JavaScript (Node.js 22.19.0)"}, {value: "6057", label: "JavaScript (Deno 2.4.5)"}];
		expect(() => chooseSubmitLanguageIds(options, JAVA, "6056")).toThrow("Java language ID was not found");
	});

	test("固定の ID が Java の選択肢でなければ、フォームの Java を使う", () => {
		const options = [{value: "6056", label: "JavaScript (Node.js 22.19.0)"}, {value: "6100", label: "Java24 (OpenJDK 24.0.2)"}];
		expect(chooseSubmitLanguageIds(options, JAVA, "6056")).toEqual(["6100"]);
	});
});

describe("findNewestSubmissionId", () => {
	const row = (task: string, id: number) => `<tr><td><a href="/contests/abc1/tasks/${task}">${task}</a></td>`
		+ `<td><a href="/contests/abc1/submissions/${id}">Detail</a></td></tr>`;
	const html = `<nav><a href="/contests/abc1/submissions/me">My</a><a href="/contests/abc1/submissions/150">x</a></nav>`
		+ `<table><tbody>${row("abc1_b", 200)}${row("abc1_a", 100)}${row("abc1_a", 99)}</tbody></table>`;

	test("その問題の行だけから、前の ID より新しいものを選ぶ", () => {
		expect(findNewestSubmissionId(html, "abc1", "abc1_a")).toBe("100");
		expect(findNewestSubmissionId(html, "abc1", "abc1_a", "100")).toBe("");
		expect(findNewestSubmissionId(html, "abc1", "abc1_b", "100")).toBe("200");
	});

	test("ジャッジ待ちの行の data-id も読み、桁の多い ID を新しいとする", () => {
		const waiting = `<tr><td><a href="/contests/abc1/tasks/abc1_a">A</a></td><td class="waiting-judge" data-id="1000"></td></tr>`;
		expect(findNewestSubmissionId(html + waiting, "abc1", "abc1_a", "999")).toBe("1000");
	});
});
