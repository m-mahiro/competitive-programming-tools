import {defineFeature} from "@application/feature/definition";
import {createModal} from "@ui/dialog/modal";
import {h} from "@ui/element";
import formCss from "@ui/form/form.css" with {type: "text"};

const MINUTE_MS = 60_000;
/** 1回の setTimeout で待つ時間の上限。ブラウザが受け付ける最大値(2^31 - 1 ミリ秒)より短くする。 */
const MAX_TIMEOUT_MS = 24 * 60 * MINUTE_MS;

export const submissionTimer = defineFeature({
	id: "submission-timer",
	title: "submissionTimer.title",
	description: "submissionTimer.description",
	category: "category.submission",
	defaultEnabled: false,
	routes: ["atcoder:task"],
	phase: "ready",
	options: {},
	start({translate}) {
		const submitButton = document.querySelector<HTMLElement>("#submit");
		if (!submitButton) return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const modal = createModal({
			title: translate("submissionTimer.title"),
			closeLabel: translate("settings.close"),
			css: formCss,
		});
		const minutes = h("input", {type: "number", min: "1"});
		const info = h("p");
		const cancel = (): void => {
			clearTimeout(timer);
			timer = undefined;
			info.textContent = translate("submissionTimer.canceled");
		};
		// setTimeout の待ち時間は 32 ビットの整数(約 24.8 日)までで、超えるとすぐに動く。
		// 予定の時刻を覚えておき、上限より短い待ちを繰り返して、その時刻に提出する。
		const waitUntil = (dueAt: number): void => {
			const remaining = dueAt - Date.now();
			timer = remaining > 0
				? setTimeout(() => waitUntil(dueAt), Math.min(remaining, MAX_TIMEOUT_MS))
				: undefined;
			if (remaining <= 0) submitButton.click();
		};
		const schedule = (): void => {
			const value = minutes.valueAsNumber;
			clearTimeout(timer);
			if (!(value > 0)) {
				cancel();
				return;
			}
			const dueAt = Date.now() + value * MINUTE_MS;
			waitUntil(dueAt);
			const at = new Date(dueAt).toLocaleTimeString();
			info.textContent = translate("submissionTimer.scheduled").replace("{time}", at);
		};
		modal.body.append(
			h("label", {className: "field"}, h("span", {
				className: "field-label",
				textContent: translate("submissionTimer.minutes"),
			}), minutes),
			info,
		);
		modal.footer.append(
			h("button", {type: "button", textContent: translate("submissionTimer.set"), onclick: schedule}),
			h("button", {type: "button", textContent: translate("submissionTimer.cancel"), onclick: cancel}),
		);

		const openButton = h("button", {
			type: "button",
			className: "btn btn-default",
			textContent: translate("submissionTimer.title"),
			onclick: () => modal.open(),
		});
		openButton.style.marginLeft = "5px";
		submitButton.after(openButton);
	},
});
