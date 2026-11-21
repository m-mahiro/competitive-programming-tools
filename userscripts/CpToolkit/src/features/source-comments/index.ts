import {languageCatalog} from "@catalog/tables";
import {commentSyntaxOf} from "@domain/execution/language";
import {contestIdOf} from "@domain/page/route";
import {option} from "@domain/settings/option";
import {
	type CommentStyle,
	fillVariables,
	insertFooter,
	insertHeader,
	insertRunnerHeader,
	isWholeCode,
	replaceBlock,
	toComment,
} from "@domain/source/comment";
import {LocalRunnerError} from "@application/execution/local-runner";
import {defineFeature} from "@application/feature/definition";
import {EDITOR_SETUP_DELAY_MS} from "@application/ports/code-editor";
import {type CommentSlot, SourceComments} from "@application/source/source-comments";
import {ACTION_NOTICE_DURATION_MS, showToast} from "@ui/toast/toast";
import {createCommentPanel} from "./panel";

/** 提出補助の変換が付け足す部分より外側に置く。 */
const PASTE_ORDER = 20;
const SLOTS: readonly CommentSlot[] = ["header", "footer"];

export const sourceComments = defineFeature({
	id: "source-comments",
	title: "sourceComments.title",
	description: "sourceComments.description",
	category: "category.submission",
	defaultEnabled: true,
	routes: ["atcoder:task", "atcoder:submit"],
	phase: "ready",
	options: {
		style: option.select("line", "sourceComments.style", [
			{value: "line", label: "sourceComments.styleLine"},
			{value: "block", label: "sourceComments.styleBlock"},
		]),
		runnerHeader: option.select("above", "sourceComments.runnerHeader", [
			{value: "above", label: "sourceComments.runnerHeaderAbove"},
			{value: "below", label: "sourceComments.runnerHeaderBelow"},
			{value: "none", label: "sourceComments.runnerHeaderNone"},
		]),
		runnerHeaderName: option.text("", "sourceComments.runnerHeaderName"),
	},
	async start({options, judge, judgeSite, localRunner, page, paste, state, translate}) {
		const target = judge?.submission;
		const site = await judgeSite();
		const editorButtons = document.querySelector(".editor-buttons");
		if (!target || !site || !editorButtons) return;

		const comments = new SourceComments(state);
		const defaultMultiline = options.style === "block";
		/** コードに挿入した部分。言語を変えたときに書き直す。 */
		const inserted = new Map<CommentSlot, string>();

		const syntaxOf = () => {
			const family = site.language()?.family;
			return family ? commentSyntaxOf(languageCatalog, family) : null;
		};

		const variables = (): Readonly<Record<string, string>> => {
			const url = site.taskUri();
			return {url, task: url.split("/").at(-1) ?? "", contest: contestIdOf(location.pathname) ?? ""};
		};

		/** 挿入する文字列を返す。空なら挿入するものがなく、null ならこの言語では書けない。 */
		const render = (slot: CommentSlot): string | null => {
			const {text, commentOut, multiline} = comments.content(slot, site.taskUri());
			const filled = fillVariables(text.trimEnd(), variables());
			if (!filled) return "";
			if (!commentOut) return `${filled}\n`;
			const syntax = syntaxOf();
			const style: CommentStyle = multiline ?? defaultMultiline ? "block" : "line";
			const comment = syntax && toComment(filled, syntax, style);
			return comment === null ? null : `${comment}\n`;
		};

		const insertAll = (code: string): string => {
			const syntax = syntaxOf() ?? {};
			let result = code;
			let writable = true;
			for (const slot of SLOTS) {
				const block = render(slot);
				if (block === null) writable = false;
				if (!block) continue;
				if (!result.includes(block)) {
					result = slot === "header" ? insertHeader(result, block, syntax) : insertFooter(result, block, syntax);
				}
				inserted.set(slot, block);
			}
			panel.setUnsupported(!writable);
			return result;
		};

		/** 言語や内容が変わったら、挿入した部分を書き直す。書けない言語では元のまま残す。 */
		const refresh = (): void => {
			const original = site.sourceCode();
			let code = original;
			let writable = true;
			for (const [slot, current] of inserted) {
				const next = render(slot);
				if (next === null) {
					writable = false;
					continue;
				}
				const replaced = replaceBlock(code, current, next, slot === "footer");
				if (replaced === null || !next) inserted.delete(slot);
				else inserted.set(slot, next);
				code = replaced ?? code;
			}
			panel.setUnsupported(!writable);
			if (code !== original) site.setSourceCode(code);
		};

		const panel = createCommentPanel({
			comments,
			translate,
			task: () => site.taskUri(),
			defaultMultiline,
			onChange: refresh,
			onApply() {
				refresh();
				const code = site.sourceCode();
				void insertWithRunnerHeader(code).then((next) => {
					// 待つ間に編集されていたら、その内容を上書きしない
					if (next !== code && site.sourceCode() === code) site.setSourceCode(next);
				});
			},
		});
		editorButtons.append(panel.button);

		site.onLanguageChange(refresh);
		const taskSelect = document.querySelector("#select-task");
		if (taskSelect) {
			page.onChange(taskSelect, () => {
				panel.reload();
				refresh();
			});
		}

		/** Local Runner に設定した、この言語のヘッダー。付けない設定か、接続できなければ null。 */
		const runnerHeader = async (): Promise<string | null> => {
			const language = site.language();
			if (options.runnerHeader === "none" || !language || !localRunner.isAvailable()) return null;
			try {
				const compilerName = await localRunner.compilerFor(language);
				if (compilerName === null) return null;
				return await localRunner.header(compilerName, options.runnerHeaderName.trim() || true);
			} catch (error) {
				// 名前を指定したヘッダーが無いときは、知らずに提出しないよう知らせる。起動していないだけなら知らせない
				if (error instanceof LocalRunnerError && error.status !== 0) {
					showToast({
						title: translate("sourceComments.runnerHeaderFailed"),
						detail: error.message,
						tone: "warning",
						durationMs: ACTION_NOTICE_DURATION_MS,
					});
				}
				return null;
			}
		};

		/** 問題ごとのヘッダーとフッターに加えて、Local Runner のヘッダーを付ける。上なら問題ごとのヘッダーの上に、下ならその下に置く。 */
		const insertWithRunnerHeader = async (code: string): Promise<string> => {
			const header = await runnerHeader();
			if (header === null) return insertAll(code);
			const syntax = syntaxOf() ?? {};
			return options.runnerHeader === "above"
				? insertRunnerHeader(insertAll(code), header, syntax)
				: insertAll(insertRunnerHeader(code, header, syntax));
		};

		paste.add(target, {delayMs: EDITOR_SETUP_DELAY_MS}, {
			order: PASTE_ORDER,
			async transform(code, {pasted, original}) {
				if (!isWholeCode(original, pasted)) return code;
				inserted.clear();
				return insertWithRunnerHeader(code);
			},
		});
	},
});
