import type {MessageKey} from "@catalog/messages";
import {option} from "@domain/settings/option";
import {isShortcutSetting, NO_SHORTCUT, normalizeShortcut} from "@domain/settings/shortcut";
import {defineFeature} from "@application/feature/definition";
import {EDITOR_SETUP_DELAY_MS} from "@application/ports/code-editor";
import type {SubmissionForm} from "@application/ports/submission-form";
import {languageSupport} from "@application/source/submission-transform";
import {registerShortcut} from "@ui/shortcuts";
import {addTooltip} from "@ui/tooltip/tooltip";

const SHARE_URL = "https://x.com/intent/post";

/** 空欄なら fallback を使う。none なら使わない。 */
function resolveKey(value: string, fallback: string): string | null {
	if (value.toLowerCase() === NO_SHORTCUT) return null;
	return normalizeShortcut(value || fallback);
}

const shortcutOption = (defaultValue: string, label: MessageKey) => option.text(defaultValue, label, {
	validate: isShortcutSetting,
	invalidMessage: "keyboardShortcuts.invalidKey",
});

export const keyboardShortcuts = defineFeature({
	id: "keyboard-shortcuts",
	title: "keyboardShortcuts.title",
	description: "keyboardShortcuts.description",
	category: "category.execution",
	defaultEnabled: true,
	routes: ["atcoder:page", "atcoder:home", "codeforces:page", "aoj:page", "libraryChecker:page", "paiza:page", "yukicoder:problem"],
	phase: "ready",
	options: {
		submit: shortcutOption("", "keyboardShortcuts.submit"),
		fold: shortcutOption("Ctrl+Shift+M", "keyboardShortcuts.fold"),
		openSettings: shortcutOption("Ctrl+I", "keyboardShortcuts.openSettings"),
		share: shortcutOption("", "keyboardShortcuts.share"),
	},
	start({options, judge, editors, submissionForm, openSettings}) {
		const target = judge?.submission;

		const settingsKey = resolveKey(options.openSettings, "");
		if (settingsKey) registerShortcut(settingsKey, () => {
			openSettings();
			return true;
		});

		const shareKey = resolveKey(options.share, "");
		if (shareKey) registerShortcut(shareKey, () => {
			const url = `${SHARE_URL}?text=${encodeURIComponent(document.title)}&url=${encodeURIComponent(location.href)}`;
			window.open(url, "_blank", "noopener");
			return true;
		});

		if (!target) return;
		// 提出欄はページの読み込み後に作られることがあるので、押したときに探す
		let form: SubmissionForm | null = null;
		void submissionForm(target).then((ready) => {
			form = ready;
		});
		const submitKey = resolveKey(options.submit, target.shortcut);
		if (submitKey) {
			addTooltip(() => form?.submitButton() as HTMLElement | null ?? null, () => submitKey);
			registerShortcut(submitKey, () => {
				const button = form?.submitButton() as HTMLElement | null ?? null;
				button?.click();
				return button !== null;
			});
		}

		const foldKey = resolveKey(options.fold, "");
		if (foldKey) {
			void editors.locate(target, {delayMs: EDITOR_SETUP_DELAY_MS}).then((editor) => {
				if (!editor) return;
				registerShortcut(foldKey, () => {
					const family = form?.language(editor)?.family;
					const lines = family ? languageSupport(family).foldStartLines?.(editor.getValue()) : undefined;
					if (!lines) return false;
					editor.foldLines(lines);
					return true;
				});
			});
		}
	},
});
