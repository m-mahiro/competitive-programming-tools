import fs from "node:fs";
import {
	type LocalRunnerHeaderOption,
	type LocalRunnerPrepareResponse,
	type LocalRunnerTransformResponse,
	normalizeNewlines,
	prependSubmissionHeader,
} from "@atcoder-tools/shared";
import * as config from "../config";

/**
 * 提出物に付けるヘッダーの文。言語に設定が無ければ null を返し、指定された名前に設定が無ければ失敗する。
 * languageKeys は言語の既定のヘッダーを探す名前で、先に書いたものを優先する(言語の名前、種類の順)。
 */
export function resolveSubmissionHeader(header: LocalRunnerHeaderOption, languageKeys: readonly string[]): string | null {
	if (header === false) return null;
	const names = typeof header === "string" ? [header] : languageKeys;
	const headerFile = names.map((name) => config.resolveSubmissionHeaderFile(name)).find((file) => file !== null) ?? null;
	if (headerFile === null) {
		if (typeof header === "string") throw new Error(`Header is not set: ${header}. Set it with setheader ${header} <file>.`);
		return null;
	}
	if (!fs.existsSync(headerFile)) throw new Error(`Header file not found: ${headerFile}`);
	return normalizeNewlines(fs.readFileSync(headerFile, "utf8")).trimEnd();
}

/** ヘッダーを読む。読めなければ、その理由を返す。空白だけのヘッダーは付けないので null にする。 */
export function readSubmissionHeader(header: LocalRunnerHeaderOption, languageKeys: readonly string[]): {text: string | null} | {error: string} {
	try {
		const text = resolveSubmissionHeader(header, languageKeys);
		return {text: text !== null && text.trim() ? text : null};
	} catch (error) {
		return {error: error instanceof Error ? error.message : String(error)};
	}
}

function withHeaderLines<T extends LocalRunnerTransformResponse>(response: T, lines: number): T {
	return {...response, lineOffset: {header: lines, transform: response.lineOffset === undefined ? 0 : response.lineOffset.transform}};
}

/** 変換結果の提出用ソースにヘッダーを付ける(tomain、toclip)。ヘッダーを読めないときは変換の失敗として返す。 */
export function applySubmissionHeader<T extends LocalRunnerTransformResponse>(
	response: T,
	header: LocalRunnerHeaderOption,
	languageKeys: readonly string[],
): T {
	if (response.status !== "success") return response;
	const read = readSubmissionHeader(header, languageKeys);
	if ("error" in read) return {...response, status: "compileError", diagnostics: read.error};
	const headered = prependSubmissionHeader(response.sourceCode, read.text);
	return withHeaderLines({...response, sourceCode: headered.sourceCode}, headered.lines);
}

/**
 * ヘッダーを1回だけ読んでから、変換、ヘッダーの付与、コンパイルを行う(prepare)。
 * 読めなければコンパイルせずに止める。コンパイルの間にファイルが変わっても、読んだ文で付ける。
 * prepare は、変換したソースの先頭にヘッダーを付けてからコンパイルする。
 */
export async function prepareWithSubmissionHeader(
	sourceCode: string,
	header: LocalRunnerHeaderOption,
	languageKeys: readonly string[],
	prepare: (sourceCode: string, header: string | null) => Promise<LocalRunnerPrepareResponse>,
): Promise<LocalRunnerPrepareResponse> {
	const read = readSubmissionHeader(header, languageKeys);
	if ("error" in read) return {status: "compileError", sourceCode, diagnostics: read.error, inlinedClasses: [], diagnosticItems: []};
	return prepare(sourceCode, read.text);
}
