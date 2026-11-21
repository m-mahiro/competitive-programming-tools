import {type CompilerDiagnostic, type LocalRunnerHeaderOption, modifyJavaCode} from "@atcoder-tools/shared";
import type {LocalRunnerClient} from "@application/execution/local-runner";

export type JavaTransformOptions = {
	readonly removePackage: boolean;
	readonly renameClass: boolean;
	readonly fixDebug: boolean;
	readonly header: LocalRunnerHeaderOption;
};

/** Local Runner で変換できなかったときの javac の診断。 */
export type JavaTransformFailure = {
	readonly diagnostics: string;
	readonly items: readonly CompilerDiagnostic[];
};

export type JavaTransformResult = {
	readonly sourceCode: string;
	/** Local Runner と通信できたか。偽なら字句の置換だけの結果になる。 */
	readonly connected: boolean;
	/** 通信できたが変換に失敗した。このときコードは変えない。 */
	readonly failure: JavaTransformFailure | null;
};

/** Local Runner で変換する。通信できないときだけ、字句の置換で最低限の修正を行う。 */
export async function transformJava(
	code: string,
	localRunner: LocalRunnerClient,
	options: JavaTransformOptions,
): Promise<JavaTransformResult> {
	if (localRunner.isAvailable()) {
		try {
			const transformed = await localRunner.transform(code, options.header);
			if (transformed.status === "success") return {sourceCode: transformed.sourceCode, connected: true, failure: null};
			return {
				sourceCode: code,
				connected: true,
				failure: {diagnostics: transformed.diagnostics, items: transformed.diagnosticItems ?? []},
			};
		} catch {
			// Local Runner が起動していなければ、下の字句変換を使う
		}
	}
	return {sourceCode: modifyJavaCode(code, options).modified, connected: false, failure: null};
}
