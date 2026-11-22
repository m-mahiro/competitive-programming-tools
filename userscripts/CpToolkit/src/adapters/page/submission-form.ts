import type {JudgeLanguage} from "@domain/execution/result";
import type {SubmissionTarget} from "@domain/page/route";
import type {CodeEditor} from "@application/ports/code-editor";
import type {JudgeSite} from "@application/ports/judge-site";
import type {PageBridge} from "@application/ports/page-bridge";
import type {PendingWork, SubmissionForm} from "@application/ports/submission-form";
import {CODEFORCES_LANGUAGE_SELECT} from "@adapters/judges/codeforces";
import {selectedLanguageOf} from "@adapters/judges/languages";

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

/** Codeforces の提出ページでは、選んだ問題の記号から問題の URL を作る。 */
function codeforcesTaskUri(selected: string): string | null {
	if (!/^[a-z]\d*$/i.test(selected)) return null;
	const contest = /^(.*\/(?:contest|gym)\/\d+)\/submit\/?$/.exec(location.pathname);
	return contest ? `${location.origin}${contest[1]}/problem/${selected}` : null;
}

type Dependencies = {
	readonly judgeId: string | undefined;
	readonly bridge: PageBridge;
	/** Easy Test+ のためのサイトの操作。Codeforces では入力欄を作るので、言語を読むだけなら使わない。 */
	readonly judgeSite: () => Promise<JudgeSite | null>;
};

/**
 * 提出欄の操作を作る。言語は、AtCoder と yukicoder はサイトの操作から、Codeforces は言語の選択欄から読む。
 * それ以外のサイトは言語の選択欄を読まず、エディタが判定した言語の種類だけを使う。
 */
export async function createSubmissionForm(target: SubmissionTarget, {judgeId, bridge, judgeSite}: Dependencies): Promise<SubmissionForm> {
	const site = judgeId === "atcoder" || judgeId === "yukicoder" ? await judgeSite() : null;
	const codeforcesLanguage = (): HTMLSelectElement | null => {
		return judgeId === "codeforces" ? document.querySelector<HTMLSelectElement>(CODEFORCES_LANGUAGE_SELECT) : null;
	};
	const taskControl = () => target.taskSelect ? document.querySelector<HTMLInputElement | HTMLSelectElement>(target.taskSelect) : null;
	const task = (): string => {
		if (site) return site.taskUri();
		const selected = taskControl()?.value;
		if (!selected) return location.href;
		return (judgeId === "codeforces" ? codeforcesTaskUri(selected) : null)
			?? `${location.href.split("#")[0]}#${encodeURIComponent(selected)}`;
	};
	const language = (editor: CodeEditor): JudgeLanguage | null => {
		if (site) return site.language();
		const select = codeforcesLanguage();
		if (select) return selectedLanguageOf(select);
		const family = editor.languageFamily?.() ?? (editor.isJava() ? "java" : null);
		return family ? {id: family, label: family, family} : null;
	};

	let changes = 0;
	const listeners = new Set<() => void>();
	const observed = new WeakSet<CodeEditor>();
	const changed = (): void => {
		changes++;
		for (const listener of listeners) listener();
	};
	window.addEventListener("popstate", changed);
	window.addEventListener("hashchange", changed);
	site?.onLanguageChange(changed);
	for (const element of [codeforcesLanguage(), ...(target.taskSelect ? document.querySelectorAll(target.taskSelect) : [])]) {
		if (element) bridge.onChange(element, changed);
	}

	let holding = false;
	return {
		task,
		language,
		contextKey(editor) {
			const selected = language(editor);
			return JSON.stringify([changes, task(), selected?.id, selected?.family]);
		},
		observe(editor, listener) {
			if (listener) listeners.add(listener);
			// 言語の選択欄を読まないサイトでは、エディタの言語の切り替えを見る
			if (!site && !codeforcesLanguage() && !observed.has(editor)) {
				observed.add(editor);
				editor.onLanguageChange?.(changed);
			}
		},
		submitButton: () => findSubmitButton(target),
		holdSubmitWhile(work: PendingWork, onCanceled: () => void) {
			if (holding) return;
			holding = true;
			let waiting = false;
			const defer = (event: Event, resume: () => void): void => {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (waiting) return;
				waiting = true;
				void work.settled().then((success) => {
					waiting = false;
					if (success) resume();
					else onCanceled();
				});
			};
			// サイトのクリック処理とフォームの検証は、加工が終わってから元の提出操作をやり直して通す
			document.addEventListener("click", (event) => {
				if (!work.busy || !(event.target instanceof Element)) return;
				const button = findSubmitButton(target);
				if (button?.contains(event.target)) defer(event, () => {
					if (button.isConnected) button.click();
				});
			}, true);
			document.addEventListener("submit", (event) => {
				if (!work.busy || !(event.target instanceof HTMLFormElement)) return;
				const form = event.target;
				if (findSubmitButton(target)?.closest("form") !== form) return;
				const submitter = event.submitter;
				defer(event, () => {
					if (form.isConnected && (!submitter || submitter.isConnected)) form.requestSubmit(submitter);
				});
			}, true);
		},
	};
}
