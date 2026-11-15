import os from "node:os";
import {type LocalRunnerRunResponse, STALE_PROGRAM_MESSAGE} from "@atcoder-tools/shared";
import * as config from "../config";
import * as formatter from "../utils/formatter";
import * as logging from "../utils/logging";
import type {ProcessOutcome} from "./processRunner";

// 実行の応答の組み立て。Java とコマンドで動かす言語の両方が使う。

/** 実行の結果が無いときの応答。 */
export function notRunResponse(status: LocalRunnerRunResponse["status"], exitCode: number, stderr: string, time = 0): LocalRunnerRunResponse {
	return {status, exitCode, stdout: "", stderr, time, stdoutTruncated: false, stderrTruncated: false, memory: 0};
}

export function missingProgramResponse(programId: string): LocalRunnerRunResponse {
	return notRunResponse("badRequest", -1, `${STALE_PROGRAM_MESSAGE} ${programId}`);
}

/** コンパイルエラーを実行の応答にして、記録する。Wait と Total は、コンパイルを待った時間になる。 */
export function compileErrorResponse(diagnostics: string, language: string, receivedAt: number): LocalRunnerRunResponse {
	const response = notRunResponse("compileError", 1, diagnostics);
	const waitTime = Date.now() - receivedAt;
	logging.logWarn(formatter.formatRunSummary(response, waitTime, waitTime, "compile", language));
	return response;
}

/** コマンドで動かした解答のプロセスの結果を、実行の応答にする。 */
export function toRunResponse(outcome: ProcessOutcome): LocalRunnerRunResponse {
	const base = {
		stdout: outcome.stdout,
		stdoutTruncated: outcome.stdoutTruncated,
		stderrTruncated: outcome.stderrTruncated,
		memory: 0,
		peakMemory: outcome.peakMemoryKb,
	};
	if (outcome.timedOut) {
		const timeoutMs = config.RUNNER_CONFIG.runTimeoutMs;
		return {
			...base,
			status: "timeLimitExceeded",
			exitCode: 124,
			stderr: `Execution timed out after ${timeoutMs}ms.\n${outcome.stderr}`.trim(),
			time: timeoutMs
		};
	}
	if (outcome.signal !== null) {
		const signalNumber = (os.constants.signals as Record<string, number>)[outcome.signal] ?? 0;
		return {
			...base,
			status: "runtimeError",
			exitCode: 128 + signalNumber,
			stderr: `${outcome.stderr}${outcome.stderr && !outcome.stderr.endsWith("\n") ? "\n" : ""}Terminated by ${outcome.signal}.`,
			time: outcome.timeMs,
		};
	}
	return {
		...base,
		status: outcome.exitCode === 0 ? "success" : "runtimeError",
		exitCode: outcome.exitCode,
		stderr: outcome.stderr,
		time: outcome.timeMs,
	};
}
