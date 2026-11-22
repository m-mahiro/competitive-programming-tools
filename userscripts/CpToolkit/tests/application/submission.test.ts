import {describe, expect, test} from "bun:test";
import {PendingSubmissions} from "@application/submission/pending-submissions";
import {MemoryStore} from "../support/fakes";

describe("PendingSubmissions", () => {
	const submission = {id: "1", contestId: "abc1", taskName: "A", addedAt: 1000};

	test("同じ提出を重複して登録しない", () => {
		const pending = new PendingSubmissions(new MemoryStore());
		pending.add([submission], 1000);
		pending.add([submission], 1000);
		expect(pending.list(1000)).toHaveLength(1);
	});

	test("時間が経った提出は対象から外す", () => {
		const pending = new PendingSubmissions(new MemoryStore());
		pending.add([submission], 1000);
		expect(pending.list(1000 + 31 * 60 * 1000)).toHaveLength(0);
	});

	test("確認は間隔を空け、他のタブと重複しない", () => {
		const state = new MemoryStore();
		const first = new PendingSubmissions(state);
		const second = new PendingSubmissions(state);
		expect(first.claimPoll(10_000, 1000)).toBe(true);
		expect(second.claimPoll(10_500, 1000)).toBe(false);
		expect(second.claimPoll(11_000, 1000)).toBe(true);
	});

	test("サイトが勧める間隔まで確認を遅らせる", () => {
		const pending = new PendingSubmissions(new MemoryStore());
		pending.claimPoll(10_000, 1000);
		pending.postponePoll(13_000);
		expect(pending.claimPoll(12_000, 1000)).toBe(false);
		expect(pending.claimPoll(13_000, 1000)).toBe(true);
	});

	test("操作中のタブの記録は短い間だけ有効で、離れると消える", () => {
		const pending = new PendingSubmissions(new MemoryStore());
		pending.markFocused(10_000);
		expect(pending.isFocusedElsewhere(12_000)).toBe(true);
		expect(pending.isFocusedElsewhere(13_000)).toBe(false);

		pending.markFocused(14_000);
		pending.clearFocus();
		expect(pending.isFocusedElsewhere(14_000)).toBe(false);
	});

	test("操作中の記録を書き込む回数を抑える", () => {
		const state = new MemoryStore();
		const pending = new PendingSubmissions(state);
		pending.markFocused(10_000);
		pending.markFocused(10_500);
		expect(state.get("result-notifier:lastFocus")).toBe(10_000);
	});
});
