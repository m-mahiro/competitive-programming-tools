import type {SubmissionTarget} from "@domain/page/route";

/** ace.edit を先に呼ぶとサイトの初期化の設定が無視されるので、サイトの処理を待つ。 */
export const EDITOR_SETUP_DELAY_MS = 500;

export interface CodeEditor {
	getValue(): string;

	setValue(value: string): void;

	isJava(): boolean;

	/** エディタが区別できる言語の種類。 */
	languageFamily?(): string | null;
	/** 言語の処理系は特定できない場合にも、共通のコメント記法を使えることがある。 */
	commentFamily?(): string | null;
	identity?(): object | null;
	onLanguageChange?(listener: () => void): void;

	isReadOnly(): boolean;

	setWritable(): void;

	/** 貼り付けた文字列を渡す。エディタへの挿入前に通知する場合は、その完了を待つ Promise も渡す。 */
	onPaste(listener: (pasted: string, inserted?: Promise<void>) => void): void;

	onChange(listener: () => void): void;

	/** いちばん外側のブロック(とコメント)だけを折りたたむ。入れ子のブロックは折りたたまない。 */
	foldTopLevel(): void;

	/** カーソルを含む、まだ折りたたんでいない最も内側のブロックを折りたたむ。エディタが扱えなければ false。 */
	foldAtCursor?(): boolean;

	/** カーソルの行にある折りたたみを開く。エディタが扱えなければ false。 */
	unfoldAtCursor?(): boolean;
}

export type EditorLookup = {
	readonly timeoutMs?: number;
	readonly delayMs?: number;
};

export interface CodeEditorLocator {
	/**
	 * エディタが生成されるまで待つ。時間内に見つからなければ null を返す。
	 * delayMs を指定すると、サイトがエディタを初期化する時間を空けてから探す。
	 */
	locate(target: SubmissionTarget, options?: EditorLookup): Promise<CodeEditor | null>;
}
