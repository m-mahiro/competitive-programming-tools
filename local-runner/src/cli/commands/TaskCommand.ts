import type {LocalRunnerHeaderOption} from "@atcoder-tools/shared";
import type {Task} from "../../types";
import * as atcoder from "../atcoder";
import type {SourceLanguage} from "../language";
import * as parser from "../parser";
import * as taskUtils from "../task";
import {inferTask} from "../localTask";
import * as sampleJudge from "../sampleJudge";
import * as sampleCache from "../sampleCache";
import {CliUsageError, type Command} from "./Command";
import * as options from "./options";
import * as source from "./source";

/**
 * サンプルケースと実行時間制限を取得する。キャッシュにあればそれを使い、無ければ問題ページを
 * フェッチして抽出・保存する。サンプルは不変なので test → submit の二重取得を避けられる。
 */
async function getSamplesWithCache(task: Task, cookieHeader: string): Promise<sampleCache.CachedTaskData> {
	const cached = sampleCache.readCachedSamples(task);
	if (cached) return cached;
	const taskHtml = await atcoder.httpGetText(task.taskUrl, cookieHeader);
	const samples = parser.extractSamples(taskHtml);
	const timeLimitMs = parser.extractTimeLimitMs(taskHtml);
	sampleCache.writeCachedSamples(task, samples, timeLimitMs);
	return {samples, timeLimitMs};
}

/** サンプル実行を終えた時点で onSamplesComplete に渡すコンテキスト。 */
export type TaskRunContext = {
	task: Task;
	language: SourceLanguage;
	transformed: string;
	allAccepted: boolean;
	force: boolean;
};

/**
 * test / submit の共通テンプレート。
 * 「ソース整形 → サンプル取得 → ローカル実行 → 結果表示」までを担い、
 * その後の振る舞い（test は終了、submit は提出）をサブクラスの onSamplesComplete に委ねる。
 */
export abstract class TaskCommand implements Command {
	abstract readonly name: string;
	abstract readonly usageLines: readonly string[];
	/** -f/--force を受け付けるか（submit のみ true）。 */
	protected abstract readonly allowForce: boolean;
	/** DEBUG 有効化の既定値（test は true、submit は本番なので false）。-d/--debug で上書き可。 */
	protected abstract readonly debug: boolean;
	/** -d/--debug=true/false を受け付けるか（test のみ true。submit は本番なので不可）。 */
	protected readonly supportsDebugOption: boolean = false;
	/** --full / --wa-only の表示オプションを受け付けるか（test / submit は true）。 */
	protected readonly supportsDisplayOptions: boolean = false;
	/** 提出用ヘッダーを付け、--no-header / --header=<名前> を受け付けるか（test と submit は true）。 */
	protected readonly supportsHeaderOption: boolean = false;

	async execute(args: readonly string[]): Promise<number> {
		const {task, sourceFilePath, force, debug, header, display, lang} = this.validate(args);
		const {transformed, language, program, restoreNames} = await source.compileSource(sourceFilePath, debug, {header, lang});

		const cookieHeader = atcoder.toCookieHeader();
		const {samples, timeLimitMs} = await getSamplesWithCache(task, cookieHeader);
		// 問題の実行時間制限が分かれば、exec 表示の警告しきい値（80%で黄、100%で赤）に使う。
		if (timeLimitMs) {
			display.timeLimitMs = timeLimitMs;
			console.log(`Time limit: ${timeLimitMs}ms`);
		}
		const allPassed = await sampleJudge.runAndReportSamples(program, samples, restoreNames, display);
		// サンプルが無いときや、期待出力の無いサンプルがあるときは、全件 AC とはみなさない。
		const allAccepted = allPassed && samples.length > 0 && samples.every(({expectedOutput}) => typeof expectedOutput === "string");

		return this.onSamplesComplete({task, language, transformed, allAccepted, force});
	}

	/** サンプル実行後の処理。終了コードを返す。 */
	protected abstract onSamplesComplete(ctx: TaskRunContext): Promise<number> | number;

	/** 引数を検証して Task・ソースパス・各オプションへ正規化する（短縮表記の展開もここで行う）。 */
	private validate(args: readonly string[]): {
		task: Task;
		sourceFilePath: string;
		force: boolean;
		debug: boolean;
		header: LocalRunnerHeaderOption;
		display: sampleJudge.SampleDisplayOptions;
		lang: string | undefined;
	} {
		const positionals: string[] = [];
		let force = false;
		let debug = this.debug; // 既定値。-d/--debug があれば上書き。
		let header: LocalRunnerHeaderOption = this.supportsHeaderOption;
		const display: sampleJudge.SampleDisplayOptions = {};
		let lang: string | undefined;
		for (const arg of args) {
			const l = options.parseLangFlag(arg);
			if (l !== undefined) {
				lang = l;
				continue;
			}
			if (arg === "-f" || arg === "--force") {
				// test は提出しないので force を受け付けない。
				if (!this.allowForce) {
					throw new CliUsageError("-f/--force is only supported with the submit and tomain commands.");
				}
				force = true;
				continue;
			}
			if (this.supportsDebugOption) {
				const d = options.parseBoolFlag(arg, "--debug", "-d");
				if (d !== undefined) {
					debug = d;
					continue;
				}
			}
			if (this.supportsHeaderOption) {
				const h = options.parseHeaderFlag(arg);
				if (h !== undefined) {
					header = h;
					continue;
				}
			}
			if (this.supportsDisplayOptions && options.parseDisplayFlag(arg, display, {timeLimit: false})) continue;
			if (arg.startsWith("-")) throw new CliUsageError(`Unknown option: ${arg}`);
			positionals.push(arg);
		}

		let task: Task | undefined;
		let sourceFilePath: string | undefined;
		if (positionals.length === 1) {
			sourceFilePath = positionals[0];
			task = inferTask(sourceFilePath);
		} else {
			let taskScreenName: string | undefined;
			[taskScreenName, sourceFilePath] = positionals;
			if (taskScreenName) task = taskUtils.parseTask(taskScreenName);
		}
		if (!task || !sourceFilePath) {
			throw new CliUsageError();
		}
		return {task, sourceFilePath, force, debug, header, display, lang};
	}
}
