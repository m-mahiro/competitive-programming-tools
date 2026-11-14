import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createModal, type Modal} from "@ui/dialog/modal";
import {configureToasts, showToast, type Toast} from "@ui/toast/toast";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
	document.body.replaceChildren();
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
});

describe("ダイアログ", () => {
	let modal: Modal;

	const dialogOf = (): HTMLDialogElement => {
		for (const host of document.body.children) {
			const dialog = host.shadowRoot?.querySelector("dialog");
			if (dialog) return dialog;
		}
		throw new Error("ダイアログがありません");
	};

	beforeEach(() => {
		modal = createModal({title: "設定", closeLabel: "閉じる", css: ""});
		modal.open();
	});

	afterEach(() => {
		modal.close();
		const root = dialogOf().getRootNode();
		if (root instanceof ShadowRoot) root.host.remove();
	});

	test("見出しを名前として結び付ける", () => {
		const dialog = dialogOf();
		const labelledBy = dialog.getAttribute("aria-labelledby");
		expect(labelledBy).not.toBeNull();
		expect(dialog.querySelector(`#${labelledBy}`)?.textContent).toBe("設定");
		// showModal のダイアログには、役割や aria-modal を足さない
		expect(dialog.hasAttribute("role")).toBe(false);
		expect(dialog.hasAttribute("aria-modal")).toBe(false);
	});

	test("枠の外で押して離したときだけ閉じる。中で押し始めたときは閉じない", () => {
		const dialog = dialogOf();
		if (dialog.getAttribute("closedby") === "any") return; // ブラウザに任せる環境では、この処理は無い
		const inner = dialog.querySelector(".modal-body")!;
		const press = (target: Element) => target.dispatchEvent(new Event("pointerdown", {bubbles: true}));
		const click = (target: Element) => target.dispatchEvent(new Event("click", {bubbles: true}));

		// 中で文字を選び始め、枠の外で離す
		press(inner);
		click(dialog);
		expect(dialog.open).toBe(true);
		// 中をクリックする
		press(inner);
		click(inner);
		expect(dialog.open).toBe(true);
		// 枠の外で押して、枠の外で離す
		press(dialog);
		click(dialog);
		expect(dialog.open).toBe(false);
	});

	test("開いている間の通知は、閉じてから表示する", () => {
		showToast({...base, title: "during the dialog"});
		expect(toasts()).toEqual([]);
		modal.close();
		expect(toasts().map((toast) => toast.querySelector(".toast-title")?.textContent)).toEqual(["during the dialog"]);
	});
});
