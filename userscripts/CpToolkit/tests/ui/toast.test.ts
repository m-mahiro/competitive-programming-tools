import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {configureToasts, showToast, type Toast} from "@ui/toast/toast";
import {wait} from "../support/dom";

function toasts(): HTMLElement[] {
	return [...document.body.children].flatMap((host) => [...host.shadowRoot?.querySelectorAll<HTMLElement>(".toast") ?? []]);
}

function toastRegion(): HTMLElement | null {
	for (const host of document.body.children) {
		const region = host.shadowRoot?.querySelector<HTMLElement>(".toasts");
		if (region) return region;
	}
	return null;
}

const base: Toast = {title: "AC: A - Problem", detail: "12 ms", tone: "success", durationMs: 10_000};

beforeEach(() => {
	configureToasts({region: "CP Toolkit", close: () => "閉じる"});
	// ほかのテストが残した通知と、待たされたままの通知を片付ける
	showToast({...base, title: "leftover"});
	for (const toast of toasts()) toast.click();
});

afterEach(() => {
	for (const toast of toasts()) toast.click();
});

describe("通知", () => {
	test("領域に名前を付け、通知の種類に合わせて読み上げ方を決める", () => {
		showToast(base);
		showToast({...base, title: "WA: B - Problem", tone: "warning"});
		const [success, warning] = toasts();
		expect(toastRegion()?.getAttribute("role")).toBe("region");
		expect(toastRegion()?.getAttribute("aria-label")).toBe("CP Toolkit");
		expect(success!.getAttribute("role")).toBe("status");
		expect(warning!.getAttribute("role")).toBe("alert");
	});

	test("閉じるボタンと、通知のクリックで消える", () => {
		showToast(base);
		showToast({...base, title: "second"});
		const [first, second] = toasts();
		const button = first!.querySelector<HTMLButtonElement>("button.toast-close");
		expect(button?.getAttribute("aria-label")).toBe("閉じる");
		button!.click();
		expect(toasts()).toEqual([second!]);
		second!.click();
		expect(toasts()).toEqual([]);
	});

	test("時間が経つと消える。カーソルやフォーカスがある間は消えない", async () => {
		showToast({...base, durationMs: 40});
		const [toast] = toasts();
		toast!.dispatchEvent(new Event("pointerenter"));
		toast!.dispatchEvent(new Event("focusin"));
		await wait(90);
		expect(toasts().length).toBe(1);
		toast!.dispatchEvent(new Event("pointerleave"));
		await wait(90);
		// フォーカスが残っている間は、まだ消さない
		expect(toasts().length).toBe(1);
		toast!.dispatchEvent(new Event("focusout"));
		await wait(90);
		expect(toasts().length).toBe(0);
	});

	test("リンクのある通知は、題名を新しいタブで開くリンクにする", () => {
		showToast({...base, href: "https://example.invalid/submissions/1"});
		const link = toasts()[0]!.querySelector<HTMLAnchorElement>("a");
		expect(link?.href).toBe("https://example.invalid/submissions/1");
		expect(link?.target).toBe("_blank");
		expect(link?.rel).toBe("noopener");
	});

	test("詳しい内容は閉じた状態で添え、開閉のクリックでは消えない", () => {
		showToast({...base, more: {label: "javac の診断", text: "ERROR 1:1 compiler.err.doesnt.exist"}});
		const more = toasts()[0]!.querySelector<HTMLDetailsElement>("details.toast-more");
		expect(more?.open).toBe(false);
		expect(more?.querySelector("summary")?.textContent).toBe("javac の診断");
		expect(more?.querySelector("pre")?.textContent).toBe("ERROR 1:1 compiler.err.doesnt.exist");
		more!.querySelector("summary")!.click();
		expect(toasts().length).toBe(1);
	});
});
