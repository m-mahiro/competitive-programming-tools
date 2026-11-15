import fs from "node:fs";
import {isPlainObject} from "../settings/schema";
import {setSetting, type UserSettings, writeUserSettings} from "../settings/settings";

/** 以前の形式の設定ファイルにあった項目。 */
function hasLegacyItems(user: UserSettings): boolean {
	return "librarySourceRoot" in user || "headerFiles" in user;
}

/** 読めないファイルは書き換えずに null を返す。誤りは、このあと設定を読むときに知らせる。 */
function readRawSettings(file: string): UserSettings | null {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
		return isPlainObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * 以前の形式(librarySourceRoot と headerFiles)の設定ファイルを、今の形式へ書き換える。
 * 元のファイルは .bak に残す。設定を読む前に呼ぶ。
 */
export function migrateLegacySettingsFile(file: string): void {
	const user = readRawSettings(file);
	if (user === null || !hasLegacyItems(user)) return;
	const {librarySourceRoot, headerFiles, ...migrated} = user;
	if (typeof librarySourceRoot === "string") setSetting(migrated, ["languages", "java", "library"], librarySourceRoot);
	if (isPlainObject(headerFiles)) {
		for (const [name, headerFile] of Object.entries(headerFiles)) setSetting(migrated, ["headers", name], headerFile);
	}
	fs.copyFileSync(file, `${file}.bak`);
	writeUserSettings(file, migrated);
}
