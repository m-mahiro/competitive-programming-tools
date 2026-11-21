import {type CompilerDiagnostic, importsPackage, modifyJavaCode, unresolvedImports} from "@atcoder-tools/shared";
import type {JudgeLanguage} from "@domain/execution/result";
import {findFoldStartLines} from "@domain/source/fold-lines";
import type {LocalRunnerClient} from "@application/execution/local-runner";

/** Local Runner がないときの変換の設定。 */
export type FallbackOptions = {
	/** false にする変数の名前。空なら変えない。 */
	readonly debugFlag: string;
	/** Local Runner で展開するライブラリのパッケージ。空なら確かめない。 */
	readonly libraryPackage: string;
};

/**
 * 言語ごとに、Local Runner を使わずに行う処理。言語を足すときは LANGUAGE_SUPPORT に登録する。
 * 登録の無い言語も、Local Runner があれば変換できる。
 */
export type LanguageSupport = {
	/** Local Runner がないときの提出用の変換。 */
	readonly fallback?: (code: string, options: FallbackOptions) => string;
	/** Local Runner がないと、提出してもコンパイルできないコードか。 */
	readonly needsLocalRunner?: (code: string, options: FallbackOptions) => boolean;
	/** 変換の失敗のうち、見つからない import の名前。 */
	readonly unresolvedImports?: (code: string, diagnostics: readonly CompilerDiagnostic[]) => string[];
	/** 貼り付けたあとに折りたたむ行。 */
	readonly foldStartLines?: (code: string) => number[];
};

const LANGUAGE_SUPPORT: Readonly<Record<string, LanguageSupport>> = {
	java: {
		fallback: (code, {debugFlag}) => modifyJavaCode(code, {debugFlag}),
		needsLocalRunner: (code, {libraryPackage}) => libraryPackage !== "" && importsPackage(code, libraryPackage),
		unresolvedImports,
		foldStartLines: findFoldStartLines,
	},
};

export function languageSupport(family: string): LanguageSupport {
	return LANGUAGE_SUPPORT[family] ?? {};
}

/** 提出するコードの言語。ページで選んだ言語が分からないサイトでは、エディタが Java と判定したときだけ Java にする。 */
export type SubmissionLanguage = {
	readonly family: string;
	/** ページで選んだ言語。分からなければ null。 */
	readonly judgeLanguage: JudgeLanguage | null;
};

/** Local Runner で変換できなかったときの診断。 */
export type SubmissionFailure = {
	readonly diagnostics: string;
	readonly items: readonly CompilerDiagnostic[];
};

export type SubmissionTransformResult = {
	readonly sourceCode: string;
	/** 変換した方法。localRunner でなければ、Local Runner と通信できなかったか、その言語が無かった。 */
	readonly via: "localRunner" | "fallback" | "none";
	/** Local Runner で変換できなかった。このときコードは変えない。 */
	readonly failure: SubmissionFailure | null;
};

/** Local Runner の言語の識別子。ページの言語が分からなければ、サーバーの既定(Java)に任せる。使える言語が無ければ null。 */
async function compilerNameOf(localRunner: LocalRunnerClient, {family, judgeLanguage}: SubmissionLanguage): Promise<string | undefined | null> {
	if (judgeLanguage) return localRunner.compilerFor(judgeLanguage);
	return family === "java" ? undefined : null;
}

/** Local Runner で提出用に変換する。通信できないか、その言語が無いときだけ、言語ごとの代わりの変換を使う。 */
export async function transformSubmission(
	code: string,
	language: SubmissionLanguage,
	localRunner: LocalRunnerClient,
	options: FallbackOptions,
): Promise<SubmissionTransformResult> {
	if (localRunner.isAvailable()) {
		try {
			const compilerName = await compilerNameOf(localRunner, language);
			if (compilerName !== null) {
				const transformed = await localRunner.transform(code, compilerName);
				if (transformed.status === "success") return {sourceCode: transformed.sourceCode, via: "localRunner", failure: null};
				return {
					sourceCode: code,
					via: "localRunner",
					failure: {diagnostics: transformed.diagnostics, items: transformed.diagnosticItems ?? []},
				};
			}
		} catch {
			// Local Runner が起動していなければ、下の代わりの変換を使う
		}
	}
	const fallback = languageSupport(language.family).fallback;
	return fallback
		? {sourceCode: fallback(code, options), via: "fallback", failure: null}
		: {sourceCode: code, via: "none", failure: null};
}
