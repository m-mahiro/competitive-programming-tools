import fs from "node:fs";
import path from "node:path";
import * as shared from "@atcoder-tools/shared";
import {SETTINGS} from "../../config";
import * as ensureServer from "../ensureServer";
import {languageForFile, resolveSourceFile, type SourceLanguage} from "../language";
import {requestRunner} from "../runnerClient";

/** コンパイル済みのプログラム。サーバーから消えていたら、refresh で作り直す。 */
export type PreparedProgram = {
	programId: string;
	/** 同じソースをコンパイルし直し、新しい programId を返す。 */
	readonly refresh: () => Promise<string>;
};

/** サーバーで変換したソースと、元のファイルの情報。 */
export type PreparedSource = {
	resolvedSourcePath: string;
	transformed: string;
	originalFileName: string;
	language: SourceLanguage;
	/** ライブラリ展開でインラインされた FQCN 一覧（展開なしなら空）。 */
	inlinedClasses: string[];
	/** サーバーが使った名前(Main.java など)を、エラーの表示で元のファイル名に戻す。 */
	restoreNames: (text: string) => string;
};

/** コンパイルまで済ませたソース。 */
export type CompiledSource = PreparedSource & {program: PreparedProgram};

export type SourceOptions = {
	header?: shared.LocalRunnerHeaderOption;
	/** --lang の指定。省略時は拡張子から選ぶ。 */
	lang?: string;
};

type ServerResult = shared.LocalRunnerTransformResponse | shared.LocalRunnerPrepareResponse;

function formatLines(lines: number): string {
	return lines > 0 ? `+${lines}` : String(lines);
}

/**
 * 実行したソースで増えた行数を、利用者への1行の案内にする。増えていなければ null。
 * 意味と使い方(エラーの行番号から引く、Java のコンパイルエラーはヘッダーの分だけ)は README に書く。
 */
export function describeLineOffset(offset: shared.LocalRunnerLineOffset | undefined, isJava = false): string | null {
	if (!offset) return null;
	const parts: string[] = [];
	if (offset.header !== 0) parts.push(`header ${formatLines(offset.header)}`);
	// Java は字句を読み切れないとき、ほかの言語は bundle を通したときに分からない
	if (offset.transform === null) parts.push(isJava ? "imports (unknown)" : "bundle (unknown)");
	else if (offset.transform !== 0) parts.push(`imports ${formatLines(offset.transform)}`);
	return parts.length === 0 ? null : `Line offset: ${parts.join(", ")}.`;
}

function createNameRestorer(language: SourceLanguage, originalFileName: string): (text: string) => string {
	const runtimeFileName = language.runtimeFileName;
	if (language.isJava) {
		// Java は提出用にクラス名も Main へ変えているので、クラス名も元に戻す。
		const originalClassName = originalFileName.replace(/\.java$/i, "");
		return (text) => text.replaceAll(runtimeFileName, originalFileName).replace(/\bMain\b/g, originalClassName);
	}
	return (text) => (runtimeFileName === originalFileName ? text : text.replaceAll(runtimeFileName, originalFileName));
}

/**
 * ソースファイルを解決して読み込み、サーバーで変換する(mode が prepare ならコンパイルもする)。
 * Java はライブラリ展開（lib import があれば）と Main クラス化、ほかの言語は設定の bundle と DEBUG の書き換えを行う。
 * すべての経路が変換後のソースを使うため、ローカル実行と提出物が常に一致する。
 */
async function requestSource(
	sourceFilePath: string,
	mode: "transform" | "prepare",
	debug: boolean,
	{header, lang, validate}: {header: shared.LocalRunnerHeaderOption; lang?: string; validate: boolean},
): Promise<{source: PreparedSource; result: ServerResult; request: () => Promise<ServerResult>}> {
	const resolvedSourcePath = resolveSourceFile(SETTINGS, sourceFilePath, process.cwd(), lang);
	const language = languageForFile(SETTINGS, resolvedSourcePath, lang);
	const sourceText = shared.normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	await ensureServer.ensureLocalRunnerReady();
	const fields = {sourceCode: sourceText, compilerName: language.name, debug, validate, header};
	const request = () => requestRunner<ServerResult>({mode, ...fields}, "Local Runner transform failed");

	const originalFileName = path.basename(resolvedSourcePath);
	const restoreNames = createNameRestorer(language, originalFileName);
	const result = await request();
	// 実行するもの(prepare)だけ、エラーの行番号が元のソースからずれる行数を示す
	const offset = mode === "prepare" ? describeLineOffset(result.lineOffset, language.isJava) : null;
	if (offset) console.log(offset);
	if (result.status !== "success") {
		// Java の診断は、変換の前のソースについて javac が返したものなので、名前を戻さない。
		const diagnostics = language.isJava ? result.diagnostics : restoreNames(result.diagnostics);
		throw new Error(diagnostics || "The source could not be prepared.");
	}
	if (result.inlinedClasses.length > 0) {
		console.log(`Bundled library classes: ${result.inlinedClasses.join(", ")}`);
	}
	const source: PreparedSource = {
		resolvedSourcePath,
		transformed: result.sourceCode,
		originalFileName,
		language,
		inlinedClasses: result.inlinedClasses,
		restoreNames,
	};
	return {source, result, request};
}

/** 提出物を作る(tomain、toclip)。DEBUG は無効にし、ヘッダーは既定で付ける。 */
export async function transformSource(sourceFilePath: string, options: SourceOptions = {}): Promise<PreparedSource> {
	const {source} = await requestSource(sourceFilePath, "transform", false, {
		header: options.header ?? true,
		...(options.lang !== undefined && {lang: options.lang}),
		validate: true,
	});
	return source;
}

/**
 * 実行のためにコンパイルする(run、test、localtest、crosscheck、submit)。
 * どのコマンドも、ライブラリの展開、ヘッダーの付与、コンパイルの順に行い、提出するソースそのもので実行する。ヘッダーは既定で付ける。
 */
export async function compileSource(sourceFilePath: string, debug: boolean, options: SourceOptions = {}): Promise<CompiledSource> {
	const {source, result, request} = await requestSource(sourceFilePath, "prepare", debug, {
		header: options.header ?? true,
		...(options.lang !== undefined && {lang: options.lang}),
		validate: false,
	});
	return {...source, program: preparedProgram(result, request)};
}

function programIdOf(response: ServerResult): string {
	if (response.status !== "success") throw new Error(response.diagnostics || "The source could not be prepared.");
	if (!("programId" in response) || !response.programId) throw new Error("Local Runner did not return a prepared program ID.");
	return response.programId;
}

/**
 * コンパイルしたプログラム。消えていたら request で作り直す。
 * 作り直したソースが最初と違えば(ヘッダーやライブラリのファイルが変わったなど)、試したプログラムと提出物が食い違うので止める。
 */
export function preparedProgram(first: ServerResult, request: () => Promise<ServerResult>): PreparedProgram {
	return {
		programId: programIdOf(first),
		refresh: async () => {
			const next = await request();
			if (next.status === "success" && next.sourceCode !== first.sourceCode) {
				throw new Error("The source changed while running the samples (a header or library file was edited). Run the command again.");
			}
			return programIdOf(next);
		},
	};
}
