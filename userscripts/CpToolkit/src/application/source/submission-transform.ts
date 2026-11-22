import {
	type CompilerDiagnostic,
	DEBUG_FLAG_FAMILIES,
	importsPackage,
	type JavaTransformIssue,
	rewriteDebugFlag,
	transformJavaForSubmission,
	unresolvedImports,
} from "@atcoder-tools/shared";
import type {JudgeLanguage} from "@domain/execution/result";
import {LocalRunnerError, type LocalRunnerClient} from "@application/execution/local-runner";

/** Local Runner がないときの変換の設定。 */
export type FallbackOptions = {
	/** false にする変数の名前。空なら変えない。 */
	readonly debugFlag: string;
	/** Local Runner で展開する Java のライブラリのパッケージ。空なら確かめない。 */
	readonly libraryPackage: string;
};

/** Local Runner がないときの変換で、元のコードを残した理由。 */
type FallbackIssue = JavaTransformIssue | "ambiguousDebugFlag";

type FallbackResult = {readonly sourceCode: string; readonly issue: FallbackIssue | null};

/**
 * 言語ごとに、Local Runner を使わずに行う処理。言語を足すときは LANGUAGE_SUPPORT に登録する。
 * 登録の無い言語も、Local Runner があれば変換できる。
 */
export type LanguageSupport = {
	/** Local Runner がないときの提出用の変換。 */
	readonly fallback?: (code: string, options: FallbackOptions) => FallbackResult;
	/** Local Runner がないと、提出してもコンパイルできないコードか。 */
	readonly needsLocalRunner?: (code: string, options: FallbackOptions) => boolean;
	/** 変換の失敗のうち、見つからない import の名前。 */
	readonly unresolvedImports?: (code: string, diagnostics: readonly CompilerDiagnostic[]) => string[];
};

/** デバッグ用の変数だけを false にする。宣言が2つ以上あって決められなければ、元のコードを残す。 */
const debugFlagSupport = (family: string): LanguageSupport => ({
	fallback(code, {debugFlag}) {
		if (debugFlag === "") return {sourceCode: code, issue: null};
		const sourceCode = rewriteDebugFlag(code, debugFlag, false, family);
		return sourceCode === null ? {sourceCode: code, issue: "ambiguousDebugFlag"} : {sourceCode, issue: null};
	},
});

const LANGUAGE_SUPPORT: Readonly<Record<string, LanguageSupport>> = {
	// Local Runner の debugFlag と同じ書き換えを、Local Runner がないときにも行う
	...Object.fromEntries(DEBUG_FLAG_FAMILIES.map((family) => [family, debugFlagSupport(family)])),
	java: {
		fallback: (code, {debugFlag}) => transformJavaForSubmission(code, {debugFlag}),
		needsLocalRunner: (code, {libraryPackage}) => libraryPackage !== "" && importsPackage(code, libraryPackage),
		unresolvedImports,
	},
};

export function languageSupport(family: string): LanguageSupport {
	return LANGUAGE_SUPPORT[family] ?? {};
}

/** 提出フォームかエディタから言語の種類を特定できたときだけ変換する。 */
export type SubmissionLanguage = JudgeLanguage & {readonly family: string};

/** Local Runner で変換できなかったときの診断。 */
export type SubmissionFailure = {
	readonly diagnostics: string;
	readonly items: readonly CompilerDiagnostic[];
	readonly notify?: boolean;
};

export type SubmissionTransformResult = {
	readonly sourceCode: string;
	/** 変換した方法。localRunner でなければ、Local Runner と通信できなかったか、その言語が無かった。 */
	readonly via: "localRunner" | "fallback" | "none";
	/** Local Runner で変換できなかった。このときコードは変えない。 */
	readonly failure: SubmissionFailure | null;
};

/** Local Runner で提出用に変換する。通信できないか、その言語が無いときだけ、言語ごとの代わりの変換を使う。 */
export async function transformSubmission(
	code: string,
	language: SubmissionLanguage,
	localRunner: LocalRunnerClient,
	options: FallbackOptions,
): Promise<SubmissionTransformResult> {
	if (localRunner.isAvailable()) {
		try {
			const compilerName = await localRunner.compilerFor(language);
			if (compilerName !== null) {
				const transformed = await localRunner.transform(code, compilerName);
				if (transformed.status === "success") return {sourceCode: transformed.sourceCode, via: "localRunner", failure: null};
				return {
					sourceCode: code,
					via: "localRunner",
					failure: {diagnostics: transformed.diagnostics, items: transformed.diagnosticItems},
				};
			}
		} catch (error) {
			if (!(error instanceof LocalRunnerError && error.status === 0)) {
				return {sourceCode: code, via: "localRunner", failure: {
					diagnostics: error instanceof Error ? error.message : String(error), items: [],
					notify: !(error instanceof LocalRunnerError) || error.notify,
				}};
			}
		}
	}
	const fallback = languageSupport(language.family).fallback;
	if (!fallback) return {sourceCode: code, via: "none", failure: null};
	const {sourceCode, issue} = fallback(code, options);
	const reasons: Readonly<Record<FallbackIssue, string>> = {
		ambiguousDebugFlag: "More than one declaration of the debug flag was found outside blocks.",
		mainNotFound: "No supported Java main method was found.",
		ambiguousMain: "More than one Java entry point was found.",
		nameCollision: "Renaming the entry class would cause a name collision.",
		ambiguousReference: "The browser cannot reliably resolve references to the entry class.",
		unsupportedSyntax: "This Java syntax requires Local Runner for a safe transform.",
	};
	return {sourceCode, via: "fallback", failure: issue ? {diagnostics: reasons[issue], items: []} : null};
}
