import type {MessageKey} from "@catalog/messages";
import type {RunOptions, RunResult, TestCase} from "@domain/execution/result";
import {option} from "@domain/settings/option";
import type {CodeRunner} from "@application/execution/runner-catalog";
import {type EnvironmentView, RunnerSelection} from "@application/execution/runner-selection";
import {TestSession} from "@application/execution/test-session";
import {defineFeature, type FeatureContext} from "@application/feature/definition";
import type {JudgeSite, SampleCase} from "@application/ports/judge-site";
import {createDock, type Dock, type DockTab} from "@ui/dock/dock";
import {h, injectStyle} from "@ui/element";
import {registerShortcut} from "@ui/shortcuts";
import {addTooltip} from "@ui/tooltip/tooltip";
import css from "./easy-test.css" with {type: "text"};
import resultRowCss from "./result-row.css" with {type: "text"};
import {SavedCodes} from "./saved-code";
import {createResultRow, createResultView, createTestPanel, type TestPanel, toneOf} from "./views";

const PRECOMPILE_DELAY_MS = 180;
const TEST_AND_SUBMIT_KEY = "Ctrl+Enter";
const TEST_ALL_KEY = "Alt+Enter";

const featureOptions = {
	precompile: option.boolean(true, "easyTest.precompile"),
	keyboardShortcuts: option.boolean(true, "easyTest.keyboardShortcuts"),
	savedCodeLimit: option.number(10, "easyTest.savedCodeLimit", {min: 0}),
	allowableError: option.text("1e-6", "easyTest.allowableError"),
};

type Context = FeatureContext<typeof featureOptions>;
type Execution = {readonly result: Promise<RunResult>; readonly tab: DockTab};

class EasyTest {
	private readonly dock: Dock;
	private readonly panel: TestPanel;
	private readonly savedCodes: SavedCodes;
	private readonly buttons: HTMLElement[] = [];
	private readonly resultList = h("div", {className: "row"});
	private readonly selection: RunnerSelection;
	private readonly session: TestSession;
	private readonly environmentView: EnvironmentView = {
		selected: () => this.panel.environment.value,
		show: (candidates, selected) => this.showEnvironment(candidates, selected),
	};
	private submitButton: HTMLButtonElement | undefined;
	private runnable = false;
	private readonly site: JudgeSite;
	private readonly context: Context;

	constructor(site: JudgeSite, context: Context) {
		this.site = site;
		this.context = context;
		const {options, state, translate, openSettings, runners} = context;
		this.selection = new RunnerSelection(() => site.language(), runners, state);
		this.session = new TestSession(runners, this.selection, {
			onBusyChange: () => this.updateRunnable(),
			onSubmitChange: () => this.showSubmitState(),
		});
		this.savedCodes = new SavedCodes(state, options.savedCodeLimit);
		this.dock = createDock({css, toggleLabel: "Easy Test+", closeLabel: translate("settings.close")});
		this.panel = createTestPanel(translate, options.allowableError, {
			onRun: () => void this.runPanel(),
			onOpenSettings: openSettings,
		});
		this.dock.addTab("Easy Test+", this.panel.element);
	}

	start(): void {
		injectStyle(resultRowCss);
		this.panel.environment.addEventListener("change", () => this.selection.remember(this.panel.environment.value));
		this.site.onLanguageChange(() => void this.refreshEnvironment());
		void this.refreshEnvironment();
		this.placeButtons();
		this.placeSampleButtons();
		if (this.context.options.precompile) this.watchSource();
		if (this.context.options.keyboardShortcuts) this.registerShortcuts();
	}

	/** 実行中でも次の実行を受け付けるので、見た目だけを切り替える。 */
	private createButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
		const button = h("button", {
			type: "button",
			className: `btn ${className}`,
			textContent: label,
			onclick: onClick,
		});
		button.classList.toggle("disabled", !this.runnable);
		this.buttons.push(button);
		return button;
	}

	private createTestButton(label: MessageKey, className: string, shortcut: () => string | null, onClick: () => void): HTMLButtonElement {
		const button = this.createButton(this.context.translate(label), className, onClick);
		if (this.context.options.keyboardShortcuts) addTooltip(() => button, shortcut);
		button.style.marginLeft = "1rem";
		return button;
	}

	private placeButtons(): void {
		const {translate} = this.context;
		const {testButtons, sideButtons, results} = this.site.mounts;
		if (testButtons instanceof Element) {
			// 中止のボタンの間は、ショートカットでは中止できない
			const submitKey = (): string | null => this.session.submitPending ? null : TEST_AND_SUBMIT_KEY;
			this.submitButton = this.createTestButton("easyTest.testAndSubmit", "btn-info", submitKey, () => {
				if (this.session.submitPending) this.session.cancelSubmit();
				else void this.testAndSubmit();
			});
			testButtons.append(
				this.submitButton,
				this.createTestButton("easyTest.testAll", "btn-default btn-sm", () => TEST_ALL_KEY, () => void this.testAll()),
			);
		}
		if (sideButtons instanceof Element) {
			sideButtons.append(h("a", {
				className: "btn btn-danger btn-sm",
				textContent: translate("easyTest.restore"),
				onclick: () => this.restore(),
			}));
		}
		if (results instanceof Element) results.append(this.resultList);
	}

	private placeSampleButtons(): void {
		void this.readSamples().then((samples) => {
			const label = this.context.translate("easyTest.run");
			for (const sample of samples) {
				if (!(sample.anchor instanceof Element)) continue;
				const button = this.createButton(label, "btn-primary btn-sm", () => void this.runSample(sample));
				button.style.verticalAlign = "top";
				button.style.marginLeft = "0.5em";
				sample.anchor.after(button);
			}
		});
	}

	/** 選んでいる言語を Local Runner が扱えるときだけ、編集中のコードをコンパイルしておく。 */
	private watchSource(): void {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const prepare = (): void => {
			const code = this.site.sourceCode();
			const runner = this.selection.local();
			if (code) void runner?.prepare?.(code)?.catch(() => undefined);
		};
		const schedule = (): void => {
			clearTimeout(timer);
			timer = setTimeout(() => void this.selection.settled().then(prepare), PRECOMPILE_DELAY_MS);
		};
		this.site.onSourceChange(schedule);
		schedule();
	}

	private registerShortcuts(): void {
		const handled = (action: () => void) => () => {
			action();
			return true;
		};
		registerShortcut(TEST_AND_SUBMIT_KEY, handled(() => void this.testAndSubmit()), {inTextFields: true});
		registerShortcut(TEST_ALL_KEY, handled(() => void this.testAll()), {inTextFields: true});
		registerShortcut("Alt+Escape", handled(() => this.dock.toggle()), {inTextFields: true});
	}

	private refreshEnvironment(): Promise<void> {
		return this.selection.refresh(this.environmentView);
	}

	/** 実行環境の候補を `<select>` に反映する。 */
	private showEnvironment(candidates: readonly CodeRunner[], selected: string | undefined): void {
		const {environment} = this.panel;
		const signature = candidates.map(({id, label}) => `${id}\n${label}`).join("\n");
		if (environment.dataset.signature !== signature || candidates.length === 0) {
			environment.dataset.signature = signature;
			environment.replaceChildren(...candidates.map(({id, label}) => h("option", {
				value: id,
				textContent: label,
			})));
			if (candidates.length === 0) environment.append(h("option", {textContent: this.context.translate("easyTest.noEnvironment")}));
		}
		if (selected !== undefined) environment.value = selected;
		this.updateRunnable();
	}

	private updateRunnable(): void {
		this.setRunnable(this.selection.candidates.length > 0 && !this.session.busy);
	}

	private setRunnable(runnable: boolean): void {
		this.runnable = runnable;
		this.panel.setRunnable(runnable);
		for (const button of this.buttons) button.classList.toggle("disabled", !runnable);
		this.showSubmitState();
	}

	/** 提出の予定がある間は、Test & Submit のボタンを中止のボタンにする。 */
	private showSubmitState(): void {
		const button = this.submitButton;
		if (!button) return;
		const pending = this.session.submitPending;
		button.textContent = this.context.translate(pending ? "easyTest.cancelSubmit" : "easyTest.testAndSubmit");
		button.classList.toggle("btn-info", !pending);
		button.classList.toggle("btn-warning", pending);
		button.classList.toggle("disabled", !pending && !this.runnable);
	}

	private execute(testCase: TestCase, options: RunOptions): Execution {
		const code = this.site.sourceCode();
		if (code) this.savedCodes.save(this.site.taskUri(), code);

		const view = createResultView(this.context.translate);
		const tab = this.dock.addTab(`#${this.session.nextNumber()} ${testCase.title}`, view.element, {closable: true});
		const result = this.session.start(testCase, code, this.panel.environment.value, this.panel.allowableError(), options);
		void result.then((value) => {
			view.show(value);
			const tone = toneOf(value.status);
			if (tone) tab.setTone(tone);
		});
		return {result, tab};
	}

	/** ソースが空なら知らせる。サイトのエディタを読めなかったときに、空のコードを実行しないようにする。 */
	private hasSource(): boolean {
		if (this.site.sourceCode()) return true;
		window.alert(this.context.translate("easyTest.noSource"));
		return false;
	}

	private async runPanel(): Promise<void> {
		if (!this.hasSource()) return;
		await this.refreshEnvironment();
		const {input, expected} = this.panel;
		this.execute({title: "Run", input: input.value, output: expected.value || null}, {});
	}

	private async runSample(sample: SampleCase): Promise<void> {
		if (!this.hasSource()) return;
		await this.refreshEnvironment();
		const {result, tab} = this.execute(sample, {});
		await result;
		tab.show();
	}

	private readSamples(): Promise<readonly SampleCase[]> {
		return this.site.samples().catch(() => []);
	}

	/** サンプルをすべて実行し、全問正解かを返す。ソースが空か、サンプルを読めなければ何も実行しない。 */
	private async runSamples(onClose?: () => void): Promise<boolean> {
		if (!this.hasSource()) return false;
		const samples = await this.readSamples();
		if (samples.length === 0) {
			window.alert(this.context.translate("easyTest.noSamples"));
			return false;
		}
		await this.refreshEnvironment();
		const runGroupId = crypto.randomUUID();
		const executions = samples.map((sample) => this.execute(sample, {runGroupId}));
		// 次に開いたときは、このテストの先頭の結果から見られるようにする
		executions[0]?.tab.select();
		const row = createResultRow(samples.length, this.context.translate("settings.close"), () => {
			for (const {tab} of executions) tab.close();
			onClose?.();
		});
		this.resultList.prepend(row.element);
		for (const {result, tab} of executions) row.track(result, () => tab.show());
		const results = await Promise.all(executions.map(({result}) => result));
		return results.every(({status}) => status === "AC");
	}

	private async testAll(): Promise<void> {
		await this.runSamples();
	}

	private async testAndSubmit(): Promise<void> {
		await this.session.testAndSubmit((cancel) => this.runSamples(cancel), () => this.site.submit());
	}

	private restore(): void {
		const {translate} = this.context;
		const code = this.savedCodes.find(this.site.taskUri());
		if (code === null) {
			window.alert(translate("easyTest.noSavedCode"));
		} else if (!this.site.sourceCode() || window.confirm(translate("easyTest.restoreConfirm"))) {
			this.site.setSourceCode(code);
		}
	}
}

export const easyTest = defineFeature({
	id: "easy-test",
	title: "easyTest.title",
	description: "easyTest.description",
	category: "category.execution",
	defaultEnabled: false,
	routes: ["atcoder:task", "atcoder:submit", "yukicoder:problem", "codeforces:problem"],
	phase: "ready",
	options: featureOptions,
	async start(context) {
		const site = await context.judgeSite();
		if (site) new EasyTest(site, context).start();
	},
});
