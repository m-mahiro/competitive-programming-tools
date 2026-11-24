import type {MessageKey} from "@catalog/messages";
import {parseAllowableError, type RunOptions, type RunResult, type TestCase} from "@domain/execution/result";
import {option} from "@domain/settings/option";
import type {CodeRunner} from "@application/execution/runner-catalog";
import {type EnvironmentView, RunnerSelection} from "@application/execution/runner-selection";
import {TestSession} from "@application/execution/test-session";
import {defineFeature, type FeatureContext} from "@application/feature/definition";
import type {JudgeSite, SampleCase} from "@application/ports/judge-site";
import {SHORTCUT_ACTIONS} from "@application/shortcuts/shortcut-actions";
import {createDock, type Dock, type DockTab} from "@ui/dock/dock";
import {h, injectStyle} from "@ui/element";
import {showActionWarning} from "@ui/toast/toast";
import {addTooltip} from "@ui/tooltip/tooltip";
import css from "./easy-test.css" with {type: "text"};
import resultRowCss from "./result-row.css" with {type: "text"};
import {SavedCodes} from "./saved-code";
import {createResultRow, createResultView, createTestPanel, type TestPanel, toneOf} from "./views";

const PRECOMPILE_DELAY_MS = 180;

const featureOptions = {
	precompile: option.boolean(true, "easyTest.precompile"),
	savedCodeLimit: option.number(10, "easyTest.savedCodeLimit", {min: 0, integer: true}),
	allowableError: option.text("1e-6", "easyTest.allowableError", {
		validate: (value) => parseAllowableError(value) !== null,
		invalidMessage: "easyTest.invalidAllowableError",
	}),
};

type Context = FeatureContext<typeof featureOptions>;
/** 実行を始めたときの入力。全サンプルを同じ許容誤差で判定する。 */
type RunSnapshot = {source: string; task: string; language: string | undefined; runner: string; explicit: string | undefined; allowableError: number | undefined};
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
		show: (candidates, selected) => this.showEnvironment(candidates, selected),
	};
	private submitButton: HTMLButtonElement | undefined;
	/** 準備中または判定中の操作数。重ねて実行したときは最後の操作が終わってから許容誤差の欄を戻す。 */
	private activeRuns = 0;
	private runnable = false;
	private currentRunner = "";
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
		this.panel.environment.addEventListener("change", () => {
			this.selection.remember(this.panel.environment.value);
			void this.refreshEnvironment();
		});
		this.site.onLanguageChange(() => void this.refreshEnvironment());
		void this.refreshEnvironment();
		this.placeButtons();
		this.placeSampleButtons();
		if (this.context.options.precompile) this.watchSource();
		this.registerShortcuts();
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
		addTooltip(() => button, shortcut);
		button.style.marginLeft = "1rem";
		return button;
	}

	private placeButtons(): void {
		const {translate} = this.context;
		const {testButtons, sideButtons, results} = this.site.mounts;
		if (testButtons instanceof Element) {
			// 中止のボタンの間は、ショートカットでは中止できない
			const {shortcuts} = this.context;
			const submitKey = (): string | null => this.session.submitPending ? null : shortcuts.keyOf(SHORTCUT_ACTIONS.testAndSubmit);
			this.submitButton = this.createTestButton("easyTest.testAndSubmit", "btn-info", submitKey, () => {
				if (this.session.submitPending) this.session.cancelSubmit();
				else void this.testAndSubmit();
			});
			testButtons.append(
				this.submitButton,
				this.createTestButton("easyTest.testAll", "btn-default btn-sm", () => shortcuts.keyOf(SHORTCUT_ACTIONS.testAll), () => void this.testAll()),
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
				for (const anchor of sample.anchors) {
					if (!(anchor instanceof Element)) continue;
					const button = this.createButton(label, "btn-primary btn-sm", () => void this.runSample(sample));
					button.style.verticalAlign = "top";
					button.style.marginLeft = "0.5em";
					anchor.after(button);
				}
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

	/** キーはショートカットキーの機能の設定で決める。 */
	private registerShortcuts(): void {
		const {shortcuts} = this.context;
		const handled = (action: () => void) => () => {
			action();
			return true;
		};
		shortcuts.register(SHORTCUT_ACTIONS.testAndSubmit, handled(() => void this.testAndSubmit()));
		shortcuts.register(SHORTCUT_ACTIONS.testAll, handled(() => void this.testAll()));
		shortcuts.register(SHORTCUT_ACTIONS.toggleEasyTest, handled(() => this.dock.toggle()));
	}

	private refreshEnvironment(): Promise<void> {
		return this.selection.refresh(this.environmentView);
	}

	/** 実行環境の候補を `<select>` に反映する。 */
	private showEnvironment(candidates: readonly CodeRunner[], selected: string | undefined): void {
		const {environment} = this.panel;
		const explicit = this.selection.explicit;
		const automatic = candidates.find(({kind}) => kind === "local") ?? candidates[0];
		const options = candidates.map(({id, label}) => h("option", {value: id, textContent: label}));
		if (automatic) options.unshift(h("option", {value: "", textContent: this.context.translate("easyTest.autoRunner") + " — " + automatic.label}));
		else options.push(h("option", {value: "", textContent: this.context.translate("easyTest.noEnvironment")}));
		if (explicit && !candidates.some(({id}) => id === explicit)) {
			options.push(h("option", {value: explicit, textContent: explicit + " — " + this.context.translate("easyTest.noEnvironment")}));
		}
		environment.replaceChildren(...options);
		environment.value = explicit ?? "";
		this.currentRunner = selected ?? "";
		this.updateRunnable();
	}

	private updateRunnable(): void {
		// 実行先は押した時点で調べ直す。ページを開いた後に Runner を起動する場合も受け付ける。
		this.runnable = this.site.language() !== null && !this.session.busy;
		this.panel.setRunnable(this.runnable);
		for (const button of this.buttons) button.classList.toggle("disabled", !this.runnable);
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

	private snapshot(allowableError?: number): RunSnapshot {
		const explicit = this.selection.explicit;
		return {source: this.site.sourceCode(), task: this.site.taskUri(), language: this.site.language()?.id, runner: explicit ?? this.currentRunner, explicit, allowableError};
	}

	private matches(snapshot: RunSnapshot, checkRunner = true): boolean {
		const current = this.snapshot();
		return current.source === snapshot.source && current.task === snapshot.task && current.language === snapshot.language
			&& current.explicit === snapshot.explicit && (!checkRunner || current.runner === snapshot.runner);
	}

	private changed(): void {
		showActionWarning({title: this.context.translate("easyTest.title"), detail: this.context.translate("easyTest.submitChanged")});
	}

	private async withPreparedRun<T>(run: (snapshot: RunSnapshot) => Promise<T>): Promise<T | false> {
		this.activeRuns++;
		this.panel.setAllowableErrorLocked(true);
		try {
			const allowableError = this.panel.allowableError();
			if (allowableError === null) {
				window.alert(this.context.translate("easyTest.invalidAllowableError"));
				return false;
			}
			if (!await this.context.paste.settled() || !this.hasSource()) return false;
			const before = this.snapshot();
			await this.refreshEnvironment();
			if (!this.matches(before, false)) { this.changed(); return false; }
			if (!this.selection.candidates.some(({id}) => id === this.currentRunner)) {
				window.alert(this.context.translate("easyTest.noEnvironment"));
				return false;
			}
			return await run(this.snapshot(allowableError));
		} finally {
			if (--this.activeRuns === 0) this.panel.setAllowableErrorLocked(false);
		}
	}

	private execute(testCase: TestCase, options: RunOptions, snapshot: RunSnapshot): Execution {
		this.savedCodes.save(snapshot.task, snapshot.source);

		const view = createResultView(this.context.translate);
		const tab = this.dock.addTab(`#${this.session.nextNumber()} ${testCase.title}`, view.element, {closable: true});
		const result = this.session.start(testCase, snapshot.source, snapshot.runner, snapshot.allowableError, options);
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

	private runPanel() {
		return this.withPreparedRun((snapshot) => {
			const {input, expected} = this.panel;
			return this.execute({title: "Run", input: input.value, output: expected.value || null}, {}, snapshot).result;
		});
	}

	private runSample(sample: SampleCase) {
		return this.withPreparedRun(async (snapshot) => {
			const {result, tab} = this.execute(sample, {}, snapshot);
			await result;
			tab.show();
		});
	}

	private readSamples(): Promise<readonly SampleCase[]> {
		return this.site.samples().catch(() => []);
	}

	/** サンプルをすべて実行し、全問正解かを返す。ソースが空か、サンプルを読めなければ何も実行しない。 */
	private async runSamples(snapshot: RunSnapshot, onClose?: () => void): Promise<boolean> {
		const samples = await this.readSamples();
		if (samples.length === 0) {
			window.alert(this.context.translate("easyTest.noSamples"));
			return false;
		}
		if (!this.matches(snapshot)) { this.changed(); return false; }
		const runGroupId = crypto.randomUUID();
		const executions = samples.map((sample) => this.execute(sample, {runGroupId}, snapshot));
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

	private testAll() {
		return this.withPreparedRun((snapshot) => this.runSamples(snapshot));
	}

	private async testAndSubmit(): Promise<void> {
		let tested: RunSnapshot | null = null;
		await this.session.testAndSubmit((cancel) => this.withPreparedRun(async (snapshot) => {
			tested = snapshot;
			return await this.runSamples(snapshot, cancel) && await this.context.paste.settled();
		}), () => {
			if (tested && this.matches(tested)) this.site.submit();
			else this.changed();
		});
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
