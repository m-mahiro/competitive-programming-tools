import type {JudgeLanguage} from "@domain/execution/result";
import type {CodeEditor} from "./code-editor";

/** 加工中かどうかと、その終わりを知らせるもの(貼り付けの処理)。 */
export type PendingWork = {
	readonly busy: boolean;
	/** 終わるまで待つ。加工の途中で本文や条件が変わっていたら false。 */
	settled(): Promise<boolean>;
};

/** 提出欄の操作。サイトごとの違い(問題、言語、提出ボタン)はここで吸収する。 */
export interface SubmissionForm {
	/** いま提出しようとしている問題の URL。 */
	task(): string;

	/** 提出する言語。ページで選んだ言語が分からないサイトでは、エディタの言語の種類から決める。分からなければ null。 */
	language(editor: CodeEditor): JudgeLanguage | null;

	/** 問題や言語が変わったら変わる値。加工の途中で変わったら、その結果を捨てるのに使う。 */
	contextKey(editor: CodeEditor): string;

	/** 問題や言語が変わったら listener を呼ぶ。 */
	observe(editor: CodeEditor, listener?: () => void): void;

	/** 提出ボタン。見つからなければ null。 */
	submitButton(): object | null;

	/**
	 * 加工の途中に提出ボタンが押されたら、終わるまで待ってから提出し直す。
	 * 加工の途中で条件が変わって提出し直せなければ onCanceled を呼ぶ。何度呼んでも仕掛けるのは1回だけ。
	 */
	holdSubmitWhile(work: PendingWork, onCanceled: () => void): void;
}
