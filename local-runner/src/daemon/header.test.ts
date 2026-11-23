import {afterAll, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {LocalRunnerTransformResponse} from "@atcoder-tools/shared";
import {writeUserSettings} from "../settings/settings";

const {TEST_SETTINGS_FILE: settingsFile} = await import("../testSettings");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "submission-header-"));
const {applySubmissionHeader, prepareWithSubmissionHeader, resolveSubmissionHeader} = await import("./header");

const SOURCE = "public class Main {}\n";
const success: LocalRunnerTransformResponse = {
	status: "success",
	sourceCode: SOURCE,
	diagnostics: "",
	inlinedClasses: [],
	diagnosticItems: [],
};

function writeHeader(name: string, text: string): string {
	const file = path.join(dir, name);
	fs.writeFileSync(file, text);
	return file;
}

afterAll(() => {
	fs.rmSync(dir, {recursive: true, force: true});
});

describe("applySubmissionHeader", () => {
	beforeEach(() => {
		fs.rmSync(settingsFile, {force: true});
	});

	test("言語に設定したファイルを付ける", () => {
		writeUserSettings(settingsFile, {headers: {java: writeHeader("java.txt", "// java\n")}});
		expect(applySubmissionHeader(success, true, ["java"]).sourceCode).toBe(`// java\n\n${SOURCE}`);
	});

	test("言語ごとに別のファイルを使う", () => {
		writeUserSettings(settingsFile, {
			headers: {
				java: writeHeader("java.txt", "// java"),
				cpp: writeHeader("cpp.txt", "// cpp")
			}
		});
		expect(applySubmissionHeader(success, true, ["cpp"]).sourceCode).toBe(`// cpp\n\n${SOURCE}`);
	});

	test("言語の名前に設定が無ければ、言語の種類の設定を使う", () => {
		writeUserSettings(settingsFile, {headers: {python3: writeHeader("python.txt", "# python")}});
		expect(applySubmissionHeader(success, true, ["pypy", "python3"]).sourceCode).toBe(`# python\n\n${SOURCE}`);
		writeUserSettings(settingsFile, {
			headers: {
				python3: writeHeader("python.txt", "# python"),
				pypy: writeHeader("pypy.txt", "# pypy")
			}
		});
		expect(applySubmissionHeader(success, true, ["pypy", "python3"]).sourceCode).toBe(`# pypy\n\n${SOURCE}`);
	});

	test("設定した名前を指定して別のファイルを使う", () => {
		writeUserSettings(settingsFile, {headers: {short: writeHeader("short.txt", "// short")}});
		expect(applySubmissionHeader(success, "short", ["java"]).sourceCode).toBe(`// short\n\n${SOURCE}`);
	});

	test("言語に設定が無ければ付けない", () => {
		expect(applySubmissionHeader(success, true, ["java"]).sourceCode).toBe(SOURCE);
	});

	test("付けない指定なら設定があっても付けない", () => {
		writeUserSettings(settingsFile, {headers: {java: writeHeader("java.txt", "// java")}});
		expect(applySubmissionHeader(success, false, ["java"]).sourceCode).toBe(SOURCE);
	});

	test("既にヘッダーで始まるソースには重ねて付けない", () => {
		writeUserSettings(settingsFile, {headers: {java: writeHeader("java.txt", "// java")}});
		const withHeader = {...success, sourceCode: `// java\n\n${SOURCE}`};
		expect(applySubmissionHeader(withHeader, true, ["java"]).sourceCode).toBe(withHeader.sourceCode);
	});

	test("指定した名前に設定が無ければ失敗にする", () => {
		const result = applySubmissionHeader(success, "short", ["java"]);
		expect(result.status).toBe("compileError");
		expect(result.diagnostics).toContain("setheader short <file>");
	});

	test("設定したファイルが無くなっていれば失敗にする", () => {
		writeUserSettings(settingsFile, {headers: {java: path.join(dir, "missing.txt")}});
		const result = applySubmissionHeader(success, true, ["java"]);
		expect(result.status).toBe("compileError");
		expect(result.diagnostics).toContain("Header file not found");
	});

	test("付けるヘッダーの文を返し、設定が無ければ null を返す", () => {
		writeUserSettings(settingsFile, {headers: {python3: writeHeader("python.txt", "# python\n\n")}});
		expect(resolveSubmissionHeader(true, ["pypy", "python3"])).toBe("# python");
		expect(resolveSubmissionHeader(true, ["java"])).toBeNull();
		expect(resolveSubmissionHeader(false, ["python3"])).toBeNull();
	});

	test("名前の形式を検査し、オブジェクトの既定のプロパティを読まない", () => {
		expect(applySubmissionHeader(success, "../secret", ["java"]).diagnostics).toContain("Invalid header name");
		expect(applySubmissionHeader(success, "constructor", ["java"]).diagnostics).toContain("Header is not set");
	});
});

describe("prepareWithSubmissionHeader", () => {
	beforeEach(() => {
		fs.rmSync(settingsFile, {force: true});
	});

	/** 呼ばれたときの元のソースとヘッダーを覚え、変換のあとにヘッダーを付けたものを返す代役。 */
	function recorder() {
		const calls: Array<{sourceCode: string; header: string | null}> = [];
		const prepare = (sourceCode: string, header: string | null) => {
			calls.push({sourceCode, header});
			const finished = header === null ? sourceCode : `${header}\n\n${sourceCode}`;
			return Promise.resolve({...success, sourceCode: finished, programId: "id"});
		};
		return {calls, prepare};
	}

	test("元のソースと、読んだヘッダーの文を渡す(変換のあとに付ける)", async () => {
		writeUserSettings(settingsFile, {headers: {java: writeHeader("java.txt", "// a\n// b")}});
		const {calls, prepare} = recorder();
		const response = await prepareWithSubmissionHeader(SOURCE, true, ["java"], prepare);
		expect(calls).toEqual([{sourceCode: SOURCE, header: "// a\n// b"}]);
		expect(response.sourceCode).toBe(`// a\n// b\n\n${SOURCE}`);
	});

	test("ヘッダーを付けない指定や、空白だけのヘッダーなら null を渡す", async () => {
		writeUserSettings(settingsFile, {headers: {java: writeHeader("java.txt", "  \n")}});
		const {calls, prepare} = recorder();
		await prepareWithSubmissionHeader(SOURCE, true, ["java"], prepare);
		await prepareWithSubmissionHeader(SOURCE, false, ["java"], prepare);
		expect(calls.map(({header}) => header)).toEqual([null, null]);
	});

	test("ヘッダーを読めないときは、コンパイルせずに失敗として返す", async () => {
		const {calls, prepare} = recorder();
		const response = await prepareWithSubmissionHeader(SOURCE, "missing", ["java"], prepare);
		expect(response.status).toBe("compileError");
		expect(response.diagnostics).toContain("Header is not set");
		expect(calls).toEqual([]);
	});

	test("コンパイルの間にヘッダーのファイルが変わっても、読んだときの文を使う", async () => {
		const file = writeHeader("java.txt", "// first");
		writeUserSettings(settingsFile, {headers: {java: file}});
		const response = await prepareWithSubmissionHeader(SOURCE, true, ["java"], (sourceCode, header) => {
			fs.writeFileSync(file, "// second");
			return recorder().prepare(sourceCode, header);
		});
		expect(response.sourceCode).toBe(`// first\n\n${SOURCE}`);
	});
});

describe("applySubmissionHeader の行数", () => {
	test("付けたヘッダーと空行の行数を返し、付けなければ 0 にする", () => {
		writeUserSettings(settingsFile, {headers: {java: writeHeader("java.txt", "// java")}});
		expect(applySubmissionHeader(success, true, ["java"]).lineOffset).toEqual({header: 2, transform: 0});
		expect(applySubmissionHeader({...success, sourceCode: `// java\n\n${SOURCE}`}, true, ["java"]).lineOffset).toEqual({header: 0, transform: 0});
		expect(applySubmissionHeader({...success, lineOffset: {header: 0, transform: 3}}, true, ["java"]).lineOffset).toEqual({header: 2, transform: 3});
	});
});
