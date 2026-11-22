import type {RunOptions, RunResult, TestCase} from "@domain/execution/result";
import type {RunnerCatalogService} from "./runner-catalog";
import type {RunnerSelection} from "./runner-selection";

export interface TestSessionListener {
	/** 実行を始めたとき、と、実行中の件数が 0 になったときに呼ぶ。 */
	onBusyChange(): void;

	/** 提出の予定ができる、または無くなったときに呼ぶ。 */
	onSubmitChange(): void;
}

/** 実行の件数と、テスト後に提出する予定を管理する。 */
export class TestSession {
	private readonly runners: RunnerCatalogService;
	private readonly selection: RunnerSelection;
	private readonly listener: TestSessionListener;
	/** テスト後に提出する予定。中止したら別の予定と区別できるよう、実行ごとに作る。 */
	private pendingSubmit: object | null = null;
	private count = 0;
	private active = 0;

	constructor(runners: RunnerCatalogService, selection: RunnerSelection, listener: TestSessionListener) {
		this.runners = runners;
		this.selection = selection;
		this.listener = listener;
	}

	get busy(): boolean {
		return this.active > 0;
	}

	get submitPending(): boolean {
		return this.pendingSubmit !== null;
	}

	/** これから始める実行の番号を返す。 */
	nextNumber(): number {
		return ++this.count;
	}

	start(
		testCase: TestCase,
		code: string,
		runnerId: string,
		allowableError: number | undefined,
		extra: RunOptions,
	): Promise<RunResult> {
		this.active++;
		this.listener.onBusyChange();
		const options: RunOptions = {
			trim: true,
			split: true,
			...(allowableError === undefined ? {} : {allowableError}),
			...extra,
		};
		const candidates = this.selection.explicit ? this.selection.candidates.filter(({id}) => id === runnerId) : this.selection.candidates;
		return this.runners.test(candidates, runnerId, code, testCase, options).finally(() => {
			if (--this.active === 0) this.listener.onBusyChange();
		});
	}

	cancelSubmit(): void {
		this.setPendingSubmit(null);
	}

	/**
	 * 全問正解なら提出する。提出の予定があれば何もしない。ショートカットの連打で二重に提出しないようにする。
	 * `runSamples` には、予定を取り消す関数を渡す。
	 */
	async testAndSubmit(runSamples: (cancel: () => void) => Promise<boolean>, submit: () => void): Promise<void> {
		if (this.pendingSubmit) return;
		const pending = {};
		const cancel = (): void => {
			if (this.pendingSubmit === pending) this.setPendingSubmit(null);
		};
		this.setPendingSubmit(pending);
		try {
			const passed = await runSamples(cancel);
			if (passed && this.pendingSubmit === pending) submit();
		} finally {
			cancel();
		}
	}

	private setPendingSubmit(pending: object | null): void {
		this.pendingSubmit = pending;
		this.listener.onSubmitChange();
	}
}
