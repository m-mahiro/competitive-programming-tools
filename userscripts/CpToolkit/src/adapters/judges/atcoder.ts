import {atcoderSampleSelectors} from "@catalog/judges";
import {atCoderSampleHeading} from "@atcoder-tools/shared";
import type {JudgeMounts, SampleCase} from "@application/ports/judge-site";
import type {PageBridge} from "@application/ports/page-bridge";
import type {HttpClient} from "@application/ports/services";
import {pageGlobals} from "@adapters/page/globals";
import {JudgeSiteBase} from "./site-base";

function sample(index: number, input: Element, output: Element, anchor: Element): SampleCase {
	return {title: `Sample ${index + 1}`, input: input.textContent ?? "", output: output.textContent ?? "", anchors: [anchor]};
}

/** 見出しの次の本文を、その入力例・出力例に対応付ける。片方でも欠けていれば null。 */
function parseSamplesIn(root: Element): SampleCase[] | null {
	const samples: SampleCase[] = [];
	const nodes = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6,pre")];
	let input: {pre: Element; anchor: Element; number: number | undefined} | undefined;
	for (const [index, node] of nodes.entries()) {
		if (node.tagName === "PRE") continue;
		const title = node.cloneNode(true) as Element;
		for (const control of title.querySelectorAll("button,.btn-copy,.cp-title-control")) control.remove();
		const heading = atCoderSampleHeading(title.textContent ?? "");
		if (!heading) continue;
		const pre = nodes[index + 1];
		if (pre?.tagName !== "PRE") return null;
		if (heading.input) {
			if (input) return null;
			input = {pre, anchor: node.closest(".part, .section")?.querySelector(".btn-copy") ?? node, number: heading.number};
		} else {
			if (!input || input.number !== heading.number) return null;
			samples.push(sample(samples.length, input.pre, pre, input.anchor));
			input = undefined;
		}
	}
	if (input) return null;
	if (samples.length) return samples;

	// 見出しがない旧書式は、対応するセレクタで入出力を順に読む。
	for (const {selector, container, insideIoStyle} of atcoderSampleSelectors) {
		const elements = [...root.querySelectorAll(selector)].filter((element) => {
			if (insideIoStyle) return element.childElementCount === 0;
			return !element.closest(".io-style") && !element.querySelector("var");
		});
		if (elements.length === 0) continue;
		if (elements.length % 2 !== 0) return null;
		for (let i = 0; i < elements.length; i += 2) {
			const pre = elements[i]!;
			const parent = pre.closest(container) ?? pre.parentElement;
			samples.push(sample(samples.length, pre, elements[i + 1]!, parent?.querySelector(".btn-copy") ?? parent?.querySelector("h1,h2,h3,h4,h5,h6") ?? pre));
		}
		break;
	}
	return samples;
}

/**
 * 日英でサンプル数が違えば多い方を使い、Run ボタンの置き場所は全言語から集める。
 * 表示中の言語は切り替えのたびに変わるので、どちらが見えているかは見ない。
 */
function parseSamples(page: Document): SampleCase[] {
	const statement = page.getElementById("task-statement");
	if (!statement) return [];
	const languages = [...statement.querySelectorAll(".lang > .lang-ja, .lang > .lang-en")];
	const translations: SampleCase[][] = [];
	for (const root of languages.length ? languages : [statement]) {
		const samples = parseSamplesIn(root);
		if (!samples) return [];
		translations.push(samples);
	}
	const [first = [], ...others] = translations.sort((a, b) => b.length - a.length);
	return first.map((sample, index) => ({
		...sample,
		anchors: [...sample.anchors, ...others.flatMap((samples) => {
			const other = samples[index];
			return other?.input === sample.input && other.output === sample.output ? other.anchors : [];
		})],
	}));
}

export class AtCoderSite extends JudgeSiteBase {
	readonly id = "atcoder";
	private readonly samplesByTask = new Map<string, Promise<readonly SampleCase[]>>();
	private readonly site: HttpClient;

	constructor(bridge: PageBridge, site: HttpClient) {
		super(bridge);
		this.site = site;
	}

	get mounts(): JudgeMounts {
		return {
			testButtons: document.querySelector("#submit")?.parentElement ?? null,
			sideButtons: document.querySelector(".editor-buttons"),
			results: document.querySelector(".form-code-submit"),
		};
	}

	protected get languageSelect(): HTMLSelectElement | null {
		return document.querySelector("#select-lang select.current");
	}

	private get taskSelect(): HTMLSelectElement | null {
		return document.querySelector("#select-task");
	}

	override taskUri(): string {
		const task = this.taskSelect?.value;
		if (!task) return `${location.origin}${location.pathname}`;
		return `${location.origin}/contests/${pageGlobals().contestScreenName}/tasks/${task}`;
	}

	override onLanguageChange(listener: () => void): void {
		for (const select of document.querySelectorAll("#select-lang select")) this.bridge.onChange(select, listener);
	}

	override onSourceChange(listener: () => void): void {
		const element = document.querySelector("#editor");
		const ace = pageGlobals().ace;
		if (ace && element) ace.edit(element).getSession().on("change", listener);
	}

	sourceCode(): string {
		const page = pageGlobals();
		const element = document.querySelector("#editor");
		if (!page.ace || !element) return page.getSourceCode?.() ?? "";
		const isPlainText = document.querySelector(".btn-toggle-editor")?.classList.contains("active");
		if (isPlainText) return document.querySelector<HTMLTextAreaElement>("#plain-textarea")?.value ?? "";
		return page.ace.edit(element).getValue();
	}

	setSourceCode(code: string): void {
		const element = document.querySelector("#editor");
		if (element) pageGlobals().ace?.edit(element).setValue(code, -1);
		const textarea = document.querySelector<HTMLTextAreaElement>("#plain-textarea");
		if (textarea) textarea.value = code;
	}

	submit(): void {
		document.querySelector<HTMLElement>("#submit")?.click();
	}

	/** Run ボタンを置くと問題文の形が変わるので、問題ごとに最初の結果を使い続ける。 */
	samples(): Promise<readonly SampleCase[]> {
		const taskUri = this.taskUri();
		const cached = this.samplesByTask.get(taskUri);
		if (cached) return cached;
		const isTaskPage = /^\/contests\/[^/]+\/tasks\//.test(location.pathname);
		const samples = isTaskPage ? Promise.resolve(parseSamples(document)) : this.fetchSamples(taskUri);
		this.samplesByTask.set(taskUri, samples);
		const forget = () => this.samplesByTask.delete(taskUri);
		void samples.then((result) => { if (!result.length) forget(); }, forget);
		return samples;
	}

	/** 提出ページにはサンプルがないので、問題ページから取得する。 */
	private async fetchSamples(taskUri: string): Promise<readonly SampleCase[]> {
		const response = await this.site.send({url: taskUri});
		if (response.status !== 200) throw new Error(`Failed to fetch ${taskUri}: ${response.status}`);
		const samples = parseSamples(new DOMParser().parseFromString(response.text, "text/html"));
		return samples.map((sample) => ({...sample, anchors: []}));
	}
}
