import {h} from "@ui/element";
import themeCss from "@ui/theme.css" with {type: "text"};
import toastCss from "./toast.css" with {type: "text"};

export type Toast = {
	readonly title: string;
	readonly detail: string;
	readonly tone: "success" | "warning";
	readonly href?: string;
	readonly durationMs: number;
	/** 閉じた状態で添える詳しい内容。開くと全文を読める。 */
	readonly more?: {readonly label: string; readonly text: string};
};

/** 読んで対処が要る通知(設定の案内や変換の失敗)を表示する時間。 */
export const ACTION_NOTICE_DURATION_MS = 15_000;

export type ToastLabels = {
	/** 通知の領域の名前。支援技術が読み上げる。 */
	readonly region: string;
	/** 閉じるボタンの名前。ページの言語が決まってから求めるので、関数で受け取る。 */
	readonly close: () => string;
};

let labels: ToastLabels = {region: "Notifications", close: () => "Close"};
let host: HTMLElement | null = null;
let container: HTMLElement | null = null;
const blockers = new Set<() => boolean>();
const waiting: Toast[] = [];

/** 支援技術に伝える名前を決める。文言はサイトの言語に合わせるので、起動の処理から渡す。 */
export function configureToasts(next: ToastLabels): void {
	labels = next;
}

function ensureContainer(): HTMLElement {
	if (container?.isConnected) return container;
	const list = h("div", {className: "toasts"});
	list.setAttribute("role", "region");
	const element = h("div");
	// サイトの重なりより前に出すため、最前面の層(popover)に置く。対応していないブラウザでは、CSS の z-index で前に出す
	if (typeof element.showPopover === "function") element.setAttribute("popover", "manual");
	element.attachShadow({mode: "open"}).append(h("style", {textContent: `${themeCss}\n${toastCss}`}), list);
	document.body.append(element);
	host = element;
	container = list;
	return list;
}

/** 通知が1つでもあれば領域を表示し、無くなったら隠す。popover は、表示するまで描画されない。 */
function syncVisibility(): void {
	if (!host || !container || !host.hasAttribute("popover")) return;
	const open = host.matches(":popover-open");
	const needed = container.childElementCount > 0;
	if (needed && !open) host.showPopover();
	if (!needed && open) host.hidePopover();
}

function moreElement({label, text}: NonNullable<Toast["more"]>): HTMLElement {
	return h("details", {className: "toast-more"}, h("summary", {textContent: label}), h("pre", {textContent: text}));
}

function present({title, detail, tone, href, durationMs, more}: Toast): void {
	const heading = href ? h("a", {href, target: "_blank", rel: "noopener", textContent: title}) : title;
	const closeButton = h("button", {type: "button", className: "toast-close", textContent: "×"});
	closeButton.setAttribute("aria-label", labels.close());
	const toast = h(
		"div",
		{className: "toast"},
		h("div", {className: "toast-title"}, heading),
		h("div", {className: "toast-detail", textContent: detail}),
		...(more ? [moreElement(more)] : []),
		closeButton,
	);
	toast.dataset.tone = tone;
	// 追加した時点で読み上げさせる。注意を促すものは、読み上げ中の内容に割り込ませる
	toast.setAttribute("role", tone === "warning" ? "alert" : "status");

	let remainingMs = durationMs;
	let startedAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let holds = 0;
	const dismiss = (): void => {
		clearTimeout(timer);
		toast.remove();
		syncVisibility();
	};
	const start = (): void => {
		startedAt = Date.now();
		timer = setTimeout(dismiss, remainingMs);
	};
	// 読んでいる間や、操作しようとしている間は消さない
	const hold = (): void => {
		if (holds++ > 0) return;
		clearTimeout(timer);
		remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
	};
	const release = (): void => {
		if (holds > 0 && --holds === 0) start();
	};
	toast.addEventListener("pointerenter", hold);
	toast.addEventListener("pointerleave", release);
	toast.addEventListener("focusin", hold);
	toast.addEventListener("focusout", release);
	// 詳しい内容を開閉したり選んだりするクリックでは消さない
	toast.addEventListener("click", (event) => {
		if (!(event.target instanceof Element && event.target.closest(".toast-more"))) dismiss();
	});

	const list = ensureContainer();
	list.setAttribute("aria-label", labels.region);
	list.append(toast);
	syncVisibility();
	start();
}

/** 表示を止めている条件が残っているか。成り立たなくなった条件は、ここで外す。 */
function isHeld(): boolean {
	for (const isBlocking of blockers) {
		if (isBlocking()) return true;
		blockers.delete(isBlocking);
	}
	return false;
}

function flush(): void {
	if (isHeld()) return;
	for (const toast of waiting.splice(0)) present(toast);
}

/**
 * 条件が成り立つ間、通知の表示を待たせる。待たせた通知は、条件が外れたときにまとめて表示する。
 * モーダルのダイアログが開いている間は、外側の内容を操作も読み上げもできないので、閉じるまで待たせるのに使う。
 * 返す関数は、条件が外れたことを知らせる。呼ばれないまま条件が成り立たなくなっても、次の通知のときに外れる。
 */
export function holdToastsWhile(isBlocking: () => boolean): () => void {
	blockers.add(isBlocking);
	return () => {
		blockers.delete(isBlocking);
		flush();
	};
}

/** 画面の隅に通知を表示する。クリックするか時間が経つと消える。カーソルやフォーカスがある間は消えない。 */
export function showToast(toast: Toast): void {
	waiting.push(toast);
	flush();
}
