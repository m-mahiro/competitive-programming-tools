// 保存済みの AtCoder Problems 公開データから、通常の URL 復元規則との差分だけを生成する。
import fs from "node:fs";
import {fileURLToPath} from "node:url";

type ContestProblem = {contest_id: string; problem_id: string; problem_index: string};
type Problem = {id: string; contest_id: string};
type ContestRule = {taskPrefix?: string; tasks?: Record<string, string>};

const [contestProblemsPath, problemsPath, verifiedOn] = process.argv.slice(2);
if (!contestProblemsPath || !problemsPath || !/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn ?? "")) {
	throw new Error(
		"Usage: bun scripts/generate-atcoder-task-exceptions.ts <contest-problem.json> <problems.json> <YYYY-MM-DD>",
	);
}

function readJson<T>(file: string): T {
	return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as T;
}

function sorted<T>(entries: Iterable<[string, T]>): Record<string, T> {
	return Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

const excludedContestPrefixes = ["adt_"];
const included = (contestId: string) => !excludedContestPrefixes.some((prefix) => contestId.startsWith(prefix));
const rows = readJson<ContestProblem[]>(contestProblemsPath).filter((row) => included(row.contest_id));
const problems = readJson<Problem[]>(problemsPath).filter((problem) => included(problem.contest_id));
const groups = new Map<string, ContestProblem[]>();
const hostsByTask = new Map<string, Set<string>>();
for (const row of rows) {
	const group = groups.get(row.contest_id) ?? [];
	group.push(row);
	groups.set(row.contest_id, group);
	const hosts = hostsByTask.get(row.problem_id) ?? new Set<string>();
	hosts.add(row.contest_id);
	hostsByTask.set(row.problem_id, hosts);
}

const contests = new Map<string, ContestRule>();
const contestNames = new Map<string, string>();
for (const [contestId, group] of groups) {
	if (contestId !== contestId.toLowerCase()) contestNames.set(contestId.toLowerCase(), contestId);
	const prefixes = new Map<string, number>();
	for (const row of group) {
		const suffix = `_${row.problem_index.toLowerCase()}`;
		if (!row.problem_id.endsWith(suffix)) continue;
		const prefix = row.problem_id.slice(0, -suffix.length);
		prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
	}
	// 全問題で最もよく使われる接頭辞を採用し、それでも合わない問題を個別に記録する。
	const taskPrefix = [...prefixes].sort(([a, ac], [b, bc]) => bc - ac || (a < b ? -1 : 1))[0]?.[0] ?? contestId;
	const tasks = new Map<string, string>();
	const seen = new Map<string, string>();
	for (const row of group) {
		const index = row.problem_index.toLowerCase();
		if (seen.has(index) && seen.get(index) !== row.problem_id) {
			throw new Error(`Conflicting task index: ${contestId}/${index}`);
		}
		seen.set(index, row.problem_id);
		if (row.problem_id !== `${taskPrefix}_${index}`) tasks.set(index, row.problem_id);
	}
	const rule: ContestRule = {};
	if (taskPrefix !== contestId) rule.taskPrefix = taskPrefix;
	if (tasks.size) rule.tasks = sorted(tasks);
	if (Object.keys(rule).length) contests.set(contestId, rule);
}

// 正式IDの接頭辞が開催回と違う場合に、完全指定用のコンテストを記録する。
// ARC のように接頭辞のコンテストにも掲載されていれば、そちらを優先する。
const ownerGroups = new Map<string, Array<{taskId: string; contestId: string}>>();
const taskContests = new Map<string, string>();
for (const problem of problems) {
	const separator = problem.id.lastIndexOf("_");
	const hosts = hostsByTask.get(problem.id);
	if (!hosts?.has(problem.contest_id)) throw new Error(`Missing primary contest: ${problem.id}`);
	if (separator <= 0) {
		taskContests.set(problem.id, problem.contest_id);
		continue;
	}
	const prefix = problem.id.slice(0, separator);
	const contestId = hosts.has(prefix) ? prefix : problem.contest_id;
	const group = ownerGroups.get(prefix) ?? [];
	group.push({taskId: problem.id, contestId});
	ownerGroups.set(prefix, group);
}
const taskContestPrefixes = new Map<string, string>();
for (const [prefix, group] of ownerGroups) {
	const counts = new Map<string, number>();
	for (const row of group) counts.set(row.contestId, (counts.get(row.contestId) ?? 0) + 1);
	const owner = [...counts].sort(([a, ac], [b, bc]) => bc - ac || (a < b ? -1 : 1))[0][0];
	if (owner !== prefix) taskContestPrefixes.set(prefix, owner);
	for (const row of group) if (row.contestId !== owner) taskContests.set(row.taskId, row.contestId);
}

const output = {
	metadata: {
		verifiedOn,
		sources: [
			"https://kenkoooo.com/atcoder/resources/contest-problem.json",
			"https://kenkoooo.com/atcoder/resources/problems.json",
		],
		excludedContestPrefixes,
		contestCount: groups.size,
		taskCount: rows.length,
	},
	contestNames: sorted(contestNames),
	contests: sorted(contests),
	taskContestPrefixes: sorted(taskContestPrefixes),
	taskContests: sorted(taskContests),
};
const outputPath = fileURLToPath(new URL("../data/atcoder-task-exceptions.json", import.meta.url));
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, "\t")}\n`);
console.log(`Verified ${groups.size} contests / ${rows.length} tasks; wrote ${contests.size} contest rules.`);
