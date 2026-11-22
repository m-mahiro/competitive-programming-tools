import type {JudgeLanguage} from "@domain/execution/result";
import {isRecordOf, isString} from "@domain/validation/guards";
import {type KeyValueStore, readStored} from "@application/ports/key-value-store";
import type {CodeRunner, RunnerCatalogService} from "./runner-catalog";

const RUNNER_SELECTION_KEY = "easy-test:runner-selection";

/** 選んだ実行環境を表示する側。 */
export interface EnvironmentView {
	show(candidates: readonly CodeRunner[], selected: string | undefined): void;
}

/** サイトで選んだ言語に合わせて、実行環境の候補と、その中から選ぶものを決める。 */
export class RunnerSelection {
	private readonly language: () => JudgeLanguage | null;
	private readonly runners: RunnerCatalogService;
	private readonly state: KeyValueStore;
	private current: readonly CodeRunner[] = [];
	get explicit(): string | undefined {
		const language = this.language();
		return language ? this.selections()[language.id] : undefined;
	}
	private refreshing: Promise<void> = Promise.resolve();

	constructor(language: () => JudgeLanguage | null, runners: RunnerCatalogService, state: KeyValueStore) {
		this.language = language;
		this.runners = runners;
		this.state = state;
	}

	get candidates(): readonly CodeRunner[] {
		return this.current;
	}

	/** Local Runner の実行環境。使えないときは undefined。 */
	local(): CodeRunner | undefined {
		return this.current.find(({kind}) => kind === "local");
	}

	/** 候補が更新し終わるのを待つ。 */
	settled(): Promise<void> {
		return this.refreshing;
	}

	/** 言語の切り替えと実行が重なっても、最新の状態になるよう順番に更新する。 */
	refresh(view: EnvironmentView): Promise<void> {
		this.refreshing = this.refreshing.then(() => this.load(view));
		return this.refreshing;
	}

	/** 選んだ実行環境を、いまの言語に対して記憶する。 */
	remember(runnerId: string): void {
		const language = this.language();
		if (!language) return;
		const next = {...this.selections()};
		if (runnerId) next[language.id] = runnerId;
		else delete next[language.id];
		this.state.set(RUNNER_SELECTION_KEY, next);
	}

	private selections(): Readonly<Record<string, string>> {
		return readStored(this.state, RUNNER_SELECTION_KEY, isRecordOf(isString), {});
	}

	private async load(view: EnvironmentView): Promise<void> {
		const language = this.language();
		const candidates = language ? await this.runners.candidates(language) : [];
		if (this.language()?.id !== language?.id) return;
		this.current = candidates;
		const preferred = candidates.find(({kind}) => kind === "local") ?? candidates[0];
		view.show(candidates, this.explicit ?? preferred?.id);
	}
}
