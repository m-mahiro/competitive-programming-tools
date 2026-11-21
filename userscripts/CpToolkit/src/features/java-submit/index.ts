import type {Translate} from "@catalog/messages";
import type {SubmissionTarget} from "@domain/page/route";
import {isWholeCode} from "@domain/source/comment";
import {option} from "@domain/settings/option";
import {defineFeature} from "@application/feature/definition";
import {type CodeEditor, EDITOR_SETUP_DELAY_MS} from "@application/ports/code-editor";
import type {JudgeSite} from "@application/ports/judge-site";
import {
	type FallbackOptions,
	languageSupport,
	type SubmissionLanguage,
	type SubmissionTransformResult,
	transformSubmission,
} from "@application/source/submission-transform";
import {registerShortcut} from "@ui/shortcuts";
import {ACTION_NOTICE_DURATION_MS, showToast} from "@ui/toast/toast";
import {addTooltip} from "@ui/tooltip/tooltip";

// 機能の id は、保存した設定を引き継ぐため、Java だけを扱っていたころの名前のままにする
const FOLD_SHORTCUT = "Ctrl+Shift+M";
const FOLD_DELAY_MS = 100;
const PASTE_ORDER = 10;
const LOCAL_RUNNER_GUIDE_URL = "https://github.com/nsubaru11/competitive-programming-tools/tree/main/local-runner";

function findSubmitButton({submitButtons, labeledSubmit}: SubmissionTarget): HTMLElement | null {
	for (const selector of submitButtons) {
		const button = document.querySelector<HTMLElement>(selector);
		if (button) return button;
	}
	if (!labeledSubmit) return null;
	const candidates = [...document.querySelectorAll<HTMLElement>(labeledSubmit.selector)];
	for (const label of labeledSubmit.labels) {
		const button = candidates.find((candidate) => {
			const text = candidate instanceof HTMLInputElement ? candidate.value : candidate.textContent;
			return text?.trim().toLowerCase().includes(label);
		});
		if (button) return button;
	}
	return null;
}

/** ページで選んだ言語を使い、分からないサイトではエディタが Java と判定したときだけ Java とする。どちらでもなければ null。 */
function submissionLanguageOf(site: JudgeSite | null, editor: CodeEditor): SubmissionLanguage | null {
	const judgeLanguage = site?.language() ?? null;
	if (judgeLanguage) return judgeLanguage.family ? {family: judgeLanguage.family, judgeLanguage} : null;
	return editor.isJava() ? {family: "java", judgeLanguage: null} : null;
}

/** 変換の結果、提出するとコンパイルエラーになると分かっていれば知らせる。 */
function notifyTransformProblem(
	code: string,
	{family}: SubmissionLanguage,
	{failure, via}: SubmissionTransformResult,
	options: FallbackOptions,
	translate: Translate,
): void {
	const support = languageSupport(family);
	if (failure) {
		const imports = support.unresolvedImports?.(code, failure.items) ?? [];
		const firstError = failure.items.find((item) => item.kind === "ERROR");
		showToast({
			title: translate(imports.length > 0 ? "submissionHelper.unresolvedImports" : "submissionHelper.transformFailed"),
			detail: imports.length > 0 ? imports.join("\n") : firstError?.message ?? failure.diagnostics.split("\n", 1)[0] ?? "",
			tone: "warning",
			durationMs: ACTION_NOTICE_DURATION_MS,
			...(failure.diagnostics && {more: {label: translate("submissionHelper.diagnostics"), text: failure.diagnostics}}),
		});
	} else if (via !== "localRunner" && support.needsLocalRunner?.(code, options)) {
		// ライブラリの展開は Local Runner の Java Compiler API が行う。ブラウザの字句の置換ではできない
		showToast({
			title: translate("submissionHelper.localRunnerRequired").replace("{package}", options.libraryPackage),
			detail: translate("submissionHelper.localRunnerGuide"),
			tone: "warning",
			href: LOCAL_RUNNER_GUIDE_URL,
			durationMs: ACTION_NOTICE_DURATION_MS,
		});
	}
}

export const submissionHelper = defineFeature({
	id: "java-submit",
	title: "submissionHelper.title",
	description: "submissionHelper.description",
	category: "category.execution",
	defaultEnabled: true,
	// AtCoder でエディタがあるのはこの3種類だけ。順位表などで探し続けないよう絞る
	routes: ["atcoder:task", "atcoder:submit", "atcoder:customTest", "codeforces:page", "aoj:page", "libraryChecker:page", "paiza:page"],
	phase: "ready",
	options: {
		debugFlag: option.text("", "submissionHelper.debugFlag"),
		libraryPackage: option.text("", "submissionHelper.libraryPackage"),
		foldOnPaste: option.boolean(true, "submissionHelper.foldOnPaste"),
	},
	start({options, judge, judgeSite, editors, localRunner, paste, translate}) {
		const target = judge?.submission;
		if (!target) return;

		registerShortcut(target.shortcut, () => {
			const button = findSubmitButton(target);
			button?.click();
			return button !== null;
		});
		addTooltip(() => findSubmitButton(target), () => target.shortcut);

		// エディタのないページも多いので、見つかるのを待たずに起動を終える
		const site = judgeSite();
		const fallbackOptions: FallbackOptions = {debugFlag: options.debugFlag.trim(), libraryPackage: options.libraryPackage.trim()};
		const lookup = {delayMs: EDITOR_SETUP_DELAY_MS};
		const fold = async (editor: CodeEditor): Promise<void> => {
			const language = submissionLanguageOf(await site, editor);
			const lines = language ? languageSupport(language.family).foldStartLines?.(editor.getValue()) : undefined;
			if (lines) editor.foldLines(lines);
		};
		void editors.locate(target, lookup).then((editor) => {
			if (!editor) return;
			registerShortcut(FOLD_SHORTCUT, () => {
				void fold(editor);
				return true;
			});
		});
		paste.add(target, lookup, {
			order: PASTE_ORDER,
			async transform(code, {editor, pasted, original}) {
				// 編集中のコードへ一部を貼り付けたときは、全体を書き換えない
				if (!isWholeCode(original, pasted)) return code;
				const language = submissionLanguageOf(await site, editor);
				if (!language) return code;
				const result = await transformSubmission(code, language, localRunner, fallbackOptions);
				notifyTransformProblem(code, language, result, fallbackOptions, translate);
				return result.sourceCode;
			},
			applied(editor) {
				if (options.foldOnPaste) setTimeout(() => void fold(editor), FOLD_DELAY_MS);
			},
		});
	},
});
