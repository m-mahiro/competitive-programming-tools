import {describe, expect, test} from "bun:test";
import {contestPagesOf, neighborTask, taskByLetter, taskKeyOf} from "@domain/contest/pages";
import {isModifierSetting, isShortcutSetting, normalizeModifiers, normalizeShortcut} from "@domain/settings/shortcut";

describe("キーの書き方", () => {
	test("修飾キーの順番と大文字をそろえる", () => {
		expect(normalizeShortcut("shift+ctrl+enter")).toBe("Ctrl+Shift+Enter");
		expect(normalizeShortcut("alt+ctrl+,")).toBe("Ctrl+Alt+,");
		expect(normalizeShortcut("ctrl+shift+alt+p")).toBe("Ctrl+Shift+Alt+P");
		expect(normalizeShortcut("meta+p")).toBeNull();
		expect(isShortcutSetting("None")).toBe(true);
	});

	test("修飾キーだけの設定は、修飾キーが1つ以上あり、ほかのキーを含まない", () => {
		expect(normalizeModifiers("alt + ctrl")).toBe("Ctrl+Alt");
		expect(normalizeModifiers("Ctrl+Alt+1")).toBeNull();
		expect(normalizeModifiers("")).toBeNull();
		expect(isModifierSetting("none")).toBe(true);
		expect(isModifierSetting("Ctrl+Shift+Alt")).toBe(true);
	});
});

describe("コンテストのページ", () => {
	test("AtCoder は問題のページなら、その問題の解説を開く", () => {
		expect(contestPagesOf("atcoder", "/contests/abc485/tasks/abc485_c")).toEqual({
			tasks: "/contests/abc485/tasks",
			mySubmissions: "/contests/abc485/submissions/me",
			standings: "/contests/abc485/standings",
			editorial: "/contests/abc485/tasks/abc485_c/editorial",
			customTest: "/contests/abc485/custom_test",
		});
		expect(contestPagesOf("atcoder", "/contests/abc485/standings")?.editorial).toBe("/contests/abc485/editorial");
		expect(contestPagesOf("atcoder", "/contests/archive")).toBeNull();
		expect(contestPagesOf("atcoder", "/users/someone")).toBeNull();
	});

	test("Codeforces は Gym と問題集の問題も、コンテストのページを開く", () => {
		expect(contestPagesOf("codeforces", "/contest/2000/problem/A")?.standings).toBe("/contest/2000/standings");
		expect(contestPagesOf("codeforces", "/gym/100001/problem/B")?.mySubmissions).toBe("/gym/100001/my");
		expect(contestPagesOf("codeforces", "/problemset/problem/2000/A")?.tasks).toBe("/contest/2000");
		expect(contestPagesOf("codeforces", "/contest/2000/problem/A")?.editorial).toBeNull();
		expect(contestPagesOf("yukicoder", "/problems/no/1")).toBeNull();
	});
});

describe("問題の切り替え", () => {
	const atcoder = ["a", "b", "c"].map((id) => ({url: `/contests/abc1/tasks/abc1_${id}`, label: id.toUpperCase()}));
	const codeforces = ["A", "B", "C1", "C2"].map((id) => ({url: `/contest/2000/problem/${id}`, label: id}));

	test("前後の問題を選び、端では選ばない", () => {
		expect(neighborTask(atcoder, "/contests/abc1/tasks/abc1_b", 1)?.label).toBe("C");
		expect(neighborTask(atcoder, "/contests/abc1/tasks/abc1_a", -1)).toBeNull();
		expect(neighborTask(atcoder, "/contests/abc1/tasks", 1)).toBeNull();
		expect(neighborTask(codeforces, "/problemset/problem/2000/b", 1)?.label).toBe("C1");
	});

	test("記号で選び、完全に一致するものが無ければ記号で始まる問題を選ぶ", () => {
		expect(taskByLetter(atcoder, "b")?.url).toBe("/contests/abc1/tasks/abc1_b");
		expect(taskByLetter(codeforces, "C")?.label).toBe("C1");
		expect(taskByLetter(codeforces, "Z")).toBeNull();
	});

	test("URL の書き方が違っても同じ問題とみなす", () => {
		expect(taskKeyOf("/problemset/problem/2000/A")).toBe(taskKeyOf("/contest/2000/problem/a"));
		expect(taskKeyOf("/contests/abc1/tasks")).toBeNull();
	});
});
