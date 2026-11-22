import {describe, expect, mock, test} from "bun:test";
import {LocalRunnerClient} from "@application/execution/local-runner";
import type {CodeEditor} from "@application/ports/code-editor";
import type {JudgeSite} from "@application/ports/judge-site";
import {PastePipeline} from "@application/source/paste-pipeline";
import type {JudgeLanguage} from "@domain/execution/result";
import {submissionHelper} from "@features/submission-helper/index";
import {keyboardShortcuts} from "@features/keyboard-shortcuts/index";
import {createFakeServices, FakeHttpClient} from "../support/fakes";
import {pressKey, shadowRoots, wait} from "../support/dom";

/** 提出補助が言語と問題を読むためだけのサイトの代役。 */
function languageSite(language: () => JudgeLanguage): JudgeSite {
	return {language, onLanguageChange: () => undefined, taskUri: () => location.href} as unknown as JudgeSite;
}

describe("submissionHelper", () => {
	const target = {
		editor: "ace",
		editorElements: ["#editor"],
		submitButtons: ["#submit"],
	} as const;
	const judge = {id: "atcoder", name: "AtCoder", matches: [], routes: {}, navigationLists: [], submission: target};

	function createEditor(initial: string) {
		let value = initial;
		let paste = (_pasted: string): void => undefined;
		const editor: CodeEditor = {
			getValue: () => value,
			setValue(next) {
				value = next;
			},
			isJava: () => true,
			isReadOnly: () => false,
			setWritable: () => undefined,
			onPaste(listener) {
				paste = listener;
			},
			onChange: () => undefined,
			foldLines: mock(() => undefined),
		};
		return {editor, paste: (pasted = value) => paste(pasted)};
	}

	const editorServices = (editor: CodeEditor | null) => {
		const editors = {locate: async () => editor};
		return {editors, paste: new PastePipeline(editors), judgeSite: async () => null};
	};
	const source = "package a;\npublic class Solution {\n\tpublic static void main(String[] args) {}\n}\n";
	const offline = new LocalRunnerClient(new FakeHttpClient(() => ({status: 500, text: ""})), () => null);

	function runnerWithTransform(transform: object) {
		return new FakeHttpClient(({body}) => {
			const {mode} = JSON.parse(String(body)) as {mode: string};
			if (mode === "status") return {status: 200, text: JSON.stringify({status: "running", version: "2.0.0"})};
			if (mode === "list") return {status: 200, text: JSON.stringify([{language: "Java", label: "Java", compilerName: "java", family: "java"}])};
			return {status: 200, text: JSON.stringify({diagnostics: "", diagnosticItems: [], inlinedClasses: [], ...transform})};
		});
	}

	test("Local Runner がなくても、貼り付けたコードを提出用に変換する", async () => {
		const {editor, paste} = createEditor(source);
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({
			judge,
			localRunner: offline,
			...editorServices(editor),
		}));
		await wait();
		paste();
		await wait();
		expect(editor.getValue()).toContain("class Main");
		expect(editor.getValue()).not.toContain("package a;");
	});

	test("Local Runner があればその変換結果を使う", async () => {
		const {editor, paste} = createEditor(source);
		const http = runnerWithTransform({status: "success", sourceCode: "// transformed\n"});
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({
			judge,
			localRunner: new LocalRunnerClient(http, () => "http://localhost:8080"),
			...editorServices(editor),
		}));
		await wait();
		paste();
		await wait();
		expect(editor.getValue()).toBe("// transformed\n");
	});

	test("Java 以外の言語も、ページの言語に合う Local Runner の言語で変換する", async () => {
		const pythonSource = "import sys\nDEBUG = True\nprint(sys.stdin.readline())\n";
		const {editor, paste} = createEditor(pythonSource);
		const http = new FakeHttpClient(({body}) => {
			const request = JSON.parse(String(body)) as {mode: string; compilerName?: string};
			if (request.mode === "status") return {status: 200, text: JSON.stringify({status: "running", version: "2.0.0"})};
			const response = request.mode === "list"
				? [
					{language: "Python", compilerName: "cpython", label: "CPython", family: "python3", match: ["CPython"]},
					{language: "Python", compilerName: "pypy", label: "PyPy", family: "python3", match: ["PyPy"]},
				]
				: {status: "success", sourceCode: `# ${request.compilerName}\n`, diagnostics: "", inlinedClasses: [], diagnosticItems: []};
			return {status: 200, text: JSON.stringify(response)};
		});
		const pypy = {id: "5078", label: "Python (PyPy 3.11-v7.3.20)", family: "python3"};
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({
			judge,
			localRunner: new LocalRunnerClient(http, () => "http://localhost:8080"),
			...editorServices(editor),
			judgeSite: async () => languageSite(() => pypy),
		}));
		await wait();
		paste();
		await wait();
		expect(editor.getValue()).toBe("# pypy\n");
	});

	test("コードの一部を貼り付けたときは変換しない", async () => {
		const {editor, paste} = createEditor(source);
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({
			judge,
			localRunner: offline,
			...editorServices(editor),
		}));
		await wait();
		paste("\tpublic static void main(String[] args) {}\n");
		await wait();
		expect(editor.getValue()).toBe(source);
	});

	test("Local Runner に接続できず、設定したライブラリを使うコードなら、導入方法を案内する", async () => {
		const code = "import lib.ds.UnionFind;\npublic class Solution {\n\tpublic static void main(String[] args) {}\n}\n";
		const {editor, paste} = createEditor(code);
		await submissionHelper.run({foldOnPaste: false, libraryPackage: "lib"}, createFakeServices({
			judge,
			localRunner: offline, ...editorServices(editor)
		}));
		await wait();
		paste();
		await wait();

		const text = shadowRoots().map((root) => root.textContent).join("");
		expect(text).toContain("lib.* の展開には Local Runner が必要です");
		expect(editor.getValue()).toContain("public class Main");
	});

	const connectedRunner = (response: object) => new LocalRunnerClient(
		runnerWithTransform(response),
		() => "http://localhost:8080",
	);

	test("Local Runner で変換できず import が見つからなければ、その名前を知らせてコードを変えない", async () => {
		const code = "import lib.ds.UnionFind;\npublic class Solution {\n\tpublic static void main(String[] args) {}\n}\n";
		const {editor, paste} = createEditor(code);
		const localRunner = connectedRunner({
			status: "compileError",
			sourceCode: code,
			diagnostics: "ERROR 1:15 compiler.err.doesnt.exist package lib.ds does not exist",
			diagnosticItems: [{kind: "ERROR", line: 1, column: 15, code: "compiler.err.doesnt.exist", message: "package lib.ds does not exist"}],
		});
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({judge, localRunner, ...editorServices(editor)}));
		await wait();
		paste();
		await wait();

		const text = shadowRoots().map((root) => root.textContent).join("");
		expect(text).toContain("見つからない import があります");
		expect(text).toContain("診断の全文");
		expect(text).toContain("lib.ds.UnionFind");
		expect(editor.getValue()).toBe(code);
	});

	test("Local Runner で変換できなければ、簡易変換をせず診断を知らせる", async () => {
		const {editor, paste} = createEditor(source);
		const localRunner = connectedRunner({
			status: "compileError",
			sourceCode: source,
			diagnostics: "ERROR 3:40 compiler.err.cant.resolve cannot find symbol",
			diagnosticItems: [{kind: "ERROR", line: 3, column: 40, code: "compiler.err.cant.resolve", message: "cannot find symbol"}],
		});
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({judge, localRunner, ...editorServices(editor)}));
		await wait();
		paste();
		await wait();

		const text = shadowRoots().map((root) => root.textContent).join("");
		expect(text).toContain("Local Runner で変換できませんでした");
		expect(text).toContain("cannot find symbol");
		expect(editor.getValue()).toBe(source);
	});

	test("ライブラリのパッケージを設定していなければ、接続できなくても案内しない", async () => {
		const code = "import lib.ds.UnionFind;\npublic class Solution {\n\tpublic static void main(String[] args) {}\n}\n";
		const {editor, paste} = createEditor(code);
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({judge, localRunner: offline, ...editorServices(editor)}));
		await wait();
		paste();
		await wait();

		expect(shadowRoots().map((root) => root.textContent).join("")).not.toContain("Local Runner が必要です");
	});

	test("lib を使わないコードなら Local Runner がなくても案内しない", async () => {
		const {editor, paste} = createEditor(source);
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({
			judge,
			localRunner: offline, ...editorServices(editor)
		}));
		await wait();
		paste();
		await wait();

		expect(shadowRoots().map((root) => root.textContent).join("")).not.toContain("Local Runner");
	});

	test("変換待ちのクリックとショートカットの連打を、反映後に一度だけ提出する", async () => {
		document.body.innerHTML = '<button type="button" id="submit"></button>';
		const {editor, paste} = createEditor(source);
		const setup = editorServices(editor);
		const gate = Promise.withResolvers<void>();
		setup.paste.add(target, {}, {order: 5, async transform(code) { await gate.promise; return code; }});
		const submitted: string[] = [];
		const button = document.querySelector<HTMLButtonElement>("#submit")!;
		button.onclick = () => { submitted.push(editor.getValue()); };
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({judge, localRunner: offline, ...setup}));
		await keyboardShortcuts.run(undefined, createFakeServices({judge, ...setup, openSettings: () => undefined}));
		await wait();
		paste();
		button.click();
		pressKey("Enter", {ctrlKey: true, shiftKey: true});
		expect(submitted).toEqual([]);
		gate.resolve();
		await setup.paste.settled();
		await wait();
		expect(submitted).toEqual([editor.getValue()]);
		expect(submitted[0]).toContain("class Main");
	});

	test("提出操作の待機中に言語が変われば、本文が同じでも変換とフォーム送信を取り消す", async () => {
		document.body.innerHTML = '<form><button type="submit" id="submit"></button></form>';
		const {editor, paste} = createEditor(source);
		const setup = editorServices(editor);
		const gate = Promise.withResolvers<void>();
		setup.paste.add(target, {}, {order: 5, async transform(code) { await gate.promise; return code; }});
		let language: JudgeLanguage = {id: "1", label: "Java", family: "java"};
		await submissionHelper.run({foldOnPaste: false}, createFakeServices({
			judge, localRunner: offline, ...setup, judgeSite: async () => languageSite(() => language),
		}));
		const form = document.querySelector("form")!;
		const submit = mock((event: Event) => event.preventDefault());
		form.addEventListener("submit", submit);
		await wait();
		paste();
		form.requestSubmit();
		language = {id: "2", label: "Python", family: "python3"};
		gate.resolve();
		expect(await setup.paste.settled()).toBe(false);
		expect(submit).not.toHaveBeenCalled();
		expect(editor.getValue()).toBe(source);
	});
});
