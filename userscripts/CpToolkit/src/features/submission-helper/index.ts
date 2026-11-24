import {isIdentifier, isJavaQualifiedName} from "@atcoder-tools/shared";
import type {Translate} from "@catalog/messages";
import {isWholeCode} from "@domain/source/comment";
import {option, sharedAcrossSites} from "@domain/settings/option";
import {defineFeature} from "@application/feature/definition";
import {type CodeEditor, EDITOR_SETUP_DELAY_MS} from "@application/ports/code-editor";
import {
	type FallbackOptions,
	languageSupport,
	type SubmissionLanguage,
	type SubmissionTransformResult,
	transformSubmission,
} from "@application/source/submission-transform";
import {showActionWarning} from "@ui/toast/toast";

const FOLD_DELAY_MS = 100;
const PASTE_ORDER = 10;
const LOCAL_RUNNER_GUIDE_URL = "https://github.com/nsubaru11/competitive-programming-tools/tree/main/local-runner";

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
		if (failure.notify === false) return;
		const imports = support.unresolvedImports?.(failure.diagnosticSource ?? code, failure.items) ?? [];
		const firstError = failure.items.find((item) => item.kind === "ERROR");
		showActionWarning({
			title: translate(via === "fallback" ? "submissionHelper.fallbackFailed" : imports.length > 0 ? "submissionHelper.unresolvedImports" : "submissionHelper.transformFailed"),
			detail: imports.length > 0 ? imports.join("\n") : firstError?.message ?? failure.diagnostics.split("\n", 1)[0] ?? "",
			...(failure.diagnostics && {more: {label: translate("submissionHelper.diagnostics"), text: failure.diagnostics}}),
		});
	} else if (via !== "localRunner" && support.needsLocalRunner?.(code, options)) {
		// ライブラリの展開は Local Runner の Java Compiler API が行う。ブラウザの字句の置換ではできない
		showActionWarning({
			title: translate("submissionHelper.localRunnerRequired").replace("{package}", options.libraryPackage),
			detail: translate("submissionHelper.localRunnerGuide"),
			href: LOCAL_RUNNER_GUIDE_URL,
		});
	}
}

export const submissionHelper = defineFeature({
	id: "submission-helper",
	title: "submissionHelper.title",
	description: "submissionHelper.description",
	category: "category.execution",
	defaultEnabled: false,
	// AtCoder でエディタがあるのはこの3種類だけ。順位表などで探し続けないよう絞る
	routes: ["atcoder:task", "atcoder:submit", "atcoder:customTest", "codeforces:page", "aoj:page", "libraryChecker:page", "paiza:page", "yukicoder:problem"],
	phase: "ready",
	options: {
		debugFlag: sharedAcrossSites(option.text("", "submissionHelper.debugFlag", {
			validate: (value) => value === "" || isIdentifier(value),
			invalidMessage: "submissionHelper.debugFlagInvalid",
		})),
		libraryPackage: sharedAcrossSites(option.text("", "submissionHelper.libraryPackage", {
			validate: (value) => value === "" || isJavaQualifiedName(value),
			invalidMessage: "submissionHelper.libraryPackageInvalid",
		})),
		foldOnPaste: option.boolean(false, "submissionHelper.foldOnPaste"),
	},
	async start(services) {
		const {options, judge, editors, localRunner, paste, translate, submissionForm} = services;
		const target = judge?.submission;
		if (!target) return;

		const form = await submissionForm(target);
		form.holdSubmitWhile(paste, () => showActionWarning({title: translate("submissionHelper.submitChanged"), detail: ""}));
		const languageOf = (editor: CodeEditor): SubmissionLanguage | null => {
			const language = form.language(editor);
			return language?.family ? {...language, family: language.family} : null;
		};
		const fallbackOptions: FallbackOptions = {debugFlag: options.debugFlag.trim(), libraryPackage: options.libraryPackage.trim()};
		const lookup = {delayMs: EDITOR_SETUP_DELAY_MS};
		void editors.locate(target, lookup).then((editor) => {
			if (editor) form.observe(editor);
		});
		paste.add(target, lookup, {
			order: PASTE_ORDER,
			contextKey: form.contextKey,
			async transform(code, {editor, pasted, original, isCurrent}) {
				// 編集中のコードへ一部を貼り付けたときは、全体を書き換えない
				if (!isWholeCode(original, pasted)) return code;
				const language = languageOf(editor);
				if (!language) return code;
				const result = await transformSubmission(code, language, localRunner, fallbackOptions);
				if (!isCurrent()) return code;
				notifyTransformProblem(code, language, result, fallbackOptions, translate);
				if (result.failure) throw new Error(result.failure.diagnostics);
				return result.sourceCode;
			},
			applied(editor) {
				if (!options.foldOnPaste) return;
				const key = form.contextKey(editor);
				const code = editor.getValue();
				setTimeout(() => {
					if (key === form.contextKey(editor) && editor.getValue() === code) editor.foldTopLevel();
				}, FOLD_DELAY_MS);
			},
		});
	},
});
