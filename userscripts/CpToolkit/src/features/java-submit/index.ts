import {importsPackage, unresolvedImports} from "@atcoder-tools/shared";
import type {SubmissionTarget} from "@domain/page/route";
import {isWholeCode} from "@domain/source/comment";
import {findFoldStartLines} from "@domain/source/fold-lines";
import {option} from "@domain/settings/option";
import {defineFeature} from "@application/feature/definition";
import {type CodeEditor, EDITOR_SETUP_DELAY_MS} from "@application/ports/code-editor";
import type {Translate} from "@catalog/messages";
import {type JavaTransformResult, transformJava} from "@application/source/transform-java";
import {registerShortcut} from "@ui/shortcuts";
import {showToast} from "@ui/toast/toast";
import {addTooltip} from "@ui/tooltip/tooltip";

const FOLD_SHORTCUT = "Ctrl+Shift+M";
const MIN_SOURCE_LENGTH = 30;
const FOLD_DELAY_MS = 100;
const PASTE_ORDER = 10;
const LOCAL_RUNNER_GUIDE_URL = "https://github.com/nsubaru11/competitive-programming-tools/tree/main/local-runner";
const GUIDE_DURATION_MS = 15_000;
const MAX_DIAGNOSTIC_LINES = 3;

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

/** 変換の結果、提出するとコンパイルエラーになると分かっていれば知らせる。 */
function notifyTransformProblem(code: string, result: JavaTransformResult, libraryPackage: string, translate: Translate): void {
	const {failure, connected} = result;
	if (failure) {
		const imports = unresolvedImports(code, failure.items);
		showToast(imports.length > 0
			? {title: translate("javaSubmit.unresolvedImports"), detail: imports.join("\n"), tone: "warning", durationMs: GUIDE_DURATION_MS}
			: {
				title: translate("javaSubmit.transformFailed"),
				detail: failure.diagnostics.split("\n").slice(0, MAX_DIAGNOSTIC_LINES).join("\n"),
				tone: "warning",
				durationMs: GUIDE_DURATION_MS,
			});
	} else if (!connected && libraryPackage && importsPackage(code, libraryPackage)) {
		// ライブラリの展開は Local Runner の Java Compiler API が行う。ブラウザの字句の置換ではできない
		showToast({
			title: translate("javaSubmit.localRunnerRequired").replace("{package}", libraryPackage),
			detail: translate("javaSubmit.localRunnerGuide"),
			tone: "warning",
			href: LOCAL_RUNNER_GUIDE_URL,
			durationMs: GUIDE_DURATION_MS,
		});
	}
}

export const javaSubmit = defineFeature({
	id: "java-submit",
	title: "javaSubmit.title",
	description: "javaSubmit.description",
	category: "category.execution",
	defaultEnabled: true,
	// AtCoder でエディタがあるのはこの3種類だけ。順位表などで探し続けないよう絞る
	routes: ["atcoder:task", "atcoder:submit", "atcoder:customTest", "codeforces:page", "aoj:page", "libraryChecker:page", "paiza:page"],
	phase: "ready",
	options: {
		removePackage: option.boolean(true, "javaSubmit.removePackage"),
		renameClass: option.boolean(true, "javaSubmit.renameClass"),
		debugFlag: option.text("", "javaSubmit.debugFlag"),
		libraryPackage: option.text("", "javaSubmit.libraryPackage"),
		addHeader: option.boolean(true, "javaSubmit.addHeader"),
		headerName: option.text("", "javaSubmit.headerName"),
		foldOnPaste: option.boolean(true, "javaSubmit.foldOnPaste"),
	},
	start({options, judge, editors, localRunner, paste, translate}) {
		const target = judge?.submission;
		if (!target) return;

		registerShortcut(target.shortcut, () => {
			const button = findSubmitButton(target);
			button?.click();
			return button !== null;
		});
		addTooltip(() => findSubmitButton(target), () => target.shortcut);

		// エディタのないページも多いので、見つかるのを待たずに起動を終える
		const header = options.addHeader ? options.headerName || true : false;
		const lookup = {delayMs: EDITOR_SETUP_DELAY_MS};
		const fold = (editor: CodeEditor): void => editor.foldLines(findFoldStartLines(editor.getValue()));
		void editors.locate(target, lookup).then((editor) => {
			if (!editor) return;
			registerShortcut(FOLD_SHORTCUT, () => {
				fold(editor);
				return true;
			});
		});
		paste.add(target, lookup, {
			order: PASTE_ORDER,
			async transform(code, {editor, pasted, original}) {
				// 編集中のコードへ一部を貼り付けたときは、全体を書き換えない
				if (!editor.isJava() || code.length < MIN_SOURCE_LENGTH || !isWholeCode(original, pasted)) return code;
				const result = await transformJava(code, localRunner, {...options, debugFlag: options.debugFlag.trim(), header});
				notifyTransformProblem(code, result, options.libraryPackage.trim(), translate);
				return result.sourceCode;
			},
			applied(editor) {
				if (options.foldOnPaste) setTimeout(() => fold(editor), FOLD_DELAY_MS);
			},
		});
	},
});
