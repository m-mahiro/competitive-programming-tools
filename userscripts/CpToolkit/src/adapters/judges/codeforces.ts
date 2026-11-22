import type {JudgeMounts, SampleCase} from "@application/ports/judge-site";
import type {PageBridge} from "@application/ports/page-bridge";
import {pageGlobals} from "@adapters/page/globals";
import {JudgeSiteBase} from "./site-base";

/** 提出欄の言語の選択欄。問題ページと提出ページで同じ。 */
export const CODEFORCES_LANGUAGE_SELECT = "select[name='programTypeId']";

function readSampleBlock(pre: Element): string {
	const lines = pre.querySelectorAll(".test-example-line");
	if (lines.length > 0) return [...lines].map((line) => line.textContent ?? "").join("\n");
	return [...pre.childNodes].map((node) => {
		const isLineBreak = node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "BR");
		return (node.textContent ?? "") + (isLineBreak ? "\n" : "");
	}).join("");
}

/** 問題ページの提出欄はファイルしか受け付けないので、入力欄を用意する。 */
export class CodeforcesSite extends JudgeSiteBase {
	readonly id = "codeforces";
	private readonly buttons = document.createElement("span");
	private readonly textarea = document.createElement("textarea");

	constructor(bridge: PageBridge) {
		super(bridge);
		this.textarea.dataset.cpEasyTestSource = "";
		Object.assign(this.textarea.style, {fontFamily: "monospace", width: "100%", minHeight: "5em"});
		document.querySelector(".submitForm")?.append(this.buttons);
		if (!this.fastSubmitEditor) document.getElementById("pageContent")?.append(this.textarea);
		const input = this.fileInput;
		if (input) {
			this.textarea.addEventListener("input", () => this.attachFile(this.textarea.value, input));
			input.addEventListener("change", () => {
				const file = input.files?.[0];
				this.textarea.value = "";
				if (file) void file.text().then((text) => {
					if (input.files?.[0] === file) this.textarea.value = text;
				}).catch(() => undefined);
			});
		}
	}

	get mounts(): JudgeMounts {
		return {testButtons: this.buttons, sideButtons: this.buttons, results: document.getElementById("pageContent")};
	}

	protected get languageSelect(): HTMLSelectElement | null {
		return document.querySelector(CODEFORCES_LANGUAGE_SELECT);
	}

	private get fileInput(): HTMLInputElement | null {
		return document.querySelector('.submitForm input[name="sourceFile"]');
	}

	/** cf-fast-submit が有効なら、そのエディタを優先する。 */
	private get fastSubmitEditor() {
		const element = document.getElementById("editor");
		return element ? pageGlobals().ace?.edit(element) : undefined;
	}

	sourceCode(): string {
		return this.fastSubmitEditor?.getValue() ?? this.textarea.value;
	}

	setSourceCode(code: string): void {
		this.textarea.value = code;
		this.fastSubmitEditor?.setValue(code);
		const input = this.fileInput;
		if (input) this.attachFile(code, input);
	}

	private attachFile(code: string, input: HTMLInputElement): void {
		const files = new DataTransfer();
		if (code) files.items.add(new File([code], "prog.txt", {type: "text/plain"}));
		input.files = files.files;
	}

	submit(): void {
		this.setSourceCode(this.sourceCode());
		document.querySelector<HTMLElement>(".submitForm .submit")?.click();
	}

	async samples(): Promise<readonly SampleCase[]> {
		const samples: SampleCase[] = [];
		for (const block of document.querySelectorAll(".sample-test")) {
			const inputs = block.querySelectorAll(".input pre");
			const outputs = block.querySelectorAll(".output pre");
			const anchors = block.querySelectorAll(".input .title .input-output-copier");
			inputs.forEach((input, index) => {
				const output = outputs[index];
				const anchor = anchors[index];
				if (!output || !anchor) return;
				samples.push({
					title: `Sample ${samples.length + 1}`,
					input: readSampleBlock(input),
					output: readSampleBlock(output),
					anchors: [anchor],
				});
			});
		}
		return samples;
	}
}

/** モバイル版には提出欄がないので、提出ページのフォームを問題ページへ移す。 */
export class CodeforcesMobileSite extends JudgeSiteBase {
	readonly id = "codeforces";
	private readonly main: Element;
	private readonly form: HTMLFormElement;

	private constructor(bridge: PageBridge, main: Element, form: HTMLFormElement) {
		super(bridge);
		this.main = main;
		this.form = form;
	}

	get mounts(): JudgeMounts {
		return {testButtons: this.main, sideButtons: this.main, results: this.main};
	}

	protected get languageSelect(): HTMLSelectElement | null {
		return this.form.elements.namedItem("programTypeId") as HTMLSelectElement | null;
	}

	private get source(): HTMLTextAreaElement | null {
		return this.form.elements.namedItem("source") as HTMLTextAreaElement | null;
	}

	static async create(bridge: PageBridge): Promise<CodeforcesMobileSite | null> {
		const main = document.querySelector("main");
		const url = /\/contest\/(\d+)\/problem\/([^/]+)/.exec(location.pathname);
		if (!main || !url) return null;
		const frame = document.createElement("iframe");
		frame.src = `/contest/${url[1]}/submit`;
		frame.style.display = "none";
		const loaded = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 10_000);
			frame.addEventListener("load", () => { clearTimeout(timer); resolve(true); }, {once: true});
			frame.addEventListener("error", () => { clearTimeout(timer); resolve(false); }, {once: true});
			document.body.append(frame);
		});
		const form = loaded && frame.contentDocument?.querySelector<HTMLFormElement>("._SubmitPage_submitForm");
		if (!form) {
			frame.remove();
			return null;
		}
		const problem = form.elements.namedItem("problemIndex") as HTMLInputElement | null;
		if (problem) {
			problem.value = url[2] ?? "";
			problem.readOnly = true;
		}
		main.append(form);
		return new CodeforcesMobileSite(bridge, main, form);
	}

	sourceCode(): string {
		return this.source?.value ?? "";
	}

	setSourceCode(code: string): void {
		if (this.source) this.source.value = code;
	}

	submit(): void {
		this.form.requestSubmit();
	}

	async samples(): Promise<readonly SampleCase[]> {
		return [...document.querySelectorAll(".sample-test")].map((block, index) => ({
			title: `Sample ${index + 1}`,
			input: block.querySelector(".input pre.content")?.textContent ?? "",
			output: block.querySelector(".output pre.content")?.textContent ?? "",
			anchors: [block.querySelector(".input .title") ?? block],
		}));
	}
}
