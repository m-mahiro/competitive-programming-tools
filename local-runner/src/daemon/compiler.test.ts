import {afterAll, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 利用者の設定を読まないよう、テスト用の設定ファイルを使う。
await import("../testSettings");
const {hasCompiledProgram} = await import("./compiler");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "java-programs-"));
const programId = `1a2b-${"0".repeat(32)}`;

afterAll(() => {
	fs.rmSync(root, {recursive: true, force: true});
});

describe("hasCompiledProgram", () => {
	test("コンパイル済みのクラスが残っているときだけ true を返す", () => {
		expect(hasCompiledProgram(programId, root)).toBe(false);
		fs.mkdirSync(path.join(root, programId, "classes"), {recursive: true});
		fs.writeFileSync(path.join(root, programId, "Main.java"), "class Main {}");
		// ソースだけ残って、クラスが無い(追い出しの途中など)
		expect(hasCompiledProgram(programId, root)).toBe(false);
		fs.writeFileSync(path.join(root, programId, "classes", "Main.class"), "");
		expect(hasCompiledProgram(programId, root)).toBe(true);
		// 追い出しでフォルダごと消えたら false
		fs.rmSync(path.join(root, programId), {recursive: true, force: true});
		expect(hasCompiledProgram(programId, root)).toBe(false);
	});

	test("programId の形でない値は、フォルダを見ずに false を返す", () => {
		expect(hasCompiledProgram("../outside", root)).toBe(false);
	});
});
