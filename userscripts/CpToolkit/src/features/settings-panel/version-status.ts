import type {Translate} from "@catalog/messages";
import type {UpdateChecker, UpdateStatus} from "@application/update/update-checker";
import {h} from "@ui/element";

/**
 * 設定画面の隅に、今のバージョンと更新の状態を表示する。
 * 新しいバージョンがあれば、入手先へのリンクを出す。開くと、UserScript の管理ツールが更新の画面を出す。
 */
export function createVersionStatus(updates: UpdateChecker, translate: Translate): HTMLElement {
	const element = h("span", {className: "footer-version"});

	const render = (status: UpdateStatus, checked: boolean): void => {
		const parts: Array<HTMLElement | string> = [`v${status.current}`];
		if (status.latest !== null && status.downloadUrl !== null) {
			parts.push(h("a", {
				href: status.downloadUrl,
				target: "_blank",
				rel: "noopener",
				textContent: `${translate("update.install")} v${status.latest}`,
			}));
		} else if (checked) {
			parts.push(h("span", {textContent: translate("update.upToDate")}));
		}
		if (status.supported) {
			const button = h("button", {type: "button", textContent: translate("update.check")});
			button.addEventListener("click", () => {
				button.disabled = true;
				void updates.check(Date.now(), true).then((latest) => render(latest, true));
			});
			parts.push(button);
		}
		element.replaceChildren(...parts);
	};

	render(updates.status(), false);
	return element;
}
