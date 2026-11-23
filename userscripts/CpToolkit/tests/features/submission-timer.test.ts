import {afterEach, beforeEach, describe, expect, mock, setSystemTime, test} from "bun:test";
import {submissionTimer} from "@features/submission-timer/index";
import {createFakeServices} from "../support/fakes";

/** ブラウザが受け付ける setTimeout の待ち時間の上限。超えるとすぐに動く。 */
const MAX_DELAY_MS = 2 ** 31 - 1;
const START = Date.parse("2026-11-23T12:00:00Z");

type Pending = {callback: () => void; delay: number};
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let pending: Pending[];

beforeEach(() => {
	pending = [];
	setSystemTime(new Date(START));
	globalThis.setTimeout = ((callback: () => void, delay = 0) => {
		const entry = {callback, delay};
		pending.push(entry);
		return entry as unknown as ReturnType<typeof setTimeout>;
	}) as typeof setTimeout;
	globalThis.clearTimeout = ((entry: Pending | undefined) => {
		pending = pending.filter((item) => item !== entry);
	}) as typeof clearTimeout;
});

afterEach(() => {
	globalThis.setTimeout = realSetTimeout;
	globalThis.clearTimeout = realClearTimeout;
	setSystemTime();
});

/** 待ちの中でいちばん早いものまで時刻を進めて動かす。 */
function advance(): void {
	const next = pending.shift();
	if (!next) throw new Error("no timer is waiting");
	setSystemTime(new Date(Date.now() + next.delay));
	next.callback();
}

async function openTimer(): Promise<{submit: ReturnType<typeof mock>; schedule: (minutes: string) => void; info: () => string}> {
	document.body.innerHTML = '<button id="submit">Submit</button>';
	const submit = mock();
	document.querySelector("#submit")?.addEventListener("click", submit);
	await submissionTimer.run(undefined, createFakeServices({isOnRoute: () => true}));
	document.querySelector<HTMLButtonElement>("#submit + button")?.click();
	const root = [...document.body.children].map((element) => element.shadowRoot).find((shadow) => shadow?.querySelector("dialog"));
	if (!root) throw new Error("the dialog was not opened");
	const input = root.querySelector<HTMLInputElement>('input[type="number"]')!;
	const set = root.querySelector<HTMLButtonElement>(".modal-footer button")!;
	return {
		submit,
		schedule(minutes: string) {
			input.value = minutes;
			set.click();
		},
		info: () => root.querySelector(".modal-body p")?.textContent ?? "",
	};
}

describe("submissionTimer", () => {
	test("指定した分のあとに提出する", async () => {
		const {submit, schedule} = await openTimer();
		schedule("2");
		expect(pending.map(({delay}) => delay)).toEqual([2 * 60_000]);
		advance();
		expect(submit).toHaveBeenCalledTimes(1);
		expect(pending).toEqual([]);
	});

	test("上限を超える先の時刻でも、すぐには提出せず、その時刻まで待つ", async () => {
		const {submit, schedule} = await openTimer();
		schedule("36000");
		const due = START + 36000 * 60_000;
		while (Date.now() < due) {
			expect(pending).toHaveLength(1);
			expect(pending[0]!.delay).toBeLessThanOrEqual(MAX_DELAY_MS);
			expect(submit).not.toHaveBeenCalled();
			advance();
		}
		expect(Date.now()).toBe(due);
		expect(submit).toHaveBeenCalledTimes(1);
	});

	test("今日でない予約は日付も示し、日時として表せない先は予約しない", async () => {
		const {schedule, info} = await openTimer();
		schedule("2");
		expect(info()).toContain(new Date(START + 2 * 60_000).toLocaleTimeString());
		expect(info()).not.toContain(new Date(START).toLocaleDateString());
		schedule("36000");
		expect(info()).toContain(new Date(START + 36000 * 60_000).toLocaleString());
		schedule("1e15");
		expect(pending).toEqual([]);
		expect(info()).not.toContain("Invalid Date");
	});
});
