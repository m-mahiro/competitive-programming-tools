import {includesSubmissionHeader, normalizeNewlines} from "@atcoder-tools/shared";
import {languageCatalog} from "@catalog/tables";
import {commentSyntaxOf} from "@domain/execution/language";
import {contestIdOf} from "@domain/page/route";
import {option} from "@domain/settings/option";
import {type CommentSyntax, fillVariables, headerOffset, insertFooter, insertHeader, isWholeCode, replaceBlock, toComment} from "@domain/source/comment";
import {LocalRunnerError} from "@application/execution/local-runner";
import {defineFeature} from "@application/feature/definition";
import {EDITOR_SETUP_DELAY_MS} from "@application/ports/code-editor";
import type {PasteContext, PasteStep} from "@application/source/paste-pipeline";
import {type CommentSlot, SourceComments} from "@application/source/source-comments";
import {ACTION_NOTICE_DURATION_MS, showToast} from "@ui/toast/toast";
import {createCommentPanel} from "./panel";

type Slot = CommentSlot | "runner";
type Blocks = Partial<Record<Slot, string>>;

export const sourceComments = defineFeature({
	id: "source-comments",
	title: "sourceComments.title",
	description: "sourceComments.description",
	category: "category.submission",
	defaultEnabled: true,
	routes: ["atcoder:task", "atcoder:submit", "atcoder:customTest", "codeforces:page", "aoj:page", "libraryChecker:page", "paiza:page", "yukicoder:problem"],
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
	async start(services) {
		const {options, judge, localRunner, editors, paste, state, translate, submissionForm} = services;
		const target = judge?.submission;
		if (!target) return;
		const form = await submissionForm(target);
		const lookup = {delayMs: EDITOR_SETUP_DELAY_MS};
		const editor = await editors.locate(target, lookup);
		if (!editor || editor.isReadOnly()) return;
		const mount = document.querySelector(target.commentMount ?? ".editor-buttons");
		const button = form.submitButton() as Element | null;
		if (!mount && !button) return;
		form.holdSubmitWhile(paste, () => showToast({
			tone: "warning",
			title: translate("submissionHelper.submitChanged"),
			detail: "",
			durationMs: ACTION_NOTICE_DURATION_MS,
		}));
		const comments = new SourceComments(state);
		const defaultMultiline = options.style === "block";
		const order: Slot[] = options.runnerHeader === "above" ? ["runner", "header", "footer"] : ["header", "runner", "footer"];
		let inserted: Blocks = {};
		let previousSyntax: CommentSyntax = {};
		let contentRevision = 0;
		let applied = false;

		const syntaxOf = () => {
			const family = form.language(editor)?.family ?? editor.commentFamily?.();
			return family ? commentSyntaxOf(languageCatalog, family) : null;
		};

		const render = (slot: CommentSlot): string | null => {
			const url = form.task();
			const {text, commentOut, multiline} = comments.content(slot, url);
			const page = new URL(url, location.href);
			const task = (page.hash.slice(1) || page.pathname).split("/").filter(Boolean).at(-1) ?? "";
			const contest = contestIdOf(page.pathname) ?? (judge?.id === "codeforces"
				? /\/(?:contest|gym|problemset\/problem)\/(\d+)(?:\/|$)/.exec(page.pathname)?.[1] : undefined);
			const filled = fillVariables(text.trimEnd(), {url, task, contest: contest ?? ""});
			if (!filled) return "";
			if (!commentOut) return `${filled}\n`;
			const syntax = syntaxOf();
			const comment = syntax && toComment(filled, syntax, (multiline ?? defaultMultiline) ? "block" : "line");
			return comment === null ? null : `${comment}\n`;
		};

		// 先頭・末尾で前回の内容と全文が一致した部分だけを一度外す。本文内の同じ文字列には触れない。
		const compose = (source: string, runner: string, refresh: boolean) => {
			const syntax = syntaxOf() ?? {};
			const active = new Set<Slot>();
			const original = normalizeNewlines(source);
			let body = original;
			for (const slot of order) {
				const old = inserted[slot];
				if (!refresh || !old) continue;
				const rest = replaceBlock(body, old, "", slot === "footer", previousSyntax);
				if (rest !== null) {
					active.add(slot);
					body = rest;
				}
			}
			const blocks: Blocks = {};
			let unsupported = false;
			for (const slot of order) {
				if (refresh && !active.has(slot) && !(slot === "runner" && !inserted.runner && applied)) continue;
				let block = slot === "runner" ? runner : render(slot);
				if (block === null) {
					unsupported = true;
					block = refresh ? inserted[slot] ?? "" : "";
				}
				if (!block) continue;
				blocks[slot] = block;
			}
			// 再貼り付け・手動の再適用時には、すでに正しい位置にある同じブロックを取り込む。
			for (const slot of refresh ? [] : order) {
				const block = blocks[slot];
				if (!block) continue;
				const rest = replaceBlock(body, block, "", slot === "footer", syntax);
				if (rest !== null) body = rest;
				else if (slot === "runner") {
					const offset = headerOffset(body, syntax);
					const header = block.trimEnd();
					if (includesSubmissionHeader(body, header, offset)) {
						const end = offset + header.length;
						body = body.slice(0, offset) + body.slice(end + (body[end] === "\n" ? 1 : 0));
					}
				}
			}
			const head = order.filter((slot) => slot !== "footer").map((slot) => blocks[slot] ?? "").join("");
			if (head) body = insertHeader(body, head, syntax);
			if (blocks.footer) body = insertFooter(body, blocks.footer, syntax);
			const code = body === original ? source : body;
			return {code, commit() {
				inserted = blocks;
				previousSyntax = syntax;
				panel.setUnsupported(unsupported);
			}};
		};

		const runnerHeader = async (): Promise<string> => {
			const language = form.language(editor);
			if (options.runnerHeader === "none" || !language?.family || !localRunner.isAvailable()) return "";
			const compiler = await localRunner.compilerFor(language);
			if (!compiler) return "";
			const header = (await localRunner.header(compiler, options.runnerHeaderName.trim() || true))?.trimEnd();
			return header ? `${normalizeNewlines(header)}\n\n` : "";
		};

		const process = async (code: string, context: PasteContext, refresh: boolean): Promise<string> => {
			let runner = "";
			try {
				runner = await runnerHeader();
			} catch (error) {
				if (error instanceof LocalRunnerError && error.status !== 0) {
					if (context.isCurrent() && error.notify !== false) showToast({
						title: translate("sourceComments.runnerHeaderFailed"), detail: error.message,
						tone: "warning", durationMs: ACTION_NOTICE_DURATION_MS,
					});
					throw error;
				}
				if (!(error instanceof LocalRunnerError)) throw error;
			}
			if (!context.isCurrent()) return code;
			const result = compose(code, runner, refresh);
			context.onCommit(() => { applied = true; result.commit(); });
			return result.code;
		};
		const key = () => JSON.stringify([form.contextKey(editor), contentRevision]);
		const manual: PasteStep = {order: 20, contextKey: key, transform: (code, ctx) => process(code, ctx, false)};
		const refresh = () => {
			contentRevision++;
			const result = compose(editor.getValue(), inserted.runner ?? "", true);
			if (result.code !== editor.getValue()) editor.setValue(result.code);
			result.commit();
		};
		const panel = createCommentPanel({
			comments, translate, task: form.task, defaultMultiline,
			onChange: refresh,
			onApply: () => { void paste.apply(editor, manual); },
		});
		if (mount && !mount.matches("button, input, a, select, textarea, label")) mount.append(panel.button);
		else (mount ?? button)?.after(panel.button);
		form.observe(editor, () => {
			panel.reload();
			if (applied && options.runnerHeader !== "none") {
				void paste.apply(editor, {...manual, transform: (code, ctx) => process(code, ctx, true)});
			} else refresh();
		});
		paste.add(target, lookup, {
			...manual,
			transform: (code, ctx) => isWholeCode(ctx.original, ctx.pasted) ? process(code, ctx, false) : code,
		});
	},
});
