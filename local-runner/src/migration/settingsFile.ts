import fs from "node:fs";
import {isPlainObject} from "../settings/schema";
import {setSetting, type UserSettings, writeUserSettings} from "../settings/settings";

function languageEntries(user: UserSettings): UserSettings[] {
	return isPlainObject(user.languages) ? Object.values(user.languages).filter(isPlainObject) : [];
}

/** 以前の形式の設定ファイルにあった項目。 */
function hasLegacyItems(user: UserSettings): boolean {
	return "librarySourceRoot" in user || "headerFiles" in user || languageEntries(user).some((entry) => "debugRewrite" in entry);
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
 * 以前の形式(librarySourceRoot、headerFiles、言語ごとの debugRewrite)の設定ファイルを、今の形式へ書き換える。
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
	// debugRewrite は名前が DEBUG に決まっていた。書き換える名前を指定する debugFlag にする
	for (const entry of languageEntries(migrated)) {
		if (entry.debugRewrite === true) entry.debugFlag = "DEBUG";
		delete entry.debugRewrite;
	}
	fs.copyFileSync(file, `${file}.bak`);
	writeUserSettings(file, migrated);
}
