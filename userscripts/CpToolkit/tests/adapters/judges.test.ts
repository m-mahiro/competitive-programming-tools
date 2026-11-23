import {afterEach, describe, expect, mock, test} from "bun:test";
import {AtCoderSite} from "@adapters/judges/atcoder";
import {CodeforcesSite, readCodeforcesSamples} from "@adapters/judges/codeforces";
import {languagesOf} from "@adapters/judges/languages";
import {YukicoderSite} from "@adapters/judges/yukicoder";
import {parseCodeforcesContestPage} from "@adapters/page/contest-tasks";
import {createFakePage, FakeHttpClient} from "../support/fakes";

const bridge = createFakePage();

const noHttp = new FakeHttpClient(() => ({status: 500, text: ""}));

describe("languagesOf", () => {
	test("選択欄から言語を読み取り、空の選択肢を除く", () => {
		document.body.innerHTML = `<select>
			<option value=""></option><option value="6056"> Java 24 </option><option value="9">Whitespace</option>
		</select>`;
		expect(languagesOf(document.querySelector("select"))).toEqual([
			{id: "6056", label: "Java 24", family: "java"},
			{id: "9", label: "Whitespace", family: null},
		]);
	});
});

describe("AtCoderSite", () => {
	test("表示中の問題の選択欄だけ言語を切り替える", () => {
		document.body.innerHTML = `<div id="select-lang">
			<div><select><option value="1"></option><option value="2"></option></select></div>
			<div><select class="current"><option value="1"></option><option value="2"></option></select></div>
		</div>`;
		const changed = mock((_element: object) => undefined);
		const site = new AtCoderSite({...bridge, triggerChange: changed}, noHttp);
		site.selectLanguage("2");
		const [hidden, current] = document.querySelectorAll("select");
		expect(current?.value).toBe("2");
		expect(hidden?.value).toBe("1");
		expect(changed).toHaveBeenCalledWith(current as HTMLSelectElement);
	});

	test("サンプルを入力と出力の組にする", async () => {
		history.replaceState(null, "", "/contests/abc1/tasks/abc1_a");
		document.body.innerHTML = `<div id="task-statement">
			<div class="part io-style"><pre>N</pre></div>
			<div class="part"><section><h3>入力例 1<span class="btn-copy"></span></h3><pre>1 2</pre></section></div>
			<div class="part"><section><h3>出力例 1</h3><pre>3</pre></section></div>
		</div>`;
		const samples = await new AtCoderSite(bridge, noHttp).samples();
		expect(samples).toHaveLength(1);
		expect(samples[0]).toMatchObject({title: "Sample 1", input: "1 2", output: "3"});
		expect(samples[0]?.anchors).toHaveLength(1);
		expect(samples[0]?.anchors[0]).toBe(document.querySelector(".btn-copy") ?? undefined);
	});

	test("起動時に読み取ったサンプルを使い続ける", async () => {
		history.replaceState(null, "", "/contests/abc2/tasks/abc2_a");
		document.body.innerHTML = `<div id="task-statement">
			<div class="part"><section><h3>入力例 1</h3><div class="div-btn-copy"></div><pre>1</pre></section></div>
			<div class="part"><section><h3>出力例 1</h3><div class="div-btn-copy"></div><pre>2</pre></section></div>
		</div>`;
		const site = new AtCoderSite(bridge, noHttp);
		await site.samples();
		document.querySelector("#task-statement")?.replaceChildren();
		expect(await site.samples()).toMatchObject([{input: "1", output: "2"}]);
	});

	test(".io-style の中にしかサンプルがない問題も読み取る", async () => {
		history.replaceState(null, "", "/contests/maximum-cup-2018/tasks/maximum_cup_2018_d");
		document.body.innerHTML = `<div id="task-statement"><div class="io-style"><div class="part">
			<div class="div-btn-copy"><span class="btn-copy"></span></div><pre>1</pre>
			<div class="div-btn-copy"><span class="btn-copy"></span></div><pre>2</pre>
		</div></div></div>`;
		const samples = await new AtCoderSite(bridge, noHttp).samples();
		expect(samples).toMatchObject([{input: "1", output: "2"}]);
		expect(samples[0]?.anchors).toHaveLength(1);
		expect(samples[0]?.anchors[0]).toBe(document.querySelector(".btn-copy") ?? undefined);
	});

	describe("日英併記の問題ページ", () => {
		const block = (title: string, body: string) => `<div class="part"><section><h3>${title}</h3><div class="div-btn-copy"></div><pre>${body}</pre></section></div>`;
		const language = (name: string, style: string, ...parts: string[]) => `<span class="lang-${name}" style="${style}">${parts.join("")}</span>`;

		test.each([
			["日本語だけが表示されている", "", "display: none"],
			["英語だけが表示されている", "display: none", ""],
			["どちらも表示されていない(AtCoder の CSS の初期状態)", "display: none", "display: none"],
		])("%s ときも、両方の言語に実行ボタンを置く", async (_, jaStyle, enStyle) => {
			history.replaceState(null, "", "/contests/abc1/tasks/abc1_a");
			document.body.innerHTML = `<div id="task-statement"><span class="lang">
				${language("ja", jaStyle, block("入力例 1", "1"), block("出力例 1", "2"))}
				${language("en", enStyle, block("Sample Input 1", "1"), block("Sample Output 1", "2"))}
			</span></div>`;
			const samples = await new AtCoderSite(bridge, noHttp).samples();
			expect(samples).toHaveLength(1);
			expect(samples[0]).toMatchObject({title: "Sample 1", input: "1", output: "2"});
			expect(samples[0]?.anchors).toEqual([...document.querySelectorAll(".lang-ja h3, .lang-en h3")].filter((h3) => /入力例|Sample Input/.test(h3.textContent ?? "")));
		});

		test("サンプルの数が言語で違っても、ある分だけ置く", async () => {
			history.replaceState(null, "", "/contests/abc1/tasks/abc1_b");
			document.body.innerHTML = `<div id="task-statement"><span class="lang">
				${language("ja", "", block("入力例 1", "1"), block("出力例 1", "2"), block("入力例 2", "3"), block("出力例 2", "4"))}
				${language("en", "", block("Sample Input 1", "1"), block("Sample Output 1", "2"))}
			</span></div>`;
			const samples = await new AtCoderSite(bridge, noHttp).samples();
			expect(samples.map((sample) => sample.anchors.length)).toEqual([2, 1]);
		});
	});

	test("提出ページでは日英併記の問題から一言語分のサンプルを取得する", async () => {
		history.replaceState(null, "", "/contests/abc1/submit");
		document.body.innerHTML = '<select id="select-task"><option value="abc1_a" selected>A</option></select>';
		const blocks = '<div class="part"><section><pre>1</pre></section></div><div class="part"><section><pre>2</pre></section></div>'
			+ '<div class="part"><section><pre>3</pre></section></div><div class="part"><section><pre>4</pre></section></div>';
		const html = `<div id="task-statement"><span class="lang">
			<span class="lang-ja">${blocks}</span><span class="lang-en">${blocks}</span>
		</span></div>`;
		const http = new FakeHttpClient(() => ({status: 200, text: html}));
		const site = new AtCoderSite(bridge, http);
		const globals = globalThis as {unsafeWindow?: unknown};
		globals.unsafeWindow = {contestScreenName: "abc1"};
		try {
			const samples = await site.samples();
			await site.samples();
			expect(samples).toEqual([
				{title: "Sample 1", input: "1", output: "2", anchors: []},
				{title: "Sample 2", input: "3", output: "4", anchors: []},
			]);
			expect(http.requests).toHaveLength(1);
		} finally {
			delete globals.unsafeWindow;
		}
	});
});

describe("YukicoderSite", () => {
	const globals = globalThis as {unsafeWindow?: unknown};
	const wait = () => new Promise((resolve) => setTimeout(resolve, 10));

	afterEach(() => {
		delete globals.unsafeWindow;
	});

	/** CodeMirror と同じ場所に編集領域を置き、本体の参照を付ける。 */
	function mountEditor(initial: string) {
		const editor = {text: initial};
		const view = {
			get state() {
				return {doc: {length: editor.text.length, toString: () => editor.text}};
			},
			dispatch({changes}: {changes: {from: number; to: number; insert: string}}) {
				editor.text = editor.text.slice(0, changes.from) + changes.insert + editor.text.slice(changes.to);
			},
		};
		const content = document.createElement("div");
		content.className = "cm-content";
		Object.assign(content, {cmTile: {view}});
		const wrapper = document.createElement("div");
		wrapper.className = "cm-source-editor";
		wrapper.append(content);
		document.querySelector("#rich_source")?.after(wrapper);
		return {editor, content};
	}

	/** happy-dom は表示の有無を計算しないので、textarea が見えているかを指定して置く。 */
	function mountTextarea(visible: boolean): HTMLTextAreaElement {
		document.body.innerHTML = '<div><div id="rich_source"></div><textarea id="source"></textarea></div>';
		const textarea = document.querySelector<HTMLTextAreaElement>("#source")!;
		Object.defineProperty(textarea, "offsetParent", {value: visible ? document.body : null});
		return textarea;
	}

	test("サンプルと実行ボタンの位置を読み取る", async () => {
		document.body.innerHTML = '<div class="sample"><button class="copy-sample-input"></button><pre>1</pre><pre>2</pre></div>';
		const samples = await new YukicoderSite(bridge).samples();
		expect(samples[0]).toMatchObject({input: "1", output: "2"});
		expect(samples[0]?.anchors).toHaveLength(1);
		expect(samples[0]?.anchors[0]).toBe(document.querySelector(".copy-sample-input") ?? undefined);
	});

	test("CodeMirror のエディタからソースを読み書きする", () => {
		globals.unsafeWindow = window;
		const textarea = mountTextarea(false);
		const {editor} = mountEditor("print(1)");
		const site = new YukicoderSite(bridge);
		expect(site.sourceCode()).toBe("print(1)");
		site.setSourceCode("print(2)");
		expect(editor.text).toBe("print(2)");
		expect(textarea.value).toBe("print(2)");
	});

	test("textarea に切り替えている間は textarea から読む", () => {
		globals.unsafeWindow = window;
		const textarea = mountTextarea(true);
		mountEditor("print(1)");
		textarea.value = "print(3)";
		expect(new YukicoderSite(bridge).sourceCode()).toBe("print(3)");
	});

	test("エディタがなければ空のソースを返す", () => {
		globals.unsafeWindow = window;
		mountTextarea(false);
		expect(new YukicoderSite(bridge).sourceCode()).toBe("");
	});

	test("あとから作られたエディタの編集も知らせる", async () => {
		document.body.innerHTML = '<div><div id="rich_source"></div></div>';
		const listener = mock(() => undefined);
		new YukicoderSite(bridge).onSourceChange(listener);
		const {content} = mountEditor("");
		await wait();
		expect(listener).not.toHaveBeenCalled();
		content.append(document.createElement("div"));
		await wait();
		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("CodeforcesSite", () => {
	test("問題ページで編集したコードを提出対象のファイルに反映する", async () => {
		document.body.innerHTML = '<form class="submitForm"><input name="sourceFile" type="file"></form><div id="pageContent"></div>';
		const site = new CodeforcesSite(bridge);
		const source = document.querySelector("textarea")!;
		const input = document.querySelector("input")!;
		source.value = "new solution";
		source.dispatchEvent(new Event("input", {bubbles: true}));
		expect(await input.files?.[0]?.text()).toBe(site.sourceCode());
	});

	test("行ごとに分かれたサンプルを結合する", async () => {
		document.body.innerHTML = `<form class="submitForm"></form><div id="pageContent"></div><div class="sample-test">
			<div class="input"><div class="title"><span class="input-output-copier"></span></div>
				<pre><div class="test-example-line">1</div><div class="test-example-line">2</div></pre></div>
			<div class="output"><pre>3<br></pre></div>
		</div>`;
		const samples = await new CodeforcesSite(bridge).samples();
		expect(samples[0]).toMatchObject({input: "1\n2", output: "3\n"});
	});

	test("先頭の例だけコピーのボタンが無くても、ボタンを例と組み違えず、全部の例を返す", async () => {
		document.body.innerHTML = `<form class="submitForm"></form><div id="pageContent"></div><div class="sample-test">
			<div class="input"><div class="title"></div><pre>1</pre></div><div class="output"><pre>10</pre></div>
			<div class="input"><div class="title"><span class="input-output-copier" id="second"></span></div><pre>2</pre></div><div class="output"><pre>20</pre></div>
		</div>`;
		const samples = await new CodeforcesSite(bridge).samples();
		expect(samples.map(({title, input, output}) => ({title, input, output}))).toEqual([
			{title: "Sample 1", input: "1", output: "10"},
			{title: "Sample 2", input: "2", output: "20"},
		]);
		expect(samples.map(({anchors}) => anchors)).toEqual([[], [document.getElementById("second")!]]);
	});

	test("提出欄に手を加えずに入出力例を読む", () => {
		document.body.innerHTML = `<form class="submitForm"></form><div class="sample-test">
			<div class="input"><pre>1 2</pre></div><div class="output"><pre>3</pre></div>
		</div>`;
		expect(readCodeforcesSamples()).toMatchObject([{input: "1 2", output: "3", anchors: []}]);
		expect(document.querySelector("textarea")).toBeNull();
	});

	test("コンテストのページの表から問題を順番どおりに読む", () => {
		const html = `<table class="problems"><tr><th>#</th></tr>
			<tr><td class="id"><a href="/contest/2000/problem/A"> A </a></td><td><div><div><a href="/contest/2000/problem/A">Alpha</a></div></div></td></tr>
			<tr><td class="id"><a href="/contest/2000/problem/C1">C1</a></td><td><div><div><a>Gamma</a></div></div></td></tr>
		</table>`;
		expect(parseCodeforcesContestPage(html)).toEqual([
			{url: "/contest/2000/problem/A", label: "A", name: "Alpha"},
			{url: "/contest/2000/problem/C1", label: "C1", name: "Gamma"},
		]);
	});
});
