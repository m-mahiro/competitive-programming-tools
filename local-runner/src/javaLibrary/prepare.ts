import fs from "node:fs";
import path from "node:path";
import {RUNNER_CONFIG, resolveConfiguredPath, SETTINGS, SETTINGS_FILE} from "../config";
import {loadSettings} from "../settings/settings";
import {copyLibrarySources, findLibrarySource} from "./folder";

// 設定の languages.java.library から、変換に使うライブラリを作業用のフォルダへ用意する。

let preparedLibrarySourceRoot: string | null = null;
let librarySource: string | null = null;

/** 設定された Java のライブラリの場所。setlib の直後にも正しく表示できるよう、ファイルを読み直す。 */
export function configuredLibrarySourceRoot(): string | null {
	return loadSettings(SETTINGS_FILE).languages.java.library ?? null;
}

/** 設定されたライブラリのフォルダ。設定が無いか、フォルダが見つからなければ null。 */
function findLibrarySourceRoot(): string | null {
	const configured = SETTINGS.languages.java.library;
	if (!configured) return null;
	return findLibrarySource(resolveConfiguredPath(configured));
}

export function resolveLibrarySourceRoot(): string {
	return preparedLibrarySourceRoot ?? prepareLibrarySourceRoot().prepared;
}

/** サーバーが読み込んだライブラリの場所。ライブラリなしで起動したら null。 */
export function loadedLibrarySource(): string | null {
	return librarySource;
}

/**
 * ライブラリを作業用のフォルダへ写し、変換にはその写しを使う。
 * コンパイルした結果を利用者のフォルダに作らないためで、Linux ではメモリ上に置いて速くする意味もある。
 * ライブラリが無くても空のフォルダを渡し、解答の変換と実行を同じ経路で行う。
 */
export function prepareLibrarySourceRoot(): {source: string | null; prepared: string} {
	const source = findLibrarySourceRoot();
	librarySource = source;
	const prepared = path.join(RUNNER_CONFIG.baseDir, "library-source");
	fs.rmSync(prepared, {recursive: true, force: true});
	fs.mkdirSync(prepared, {recursive: true});
	if (source !== null) copyLibrarySources(source, prepared);
	preparedLibrarySourceRoot = prepared;
	return {source, prepared};
}
