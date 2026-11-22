import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createModal, type Modal} from "@ui/dialog/modal";
import {configureToasts, showToast, type Toast} from "@ui/toast/toast";

function toasts(): HTMLElement[] {
	return [...document.body.children].flatMap((host) => [...host.shadowRoot?.querySelectorAll<HTMLElement>(".toast") ?? []]);
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
