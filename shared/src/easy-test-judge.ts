import type {EasyTestStatus} from "./local-runner";

export type EasyTestRunResult = {
	status: string;
	output: string;
	error?: string;
	execTime?: number;
};

export type EasyTestJudgeResult = {
	status: string;
	output: string;
	expectedOutput: string;
};

export type EasyTestJudgeOptions = {
	trim?: boolean;
	split?: boolean;
	allowableError?: number;
};

/**
 * トークン全体が整数か小数の表記か。数の後ろに文字が続くもの(1garbage)と、指数の表記(1e3)は数としない。
 * 許容誤差は既定で全問題にかかり、Test & Submit は全問正解で提出するので、ジャッジが受け付けるか分からない表記は文字列で比べる。
 */
const NUMBER_PATTERN = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** 差があふれたときに数を縮める倍率(2^-512)。 */
const SCALE = 2 ** -512;

/** 両方が数の表記で、少なくとも一方が小数の表記なら、許容誤差で比べる。どちらも整数なら文字列で比べる。 */
function withinAllowableError(x: string, y: string, allowableError: number): boolean {
	if (!NUMBER_PATTERN.test(x) || !NUMBER_PATTERN.test(y) || !(x.includes(".") || y.includes("."))) return false;
	const a = Number(x);
	const b = Number(y);
	// 桁が多すぎて Infinity になる数どうしは、Infinity <= Infinity で通ってしまうので文字列で比べる
	if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(allowableError)) return false;
	const difference = Math.abs(a - b);
	if (Number.isFinite(difference)) return difference <= Math.max(allowableError, Math.abs(b) * allowableError);
	// 差が表せる最大の数を超えたら、2 の累乗で縮めて比べる。2 の累乗で割っても、この大きさの数の値は変わらない
	const a2 = a * SCALE;
	const b2 = b * SCALE;
	return Math.abs(a2 - b2) <= Math.max(allowableError * SCALE, Math.abs(b2) * allowableError);
}

export function evaluateEasyTestOutput(
	runResult: EasyTestRunResult,
	expectedOutput: string,
	options: EasyTestJudgeOptions = {trim: true, split: true},
): EasyTestJudgeResult {
	const status = runResult.status;
	if (status !== "OK" || typeof expectedOutput !== "string") {
		return {status, output: runResult.output || "", expectedOutput};
	}

	let output = runResult.output || "";
	let expected = expectedOutput;
	if (options.trim) {
		expected = expected.trim();
		output = output.trim();
	}

	let equals = (x: string, y: string): boolean => x === y;
	const allowableError = options.allowableError;
	if (allowableError) {
		equals = (x, y) => x === y || withinAllowableError(x, y, allowableError);
	}
	if (options.split) {
		const superEquals = equals;
		equals = (x, y) => {
			const xs = x.split(/\s+/);
			const ys = y.split(/\s+/);
			if (xs.length !== ys.length) return false;
			for (let i = 0; i < xs.length; i++) {
				if (!superEquals(xs[i], ys[i])) return false;
			}
			return true;
		};
	}

	const judgedStatus: EasyTestStatus = equals(output, expected) ? "AC" : "WA";
	return {status: judgedStatus, output, expectedOutput: expected};
}
