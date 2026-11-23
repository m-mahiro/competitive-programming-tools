import {randomUUID} from "node:crypto";
import fs from "node:fs";
import {isPlainObject} from "../settings/schema";
import {isHeaderName, loadSettings, SettingsError, type UserSettings, writeUserSettings} from "../settings/settings";

/** 1.x は形式番号を保存しない。2.0.0 で最初の番号を付ける。 */
export const SETTINGS_FORMAT = 2;

function migrateToVersion2(old: UserSettings): UserSettings {
	const {librarySourceRoot, headerFiles, ...next} = old;
	if (librarySourceRoot !== undefined) {
		if (typeof librarySourceRoot !== "string") throw new SettingsError("librarySourceRoot must be a string.");
		next.languages ??= {};
		if (!isPlainObject(next.languages)) throw new SettingsError("languages must be an object.");
		next.languages.java ??= {};
		if (!isPlainObject(next.languages.java)) throw new SettingsError("languages.java must be an object.");
		next.languages.java.library ??= librarySourceRoot;
	}
	if (headerFiles !== undefined) {
		if (!isPlainObject(headerFiles)) throw new SettingsError("headerFiles must be an object.");
		for (const [key, value] of Object.entries(headerFiles)) {
			if (!isHeaderName(key) || typeof value !== "string") throw new SettingsError(`Invalid headerFiles entry: ${key}.`);
		}
		if (next.headers !== undefined && !isPlainObject(next.headers)) throw new SettingsError("headers must be an object.");
		next.headers = {...headerFiles, ...next.headers};
	}
	if (isPlainObject(next.languages)) {
		for (const [name, entry] of Object.entries(next.languages)) {
			if (!isPlainObject(entry) || !Object.hasOwn(entry, "debugRewrite")) continue;
			if (typeof entry.debugRewrite !== "boolean") throw new SettingsError(`languages.${name}.debugRewrite must be a boolean.`);
			if (entry.debugFlag === undefined && entry.debugRewrite) entry.debugFlag = "DEBUG";
			delete entry.debugRewrite;
		}
	}
	return {...next, settingsVersion: SETTINGS_FORMAT};
}

/**
 * 1.x にしか無い項目(librarySourceRoot、headerFiles、言語ごとの debugRewrite)を持つか。
 * 形式番号の無いファイルでも、これらが無ければ今の形式として読む。利用者は変えたい項目だけを手で書くので、
 * 形式番号を書かないことがあるため。
 */
function hasLegacyItems(settings: Record<string, unknown>): boolean {
	if (settings.librarySourceRoot !== undefined || settings.headerFiles !== undefined) return true;
	return isPlainObject(settings.languages)
		&& Object.values(settings.languages).some((entry) => isPlainObject(entry) && Object.hasOwn(entry, "debugRewrite"));
}

/** 検証済みのファイルを同じフォルダで置き換え、旧ファイルのバックアップを保持する。 */
export function migrateLegacySettingsFile(file: string): boolean {
	if (!fs.existsSync(file)) return false;
	const original = fs.readFileSync(file);
	let parsed: unknown;
	try {
		parsed = JSON.parse(original.toString("utf8").replace(/^\uFEFF/, ""));
	} catch {
		return false; // loadSettings がファイル名を含む診断を出す。
	}
	if (!isPlainObject(parsed) || parsed.settingsVersion === SETTINGS_FORMAT) return false;
	if (parsed.settingsVersion !== undefined && parsed.settingsVersion !== 1) {
		throw new SettingsError(`Unsupported settingsVersion in ${file}: ${String(parsed.settingsVersion)}.`);
	}
	if (parsed.settingsVersion === undefined && !hasLegacyItems(parsed)) return false;
	const temp = `${file}.${randomUUID()}.tmp`;
	try {
		writeUserSettings(temp, migrateToVersion2(parsed));
		loadSettings(temp);
		fs.chmodSync(temp, fs.statSync(file).mode);
		if (!fs.readFileSync(file).equals(original)) {
			throw new SettingsError(`Settings changed during migration: ${file}. Retry with the current settings.`);
		}
		try {
			fs.writeFileSync(`${file}.bak`, original, {flag: "wx", mode: fs.statSync(file).mode});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (!fs.readFileSync(`${file}.bak`).equals(original)) {
				fs.writeFileSync(`${file}.${randomUUID()}.bak`, original, {flag: "wx", mode: fs.statSync(file).mode});
			}
		}
		fs.renameSync(temp, file);
		return true;
	} finally {
		fs.rmSync(temp, {force: true});
	}
}
