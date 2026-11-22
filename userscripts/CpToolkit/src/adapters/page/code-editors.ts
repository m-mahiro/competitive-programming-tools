import {sleep} from "@atcoder-tools/shared";
import type {SubmissionTarget} from "@domain/page/route";
import type {CodeEditor, CodeEditorLocator, EditorLookup} from "@application/ports/code-editor";
import {type AceEditor, type CodeMirrorContent, type CodeMirrorView, type MonacoEditor, pageGlobals} from "./globals";

const EDITOR_FAMILIES: Readonly<Record<string, string>> = {
	python: "python3", csharp: "csharp", sh: "bash", shell: "bash",
	golang: "go", kotlin: "kotlin", java: "java", cpp: "cpp", c: "c",
	javascript: "javascript", typescript: "typescript", rust: "rust", ruby: "ruby",
	php: "php", swift: "swift", scala: "scala", haskell: "haskell", ocaml: "ocaml",
};
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_PASTED_LENGTH = 30;

class AceCodeEditor implements CodeEditor {
	private readonly editor: AceEditor;

	constructor(editor: AceEditor) {
		this.editor = editor;
	}

	getValue(): string {
		return this.editor.getValue();
	}

	setValue(value: string): void {
		this.editor.getSession().setValue(value);
	}

	isJava(): boolean {
		return this.languageFamily() === "java";
	}

	languageFamily(): string | null {
		const mode = this.editor.getSession().getMode().$id?.split("/").at(-1) ?? "";
		return EDITOR_FAMILIES[mode] ?? null;
	}

	commentFamily(): string | null {
		return this.editor.getSession().getMode().$id === "ace/mode/c_cpp" ? "cpp" : this.languageFamily();
	}

	identity(): object { return this.editor.getSession(); }

	onLanguageChange(listener: () => void): void {
		this.editor.getSession().on("changeMode", listener);
	}

	isReadOnly(): boolean {
		return this.editor.getReadOnly();
	}

	setWritable(): void {
		this.editor.setReadOnly(false);
	}

	onPaste(listener: Parameters<CodeEditor["onPaste"]>[0]): void {
		this.editor.on("paste", ({text}) => listener(text, sleep(0)));
	}

	onChange(listener: () => void): void {
		this.editor.getSession().on("change", listener);
	}

	foldLines(lines: readonly number[]): void {
		const session = this.editor.getSession();
		const folded = new Set(session.getAllFolds().map((fold) => fold.start.row));
		for (const line of lines) {
			if (folded.has(line)) continue;
			try {
				const range = session.getFoldWidget(line) ? session.getFoldWidgetRange(line) : null;
				if (range) session.addFold("...", range);
			} catch {
				// 既存の折りたたみと重なる行は飛ばす
			}
		}
	}
}

class MonacoCodeEditor implements CodeEditor {
	private readonly editor: MonacoEditor;

	constructor(editor: MonacoEditor) {
		this.editor = editor;
	}

	private get model() {
		const model = this.editor.getModel();
		if (!model) throw new Error("Monaco model is not available.");
		return model;
	}

	getValue(): string {
		return this.model.getValue();
	}

	setValue(value: string): void {
		this.model.setValue(value);
	}

	isJava(): boolean {
		return this.model.getLanguageId() === "java";
	}

	languageFamily(): string | null {
		return EDITOR_FAMILIES[this.model.getLanguageId()] ?? null;
	}

	isReadOnly(): boolean {
		return this.editor.getRawOptions?.().readOnly ?? false;
	}

	identity(): object | null { return this.editor.getModel(); }

	onLanguageChange(listener: () => void): void { this.editor.onDidChangeModelLanguage?.(listener); }

	setWritable(): void {
	}

	onPaste(listener: (pasted: string) => void): void {
		try {
			this.editor.onDidPaste(({range}) => listener(this.model.getValueInRange(range)));
		} catch {
			// onDidPaste がない版では、まとまった入力を貼り付けとして扱う
			this.model.onDidChangeContent(({isFlush, changes}) => {
				const text = changes[0]?.text ?? "";
				if (!isFlush && changes.length === 1 && text.length >= MIN_PASTED_LENGTH) listener(text);
			});
		}
	}

	onChange(listener: () => void): void {
		this.model.onDidChangeContent(listener);
	}

	foldLines(lines: readonly number[]): void {
		const action = this.editor.getAction("editor.fold");
		if (!action) return;
		const position = this.editor.getPosition();
		void (async () => {
			try {
				for (const line of lines) {
					this.editor.setPosition({lineNumber: line + 1, column: 1});
					await action.run();
				}
			} finally {
				this.editor.setPosition(position);
			}
		})().catch(() => undefined);
	}
}

function richEditor(target: SubmissionTarget): CodeEditor | null {
	const page = pageGlobals();
	if (target.editor === "monaco") {
		const writable = (page.monaco?.editor.getEditors() ?? []).filter((editor) => editor.getModel() && !editor.getRawOptions?.().readOnly);
		const editor = writable.find((candidate) => candidate.getDomNode?.()?.closest("form")) ?? (writable.length === 1 ? writable[0] : null);
		return editor?.getModel() ? new MonacoCodeEditor(editor) : null;
	}
	const element = target.editorElements.map((selector) => document.querySelector(selector)).find((found) => found);
	if (target.editor === "codemirror") {
		const content = page.document?.querySelector<CodeMirrorContent>(target.editorElements.join(","));
		const view = content?.cmTile?.view;
		return view ? new NativeSourceEditor(content, view) : null;
	}
	if (!page.ace || !element) return null;
	try {
		return new AceCodeEditor(page.ace.edit(element));
	} catch {
		return null;
	}
}

class NativeSourceEditor implements CodeEditor {
	constructor(element: Element, view?: CodeMirrorView) {
		this.element = element;
		this.view = view;
	}

	private readonly element: Element;
	private readonly view: CodeMirrorView | undefined;

	getValue(): string {
		return this.view?.state.doc.toString() ?? (this.element as HTMLTextAreaElement).value;
	}

	setValue(value: string): void {
		if (this.view) this.view.dispatch({changes: {from: 0, to: this.view.state.doc.length, insert: value}});
		else {
			(this.element as HTMLTextAreaElement).value = value;
			this.element.dispatchEvent(new Event("input", {bubbles: true}));
		}
	}

	isJava(): boolean { return false; }
	identity(): object { return this.view ?? this.element; }
	isReadOnly(): boolean { return this.element instanceof HTMLTextAreaElement && (this.element.readOnly || this.element.disabled); }
	setWritable(): void { if (this.element instanceof HTMLTextAreaElement) this.element.readOnly = false; }
	foldLines(): void {}
	onChange(listener: () => void): void { this.element.addEventListener("input", listener); }
	onPaste(listener: Parameters<CodeEditor["onPaste"]>[0]): void {
		this.element.addEventListener("paste", (event) => {
			if (event instanceof ClipboardEvent && event.clipboardData) listener(event.clipboardData.getData("text/plain"), sleep(0));
		});
	}
}

/** リッチエディタとテキスト欄を切り替えられるページ。操作ごとに実際の入力先を読む。 */
function findEditor(target: SubmissionTarget): CodeEditor | null {
	if (!target.textarea) return richEditor(target);
	const textareaSelector = target.textarea;
	const selector = [...target.editorElements, textareaSelector].join(",");
	const current = (): CodeEditor | null => {
		const plain = document.querySelector<HTMLTextAreaElement>(textareaSelector);
		if (plain && (plain === document.activeElement || plain.offsetParent !== null
			|| document.querySelector(".btn-toggle-editor.active"))) return new NativeSourceEditor(plain);
		return richEditor(target) ?? (plain && new NativeSourceEditor(plain));
	};
	if (!current()) return null;
	return {
		getValue: () => current()?.getValue() ?? "",
		setValue: (value) => current()?.setValue(value),
		isJava: () => current()?.isJava() ?? false,
		languageFamily: () => current()?.languageFamily?.() ?? null,
		commentFamily: () => current()?.commentFamily?.() ?? null,
		identity: () => current()?.identity?.() ?? null,
		onLanguageChange: (listener) => richEditor(target)?.onLanguageChange?.(listener),
		isReadOnly: () => current()?.isReadOnly() ?? true,
		setWritable: () => current()?.setWritable(),
		foldLines: (lines) => current()?.foldLines(lines),
		onChange: (listener) => current()?.onChange(listener),
		onPaste(listener) {
			document.addEventListener("paste", (event) => {
				if (event.target instanceof Element && event.target.closest(selector) && event.clipboardData) {
					listener(event.clipboardData.getData("text/plain"), sleep(0));
				}
			}, true);
		},
	};
}

export class PageCodeEditorLocator implements CodeEditorLocator {
	/** 同じ条件の探索は1本にまとめ、ページ全体の監視を重ねない。見つからなかった結果は残さない。 */
	private readonly lookups = new Map<string, Promise<CodeEditor | null>>();

	locate(target: SubmissionTarget, {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		delayMs = 0
	}: EditorLookup = {}): Promise<CodeEditor | null> {
		const key = JSON.stringify([target, timeoutMs, delayMs]);
		const shared = this.lookups.get(key);
		if (shared) return shared;
		const pending = this.search(target, timeoutMs, delayMs);
		this.lookups.set(key, pending);
		void pending.then((editor) => {
			if (!editor) this.lookups.delete(key);
		});
		return pending;
	}

	private async search(target: SubmissionTarget, timeoutMs: number, delayMs: number): Promise<CodeEditor | null> {
		if (delayMs > 0) await sleep(delayMs);
		const editor = findEditor(target);
		if (editor) return editor;

		const {promise, resolve} = Promise.withResolvers<CodeEditor | null>();
		const observer = new MutationObserver(() => {
			const found = findEditor(target);
			if (found) resolve(found);
		});
		observer.observe(document.body, {childList: true, subtree: true});
		const timer = setTimeout(() => resolve(null), timeoutMs);
		const found = await promise;
		observer.disconnect();
		clearTimeout(timer);
		return found;
	}
}
