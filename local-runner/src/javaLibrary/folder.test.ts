import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {resolveLibrarySource} from "./folder";

let dir: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-library-"));
});

afterEach(() => {
	fs.rmSync(dir, {recursive: true, force: true});
});

describe("resolveLibrarySource", () => {
	test("フォルダの名前によらず、指定したフォルダをそのまま返す", () => {
		const library = path.join(dir, "any-name");
		fs.mkdirSync(path.join(library, "nested"), {recursive: true});
		fs.writeFileSync(path.join(library, "nested", "Tool.java"), "package mylib; public final class Tool {}");
		expect(resolveLibrarySource(library)).toBe(library);
		expect(resolveLibrarySource(dir)).toBe(dir);
	});

	test("無いフォルダと、.java が無いフォルダはエラーにする", () => {
		expect(() => resolveLibrarySource(path.join(dir, "missing"))).toThrow("The folder was not found");
		fs.mkdirSync(path.join(dir, ".git"));
		fs.writeFileSync(path.join(dir, ".git", "Hidden.java"), "");
		fs.writeFileSync(path.join(dir, "notes.txt"), "");
		expect(() => resolveLibrarySource(dir)).toThrow("No .java files were found");
	});
});
