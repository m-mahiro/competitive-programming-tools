import {
	firstDeclarationLine,
	locateDebugFlag,
	prependSubmissionHeader,
	type LocalRunnerLineOffset,
	type LocalRunnerTransformSummary,
	type LocalRunnerPrepareResponse,
	type LocalRunnerRunResponse,
	type LocalRunnerTransformResponse,
} from "@atcoder-tools/shared";
import * as formatter from "../utils/formatter";
import * as logging from "../utils/logging";
import type {CommandEngine, CommandLanguage} from "./commandEngine";
import {hasJavaProgram, prepareJavaCode, runJavaProgram, transformJavaCode} from "./javaEngine";
import type {RunnerLanguage} from "./languages";
import {type PrepareFunction, type PrepareOptions, PreparationQueue} from "./preparationQueue";
import {compileErrorResponse, missingProgramResponse, toRunResponse} from "./runResponse";

// 言語ごとの経路の振り分け。Java は javaEngine.ts へ、それ以外は commandEngine.ts へ渡し、
// 変換とコンパイルは言語によらずコンパイルの順番待ち(preparationQueue.ts)を通す。

// 覚えておくコンパイルの結果の数。言語ごとの実行環境が持つコンパイル結果の数と揃える。
const PREPARE_CACHE_MAX = 10;
// 事前コンパイルと、実行の前のコンパイルは、言語によらず同じ条件で行う。CLI の prepare と同じ条件にして結果を共有する。
// ブラウザから届くコードは、ヘッダーがあればすでに入っているので、付けない。
const RUN_PREPARE_OPTIONS = {validate: false, header: null} as const;

// 使える言語は、起動時に設定から決める(lifecycle.ts)。
let runnerLanguages: readonly RunnerLanguage[] = [];
let skippedLanguages: ReadonlyArray<{readonly name: string; readonly reason: string}> = [];
let commandEngine: CommandEngine | null = null;

/** 要求の内容が正しくないことを表す。400 として返す。 */
export class BadRequestError extends Error {
}

/** 起動時に決めた、使える言語と使えない言語を受け取る。 */
export function setLanguages(
	languages: readonly RunnerLanguage[],
	skipped: ReadonlyArray<{readonly name: string; readonly reason: string}>,
): void {
	runnerLanguages = languages;
	skippedLanguages = skipped;
}

/** コマンドで動かす言語の実行環境を受け取る。 */
export function setCommandEngine(engine: CommandEngine): void {
	commandEngine = engine;
}

export function availableLanguages(): readonly RunnerLanguage[] {
	return runnerLanguages;
}

/** 使えない言語を「名前 (理由)」の形で並べる。 */
export function describeSkippedLanguages(): string[] {
	return skippedLanguages.map(({name, reason}) => `${name} (${reason})`);
}

function findLanguage(name: string): RunnerLanguage | undefined {
	return runnerLanguages.find((candidate) => candidate.name === name);
}

/** 要求の compilerName から言語を決める。省略されていれば Java にする。 */
export function requireLanguage(compilerName: unknown): RunnerLanguage {
	const name = typeof compilerName === "string" && compilerName !== "" ? compilerName : "java";
	const language = findLanguage(name);
	if (language) return language;
	const reason = skippedLanguages.find((candidate) => candidate.name === name)?.reason;
	throw new BadRequestError(reason ? `The language "${name}" is not available: ${reason}.` : `Unknown language: "${name}".`);
}

/** 言語の既定のヘッダーを探す名前。言語の名前、種類の順に探す。 */
export function headerKeys(language: RunnerLanguage): string[] {
	return [...new Set([language.name, language.family])];
}

const NO_JAVA_TRANSFORM = {inlinedClasses: [], diagnosticItems: []};

/**
 * コマンドで動かす言語の変換の要約。bundle を通したときは、DEBUG の行を元のソースで示せないので書かない。
 * DEBUG の値は、書き換えたあとの値(debug)。
 */
function commandSummary(language: CommandLanguage, sourceCode: string, debug: boolean): LocalRunnerTransformSummary {
	if (language.bundle !== null) return {bundleCommand: true};
	const line = language.debugFlag === null ? null : locateDebugFlag(sourceCode, language.debugFlag, language.family);
	return {debugFlag: line === null || language.debugFlag === null ? null : {name: language.debugFlag, value: debug, line}};
}

/**
 * 変換で増えた行数。Java は最初の型の宣言の行を前後で比べる(変換は宣言より後の改行を保つ)。字句を読み切れなければ null。
 * ほかの言語の DEBUG の書き換えは行数を変えず、bundle のコマンドは行をどう変えるか分からないので null にする。
 */
function transformOffset(language: RunnerLanguage, sourceCode: string, transformed: string): number | null {
	if (language.command !== null) return language.command.bundle === null ? 0 : null;
	const before = firstDeclarationLine(sourceCode);
	const after = firstDeclarationLine(transformed);
	return before === null || after === null ? null : after - before;
}

/** header は、変換のあとに付けたヘッダーの行数。返すソースはヘッダーを含むので、変換の行数からは除く。 */
export function withLineOffset<T extends LocalRunnerTransformResponse>(language: RunnerLanguage, sourceCode: string, response: T, header = 0): T {
	const transform = transformOffset(language, sourceCode, response.sourceCode);
	const lineOffset: LocalRunnerLineOffset = {header, transform: transform === null || language.command !== null ? transform : transform - header};
	return {...response, lineOffset};
}

async function transformCommandCode(language: CommandLanguage, sourceCode: string, debug: boolean): Promise<LocalRunnerTransformResponse> {
	const result = await commandEngine!.transformSource(language, sourceCode, debug);
	return result.ok
		? {...NO_JAVA_TRANSFORM, status: "success", sourceCode: result.sourceCode, diagnostics: "", summary: commandSummary(language, sourceCode, debug)}
		: {...NO_JAVA_TRANSFORM, status: "compileError", sourceCode, diagnostics: result.diagnostics};
}

async function prepareCommandCode(
	language: CommandLanguage,
	sourceCode: string,
	debug: boolean,
	signal: AbortSignal,
	finish: (transformed: string) => string,
): Promise<LocalRunnerPrepareResponse> {
	const result = await commandEngine!.prepare(language, sourceCode, debug, signal, finish);
	return result.status === "success"
		? {...NO_JAVA_TRANSFORM, status: "success", sourceCode: result.sourceCode, diagnostics: "", programId: result.programId, summary: commandSummary(language, sourceCode, debug)}
		: {...NO_JAVA_TRANSFORM, status: "compileError", sourceCode: result.sourceCode, diagnostics: result.diagnostics};
}

/**
 * コマンドで動かす言語のプログラムを実行する。programId がその言語のものでなければ null を返す。
 * receivedAt は、サーバーが実行の要求を受け取った時刻。
 */
async function runCommandProgram(programId: string, stdin: string, receivedAt: number): Promise<LocalRunnerRunResponse | null> {
	if (commandEngine === null) return null;
	const outcome = await commandEngine.run(programId, stdin);
	if (outcome === null) return null;
	const response = toRunResponse(outcome);
	const logger = response.status === "success" ? logging.logInfo : logging.logWarn;
	logger(formatter.formatRunSummary(response, outcome.startedAt - receivedAt, Date.now() - receivedAt, "process", outcome.language));
	return response;
}

/**
 * 言語に合った経路で、ライブラリの展開(変換)、ヘッダーの付与、コンパイルの順に行う。コンパイルの順番待ちの中から呼ばれる。
 * 実行するのは提出するソースそのもので、増えた行数はヘッダーと変換に分けて返す。
 */
const prepareInQueue: PrepareFunction = async (name, sourceCode, {debug, validate, header}, signal) => {
	const language = findLanguage(name);
	if (!language) throw new Error(`Unknown language: "${name}".`);
	let headerLines = 0;
	const finish = (transformed: string): string => {
		const headered = prependSubmissionHeader(transformed, header);
		headerLines = headered.lines;
		return headered.sourceCode;
	};
	const prepared = language.command === null
		? prepareJavaCode(sourceCode, debug, validate, signal, finish)
		: prepareCommandCode(language.command, sourceCode, debug, signal, finish);
	return withLineOffset(language, sourceCode, await prepared, headerLines);
};

const preparations = new PreparationQueue(prepareInQueue, PREPARE_CACHE_MAX);

/** 提出用に変換する。コンパイルはしない。 */
export function transformSource(
	language: RunnerLanguage,
	sourceCode: string,
	debug: boolean,
	validate: boolean,
): Promise<LocalRunnerTransformResponse> {
	const transformed = language.command === null
		? transformJavaCode(sourceCode, debug, validate)
		: transformCommandCode(language.command, sourceCode, debug);
	return transformed.then((response) => withLineOffset(language, sourceCode, response));
}

/** 事前コンパイルを順番待ちに入れる。結果は、実行の要求が来たときに使う。 */
export function schedulePrecompile(language: RunnerLanguage, sourceCode: string, debug: boolean): void {
	preparations.schedule(language.name, sourceCode, {...RUN_PREPARE_OPTIONS, debug});
}

/** 覚えていた結果のプログラムが、実行環境に残っているか。Java はコンパイル済みのクラスを、ほかの言語は実行環境の記憶を見る。 */
function programExists(language: RunnerLanguage, programId: string): boolean {
	return language.command === null ? hasJavaProgram(programId) : commandEngine?.has(programId) !== false;
}

/**
 * 変換とコンパイルの結果を待つ。覚えていた結果のプログラムが実行環境から追い出されていたら、作り直して返す。
 * CLI はプログラムが消えたときに同じソースで prepare し直すので、消えた programId をもう一度返さない。
 */
export async function prepareSource(language: RunnerLanguage, sourceCode: string, options: PrepareOptions): Promise<LocalRunnerPrepareResponse> {
	const prepared = await preparations.wait(language.name, sourceCode, options);
	if (prepared.status !== "success" || !prepared.programId || programExists(language, prepared.programId)) return prepared;
	preparations.forget(language.name, sourceCode, options);
	return preparations.wait(language.name, sourceCode, options);
}

/**
 * ソースを実行する。そのソースのコンパイルが終わるのを待ち、コンパイルエラーなら実行の応答として返す。
 * 事前コンパイルの結果があれば、それを使う。
 */
export async function runSource(
	language: RunnerLanguage,
	sourceCode: string,
	stdin: string,
	debug: boolean,
	receivedAt: number,
): Promise<LocalRunnerRunResponse> {
	const options = {...RUN_PREPARE_OPTIONS, debug};
	// コンパイルの結果が追い出されていたら、作り直して1回だけやり直す
	for (let attempt = 0; attempt < 2; attempt++) {
		const prepared = await preparations.wait(language.name, sourceCode, options);
		// コンパイルエラーも、診断を出したソースが元より増えた行数を返す。
		// Java の変換の前に javac が見つけたエラーは元のソースのままなので、変換の行数は 0 になる
		const lineOffset = prepared.lineOffset ? {lineOffset: prepared.lineOffset} : {};
		if (prepared.status !== "success" || !prepared.programId) {
			return {...compileErrorResponse(prepared.diagnostics, language.name, receivedAt), ...lineOffset};
		}
		const response = await runProgram(prepared.programId, stdin, receivedAt);
		if (response) return {...response, ...lineOffset};
		preparations.forget(language.name, sourceCode, options);
	}
	return missingProgramResponse("(recompiled program)");
}

/** コンパイル済みのプログラムを実行する。プログラムが見つからなければ null を返す。 */
export async function runProgram(programId: string, stdin: string, receivedAt: number): Promise<LocalRunnerRunResponse | null> {
	return await runCommandProgram(programId, stdin, receivedAt) ?? runJavaProgram(programId, stdin, receivedAt);
}
