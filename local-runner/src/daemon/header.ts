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

/** ソースの先頭にヘッダーを付ける。toclip の出力を貼り付けたときなど、すでにそのヘッダーを含むソースには重ねて付けない。 */
function prependHeader(sourceCode: string, header: LocalRunnerHeaderOption, languageKeys: readonly string[]): string {
	const headerText = resolveSubmissionHeader(header, languageKeys);
	if (headerText === null || includesSubmissionHeader(sourceCode, headerText)) return sourceCode;
	return `${headerText}\n\n${sourceCode}`;
}

/** 変換結果の提出用ソースにヘッダーを付ける。ヘッダーを読めないときは変換の失敗として返す。 */
export function applySubmissionHeader<T extends LocalRunnerTransformResponse>(
	response: T,
	header: LocalRunnerHeaderOption,
	languageKeys: readonly string[],
): T {
	if (response.status !== "success") return response;
	try {
		return {...response, sourceCode: prependHeader(response.sourceCode, header, languageKeys)};
	} catch (error) {
		return {
			...response,
			status: "compileError",
			diagnostics: error instanceof Error ? error.message : String(error)
		};
	}
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
	let headerText: string | null;
	try {
		headerText = resolveSubmissionHeader(header, languageKeys);
	} catch {
		// ヘッダーを読めないときの応答は applySubmissionHeader と同じにする
		return applySubmissionHeader(await prepare(sourceCode), header, languageKeys);
	}
	if (headerText === null || !headerText.trim()) return prepare(sourceCode);
	const headered = prependHeader(sourceCode, header, languageKeys);
	const prepared = await prepare(headered);
	const headerLines = headered === sourceCode ? 0 : headered.split("\n").length - sourceCode.split("\n").length;
	const response = {...prepared, lineOffset: {header: headerLines, transform: prepared.lineOffset === undefined ? 0 : prepared.lineOffset.transform}};
	if (response.status !== "success" || includesSubmissionHeader(response.sourceCode, headerText)) return response;
	return {
		status: "compileError",
		sourceCode: response.sourceCode,
		diagnostics: "The submission header was not kept at the top of the transformed source, so the samples cannot run the submitted program.",
		inlinedClasses: response.inlinedClasses,
		diagnosticItems: [],
	};
}
