import fs from "node:fs";
import path from "node:path";
import type {ZipEntry} from "./zip";

// 配布物の zip の中身を、導入先のフォルダへ入れ替える。
// 途中で失敗しても壊れた状態を残さないよう、隣のフォルダへ全部を展開してから1つずつ置き換え、失敗したら元に戻す。

const STAGING_DIRECTORY = ".local-runner-update";
const OLD_SUFFIX = ".old";

export type PackageFile = {
	/** 導入先のフォルダからの相対パス。区切りは `/`。 */
	readonly relativePath: string;
	readonly mode: number | null;
	read(): Buffer;
};

/**
 * zip の中身を、導入先からの相対パスにする。zip は最上位にフォルダを1つだけ持つ。その名前は問わない。
 * 導入先の外へ書き出すパス(`..`、絶対パス、ドライブの指定)があれば、エラーにする。
 */
export function toPackageFiles(entries: readonly ZipEntry[]): PackageFile[] {
	const files: PackageFile[] = [];
	let topFolder: string | null = null;
	for (const entry of entries) {
		const segments = entry.name.split("/");
		if (entry.isDirectory) segments.pop();
		const unsafe = entry.name.includes("\\") || entry.name.includes(":")
			|| segments.some((segment) => segment === "" || segment === "." || segment === "..");
		if (unsafe) throw new Error(`The package contains an unsafe path: ${entry.name}`);
		const [top, ...rest] = segments;
		if (topFolder !== null && top !== topFolder) throw new Error(`The package must have one top folder, but it has ${topFolder} and ${top}.`);
		topFolder = top ?? null;
		if (entry.isDirectory) continue;
		if (rest.length === 0) throw new Error(`The package has a file outside its top folder: ${entry.name}`);
		files.push({relativePath: rest.join("/"), mode: entry.mode, read: () => entry.read()});
	}
	if (files.length === 0) throw new Error("The package is empty.");
	return files;
}

/** 前回の入れ替えで消せなかったファイル。実行中の実行ファイルは Windows では消せないので、次の起動で消す。 */
export function removeStaleFile(file: string): void {
	try {
		fs.rmSync(`${file}${OLD_SUFFIX}`, {force: true});
	} catch {
		// まだ使われているなら、次の機会に消す
	}
}

/**
 * 配布物のファイルを導入先へ入れ替える。導入先にあってパッケージに無いファイル(設定ファイルなど)には触れない。
 * 実行中の実行ファイルは上書きできない OS があるので、名前を変えてから新しいものを置く。
 */
export function installPackage(files: readonly PackageFile[], installRoot: string): void {
	const staging = path.join(installRoot, STAGING_DIRECTORY);
	fs.rmSync(staging, {recursive: true, force: true});
	const replaced: Array<{target: string; backup: string | null}> = [];
	try {
		// 先に全部を取り出す。壊れた zip なら、導入先に触れる前にここで止まる。
		for (const file of files) {
			const staged = path.join(staging, file.relativePath);
			fs.mkdirSync(path.dirname(staged), {recursive: true});
			fs.writeFileSync(staged, file.read(), file.mode === null ? {} : {mode: file.mode});
		}
		for (const file of files) {
			const target = path.join(installRoot, file.relativePath);
			fs.mkdirSync(path.dirname(target), {recursive: true});
			let backup: string | null = null;
			if (fs.existsSync(target)) {
				backup = `${target}${OLD_SUFFIX}`;
				fs.rmSync(backup, {force: true});
				fs.renameSync(target, backup);
			}
			replaced.push({target, backup});
			fs.renameSync(path.join(staging, file.relativePath), target);
		}
	} catch (error) {
		for (const {target, backup} of replaced.reverse()) {
			fs.rmSync(target, {force: true});
			if (backup !== null) fs.renameSync(backup, target);
		}
		fs.rmSync(staging, {recursive: true, force: true});
		throw error;
	}
	fs.rmSync(staging, {recursive: true, force: true});
	for (const {target} of replaced) removeStaleFile(target);
}
