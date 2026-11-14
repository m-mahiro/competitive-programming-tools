import type {Translate} from "@catalog/messages";
import type {UpdateStatus} from "@application/update/update-checker";
import {showToast} from "@ui/toast/toast";

const NOTICE_DURATION_MS = 20_000;

/** 新しいバージョンがあることを、画面の隅に知らせる。題名を押すと入手先が開く。 */
export function notifyUpdate(scriptName: string, status: UpdateStatus, translate: Translate): void {
	if (status.latest === null || status.downloadUrl === null) return;
	showToast({
		title: `${scriptName} v${status.latest}`,
		detail: translate("update.notice"),
		tone: "success",
		href: status.downloadUrl,
		durationMs: NOTICE_DURATION_MS,
	});
}
