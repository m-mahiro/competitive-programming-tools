import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadSettings} from "../settings/settings";
import {migrateLegacySettingsFile} from "./settingsFile";

let dir: string;
let file: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-migration-"));
	file = path.join(dir, "settings.json");
});

afterEach(() => {
	fs.rmSync(dir, {recursive: true, force: true});
});

function writeRaw(value: unknown): void {
	fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

describe("以前の形式の設定ファイル", () => {
	test("今の形式へ書き換え、元のファイルを .bak に残す", () => {
		const legacy = {librarySourceRoot: "C:\\library\\src", headerFiles: {java: "C:\\header\\java.txt"}};
		writeRaw(legacy);
		migrateLegacySettingsFile(file);
		const settings = loadSettings(file);
		expect(settings.languages.java.library).toBe("C:\\library\\src");
		expect(settings.headers).toEqual({java: "C:\\header\\java.txt"});
		expect(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"))).toEqual(legacy);
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
			settingsVersion: 2,
			languages: {java: {library: "C:\\library\\src"}},
			headers: {java: "C:\\header\\java.txt"},
		});
	});

	test("言語ごとの debugRewrite を debugFlag にする", () => {
		writeRaw({languages: {cpython: {debugRewrite: true}, pypy: {debugRewrite: false, stackMb: 64}}});
		migrateLegacySettingsFile(file);
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({settingsVersion: 2, languages: {cpython: {debugFlag: "DEBUG"}, pypy: {stackMb: 64}}});
		expect(loadSettings(file).languages.cpython).toMatchObject({debugFlag: "DEBUG"});
	});

	test("今の形式のファイルは書き換えない", () => {
		writeRaw({settingsVersion: 2, server: {port: 9000}});
		migrateLegacySettingsFile(file);
		expect(fs.existsSync(`${file}.bak`)).toBe(false);
	});

	test("新しい値を優先し、二度目は同じファイルを維持する", () => {
		const legacy = {headers: {java: "new"}, headerFiles: {java: "old"}, languages: {cpython: {debugRewrite: true, debugFlag: "TRACE"}}};
		writeRaw(legacy);
		expect(migrateLegacySettingsFile(file)).toBe(true);
		expect(migrateLegacySettingsFile(file)).toBe(false);
		expect(loadSettings(file).headers.java).toBe("new");
		expect(loadSettings(file).languages.cpython).toMatchObject({debugFlag: "TRACE"});
		expect(JSON.parse(fs.readFileSync(file + ".bak", "utf8"))).toEqual(legacy);
	});

	test("旧値の型が不正なら元ファイルを保持する", () => {
		const invalid = {languages: {pypy: {debugRewrite: "true"}}};
		writeRaw(invalid);
		expect(() => migrateLegacySettingsFile(file)).toThrow("debugRewrite");
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(invalid);
		expect(fs.existsSync(file + ".bak")).toBe(false);
	});
});
