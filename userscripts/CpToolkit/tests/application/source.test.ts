import {describe, expect, test} from "bun:test";
import type {CodeEditor} from "@application/ports/code-editor";
import {LocalRunnerClient} from "@application/execution/local-runner";
import {PastePipeline} from "@application/source/paste-pipeline";
import {transformSubmission} from "@application/source/submission-transform";
import {FakeHttpClient} from "../support/fakes";

describe("PastePipeline", () => {
	const target = {editor: "ace", editorElements: ["#editor"], submitButtons: []} as const;

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
			foldTopLevel: () => undefined,
		};
		return {editor, paste: () => paste(value), edit: (next: string) => void (value = next)};
	}

	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	test("登録の順によらず、order の順に実行して反映する", async () => {
		const {editor, paste} = createEditor("code");
		const pipeline = new PastePipeline({locate: async () => editor});
		pipeline.add(target, {}, {order: 20, transform: (code) => `// header\n${code}`});
		pipeline.add(target, {}, {order: 10, transform: async (code) => code.toUpperCase()});
		await flush();

		paste();
		await flush();
		expect(editor.getValue()).toBe("// header\nCODE");
	});

	test("変換中に編集されたら上書きしない", async () => {
		const {editor, paste, edit} = createEditor("code");
		const pipeline = new PastePipeline({locate: async () => editor});
		pipeline.add(target, {}, {
			order: 10,
			async transform(code) {
				edit("edited");
				return `${code}!`;
			},
		});
		await flush();

		paste();
		await flush();
		expect(editor.getValue()).toBe("edited");
	});

	test("コードを変えた処理にだけ反映後の通知を送る", async () => {
		const {editor, paste} = createEditor("code");
		const pipeline = new PastePipeline({locate: async () => editor});
		const applied: string[] = [];
		pipeline.add(target, {}, {order: 10, transform: (code) => code, applied: () => applied.push("same")});
		pipeline.add(target, {}, {order: 20, transform: (code) => `${code}!`, applied: () => applied.push("changed")});
		await flush();

		paste();
		await flush();
		expect(applied).toEqual(["changed"]);
	});

	test("加工の結果が別の処理の入力になり、貼り付けた直後のコードも受け取れる", async () => {
		const {editor, paste} = createEditor("code");
		const pipeline = new PastePipeline({locate: async () => editor});
		const originals: string[] = [];
		pipeline.add(target, {}, {order: 10, transform: (code) => `${code}!`});
		pipeline.add(target, {}, {
			order: 20,
			transform(code, {original}) {
				originals.push(original);
				return code;
			},
		});
		await flush();

		paste();
		await flush();
		expect(originals).toEqual(["code"]);
		expect(editor.getValue()).toBe("code!");
	});
});

describe("transformSubmission の Local Runner がないときの変換", () => {
	const offline = new LocalRunnerClient(new FakeHttpClient(() => ({status: 500, text: ""})), () => null);
	const python = {id: "1", label: "Python", family: "python3"};
	const options = {debugFlag: "DEBUG", libraryPackage: ""};

	test("Java 以外の言語でも、デバッグ用の変数を false にする", async () => {
		const result = await transformSubmission("DEBUG = True\nprint(1)\n", python, offline, options);
		expect(result).toEqual({sourceCode: "DEBUG = False\nprint(1)\n", via: "fallback", failure: null});
	});

	test("宣言が2つあって決められなければ、元のコードを残して知らせる", async () => {
		const code = "DEBUG = True\nDEBUG = False\n";
		const result = await transformSubmission(code, python, offline, options);
		expect(result.sourceCode).toBe(code);
		expect(result.failure?.diagnostics).toContain("debug flag");
	});

	test("名前を設定しなければ変えない", async () => {
		const code = "DEBUG = True\n";
		expect((await transformSubmission(code, python, offline, {...options, debugFlag: ""})).sourceCode).toBe(code);
	});
});
