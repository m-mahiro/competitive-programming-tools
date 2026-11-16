import path from "node:path";
import exceptions from "../../data/atcoder-task-exceptions.json";
import type {AtCoderTaskId} from "@atcoder-tools/shared";

type ContestRule = {
	taskPrefix?: string;
	tasks?: Readonly<Record<string, string>>;
};

const contests: Readonly<Record<string, ContestRule>> = exceptions.contests;
const contestNames: Readonly<Record<string, string>> = exceptions.contestNames;
const taskContestPrefixes: Readonly<Record<string, string>> = exceptions.taskContestPrefixes;
const taskContests: Readonly<Record<string, string>> = exceptions.taskContests;

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** 公式コンテスト名の大文字・小文字を復元する。 */
export function resolveContestId(contestId: string): string {
	const key = contestId.toLowerCase();
	return own(contestNames, key) ?? key;
}

/** ローカルで指定した問題記号を、実際の taskScreenName に復元する。通信は行わない。 */
export function resolveTaskScreenName(contestId: string, taskIndex: string): string {
	contestId = resolveContestId(contestId);
	const index = taskIndex.toLowerCase();
	const rule = own(contests, contestId);
	return (rule?.tasks && own(rule.tasks, index)) ?? `${rule?.taskPrefix ?? contestId}_${index}`;
}

/** 正式なタスクIDを保ち、接頭辞と異なる開催回だけを JSON から復元する。 */
export function parseLocalTaskScreenName(taskScreenName: string): AtCoderTaskId | null {
	if (!/^[A-Za-z0-9_-]+$/.test(taskScreenName)) return null;
	const explicitContest = own(taskContests, taskScreenName);
	if (explicitContest) return {contestId: explicitContest, taskId: taskScreenName};
	const separator = taskScreenName.lastIndexOf("_");
	if (separator <= 0 || separator === taskScreenName.length - 1) return null;
	const prefix = taskScreenName.slice(0, separator);
	const contestId = own(taskContestPrefixes, prefix)
		?? resolveContestId(prefix);
	return {contestId, taskId: taskScreenName};
}

/** ファイル名の拡張子と、最後の `_` 以降の実装名を除いた問題記号を返す。 */
export function taskIndexFromSourceArg(sourceArg: string): string {
	const stem = path.basename(sourceArg, path.extname(sourceArg));
	const separator = stem.lastIndexOf("_");
	const index = separator >= 0 ? stem.slice(0, separator) : stem;
	if (!/^[a-z0-9_]+$/i.test(index) || separator === stem.length - 1) {
		throw new Error(`Could not infer the task from "${sourceArg}". Use <taskScreenName> <sourceFile>.`);
	}
	return index.toLowerCase();
}
