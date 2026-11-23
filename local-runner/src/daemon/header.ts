import fs from "node:fs";
import {
	type LocalRunnerHeaderOption,
	type LocalRunnerPrepareResponse,
	type LocalRunnerTransformResponse,
	includesSubmissionHeader,
	normalizeNewlines,
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

/**
 * 読んだヘッダーの文をソースの先頭に付け、増えた行数と返す。toclip の出力を貼り付けたときなど、
 * すでにそのヘッダーで始まるソースには重ねて付けない(増えた行数は 0)。
 */
function prependHeaderText(sourceCode: string, headerText: string | null): {sourceCode: string; lines: number} {
	if (headerText === null || includesSubmissionHeader(sourceCode, headerText)) return {sourceCode, lines: 0};
	const lines = headerText.split("\n").length + 1;
	return {sourceCode: `${headerText}\n\n${sourceCode}`, lines};
}

/** ヘッダーを読む。読めなければ、その理由を返す。 */
function readHeader(header: LocalRunnerHeaderOption, languageKeys: readonly string[]): {text: string | null} | {error: string} {
	try {
		return {text: resolveSubmissionHeader(header, languageKeys)};
	} catch (error) {
		return {error: error instanceof Error ? error.message : String(error)};
	}
}

function withHeaderLines<T extends LocalRunnerTransformResponse>(response: T, lines: number): T {
	return {...response, lineOffset: {header: lines, transform: response.lineOffset === undefined ? 0 : response.lineOffset.transform}};
}

/** 変換結果の提出用ソースにヘッダーを付ける。ヘッダーを読めないときは変換の失敗として返す。 */
export function applySubmissionHeader<T extends LocalRunnerTransformResponse>(
	response: T,
	header: LocalRunnerHeaderOption,
	languageKeys: readonly string[],
): T {
	if (response.status !== "success") return response;
	const read = readHeader(header, languageKeys);
	if ("error" in read) return {...response, status: "compileError", diagnostics: read.error};
	const headered = prependHeaderText(response.sourceCode, read.text);
	return withHeaderLines({...response, sourceCode: headered.sourceCode}, headered.lines);
}

/**
 * ヘッダーまで付けた最終のソースをコンパイルする。test と submit のサンプルを、提出するソースそのもので動かすため。
 * 応答の lineOffset.header に、付けたヘッダーと空行の行数を入れる。すでにヘッダーで始まるソースには付けないので 0。
 * 変換でヘッダーが先頭から外れたら、試したプログラムと提出物が違ってしまうので、変換の失敗として返す。
 * ヘッダーを付けないときは元のソースをそのままコンパイルし、ローカル実行の行番号を元ソースと揃える。
 */
export async function prepareWithSubmissionHeader(
	sourceCode: string,
	header: LocalRunnerHeaderOption,
	languageKeys: readonly string[],
	prepare: (sourceCode: string) => Promise<LocalRunnerPrepareResponse>,
): Promise<LocalRunnerPrepareResponse> {
	// ヘッダーは1回だけ読み、付けるのも確かめるのも同じ文を使う。読めなければコンパイルせずに止める。
	// コンパイルの間にファイルが変わって、実行するプログラムと返すソースが食い違わないようにするため。
	const read = readHeader(header, languageKeys);
	if ("error" in read) return {status: "compileError", sourceCode, diagnostics: read.error, inlinedClasses: [], diagnosticItems: []};
	const headerText = read.text;
	if (headerText === null || !headerText.trim()) return prepare(sourceCode);
	const headered = prependHeaderText(sourceCode, headerText);
	const response = withHeaderLines(await prepare(headered.sourceCode), headered.lines);
	if (response.status !== "success" || includesSubmissionHeader(response.sourceCode, headerText)) return response;
	return {
		status: "compileError",
		sourceCode: response.sourceCode,
		diagnostics: "The submission header was not kept at the top of the transformed source, so the samples cannot run the submitted program.",
		inlinedClasses: response.inlinedClasses,
		diagnosticItems: [],
	};
}
