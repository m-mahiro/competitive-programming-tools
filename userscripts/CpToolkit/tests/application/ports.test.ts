import {describe, expect, test} from "bun:test";
import {readStored} from "@application/ports/key-value-store";
import {isArrayOf, isString} from "@domain/validation/guards";
import {SavedCodes} from "@features/easy-test/saved-code";
import {MemoryStore} from "../support/fakes";

describe("readStored", () => {
	test("形が正しい値はそのまま返す", () => {
		const store = new MemoryStore();
		store.set("key", ["a"]);
		expect(readStored(store, "key", isArrayOf(isString), [])).toEqual(["a"]);
	});

	test("未保存や形の違う値は既定値にする", () => {
		const store = new MemoryStore();
		expect(readStored(store, "key", isArrayOf(isString), [])).toEqual([]);
		store.set("key", {broken: true});
		expect(readStored(store, "key", isArrayOf(isString), [])).toEqual([]);
	});

	test("壊れた保存値があっても実行コードの記憶は動く", () => {
		const store = new MemoryStore();
		store.set("easy-test:saved-code", "broken");
		const codes = new SavedCodes(store, 10);
		expect(codes.find("/task")).toBeNull();
		codes.save("/task", "code");
		expect(codes.find("/task")).toBe("code");
	});

	test("上限を超えた分は古いものから捨てる", () => {
		const codes = new SavedCodes(new MemoryStore(), 2);
		codes.save("/a", "a");
		codes.save("/b", "b");
		codes.save("/c", "c");
		expect(codes.find("/a")).toBeNull();
		expect(codes.find("/b")).toBe("b");
		expect(codes.find("/c")).toBe("c");
	});

	test("上限が 0 なら保存しない", () => {
		const store = new MemoryStore();
		const codes = new SavedCodes(store, 0);
		codes.save("/a", "a");
		codes.save("/b", "b");
		expect(codes.find("/a")).toBeNull();
		expect(codes.find("/b")).toBeNull();
		expect(store.get("easy-test:saved-code")).toEqual([]);
	});
});
