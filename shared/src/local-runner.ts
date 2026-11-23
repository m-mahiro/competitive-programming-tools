export type LocalRunnerStatus =
	| "success"
	| "compileError"
	| "timeLimitExceeded"
	| "runtimeError"
	| "internalError"
	| "badRequest";

export type EasyTestStatus = "OK" | "AC" | "WA" | "RE" | "TLE" | "OLE" | "CE" | "IE";

export type LocalRunnerCompilerInfo = {
	language: string;
	compilerName: string;
	label: string;
	/** 言語の種類(cpp、python3 など)。ページの言語と同じ種類の実行環境を候補にする。 */
	family?: string;
	/** ページの言語の表記にこの語が含まれていれば、同じ種類の中でこの実行環境を先に使う。 */
	match?: string[];
};

export type LocalRunnerListRequest = {
	mode: "list";
};

/**
 * 編集中のソースを、先にコンパイルしておく。サーバーは結果を待たずに {status: "accepted"} を返し、
 * 同じ言語の新しいソースが届いたら、古いソースのコンパイルを中断する。
 */
export type LocalRunnerPrecompileRequest = {
	mode: "precompile";
	sourceCode: string;
	/** list で返したコンパイラの識別子。省略時は Java。 */
	compilerName?: string;
	/** 省略時は有効。run の debug と同じ値にすると、事前コンパイルの結果を実行に使える。 */
	debug?: boolean;
};

/** 提出物の先頭に付けるヘッダー。true は言語の設定、文字列は setheader で設定した名前、false は付けない。 */
export type LocalRunnerHeaderOption = boolean | string;

/** 提出物に付けるヘッダーの文を返す。ブラウザがほかの文と並べて付けるときに使う。 */
export type LocalRunnerHeaderRequest = {
	mode: "header";
	/** list で返したコンパイラの識別子。省略時は Java。 */
	compilerName?: string;
	/** 省略時は言語の設定のヘッダー。 */
	header?: LocalRunnerHeaderOption;
};

export type LocalRunnerHeaderResponse = {
	status: "success";
	/** ヘッダーが設定されていなければ null。 */
	header: string | null;
};

export type LocalRunnerTransformRequest = {
	mode: "transform";
	sourceCode: string;
	/** list で返したコンパイラの識別子。省略時は Java。 */
	compilerName?: string;
	debug?: boolean;
	validate?: boolean;
	/** 省略時は既定のヘッダーを付ける。 */
	header?: LocalRunnerHeaderOption;
};

export type LocalRunnerPrepareRequest = {
	mode: "prepare";
	sourceCode: string;
	/** list で返したコンパイラの識別子。複数の言語を扱うサーバーが言語を選ぶのに使う。省略時は Java。 */
	compilerName?: string;
	debug?: boolean;
	validate?: boolean;
	/** 省略時は付けない。指定しても返すソースにだけ付け、コンパイルはヘッダーなしで行う。 */
	header?: LocalRunnerHeaderOption;
};

/**
 * 実行する。sourceCode を渡すと、そのソースのコンパイルが終わるのを待ってから実行し、
 * コンパイルエラーなら status を compileError、stderr を診断にして返す。programId は prepare の結果を渡す。
 */
export type LocalRunnerRunRequest = {
	mode: "run";
	/** list で返したコンパイラの識別子。sourceCode を渡すときに使う。 */
	compilerName?: string;
	sourceCode?: string;
	programId?: string;
	stdin?: string;
	/** sourceCode を渡すときのデバッグの有無。省略時は有効。 */
	debug?: boolean;
};

export type LocalRunnerRequest =
	| {mode: "status"}
	| LocalRunnerListRequest
	| LocalRunnerPrecompileRequest
	| LocalRunnerHeaderRequest
	| LocalRunnerTransformRequest
	| LocalRunnerPrepareRequest
	| LocalRunnerRunRequest;

/**
 * 実行したソースで、元のソースより増えた行数。エラーの行番号からこれを引くと、元のソースの行になる。
 * 増えるのは最初の型の宣言より前だけなので、それより後の行は同じだけずれる。
 */
export type LocalRunnerLineOffset = {
	/** 先頭に付けたヘッダーと、その後の空行の行数。付けなければ 0。 */
	header: number;
	/** 変換で増えた行数(Java がライブラリのために足した import、消した package の行など)。bundle を通すと分からないので null。 */
	transform: number | null;
};

export type LocalRunnerTransformResponse = {
	status: "success" | "compileError";
	sourceCode: string;
	diagnostics: string;
	inlinedClasses: string[];
	diagnosticItems: CompilerDiagnostic[];
	lineOffset?: LocalRunnerLineOffset;
};

export type LocalRunnerPrepareResponse = LocalRunnerTransformResponse & {
	programId?: string;
};

export type CompilerDiagnostic = {
	kind: string;
	line: number;
	column: number;
	/** 元ソースの診断位置を含む、解決できなかった import。 */
	importName?: string;
	code: string;
	message: string;
};

export type LocalRunnerRunResponse = {
	status: LocalRunnerStatus;
	exitCode: number;
	stdout: string;
	stderr: string;
	time: number;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	/** Java が実行中に確保したメモリの合計(KB)。解放した分も含むので、最大値ではない。測らなければ 0。 */
	memory: number;
	/** プロセスが同時に使った物理メモリの最大値(KB)。プロセスとして実行する言語が返す。 */
	peakMemory?: number;
	/** sourceCode を渡した実行で、実行したソースが元のソースより増えた行数。 */
	lineOffset?: LocalRunnerLineOffset;
};

/** 指定した programId のプログラムがサーバーにないときの stderr の先頭。サーバーの再起動やキャッシュの追い出しで起こる。 */
export const STALE_PROGRAM_MESSAGE = "Prepared program is unavailable:";

/** 挿入位置から、ヘッダーの全文が独立した行として始まるか。 */
export function includesSubmissionHeader(code: string, header: string, offset = 0): boolean {
	if (!header.trim()) return true;
	const end = offset + header.length;
	return code.startsWith(header, offset) && (end === code.length || code[end] === "\n" || code.startsWith("\r\n", end));
}

/**
 * ソースの先頭にヘッダーと空行を付け、増えた行数と返す。すでにそのヘッダーで始まるソース(toclip の出力など)には
 * 重ねて付けない(増えた行数は 0)。ヘッダーが null か空白だけなら付けない。
 */
export function prependSubmissionHeader(sourceCode: string, header: string | null): {sourceCode: string; lines: number} {
	if (header === null || !header.trim() || includesSubmissionHeader(sourceCode, header)) return {sourceCode, lines: 0};
	return {sourceCode: `${header}\n\n${sourceCode}`, lines: header.split("\n").length + 1};
}

/** コンパイル済みのプログラムが消えていて、ソースから作り直す必要がある応答か。 */
export function isStaleProgramResponse(response: {status: string; stderr?: string}): boolean {
	return response.status === "badRequest" && response.stderr?.startsWith(STALE_PROGRAM_MESSAGE) === true;
}

export function isHttpUrl(value: string): boolean {
	return /^https?:\/\//.test(value);
}

/**
 * 実行の応答を Easy Test+ の判定へ変える。標準出力を上限で切り詰めたときは、比べられる出力が無いので OLE にする。
 * 標準エラー出力だけの切り詰めは判定に使わない。
 */
export function toEasyTestStatus(status: LocalRunnerStatus, exitCode = 0, stdoutTruncated = false): EasyTestStatus {
	switch (status) {
		case "success":
			if (exitCode !== 0) return "RE";
			return stdoutTruncated ? "OLE" : "OK";
		case "runtimeError":
			return "RE";
		case "timeLimitExceeded":
			return "TLE";
		case "compileError":
			return "CE";
		case "internalError":
		case "badRequest":
		default:
			return "IE";
	}
}
