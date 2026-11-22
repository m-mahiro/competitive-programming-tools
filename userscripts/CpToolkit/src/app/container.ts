import {judges, type RouteId} from "@catalog/judges";
import {createTranslator, type Translate} from "@catalog/messages";
import {contestCatalog, runnerCatalog} from "@catalog/tables";
import {contestPagesOf} from "@domain/contest/pages";
import {contestIdOf, type PageMatch, type SubmissionTarget} from "@domain/page/route";
import {normalizeOptions} from "@domain/settings/option";
import {type ContestTask, loadContestTasks} from "@application/contest/task-list";
import {LocalRunnerClient} from "@application/execution/local-runner";
import {RunnerCatalogService, type RunnerProvider} from "@application/execution/runner-catalog";
import type {FeatureServices} from "@application/feature/definition";
import type {JudgeSite} from "@application/ports/judge-site";
import type {SubmissionForm} from "@application/ports/submission-form";
import type {SettingsService} from "@application/settings/settings-service";
import {ShortcutActions} from "@application/shortcuts/shortcut-actions";
import {PastePipeline} from "@application/source/paste-pipeline";
import {CreateJsRatingGraph} from "@adapters/atcoder/rating-graph";
import {createJudgeSite, readPageSamples} from "@adapters/judges/index";
import {parseAtCoderTaskPage, parseCodeforcesContestPage} from "@adapters/page/contest-tasks";
import {PageCodeEditorLocator} from "@adapters/page/code-editors";
import {createSubmissionForm} from "@adapters/page/submission-form";
import {ElementScriptLoader} from "@adapters/page/element-script-loader";
import {detectLocale} from "@adapters/page/locale";
import {UnsafeWindowPageBridge} from "@adapters/page/page-bridge";
import {SameOriginHttpClient} from "@adapters/page/same-origin-http-client";
import {WorkerTicker} from "@adapters/page/worker-ticker";
import {AtCoderRunnerProvider} from "@adapters/runners/atcoder-custom-test";
import {PyodideRunnerProvider} from "@adapters/runners/pyodide";
import {LocalRunnerProvider, PaizaRunnerProvider, TextRunnerProvider} from "@adapters/runners/simple-runners";
import {WandboxRunnerProvider} from "@adapters/runners/wandbox";
import {TurndownStatementConverter} from "@adapters/statement/statement-converter";
import {GmKeyValueStore} from "@adapters/userscript/gm-key-value-store";
import {GmClipboard, GmHttpClient, GmNotifier} from "@adapters/userscript/gm-services";
import {localRunner as localRunnerFeature} from "@features/local-runner/index";

export function createTranslate(): Translate {
	return createTranslator(detectLocale);
}

/** 機能が使うサービスを組み立てる。重いものは最初に使われるまで生成しない。 */
export function createServices(
	page: PageMatch | null,
	settings: SettingsService,
	openSettings: () => void,
): FeatureServices {
	const state = new GmKeyValueStore();
	const http = new GmHttpClient();
	const site = new SameOriginHttpClient();
	const scripts = new ElementScriptLoader();
	const bridge = new UnsafeWindowPageBridge();
	const editors = new PageCodeEditorLocator();

	const localRunnerEndpoint = (): string | null => {
		const {id, defaultEnabled, options} = localRunnerFeature;
		if (!settings.isEnabled(id, defaultEnabled)) return null;
		return String(normalizeOptions(options, settings.storedOptions(id)).url);
	};
	const localRunner = new LocalRunnerClient(http, localRunnerEndpoint);

	let judgeSite: Promise<JudgeSite | null> | null = null;
	const getJudgeSite = (): Promise<JudgeSite | null> => {
		judgeSite ??= createJudgeSite(page?.judge.id, bridge, site);
		return judgeSite;
	};

	const forms = new Map<SubmissionTarget, Promise<SubmissionForm>>();
	const getSubmissionForm = (target: SubmissionTarget): Promise<SubmissionForm> => {
		let form = forms.get(target);
		if (!form) {
			form = createSubmissionForm(target, {judgeId: page?.judge.id, bridge, judgeSite: getJudgeSite});
			forms.set(target, form);
		}
		return form;
	};

	let contestTasks: Promise<readonly ContestTask[] | null> | null = null;
	const loadTasks = async (): Promise<readonly ContestTask[] | null> => {
		const judgeId = page?.judge.id;
		const contestId = contestIdOf(location.pathname);
		if (judgeId === "atcoder" && contestId) {
			return loadContestTasks(contestId, {site, state, parse: parseAtCoderTaskPage, cacheDays: contestCatalog.taskCacheDays});
		}
		const contestPage = contestPagesOf(judgeId, location.pathname)?.tasks;
		if (judgeId !== "codeforces" || !contestPage) return null;
		const response = await site.send({url: contestPage});
		return response.status === 200 ? parseCodeforcesContestPage(response.text) : null;
	};
	const getContestTasks = (): Promise<readonly ContestTask[] | null> => {
		contestTasks ??= loadTasks().catch(() => null);
		// 取得に失敗したら、次に使うときに取り直す
		void contestTasks.then((tasks) => {
			if (tasks === null) contestTasks = null;
		});
		return contestTasks;
	};

	let providers: readonly RunnerProvider[] | null = null;
	const getProviders = (): readonly RunnerProvider[] => {
		providers ??= [
			new LocalRunnerProvider(localRunner),
			new AtCoderRunnerProvider(site, getJudgeSite),
			new TextRunnerProvider(),
			new PyodideRunnerProvider(scripts),
			new PaizaRunnerProvider(http),
			new WandboxRunnerProvider(http, state),
		];
		return providers;
	};

	let converter: TurndownStatementConverter | null = null;
	let graph: CreateJsRatingGraph | null = null;

	return {
		translate: createTranslate(),
		isOnRoute: (route: RouteId) => page?.routeIds.has(route) ?? false,
		judge: page?.judge ?? null,
		state,
		clipboard: new GmClipboard(),
		notifier: new GmNotifier(),
		ticker: new WorkerTicker(),
		http,
		site,
		scripts,
		page: bridge,
		editors,
		paste: new PastePipeline(editors),
		localRunner,
		runners: new RunnerCatalogService(getProviders, runnerCatalog.order, runnerCatalog.maxRetry, runnerCatalog.external),
		judgeSite: getJudgeSite,
		submissionForm: getSubmissionForm,
		shortcuts: new ShortcutActions(),
		samples: () => readPageSamples(page?.judge.id, getJudgeSite).catch(() => []),
		contestTasks: getContestTasks,
		openSettings,
		get statementConverter() {
			converter ??= new TurndownStatementConverter();
			return converter;
		},
		get ratingGraph() {
			graph ??= new CreateJsRatingGraph();
			return graph;
		},
	};
}

export {judges};
