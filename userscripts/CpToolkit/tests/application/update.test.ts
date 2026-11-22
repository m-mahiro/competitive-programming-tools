import {describe, expect, test} from "bun:test";
import type {HttpResponse} from "@application/ports/services";
import {httpsHostOf, isNewerVersion, readMetadataValue} from "@domain/update/version";
import {createFakeUpdates, FakeHttpClient, MemoryStore} from "../support/fakes";

const HOUR_MS = 60 * 60 * 1000;

const UPDATE_URL = "https://updates.example/scripts/1/tool.meta.js";

const DOWNLOAD_URL = "https://updates.example/scripts/1/tool.user.js";

function header(version: string): string {
	return `// ==UserScript==\n// @name        CP Toolkit\n// @version     ${version}\n// @grant       none\n// ==/UserScript==\n`;
}

describe("バージョンとヘッダー", () => {
	test("数として比べ、読めないものは新しいとみなさない", () => {
		expect(isNewerVersion("2.10.0", "2.9.9")).toBe(true);
		expect(isNewerVersion("2.0.0", "2.0.0")).toBe(false);
		expect(isNewerVersion("1.9.9", "2.0.0")).toBe(false);
		expect(isNewerVersion("2.1", "2.0.5")).toBe(true);
		expect(isNewerVersion("", "2.0.0")).toBe(false);
		expect(isNewerVersion("3.0.0-beta", "2.0.0")).toBe(false);
	});

	test("ヘッダーから項目の値を読む", () => {
		const text = `${header("2.1.0")}// @version 9.9.9 は本文の中\n`;
		expect(readMetadataValue(text, "version")).toBe("2.1.0");
		expect(readMetadataValue("// @updateURL   https://updates.example/a.meta.js  \r\n", "updateURL")).toBe("https://updates.example/a.meta.js");
		expect(readMetadataValue(text, "downloadURL")).toBeNull();
		expect(readMetadataValue("// @noframes\n", "noframes")).toBeNull();
	});

	test("https の URL のホストだけを返す", () => {
		expect(httpsHostOf("https://Updates.Example/scripts/1.meta.js")).toBe("updates.example");
		expect(httpsHostOf("https://updates.example")).toBe("updates.example");
		expect(httpsHostOf("http://updates.example/a.js")).toBeNull();
		expect(httpsHostOf("https://user@evil.example/a.js")).toBeNull();
		expect(httpsHostOf("file:///C:/a.user.js")).toBeNull();
	});
});

describe("更新の確認", () => {
	const setup = (respond: () => HttpResponse, host: {updateUrl?: string | null; downloadUrl?: string | null; version?: string} = {}) => {
		const http = new FakeHttpClient(respond);
		const state = new MemoryStore();
		const updates = createFakeUpdates({
			host: {version: "2.0.0", updateUrl: UPDATE_URL, downloadUrl: DOWNLOAD_URL, ...host},
			http,
			state,
		});
		return {http, state, updates};
	};

	test("導入元のヘッダーを取得し、新しいバージョンと入手先を返す", async () => {
		const {http, updates} = setup(() => ({status: 206, text: header("2.1.0")}));
		expect(updates.status()).toEqual({current: "2.0.0", latest: null, downloadUrl: null, supported: true});
		expect(await updates.check(100 * HOUR_MS)).toEqual({current: "2.0.0", latest: "2.1.0", downloadUrl: DOWNLOAD_URL, supported: true});
		expect(http.requests).toEqual([{url: UPDATE_URL, headers: {Range: "bytes=0-8191"}, timeoutMs: 10_000}]);
		// 結果は覚えていて、通信せずに読める
		expect(updates.status().latest).toBe("2.1.0");
	});

	test("同じか古いバージョンなら、更新なしとする", async () => {
		expect((await setup(() => ({status: 200, text: header("2.0.0")})).updates.check(100 * HOUR_MS)).latest).toBeNull();
		expect((await setup(() => ({status: 200, text: header("1.9.0")})).updates.check(100 * HOUR_MS)).latest).toBeNull();
	});

	test("間隔が空くまでは通信しない。force なら通信する", async () => {
		const {http, updates} = setup(() => ({status: 200, text: header("2.1.0")}));
		await updates.check(100 * HOUR_MS);
		await updates.check(100 * HOUR_MS + 23 * HOUR_MS);
		expect(http.requests.length).toBe(1);
		await updates.check(100 * HOUR_MS + 24 * HOUR_MS);
		expect(http.requests.length).toBe(2);
		await updates.check(100 * HOUR_MS + 24 * HOUR_MS + 1, true);
		expect(http.requests.length).toBe(3);
	});

	test("取得に失敗しても、覚えている結果を保ち、間隔が空くまで繰り返さない", async () => {
		let fail = false;
		const {http, updates} = setup(() => {
			if (fail) throw new Error("offline");
			return {status: 200, text: header("2.1.0")};
		});
		await updates.check(100 * HOUR_MS);
		fail = true;
		expect((await updates.check(200 * HOUR_MS)).latest).toBe("2.1.0");
		await updates.check(200 * HOUR_MS + 1);
		expect(http.requests.length).toBe(2);
	});

	test("ヘッダーを読めない応答は無視する", async () => {
		expect((await setup(() => ({status: 404, text: header("9.9.9")})).updates.check(100 * HOUR_MS)).latest).toBeNull();
		expect((await setup(() => ({status: 200, text: "<html>not a script</html>"})).updates.check(100 * HOUR_MS)).latest).toBeNull();
	});

	test("更新元が無いか、通信してよい配布元でなければ確かめない", async () => {
		for (const updateUrl of [null, "https://other.example/tool.meta.js", "http://updates.example/tool.meta.js"]) {
			const {http, updates} = setup(() => ({status: 200, text: header("2.1.0")}), {updateUrl, downloadUrl: null});
			expect(await updates.check(100 * HOUR_MS, true)).toEqual({current: "2.0.0", latest: null, downloadUrl: null, supported: false});
			expect(http.requests).toEqual([]);
		}
	});

	test("@updateURL が無ければ @downloadURL で確かめる。入手先は @downloadURL だけを使う", async () => {
		const byDownload = setup(() => ({status: 200, text: header("2.1.0")}), {updateUrl: null});
		expect((await byDownload.updates.check(100 * HOUR_MS)).latest).toBe("2.1.0");
		expect(byDownload.http.requests[0]!.url).toBe(DOWNLOAD_URL);
		const byUpdate = setup(() => ({status: 200, text: header("2.1.0")}), {downloadUrl: null});
		expect(await byUpdate.updates.check(100 * HOUR_MS)).toEqual({current: "2.0.0", latest: "2.1.0", downloadUrl: null, supported: true});
	});

	test("新しいバージョンは、バージョンごとに1回だけ知らせる", async () => {
		let version = "2.0.0";
		const {updates} = setup(() => ({status: 200, text: header(version)}));
		await updates.check(100 * HOUR_MS);
		expect(updates.claimNotification()).toBe(false);
		version = "2.1.0";
		await updates.check(200 * HOUR_MS);
		expect(updates.claimNotification()).toBe(true);
		expect(updates.claimNotification()).toBe(false);
		version = "2.2.0";
		await updates.check(300 * HOUR_MS);
		expect(updates.claimNotification()).toBe(true);
		expect(updates.claimNotification()).toBe(false);
	});

	test("壊れた保存値は、初めての確認として扱う", async () => {
		const {state, updates} = setup(() => ({status: 200, text: header("2.1.0")}));
		state.set("update:state", {latest: 5, checkedAt: "yesterday"});
		expect(updates.status().latest).toBeNull();
		expect((await updates.check(100 * HOUR_MS)).latest).toBe("2.1.0");
	});
});
