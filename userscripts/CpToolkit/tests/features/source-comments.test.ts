import {beforeEach, describe, expect, mock, test} from "bun:test";
import {judges} from "@catalog/judges";
import type {JudgeLanguage} from "@domain/execution/result";
import {LocalRunnerClient} from "@application/execution/local-runner";
import type {CodeEditor} from "@application/ports/code-editor";
import type {JudgeSite} from "@application/ports/judge-site";
import {PastePipeline} from "@application/source/paste-pipeline";
import {sourceComments} from "@features/source-comments/index";
import {createFakePage, createFakeServices, FakeHttpClient, MemoryStore} from "../support/fakes";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const java: JudgeLanguage = {id: "1", label: "Java 24", family: "java"};
const python: JudgeLanguage = {id: "2", label: "Python 3", family: "python3"};
const ocaml: JudgeLanguage = {id: "3", label: "OCaml", family: "ocaml"};
const text: JudgeLanguage = {id: "4", label: "Text", family: "text"};

const target = {
	editor: "ace",
	editorElements: ["#editor"],
	shortcut: "Ctrl+Shift+Enter",
	submitButtons: ["#submit"]
} as const;
const judge = {id: "atcoder", name: "AtCoder", matches: [], routes: {}, navigationLists: [], submission: target};
const taskUrl = "https://atcoder.jp/contests/abc1/tasks/abc1_a";

const offline = new LocalRunnerClient(new FakeHttpClient(() => ({status: 500, text: ""})), () => null);

/** Java のヘッダーを返す Local Runner。 */
function runnerWithHeader(header: string | null) {
	const http = new FakeHttpClient(({body}) => {
		const {mode} = JSON.parse(String(body)) as {mode: string};
		if (mode === "status") return {status: 200, text: JSON.stringify({status: "running", version: "2.0.0"})};
		const response = mode === "list"
			? [{language: "Java", compilerName: "java", label: "Java", family: "java"}]
			: {status: "success", header};
		return {status: 200, text: JSON.stringify(response)};
	});
	return {http, client: new LocalRunnerClient(http, () => "http://localhost:8080")};
}

function createContext(localRunner: LocalRunnerClient = offline) {
	let code = "";
	let language: JudgeLanguage | null = java;
	let task = taskUrl;
	let onPaste = (_pasted: string): void => undefined;
	let onLanguageChange = (): void => undefined;
	const editor: CodeEditor = {
		getValue: () => code,
		setValue(next) {
			code = next;
		},
		isJava: () => language === java,
		isReadOnly: () => false,
		setWritable: () => undefined,
		onPaste(listener) {
			onPaste = listener;
		},
		onChange: () => undefined,
		foldTopLevel: () => undefined,
	};
	const site = {
		id: "atcoder",
		mounts: {testButtons: null, sideButtons: null, results: null},
		taskUri: () => task,
		languages: () => [],
		language: () => language,
		selectLanguage: () => undefined,
		onLanguageChange(listener: () => void) {
			onLanguageChange = listener;
		},
		onSourceChange: () => undefined,
		sourceCode: () => code,
		setSourceCode(next: string) {
			code = next;
		},
		submit: mock(() => undefined),
		samples: async () => [],
	} satisfies JudgeSite;
	const editors = {locate: async () => editor};
	const state = new MemoryStore();
	const paste = new PastePipeline(editors);
	const services = {judge, judgeSite: async () => site, localRunner, page: createFakePage(), paste, state, editors};
	return {
		services,
		state,
		code: () => code,
		setCode(next: string) {
			code = next;
		},
		setTask(next: string) {
			task = next;
		},
		async pasteCode(pasted: string) {
			code = pasted;
			onPaste(pasted);
			await flush();
		},
		async pasteInto(result: string, pasted: string) {
			code = result;
			onPaste(pasted);
			await flush();
		},
		async changeLanguage(next: JudgeLanguage | null) {
			language = next;
			onLanguageChange();
			// Local Runner のヘッダーを付ける設定では、書き直しを待ってから確かめる
			await flush();
		},
	};
}

async function open(options?: unknown, localRunner?: LocalRunnerClient) {
	const context = createContext(localRunner);
	await sourceComments.run(options, createFakeServices(context.services));
	await flush();
	openPanel();
	return context;
}

const panelRoot = (): ShadowRoot => {
	const root = [...document.body.children].flatMap((element) => element.shadowRoot ?? []).findLast((candidate) => candidate.querySelector(".comment-slots"));
	if (!root) throw new Error("panel is not open");
	return root;
};

const openPanel = (): void => document.querySelector<HTMLButtonElement>(".editor-buttons button")?.click();

const slot = (index: number) => {
	const element = panelRoot().querySelectorAll(".comment-slot")[index];
	if (!element) throw new Error("slot not found");
	const [taskOnly, commentOut, multiline] = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
	const [history, presets] = element.querySelectorAll("select");
	return {
		textarea: element.querySelector("textarea") as HTMLTextAreaElement,
		taskOnly: taskOnly as HTMLInputElement,
		commentOut: commentOut as HTMLInputElement,
		multiline: multiline as HTMLInputElement,
		history: history as HTMLSelectElement,
		presets: presets as HTMLSelectElement,
		buttons: element.querySelectorAll("button"),
	};
};

function setText(index: number, value: string): void {
	const {textarea} = slot(index);
	textarea.value = value;
	textarea.dispatchEvent(new Event("change"));
}

function toggle(input: HTMLInputElement, checked: boolean): void {
	input.checked = checked;
	input.dispatchEvent(new Event("change"));
}

function select(element: HTMLSelectElement, value: string): void {
	element.value = value;
	element.dispatchEvent(new Event("change"));
}

beforeEach(() => {
	document.body.innerHTML = '<div class="editor-buttons"></div>';
	history.replaceState(null, "", "/contests/abc1/tasks/abc1_a");
});

describe("sourceComments", () => {
	test("Local Runner のヘッダーを付けない設定では、問い合わせない", async () => {
		const {client, http} = runnerWithHeader("// server");
		const context = await open({runnerHeader: "none"}, client);
		await context.pasteCode("class Main {}\n");
		expect(context.code()).toBe("class Main {}\n");
		expect(http.requests).toHaveLength(0);
	});

	for (const [id, form] of [
		["atcoder", '<div class="editor-buttons"></div><button id="submit"></button>'],
		["codeforces", '<form class="submitForm"><select name="programTypeId"><option value="1">Java 24</option></select><button class="submit"></button></form>'],
		["yukicoder", '<button id="toggle_source_editor"></button><form id="submit_form"><input type="submit"></form>'],
		["aoj", '<div class="editorFooter"><button class="submitBtn"></button></div>'],
		["paiza", '<select id="language_id"><option value="15">Java 24</option></select><button id="handin"></button>'],
		["libraryChecker", '<form><button type="submit">Submit</button></form>'],
	] as const) {
		test(`${id} の提出欄でヘッダーとフッターを設定できる`, async () => {
			document.body.innerHTML = form;
			const judge = judges.find((item) => item.id === id)!;
			const {client, http} = runnerWithHeader("// server");
			const context = createContext(client);
			const judgeSite = mock(context.services.judgeSite);
			await sourceComments.run({runnerHeader: "above"}, createFakeServices({...context.services, judge, judgeSite}));
			await flush();
			document.querySelector<HTMLButtonElement>("button.btn-default")!.click();
			setText(0, "top");
			setText(1, "end");
			await context.pasteCode("class Main {}\n");
			expect(context.code()).toBe("// server\n\n// top\nclass Main {}\n// end\n");
			expect(http.requests.map(({body}) => JSON.parse(body!).mode)).toEqual(["list", "status", "header"]);
			if (id === "codeforces") expect(judgeSite).not.toHaveBeenCalled();
		});
	}

	test("先頭と末尾以外の同じ文字列を設定変更で書き換えない", async () => {
		const context = await open();
		toggle(slot(0).commentOut, false);
		setText(0, "print(1)");
		await context.pasteCode("x=2\nprint(1)\nprint(x)\n");
		setText(0, "print(9)");
		expect(context.code()).toBe("print(9)\nx=2\nprint(1)\nprint(x)\n");
	});

	test("同じ先頭行の別コメントは、複数行の Runner ヘッダーと区別する", async () => {
		const context = await open({runnerHeader: "above"}, runnerWithHeader("/*\nlicense\n*/").client);
		await context.pasteCode("/*\nmy note\n*/\nclass Main {}\n");
		expect(context.code()).toBe("/*\nlicense\n*/\n\n/*\nmy note\n*/\nclass Main {}\n");
	});

	test("ヘッダー取得中に言語を変更したら元の言語のヘッダーを書かない", async () => {
		const waiting = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const client = runnerWithHeader("// old").client;
		client.header = async () => { started.resolve(); await waiting.promise; return "// Java"; };
		const context = await open({runnerHeader: "above"}, client);
		await context.pasteCode("print(1)");
		await started.promise;
		await context.changeLanguage(python);
		waiting.resolve();
		await flush();
		expect(context.code()).toBe("print(1)");
	});

	test("ヘッダーの両側が CRLF でも全文として扱い、再適用で重ねない", async () => {
		const context = await open();
		setText(0, "header");
		await context.pasteCode("a\r\nb\r\n");
		expect(context.code()).toBe("// header\na\nb\n");
		await context.pasteCode(context.code());
		expect(context.code()).toBe("// header\na\nb\n");
	});
	test("貼り付けたコードの先頭と末尾へ、単一行コメントを追記する", async () => {
		const context = await open();
		setText(0, "https://example.com/a\nhttps://example.com/b");
		setText(1, "footer");

		await context.pasteCode("class Main {}\n");

		expect(context.code()).toBe("// https://example.com/a\n// https://example.com/b\nclass Main {}\n// footer\n");
	});

	test("Local Runner のヘッダーを、問題ごとのヘッダーの上か下に置き、付けないこともできる", async () => {
		for (const [placement, expected] of [
			["above", "// server\n\n// task\nclass Main {}\n"],
			["below", "// task\n// server\n\nclass Main {}\n"],
			["none", "// task\nclass Main {}\n"],
		] as const) {
			document.body.innerHTML = '<div class="editor-buttons"></div>';
			const {http, client} = runnerWithHeader("// server");
			const context = await open({runnerHeader: placement}, client);
			setText(0, "task");
			await context.pasteCode("class Main {}\n");
			expect(context.code()).toBe(expected);
			if (placement === "none") expect(http.requests).toEqual([]);
		}
	});

	test("Local Runner のヘッダーで始まるコードには重ねて付けない", async () => {
		const context = await open({runnerHeader: "above"}, runnerWithHeader("// server").client);
		await context.pasteCode("// server\n\nclass Main {}\n");
		expect(context.code()).toBe("// server\n\nclass Main {}\n");
	});

	test("複数行コメントを選べる", async () => {
		const context = await open({style: "block"});
		setText(0, "header");
		await context.pasteCode("class Main {}\n");
		expect(context.code()).toBe("/*\nheader\n*/\nclass Main {}\n");
	});

	test("ヘッダーとフッターで、コメントの形式を別々に選べる", async () => {
		const context = await open();
		expect(slot(0).multiline.checked).toBe(false);
		toggle(slot(0).multiline, true);
		setText(0, "header");
		setText(1, "footer");
		await context.pasteCode("code\n");
		expect(context.code()).toBe("/*\nheader\n*/\ncode\n// footer\n");
	});

	test("言語を変えるとコメントの書き方も変える", async () => {
		const context = await open();
		setText(0, "header");
		setText(1, "footer");
		await context.pasteCode("code\n");

		await context.changeLanguage(python);
		expect(context.code()).toBe("# header\ncode\n# footer\n");

		await context.changeLanguage(java);
		expect(context.code()).toBe("// header\ncode\n// footer\n");
	});

	test("コメントの書き方が分からない言語へ変えたら、元のまま残して知らせる", async () => {
		const context = await open();
		setText(0, "header");
		await context.pasteCode("code\n");

		await context.changeLanguage(text);
		expect(context.code()).toBe("// header\ncode\n");
		expect(panelRoot().querySelector<HTMLElement>(".comment-warning")?.hidden).toBe(false);

		await context.changeLanguage(python);
		expect(context.code()).toBe("# header\ncode\n");
		expect(panelRoot().querySelector<HTMLElement>(".comment-warning")?.hidden).toBe(true);
	});

	test("単一行コメントのない言語では行ごとに囲む", async () => {
		const context = await open();
		await context.changeLanguage(ocaml);
		setText(0, "a\nb");
		await context.pasteCode("code\n");
		expect(context.code()).toBe("(* a *)\n(* b *)\ncode\n");
	});

	test("コメントアウトしない設定では、書いた文字列をそのまま挿入する", async () => {
		const context = await open();
		toggle(slot(0).commentOut, false);
		setText(0, "/* written by hand */");
		await context.pasteCode("code\n");
		expect(context.code()).toBe("/* written by hand */\ncode\n");

		await context.changeLanguage(python);
		expect(context.code()).toBe("/* written by hand */\ncode\n");
	});

	test("変数を問題の情報に置き換える", async () => {
		const context = await open();
		setText(0, "{url} {task} {contest} {unknown}");
		await context.pasteCode("code\n");
		expect(context.code()).toBe(`// ${taskUrl} abc1_a abc1 {unknown}\ncode\n`);
	});

	test("コードの一部の貼り付けでは挿入しない", async () => {
		const context = await open();
		setText(0, "header");
		await context.pasteInto("class Main {\n\tint x;\n}\n", "int x;");
		expect(context.code()).toBe("class Main {\n\tint x;\n}\n");
	});

	test("Windows の改行で貼り付けても全体の貼り付けと判定する", async () => {
		const context = await open();
		setText(0, "header");
		await context.pasteInto("a\nb\n", "a\r\nb\r\n");
		expect(context.code()).toBe("// header\na\nb\n");
	});

	test("同じコメントを含むコードを貼り付けても重ねない", async () => {
		const context = await open();
		setText(0, "header");
		await context.pasteCode("// header\ncode\n");
		expect(context.code()).toBe("// header\ncode\n");
	});

	test("内容を変えると、挿入した部分も書き換える", async () => {
		const context = await open();
		setText(0, "first");
		await context.pasteCode("code\n");
		setText(0, "second");
		expect(context.code()).toBe("// second\ncode\n");

		setText(0, "");
		expect(context.code()).toBe("code\n");
	});

	test("挿入した部分を編集したら、そのあとは書き換えない", async () => {
		const context = await open();
		setText(0, "header");
		await context.pasteCode("code\n");
		context.setCode("// edited\ncode\n");

		await context.changeLanguage(python);
		expect(context.code()).toBe("// edited\ncode\n");
	});

	test("挿入した部分を編集したあとに言語を切り替えて戻しても、Local Runner のヘッダーを重ねない", async () => {
		const context = await open({runnerHeader: "below"}, runnerWithHeader("// server").client);
		setText(0, "task");
		await context.pasteCode("class Main {}\n");
		expect(context.code()).toBe("// task\n// server\n\nclass Main {}\n");
		context.setCode("// edited\n// server\n\nclass Main {}\n");

		await context.changeLanguage(python);
		await flush();
		await context.changeLanguage(java);
		await flush();
		expect(context.code()).toBe("// edited\n// server\n\nclass Main {}\n");
	});

	test("言語を切り替えても、空のコードにはヘッダーを入れない", async () => {
		// 貼り付けたときは Local Runner のヘッダーが無く、あとから付けられるようになった場合
		let header: string | null = null;
		const http = new FakeHttpClient(({body}) => {
			const {mode} = JSON.parse(String(body)) as {mode: string};
			if (mode === "status") return {status: 200, text: JSON.stringify({status: "running", version: "2.0.0"})};
			const response = mode === "list"
				? [{language: "Java", compilerName: "java", label: "Java", family: "java"}]
				: {status: "success", header};
			return {status: 200, text: JSON.stringify(response)};
		});
		const context = await open({runnerHeader: "above"}, new LocalRunnerClient(http, () => "http://localhost:8080"));
		setText(0, "task");
		await context.pasteCode("class Main {}\n");
		expect(context.code()).toBe("// task\nclass Main {}\n");
		header = "// server";
		context.setCode("");
		// 空のコードでは、ヘッダーも取りに行かない(取りに行く間の提出を待たせないため)
		const headerRequests = () => http.requests.filter(({body}) => String(body).includes('"mode":"header"')).length;
		const before = headerRequests();
		for (const next of [python, java, python, java]) {
			await context.changeLanguage(next);
			await flush();
			expect(context.code()).toBe("");
		}
		expect(headerRequests()).toBe(before);
		// 改行だけのコードも空として扱う
		context.setCode("\n");
		await context.changeLanguage(python);
		await flush();
		expect(context.code()).toBe("\n");
	});

	test("ボタンで現在のコードへ反映する", async () => {
		const context = await open();
		setText(0, "header");
		context.setCode("typed\n");
		panelRoot().querySelector<HTMLButtonElement>(".modal-footer .primary")?.click();
		await flush();
		expect(context.code()).toBe("// header\ntyped\n");
	});

	test("ボタンで反映するときも Local Runner のヘッダーを付け、2回押しても重ねない", async () => {
		const context = await open({runnerHeader: "below"}, runnerWithHeader("// server").client);
		setText(0, "task");
		context.setCode("typed\n");
		for (let i = 0; i < 2; i++) {
			panelRoot().querySelector<HTMLButtonElement>(".modal-footer .primary")?.click();
			await flush();
		}
		expect(context.code()).toBe("// task\n// server\n\ntyped\n");
	});

	test("前回の内容を次の問題でも使い、ヘッダーとフッターは別々に記憶する", async () => {
		const first = createContext();
		await sourceComments.run(undefined, createFakeServices(first.services));
		await flush();
		openPanel();
		setText(0, "shared header");

		document.body.innerHTML = '<div class="editor-buttons"></div>';
		const second = createContext();
		second.setTask(`${taskUrl}x`);
		await sourceComments.run(undefined, createFakeServices({...second.services, state: first.state}));
		await flush();
		openPanel();

		expect(slot(0).textarea.value).toBe("shared header");
		expect(slot(1).textarea.value).toBe("");
	});

	test("「この問題のみ」の内容は他の問題へ持ち越さない", async () => {
		const context = await open();
		setText(0, "shared");
		toggle(slot(0).taskOnly, true);
		setText(0, "only here");

		document.body.innerHTML = '<div class="editor-buttons"></div>';
		const other = createContext();
		other.setTask(`${taskUrl}x`);
		await sourceComments.run(undefined, createFakeServices({...other.services, state: context.state}));
		await flush();
		openPanel();
		expect(slot(0).textarea.value).toBe("shared");
		expect(slot(0).taskOnly.checked).toBe(false);

		document.body.innerHTML = '<div class="editor-buttons"></div>';
		const same = createContext();
		await sourceComments.run(undefined, createFakeServices({...same.services, state: context.state}));
		await flush();
		openPanel();
		expect(slot(0).textarea.value).toBe("only here");
		expect(slot(0).taskOnly.checked).toBe(true);
	});

	test("履歴から復元する", async () => {
		await open();
		setText(0, "old");
		setText(0, "new");

		const {history: historySelect, textarea} = slot(0);
		expect([...historySelect.options].map((option) => option.textContent).slice(1)).toEqual(["new", "old"]);
		select(historySelect, "1");
		expect(textarea.value).toBe("old");
	});

	test("名前を付けて保存し、呼び出して削除できる", async () => {
		await open();
		const prompt = window.prompt;
		window.prompt = () => "reference";
		setText(0, "saved text");
		const {buttons, presets, textarea} = slot(0);
		buttons[0]?.click();
		window.prompt = prompt;
		expect([...presets.options].map((option) => option.value)).toEqual(["", "reference"]);

		setText(0, "changed");
		select(presets, "reference");
		expect(textarea.value).toBe("saved text");

		buttons[1]?.click();
		expect([...slot(0).presets.options].map((option) => option.value)).toEqual([""]);
	});

	test("内容があるとボタンの色を変える", async () => {
		await open();
		const button = document.querySelector(".editor-buttons button");
		expect(button?.classList.contains("btn-default")).toBe(true);

		setText(1, "footer");
		expect(button?.classList.contains("btn-info")).toBe(true);
		expect(button?.classList.contains("btn-default")).toBe(false);

		setText(1, "");
		expect(button?.classList.contains("btn-default")).toBe(true);
	});

	test("書けない言語では通知でも知らせる", async () => {
		const context = await open();
		await context.changeLanguage(text);
		setText(0, "header");
		await context.pasteCode("code\n");

		// 設定のダイアログが開いている間は待たせ、閉じてから表示する
		for (const element of document.body.children) element.shadowRoot?.querySelector("dialog")?.close();
		const toasts = [...document.body.children].map((element) => element.shadowRoot?.textContent ?? "").join("");
		expect(toasts).toContain("コメントを挿入していません");
	});

	test("提出欄のないページでは何も表示しない", async () => {
		document.body.innerHTML = "";
		await open();
		expect(document.querySelector("button")).toBeNull();
	});
});
