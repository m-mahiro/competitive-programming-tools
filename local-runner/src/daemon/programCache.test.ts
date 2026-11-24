import {describe, expect, test} from "bun:test";
import {isProgramId, ProgramCache} from "./programCache";

type Program = {readonly id: string; readonly build: number};

/** 作ったプログラムと、消えたことにしたプログラムを覚えるキャッシュ。 */
function createCache(limit = 10) {
	const builds: string[] = [];
	const evicted: string[] = [];
	const removed = new Set<Program>();
	const cache = new ProgramCache<Program>({
		limit: () => limit,
		usable: (program) => !removed.has(program),
		evict: (program) => evicted.push(program.id),
	});
	const get = (id: string) => cache.get(id, async () => {
		builds.push(id);
		return {id, build: builds.length};
	});
	return {cache, get, builds, evicted, removed};
}

describe("ProgramCache", () => {
	test("同じプログラムは、作り終わる前に頼まれても1回だけ作る", async () => {
		const {get, builds} = createCache();
		const [first, second] = await Promise.all([get("a"), get("a")]);
		expect(first).toBe(second);
		expect(builds).toEqual(["a"]);
	});

	test("覚えていた結果を使ったときだけ hit を呼ぶ", async () => {
		const {cache} = createCache();
		const hits: string[] = [];
		const create = async () => ({id: "a", build: 1});
		await cache.get("a", create, () => hits.push("first"));
		await cache.get("a", create, () => hits.push("second"));
		expect(hits).toEqual(["second"]);
	});

	test("作業フォルダが消えて使えなければ、作り直す。同時に頼まれても作り直すのは1回", async () => {
		const {cache, get, builds, removed} = createCache();
		removed.add(await get("a"));
		expect(await cache.find("a")).toBeNull();
		const [first, second] = await Promise.all([get("a"), get("a")]);
		expect(first).toBe(second);
		expect(first.build).toBe(2);
		expect(builds).toEqual(["a", "a"]);
		expect(await cache.find("a")).toBe(first);
	});

	test("上限を超えたら、最後に使ったのが古いものから追い出す", async () => {
		const {cache, get, evicted} = createCache(2);
		await get("a");
		await get("b");
		await get("a");
		await get("c");
		await Promise.resolve();
		expect(evicted).toEqual(["b"]);
		expect(cache.has("a")).toBe(true);
		expect(cache.has("b")).toBe(false);
		expect(cache.size).toBe(2);
	});

	test("準備済み ID の実行も直近の使用に数える", async () => {
		const {cache, get, evicted} = createCache(2);
		await get("a");
		await get("b");
		await cache.use("a", async (program) => program.id);
		await get("c");
		expect(evicted).toEqual(["b"]);
	});

	test("例外で終わった作成は覚えず、次に頼まれたときにやり直す", async () => {
		const cache = new ProgramCache<Program>({limit: () => 10, usable: () => true, evict: () => undefined});
		await expect(cache.get("a", async () => {
			throw new Error("broken");
		})).rejects.toThrow("broken");
		expect(cache.has("a")).toBe(false);
		expect(await cache.get("a", async () => ({id: "a", build: 2}))).toEqual({id: "a", build: 2});
	});

	test("同じ id を使う最後の実行が終わるまで、上限を超えても追い出さない", async () => {
		const {cache, get, evicted} = createCache(1);
		await get("a");
		const first = Promise.withResolvers<void>();
		const last = Promise.withResolvers<void>();
		const a = cache.use("a", () => first.promise);
		const b = cache.use("a", () => last.promise);
		await get("b");
		await get("c");
		expect(evicted).toEqual(["b"]);
		first.resolve();
		await a;
		expect(cache.has("a")).toBe(true);
		last.reject(new Error("run failed"));
		await expect(b).rejects.toThrow("run failed");
		expect(evicted).toEqual(["b", "a"]);
		expect(cache.size).toBe(1);
	});
});

test("isProgramId はソースの長さと md5 の形だけを受け付ける", () => {
	expect(isProgramId(`1a2b-${"0".repeat(32)}`)).toBe(true);
	expect(isProgramId("../outside")).toBe(false);
	expect(isProgramId(`1a2b-${"0".repeat(31)}`)).toBe(false);
});
