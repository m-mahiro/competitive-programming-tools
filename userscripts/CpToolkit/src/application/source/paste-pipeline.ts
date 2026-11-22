import {normalizeNewlines} from "@atcoder-tools/shared";
import type {SubmissionTarget} from "@domain/page/route";
import type {CodeEditor, CodeEditorLocator, EditorLookup} from "@application/ports/code-editor";

export type PasteContext = {
	readonly editor: CodeEditor;
	readonly pasted: string;
	readonly original: string;
	/** エディタや提出先が途中で変わったら、結果と通知を破棄する。 */
	isCurrent(): boolean;
	/** 本文を反映できた場合にだけ、挿入箇所などの状態を記録する。 */
	onCommit(action: () => void): void;
};

export type PasteStep = {
	readonly order: number;
	/** この処理が参照する言語・問題など、開始時点の状態を返す。 */
	contextKey?(editor: CodeEditor): string;
	transform(code: string, context: PasteContext): string | Promise<string>;
	applied?(editor: CodeEditor): void;
};

/** 貼り付け直後の加工と、その結果を使う提出が同じ処理の完了を待てるようにする。 */
export class PastePipeline {
	private readonly steps: PasteStep[] = [];
	private watching = false;
	private readonly editors: CodeEditorLocator;
	private generation = 0;
	private pending: Promise<boolean> | null = null;

	constructor(editors: CodeEditorLocator) {
		this.editors = editors;
	}

	get busy(): boolean {
		return this.pending !== null;
	}

	settled(): Promise<boolean> {
		return this.pending ?? Promise.resolve(true);
	}

	add(target: SubmissionTarget, lookup: EditorLookup, step: PasteStep): void {
		this.steps.push(step);
		this.steps.sort((a, b) => a.order - b.order);
		if (this.watching) return;
		this.watching = true;
		void this.editors.locate(target, lookup).then((editor) => {
			if (editor) editor.onPaste((pasted, inserted) => void this.start(editor, pasted, this.steps, inserted));
			else this.watching = false;
		});
	}

	apply(editor: CodeEditor, step: PasteStep): Promise<boolean> {
		return this.start(editor, editor.getValue(), [step]);
	}

	private start(editor: CodeEditor, pasted: string, steps: readonly PasteStep[], inserted?: Promise<void>): Promise<boolean> {
		const generation = ++this.generation;
		steps = [...steps];
		const model = editor.identity?.();
		const keys = steps.map((step) => step.contextKey?.(editor));
		const run = async (): Promise<boolean> => {
			if (inserted) await inserted;
			const original = editor.getValue();
			const originalLF = normalizeNewlines(original);
			const isCurrent = (): boolean => generation === this.generation && normalizeNewlines(editor.getValue()) === originalLF && editor.identity?.() === model
				&& steps.every((step, index) => step.contextKey?.(editor) === keys[index]);
			const committed: Array<() => void> = [];
			let code = original;
			for (const step of steps) {
				if (!isCurrent()) return false;
				const next = await step.transform(code, {editor, pasted, original, isCurrent, onCommit: (action) => committed.push(action)});
				if (next !== code && step.applied) committed.push(() => step.applied?.(editor));
				code = next;
			}
			if (!isCurrent()) return false;
			if (code !== original) editor.setValue(normalizeNewlines(code));
			for (const action of committed) action();
			return true;
		};
		const pending = run().catch(() => false).finally(() => {
			if (generation === this.generation) this.pending = null;
		});
		this.pending = pending;
		return pending;
	}
}
