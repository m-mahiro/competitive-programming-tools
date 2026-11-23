import {afterAll, beforeEach, describe, expect, test} from "bun:test";
import type {Task} from "../types";

// 利用者の設定を読まないよう、テスト用の設定ファイルを使う。
await import("../testSettings");
const {CLI_CONFIG} = await import("../config");
const atcoder = await import("./atcoder");

const JAVA = {name: "java", family: "java", isJava: true, runtimeFileName: "Main.java"};
const task: Task = {
	contestId: "abc1",
	taskScreenName: "abc1_a",
	taskUrl: "https://atcoder.jp/contests/abc1/tasks/abc1_a",
	submitUrl: "https://atcoder.jp/contests/abc1/submit",
	submitPostUrl: "https://atcoder.jp/contests/abc1/submit",
};

const SUBMIT_PAGE = `<form class="form-code-submit" action="/contests/abc1/submit" method="POST">
	<input type="hidden" name="csrf_token" value="token">
	<div id="select-lang-abc1_a"><select name="data.LanguageId">
		<option value="6056">Java (OpenJDK 21.0.1)</option>
		<option value="6100">Java24 (OpenJDK 24.0.2)</option>
	</select></div>
</form>`;

const row = (taskScreenName: string, id: number) =>
	`<tr><td><a href="/contests/abc1/tasks/${taskScreenName}">x</a></td><td><a href="/contests/abc1/submissions/${id}">Detail</a></td></tr>`;
const list = (...rows: string[]) => `<table><tbody>${rows.join("")}</tbody></table>`;

type Reply = {status?: number; url?: string; body: string};
let posts: number;
let listBodies: string[];
let postReply: () => Reply;
let listStatus: number;

function respond({status = 200, url, body}: Reply, requested: string): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		url: url ?? requested,
		headers: new Headers(),
		text: async () => body,
	} as Response;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const url = String(input);
	if (init?.method === "POST") {
		posts++;
		return respond(postReply(), url);
	}
	if (url.includes("/submissions/me")) {
		return respond({status: listStatus, body: listBodies.length > 1 ? listBodies.shift()! : listBodies[0]}, url);
	}
	return respond({body: SUBMIT_PAGE}, url);
}) as typeof fetch;

const COOKIE = "REVEL_SESSION=test";

beforeEach(() => {
	posts = 0;
	listStatus = 200;
	CLI_CONFIG.submissionIdDetectTimeoutMs = 30;
	CLI_CONFIG.submissionIdDetectIntervalMs = 1;
});

afterAll(() => {
	globalThis.fetch = originalFetch;
});

describe("submitToAtCoder", () => {
	test("提出の一覧へ戻ったら、一覧が更新されなくても別の言語で送り直さない", async () => {
		listBodies = [list(row("abc1_a", 100))];
		postReply = () => ({url: "https://atcoder.jp/contests/abc1/submissions/me", body: list(row("abc1_b", 200), row("abc1_a", 100))});
		const result = await atcoder.submitToAtCoder(task, "class Main {}", COOKIE, JAVA);
		expect(posts).toBe(1);
		expect(result.trackingUnavailable).toBe(true);
		expect(result.submissionUrl).toContain("/contests/abc1/submissions/me");
	});

	test("ほかの問題の新しい提出を、今回の提出としない", async () => {
		listBodies = [list(row("abc1_a", 100)), list(row("abc1_b", 200), row("abc1_a", 100)), list(row("abc1_a", 201), row("abc1_b", 200))];
		postReply = () => ({url: "https://atcoder.jp/contests/abc1/submissions/me", body: list(row("abc1_b", 200), row("abc1_a", 100))});
		const result = await atcoder.submitToAtCoder(task, "class Main {}", COOKIE, JAVA);
		expect(result).toEqual({submissionId: "201", submissionUrl: "https://atcoder.jp/contests/abc1/submissions/201"});
		expect(posts).toBe(1);
	});

	test("提出の応答にある、その問題の新しい行を使う", async () => {
		listBodies = [list(row("abc1_a", 100))];
		postReply = () => ({url: "https://atcoder.jp/contests/abc1/submissions/me", body: list(row("abc1_a", 101), row("abc1_a", 100))});
		expect((await atcoder.submitToAtCoder(task, "class Main {}", COOKIE, JAVA)).submissionId).toBe("101");
	});

	test("提出ページへ戻されたときだけ、次の言語で送り直す", async () => {
		listBodies = [list(row("abc1_a", 100))];
		postReply = () => ({url: task.submitUrl, body: '<div class="alert alert-danger">Invalid language</div>'});
		await expect(atcoder.submitToAtCoder(task, "class Main {}", COOKIE, JAVA)).rejects.toThrow("Invalid language");
		expect(posts).toBe(2);
	});

	test("認証が切れていれば、送らずに止める", async () => {
		listBodies = ["<html><head><title>Sign In - AtCoder</title></head></html>"];
		postReply = () => ({url: "https://atcoder.jp/contests/abc1/submissions/me", body: list(row("abc1_a", 101))});
		await expect(atcoder.submitToAtCoder(task, "class Main {}", COOKIE, JAVA)).rejects.toThrow("REVEL_SESSION");
		expect(posts).toBe(0);
	});

	test("提出前の ID を読めなければ(429)、応答の行を今回の提出としない", async () => {
		listStatus = 429;
		listBodies = [list(row("abc1_a", 100))];
		postReply = () => ({url: "https://atcoder.jp/contests/abc1/submissions/me", body: list(row("abc1_a", 100))});
		const result = await atcoder.submitToAtCoder(task, "class Main {}", COOKIE, JAVA);
		expect(posts).toBe(1);
		expect(result.trackingUnavailable).toBe(true);
	}, 10_000);
});

describe("httpGetText", () => {
	test("ログイン画面へ転送されたら認証の誤りにし、公開ページのログインのリンクでは誤りにしない", async () => {
		const savedFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request) => respond(String(input).includes("tasks")
			? {body: '<a href="/login?continue=https%3A%2F%2Fatcoder.jp%2F">ログイン</a><h3>入力例 1</h3><pre>1</pre>'}
			: {url: "https://atcoder.jp/login?continue=x", body: "<form></form>"}, String(input))) as typeof fetch;
		try {
			expect(await atcoder.httpGetText(task.taskUrl)).toContain("入力例");
			await expect(atcoder.httpGetText("https://atcoder.jp/contests/abc1/submissions/me", COOKIE)).rejects.toThrow("REVEL_SESSION");
		} finally {
			globalThis.fetch = savedFetch;
		}
	});
});
