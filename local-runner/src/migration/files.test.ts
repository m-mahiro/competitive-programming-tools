import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {legacyFiles, removeLegacyFiles} from "./files";

let dir: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-legacy-"));
});

afterEach(() => {
	fs.rmSync(dir, {recursive: true, force: true});
});

describe("legacyFiles", () => {
	test("作業フォルダは、Linux では /dev/shm、ほかでは一時フォルダの中を指す", () => {
		expect(legacyFiles("linux", "/home/me", "/tmp")).toEqual(["/dev/shm/atcoder-local-runner", path.join("/home/me", ".atcoder", "runner-autostart.log")]);
		expect(legacyFiles("win32", "/home/me", "/temp")).toContain(path.join("/temp", "atcoder-local-runner"));
	});
});

describe("removeLegacyFiles", () => {
	test("残っているものだけを消して返し、隣のファイルには触れない", () => {
		const workDir = path.join(dir, "atcoder-local-runner");
		fs.mkdirSync(path.join(workDir, "compiled"), {recursive: true});
		fs.writeFileSync(path.join(workDir, "compiled", "Main.class"), "");
		const log = path.join(dir, ".atcoder", "runner-autostart.log");
		const session = path.join(dir, ".atcoder", "session.txt");
		fs.mkdirSync(path.dirname(log));
		fs.writeFileSync(log, "");
		fs.writeFileSync(session, "");
		const missing = path.join(dir, "missing");

		expect(removeLegacyFiles([workDir, log, missing])).toEqual([workDir, log]);
		expect(fs.existsSync(workDir)).toBe(false);
		expect(fs.existsSync(log)).toBe(false);
		expect(fs.existsSync(session)).toBe(true);
		expect(removeLegacyFiles([workDir, log, missing])).toEqual([]);
	});
});
