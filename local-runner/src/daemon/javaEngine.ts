import {
	type LocalRunnerPrepareResponse,
	type LocalRunnerRunResponse,
	type LocalRunnerTransformResponse,
} from "@atcoder-tools/shared";
import type {CompileEntry} from "../types";
import * as config from "../config";
import {resolveLibrarySourceRoot} from "../javaLibrary/prepare";
import * as formatter from "../utils/formatter";
import * as logging from "../utils/logging";
import * as compiler from "./compiler";
import * as dispatcher from "./dispatcher";
import {CanceledError} from "./processRunner";
import {compileErrorResponse, notRunResponse} from "./runResponse";

// Java の変換、コンパイル、実行。常駐 JVM(dispatcher.ts)と javac のキャッシュ(compiler.ts)を使う。
// Java 以外の言語は commandEngine.ts が受け持つ。

export async function transformJavaCode(sourceCode: string, debug: boolean, validate = true): Promise<LocalRunnerTransformResponse> {
	const result = await dispatcher.queueDispatcherTransform(sourceCode, resolveLibrarySourceRoot(), debug, validate);
	return {
		status: result.exitCode === 0 ? "success" : "compileError",
		sourceCode: result.sourceCode,
		diagnostics: result.diagnostics,
		inlinedClasses: result.inlinedClasses,
		diagnosticItems: result.diagnosticItems,
	};
}

/** Java の変換とコンパイル。常駐 JVM の中の処理は止められないので、中断は区切りごとに確かめる。 */
export async function prepareJavaCode(
	sourceCode: string,
	debug: boolean,
	validate: boolean,
	signal: AbortSignal,
): Promise<LocalRunnerPrepareResponse> {
	const transformed = await transformJavaCode(sourceCode, debug, validate);
	if (transformed.status !== "success") return transformed;
	if (signal.aborted) throw new CanceledError();

	const entry = await compiler.getCompiledEntry(transformed.sourceCode);
	if (entry.status === "error") {
		return {
			...transformed,
			status: "compileError",
			diagnostics: entry.error || "Java compilation failed.",
		};
	}
	return {...transformed, programId: compiler.getProgramId(transformed.sourceCode)};
}

/** コンパイル済みの Java のプログラムを実行する。programId が Java のものでなければ null を返す。 */
export async function runJavaProgram(programId: string, stdin: string, receivedAt: number): Promise<LocalRunnerRunResponse | null> {
	const entry = await compiler.getCompiledEntryByProgramId(programId);
	return entry === null ? null : runJavaEntry(entry, stdin, receivedAt);
}

async function runJavaEntry(entry: CompileEntry, stdin: string, receivedAt: number): Promise<LocalRunnerRunResponse> {
	if (entry.status === "error") return compileErrorResponse(entry.error || "", "java", receivedAt);

	if (entry.requiresIsolatedProcess) {
		logging.logInfo("[Run] Falling back to isolated JVM mode due to FileDescriptor/System.exit/Runtime.halt usage.");
		const startedAt = Date.now();
		const result = await compiler.runCodeInIsolatedJvm(entry, stdin);
		logging.logInfo(formatter.formatRunSummary(result, startedAt - receivedAt, Date.now() - receivedAt, "isolated", "java"));
		return result;
	}

	// 実行が始まる前に失敗したときは、失敗するまで待った時間を Wait にする
	let waitTime: number | null = null;
	try {
		const result = await dispatcher.queueDispatcherRun(entry, stdin);
		waitTime = (result.startedAt ?? receivedAt) - receivedAt;
		if (result.timedOut) {
			const response = notRunResponse("timeLimitExceeded", 124, result.error || "", config.RUNNER_CONFIG.runTimeoutMs);
			logging.logWarn(formatter.formatRunSummary(response, waitTime, Date.now() - receivedAt, "daemon", "java"));
			return response;
		}
		const totalTime = Date.now() - receivedAt;
		if (result.stdoutTruncated || result.stderrTruncated) {
			logging.logWarn(
				`[Run] Output truncated by dispatcher (stdout=${result.stdoutTruncated}, stderr=${result.stderrTruncated}).`,
			);
		}
		const response: LocalRunnerRunResponse = {
			status: result.exitCode === 0 ? "success" : "runtimeError",
			exitCode: result.exitCode ?? -1,
			stdout: result.stdout || "",
			stderr: result.stderr || "",
			time: result.time || 0,
			stdoutTruncated: !!result.stdoutTruncated,
			stderrTruncated: !!result.stderrTruncated,
			// Java は累積アロケーション量をバイトで返す（-1=計測不可）。表示系は KB 想定なので KB に変換。
			memory: result.memory && result.memory > 0 ? Math.round(result.memory / 1024) : 0,
		};
		const logger = response.status === "success" ? logging.logInfo : logging.logWarn;
		logger(formatter.formatRunSummary(response, waitTime, totalTime, "daemon", "java"));
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logging.logError(`[Run] Internal error: ${message}`);
		const response = notRunResponse("internalError", -1, message);
		const totalTime = Date.now() - receivedAt;
		logging.logError(formatter.formatRunSummary(response, waitTime ?? totalTime, totalTime, "daemon", "java"));
		return response;
	}
}
