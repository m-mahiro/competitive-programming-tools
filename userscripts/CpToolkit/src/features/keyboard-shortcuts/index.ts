import type {MessageKey} from "@catalog/messages";
import {type ContestPages, contestPagesOf, type ContestTaskLink, neighborTask} from "@domain/contest/pages";
import {option} from "@domain/settings/option";
import {isModifierSetting, isShortcutSetting, NO_SHORTCUT, normalizeModifiers, normalizeShortcut} from "@domain/settings/shortcut";
import {defineFeature} from "@application/feature/definition";
import {type CodeEditor, EDITOR_SETUP_DELAY_MS} from "@application/ports/code-editor";
import type {SubmissionForm} from "@application/ports/submission-form";
import {SHORTCUT_ACTIONS} from "@application/shortcuts/shortcut-actions";
import {registerShortcut, type ShortcutHandler} from "@ui/shortcuts";
import {showToast} from "@ui/toast/toast";
import {addTooltip} from "@ui/tooltip/tooltip";

const SHARE_URL = "https://x.com/intent/post";
const NOTICE_DURATION_MS = 2_000;
const SAMPLE_NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const TASK_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
/** 入出力例のある問題のページ。提出ページは、Easy Test+ と同じく問題のページから読む。 */
const SAMPLE_ROUTES = ["atcoder:task", "atcoder:submit", "codeforces:problem", "yukicoder:problem"] as const;

/** 空欄と none なら使わない。 */
function resolveKey(value: string): string | null {
	if (value.toLowerCase() === NO_SHORTCUT) return null;
	return normalizeShortcut(value);
}

const shortcutOption = (defaultValue: string, label: MessageKey) => option.text(defaultValue, label, {
	validate: isShortcutSetting,
	invalidMessage: "keyboardShortcuts.invalidKey",
});

const modifierOption = (defaultValue: string, label: MessageKey) => option.text(defaultValue, label, {
	validate: isModifierSetting,
	invalidMessage: "keyboardShortcuts.invalidModifiers",
});

/** ページを開くキーと、開くページ。 */
const PAGE_KEYS = {
	openTasks: "tasks",
	openMySubmissions: "mySubmissions",
	openStandings: "standings",
	openEditorial: "editorial",
	openCustomTest: "customTest",
} as const satisfies Record<string, keyof ContestPages>;

/** 設定画面に並べる順番。キーが重なれば、後の項目から試す。 */
const featureOptions = {
	openSettings: shortcutOption("Ctrl+I", "keyboardShortcuts.openSettings"),
	submit: shortcutOption("Ctrl+Shift+Enter", "keyboardShortcuts.submit"),
	fold: shortcutOption("Ctrl+Shift+[", "keyboardShortcuts.fold"),
	unfold: shortcutOption("Ctrl+Shift+]", "keyboardShortcuts.unfold"),
	testAndSubmit: shortcutOption("Ctrl+Enter", "keyboardShortcuts.testAndSubmit"),
	testAll: shortcutOption("Alt+Enter", "keyboardShortcuts.testAll"),
	toggleEasyTest: shortcutOption("Ctrl+Shift+Alt+D", "keyboardShortcuts.toggleEasyTest"),
	copyInput: modifierOption("Ctrl+Alt", "keyboardShortcuts.copyInput"),
	copyOutput: modifierOption("Ctrl+Shift+Alt", "keyboardShortcuts.copyOutput"),
	copyStatement: shortcutOption("Ctrl+Shift+Alt+P", "keyboardShortcuts.copyStatement"),
	previousTask: shortcutOption("Ctrl+Shift+Alt+Left", "keyboardShortcuts.previousTask"),
	nextTask: shortcutOption("Ctrl+Shift+Alt+Right", "keyboardShortcuts.nextTask"),
	openTask: modifierOption("Ctrl+Alt", "keyboardShortcuts.openTask"),
	openTasks: shortcutOption("Ctrl+Shift+Alt+T", "keyboardShortcuts.openTasks"),
	openMySubmissions: shortcutOption("Ctrl+Shift+Alt+S", "keyboardShortcuts.openMySubmissions"),
	openStandings: shortcutOption("Ctrl+Shift+Alt+R", "keyboardShortcuts.openStandings"),
	openEditorial: shortcutOption("Ctrl+Shift+Alt+E", "keyboardShortcuts.openEditorial"),
	openCustomTest: shortcutOption("Ctrl+Shift+Alt+C", "keyboardShortcuts.openCustomTest"),
	acByTime: shortcutOption("Ctrl+Shift+Alt+F", "keyboardShortcuts.acByTime"),
	acByLength: shortcutOption("Ctrl+Shift+Alt+L", "keyboardShortcuts.acByLength"),
	acByCreated: shortcutOption("Ctrl+Shift+Alt+N", "keyboardShortcuts.acByCreated"),
	acByMemory: shortcutOption("Ctrl+Shift+Alt+M", "keyboardShortcuts.acByMemory"),
	share: shortcutOption("Ctrl+Shift+Alt+X", "keyboardShortcuts.share"),
};

type OptionName = keyof typeof featureOptions;
/** 修飾キーの後ろに番号や記号を続ける項目。 */
type PrefixOption = "copyInput" | "copyOutput" | "openTask";

export const keyboardShortcuts = defineFeature({
	id: "keyboard-shortcuts",
	title: "keyboardShortcuts.title",
	description: "keyboardShortcuts.description",
	category: "category.execution",
	defaultEnabled: true,
	routes: ["atcoder:page", "atcoder:home", "codeforces:page", "aoj:page", "libraryChecker:page", "paiza:page", "yukicoder:problem"],
	phase: "ready",
	options: featureOptions,
	start(services) {
		const {options, judge, openSettings, shortcuts, isOnRoute, translate} = services;
		const notice = (title: string, tone: "success" | "warning"): void => {
			showToast({title, detail: "", tone, durationMs: NOTICE_DURATION_MS});
		};
		const handlers: Partial<Record<Exclude<OptionName, PrefixOption>, ShortcutHandler>> = {};
		const prefixHandlers: Partial<Record<PrefixOption, {keys: readonly string[]; handler: (key: string) => boolean}>> = {};

		const hasSamples = SAMPLE_ROUTES.some((route) => isOnRoute(route));
		const copySample = (number: string, part: "input" | "output"): boolean => {
			if (!hasSamples) return false;
			void services.samples().then((samples) => {
				const sample = samples[Number(number) - 1];
				const text = part === "input" ? sample?.input : sample?.output;
				const label = translate(part === "input" ? "keyboardShortcuts.sampleInput" : "keyboardShortcuts.sampleOutput").replace("{number}", number);
				if (text === undefined || text === null) {
					notice(translate("keyboardShortcuts.sampleMissing").replace("{sample}", label), "warning");
					return;
				}
				services.clipboard.write(text);
				notice(translate("keyboardShortcuts.sampleCopied").replace("{sample}", label), "success");
			});
			return true;
		};
		prefixHandlers.copyInput = {keys: SAMPLE_NUMBERS, handler: (number) => copySample(number, "input")};
		prefixHandlers.copyOutput = {keys: SAMPLE_NUMBERS, handler: (number) => copySample(number, "output")};

		const pages = contestPagesOf(judge?.id, location.pathname);
		const goToTask = (pick: (tasks: readonly ContestTaskLink[]) => ContestTaskLink | null | undefined): boolean => {
			if (!pages) return false;
			void services.contestTasks().then((tasks) => {
				const task = tasks ? pick(tasks) : null;
				if (task) location.assign(task.url);
			});
			return true;
		};
		// 問題の記号は見ず、一覧の上から順に A、B、C… とする
		prefixHandlers.openTask = {keys: TASK_LETTERS, handler: (letter) => goToTask((tasks) => tasks[TASK_LETTERS.indexOf(letter)])};
		handlers.previousTask = () => goToTask((tasks) => neighborTask(tasks, location.pathname, -1));
		handlers.nextTask = () => goToTask((tasks) => neighborTask(tasks, location.pathname, 1));

		// 開いているページを残せるよう、新しいタブで開く
		for (const [name, page] of Object.entries(PAGE_KEYS) as Array<[keyof typeof PAGE_KEYS, keyof ContestPages]>) {
			handlers[name] = () => {
				const url = pages?.[page];
				if (!url) return false;
				window.open(url, "_blank", "noopener");
				return true;
			};
		}

		// ほかの機能の操作は、その機能が動いているページでだけ反応する
		for (const [name, id] of Object.entries(SHORTCUT_ACTIONS) as Array<[keyof typeof SHORTCUT_ACTIONS, string]>) {
			shortcuts.assign(id, resolveKey(options[name]));
			handlers[name] = () => shortcuts.run(id);
		}

		handlers.openSettings = () => {
			openSettings();
			return true;
		};
		handlers.share = () => {
			const url = `${SHARE_URL}?text=${encodeURIComponent(document.title)}&url=${encodeURIComponent(location.href)}`;
			window.open(url, "_blank", "noopener");
			return true;
		};

		const target = judge?.submission;
		if (target) {
			// 提出欄とエディタはページの読み込み後に作られることがあるので、押したときに探す
			let form: SubmissionForm | null = null;
			let editor: CodeEditor | null = null;
			void services.submissionForm(target).then((ready) => {
				form = ready;
			});
			const submitKey = resolveKey(options.submit);
			if (submitKey) addTooltip(() => form?.submitButton() as HTMLElement | null ?? null, () => submitKey);
			handlers.submit = () => {
				const button = form?.submitButton() as HTMLElement | null ?? null;
				button?.click();
				return button !== null;
			};
			if (resolveKey(options.fold) || resolveKey(options.unfold)) {
				void services.editors.locate(target, {delayMs: EDITOR_SETUP_DELAY_MS}).then((located) => {
					editor = located;
				});
			}
			// エディタが扱えなければ、エディタ自身のキー操作に任せる(yukicoder の CodeMirror など)
			handlers.fold = () => editor?.foldAtCursor?.() ?? false;
			handlers.unfold = () => editor?.unfoldAtCursor?.() ?? false;
		}

		// 同じキーの操作は後の項目から試し、そのページで使えない操作なら前の項目へ回す(paiza の提出と Easy Test+ の Ctrl+Enter など)
		const byKey = new Map<string, ShortcutHandler[]>();
		const bind = (key: string, handler: ShortcutHandler): void => {
			byKey.set(key, [handler, ...byKey.get(key) ?? []]);
		};
		for (const name of Object.keys(featureOptions) as OptionName[]) {
			if (name === "copyInput" || name === "copyOutput" || name === "openTask") {
				const value = options[name];
				const modifiers = value.toLowerCase() === NO_SHORTCUT ? null : normalizeModifiers(value);
				const prefix = prefixHandlers[name];
				if (modifiers && prefix) for (const key of prefix.keys) bind(`${modifiers}+${key}`, () => prefix.handler(key));
				continue;
			}
			const key = resolveKey(options[name]);
			const handler = handlers[name];
			if (key && handler) bind(key, handler);
		}
		// 提出欄にいても、そうでなくても反応させる
		for (const [key, list] of byKey) registerShortcut(key, () => list.some((handler) => handler()), {inTextFields: true});
	},
});
