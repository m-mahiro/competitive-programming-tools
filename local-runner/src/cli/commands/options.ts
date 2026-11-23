import type {LocalRunnerHeaderOption} from "@atcoder-tools/shared";
import type {SampleDisplayOptions} from "../sampleJudge";
import {isHeaderName} from "../../settings/settings";
import {CliUsageError} from "./Command";

/**
 * サンプルの結果の表示に関するオプション(--full、--wa-only、--max-lines=N、--time-limit=N)を解釈し、display に書き込む。
 * 解釈したら true を返す。test と submit は問題ページの制限を使うので、timeLimit: false で --time-limit を受け付けない。
 */
export function parseDisplayFlag(arg: string, display: SampleDisplayOptions, {timeLimit = true} = {}): boolean {
	const full = parseBoolFlag(arg, "--full");
	if (full !== undefined) {
		display.full = full;
		return true;
	}
	const waOnly = parseBoolFlag(arg, "--wa-only");
	if (waOnly !== undefined) {
		display.waOnly = waOnly;
		return true;
	}
	const maxLines = parseIntFlag(arg, "--max-lines");
	if (maxLines !== undefined) {
		display.maxLines = maxLines;
		return true;
	}
	// 0 ms の制限は表示に使えないので、1 以上だけを受け付ける
	const timeLimitMs = timeLimit ? parseIntFlag(arg, "--time-limit", undefined, 1) : undefined;
	if (timeLimitMs !== undefined) {
		display.timeLimitMs = timeLimitMs;
		return true;
	}
	return false;
}

/**
 * 提出物のヘッダー指定を解釈するヘルパー。受け付ける形式:
 *   --no-header       → 付けない
 *   --header=<名前>   → setheader で <名前> に設定したファイルを付ける
 *
 * arg がこのフラグでなければ undefined を返す。
 */
export function parseHeaderFlag(arg: string): LocalRunnerHeaderOption | undefined {
	if (arg === "--no-header") return false;
	if (!arg.startsWith("--header=")) return undefined;
	// setheader と同じ規則の名前だけを受け付ける。空や ../x のような名前は、打ち間違いとして止める
	const name = arg.slice("--header=".length);
	if (!isHeaderName(name)) {
		throw new CliUsageError(`Invalid header name for --header: "${name}" (use a name set with setheader, e.g. --header=short).`);
	}
	return name;
}

/** --lang=<名前> を解釈する。arg がこのフラグでなければ undefined を返す。 */
export function parseLangFlag(arg: string, name = "--lang"): string | undefined {
	if (!arg.startsWith(`${name}=`)) return undefined;
	const value = arg.slice(name.length + 1);
	if (value === "") throw new CliUsageError(`${name} needs a language name (e.g. ${name}=pypy).`);
	return value;
}

/**
 * 真偽値オプションを解釈する汎用ヘルパー。
 * 受け付ける形式:
 *   --flag            → true
 *   --flag=true       → true   （1 / yes / on も真）
 *   --flag=false      → false  （0 / no / off も偽）
 *   -x / -x=true ...  （shortName を渡した場合）
 *
 * arg がこのフラグでなければ undefined を返す（呼び出し側で次の判定に進める）。
 * 値が真偽として解釈できない場合は {@link CliUsageError} を投げる。
 *
 * オプションはコマンドごとに異なるため、どのフラグを受け付けるかは各コマンドが
 * このヘルパーを並べて宣言する（値の解釈という退屈な部分だけを共通化する）。
 */
export function parseBoolFlag(arg: string, longName: string, shortName?: string): boolean | undefined {
	const eq = arg.indexOf("=");
	const key = eq === -1 ? arg : arg.slice(0, eq);
	if (key !== longName && (shortName === undefined || key !== shortName)) return undefined;
	if (eq === -1) return true;
	const value = arg.slice(eq + 1).toLowerCase();
	if (["true", "1", "yes", "on"].includes(value)) return true;
	if (["false", "0", "no", "off"].includes(value)) return false;
	throw new CliUsageError(`Invalid boolean value for ${key}: "${arg.slice(eq + 1)}" (use true/false)`);
}

/**
 * 非負整数オプションを解釈する汎用ヘルパー。形式は `--name=N`（値必須）。
 * arg がこのフラグでなければ undefined。値が非負整数でなければ {@link CliUsageError} を投げる。
 */
export function parseIntFlag(arg: string, longName: string, shortName?: string, min = 0): number | undefined {
	const eq = arg.indexOf("=");
	const key = eq === -1 ? arg : arg.slice(0, eq);
	if (key !== longName && (shortName === undefined || key !== shortName)) return undefined;
	const raw = eq === -1 ? "" : arg.slice(eq + 1);
	// 数字だけを受け付ける。Number で読むと 1e3、0x10、空白の付いた値も整数になってしまう
	const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
	if (!Number.isSafeInteger(n) || n < min) {
		const kind = min > 0 ? `an integer of ${min} or more` : "a non-negative integer";
		throw new CliUsageError(`Invalid integer value for ${key}: "${raw}" (use ${kind}, e.g. ${key}=50)`);
	}
	return n;
}
