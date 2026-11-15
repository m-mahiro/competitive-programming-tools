import fs from "node:fs";
import path from "node:path";

// Java のライブラリのフォルダの検査と写し。設定には依存しない。

function isDirectory(target: string): boolean {
	try {
		return fs.statSync(target).isDirectory();
	} catch {
		return false;
	}
}

/** 名前が `.` で始まるフォルダ(.git など)は、ライブラリの中身として扱わない。 */
function isLibrarySourceEntry(entry: fs.Dirent): boolean {
	return entry.isDirectory() ? !entry.name.startsWith(".") : entry.name.endsWith(".java");
}

function containsJavaSource(dir: string): boolean {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, {withFileTypes: true});
	} catch {
		return false;
	}
	const sources = entries.filter(isLibrarySourceEntry);
	return sources.some((entry) => !entry.isDirectory())
		|| sources.some((entry) => containsJavaSource(path.join(dir, entry.name)));
}

/** 設定されたライブラリのフォルダ。フォルダが無ければ null。 */
export function findLibrarySource(root: string): string | null {
	return isDirectory(root) ? root : null;
}

/**
 * setlib が受け取った場所を、ライブラリのフォルダとして確かめる。
 * フォルダの名前は問わず、指定されたフォルダをそのまま使う。.java が1つも無ければエラーにする。
 */
export function resolveLibrarySource(input: string): string {
	const root = path.resolve(input);
	if (!isDirectory(root)) throw new Error(`The folder was not found: ${root}`);
	if (!containsJavaSource(root)) throw new Error(`No .java files were found in: ${root}`);
	return root;
}

/** ライブラリの .java だけを、フォルダの構成を保って写す。 */
export function copyLibrarySources(source: string, target: string): void {
	fs.mkdirSync(target, {recursive: true});
	for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
		if (!isLibrarySourceEntry(entry)) continue;
		const from = path.join(source, entry.name);
		const to = path.join(target, entry.name);
		if (entry.isDirectory()) copyLibrarySources(from, to);
		else fs.copyFileSync(from, to);
	}
}
