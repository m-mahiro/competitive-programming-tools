import {evaluateEasyTestOutput} from "@atcoder-tools/shared";

export type JudgeLanguage = {
	readonly id: string;
	readonly label: string;
	readonly family: string | null;
};

export type TestCase = {
	readonly title: string;
	readonly input: string;
	readonly output: string | null;
};

export type RunOptions = {
	readonly trim?: boolean;
	readonly split?: boolean;
	readonly allowableError?: number;
	/** 同時に実行するサンプルの組。コンパイルエラーの再実行を省くために使う。 */
	readonly runGroupId?: string;
};

export type RunResult = {
	readonly status: string;
	readonly input: string;
	readonly exitCode?: string | number;
	readonly execTime?: number;
	/** 判定サーバーが測った使用量(KB)。 */
	readonly memory?: number;
	/** Local Runner が測った累積の割り当て量(KB)。ピークの使用量ではない。 */
	readonly allocatedMemory?: number;
	readonly output?: string;
	readonly error?: string;
	readonly expectedOutput?: string;
	/** 実行したソースが、エディタのコードより増えた行数(Local Runner の変換)。エラーの行番号からこれを引くとエディタの行になる。 */
	readonly lineOffset?: number;
};

/**
 * 許容誤差の欄の文字列を読む。全体が数の表記(1e-6、0.001 など)で、有限の正の数のときだけ値を返し、それ以外は null。
 * 先頭だけを数として読むと 10^-6 が 10 になり、誤答を正解にしてしまうため。
 */
export function parseAllowableError(text: string): number | null {
	if (!/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?\s*$/.test(text)) return null;
	const value = Number(text.trim());
	return Number.isFinite(value) && value > 0 ? value : null;
}

/** 実行結果を期待する出力と比較する。 */
export function judgeResult(result: RunResult, expected: string | null, options: RunOptions): RunResult {
	if (expected === null) return result;
	if (result.status !== "OK") return {...result, expectedOutput: expected};
	const judged = evaluateEasyTestOutput({status: result.status, output: result.output ?? ""}, expected, options);
	return {...result, ...judged};
}
