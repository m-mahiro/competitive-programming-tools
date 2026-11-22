/** ショートカットキーで開く、コンテストのページ。 */
export type ContestPages = {
	readonly tasks: string;
	readonly mySubmissions: string;
	readonly standings: string;
	/** 解説の一覧。問題のページなら、その問題の解説。サイトに無ければ null。 */
	readonly editorial: string | null;
	readonly customTest: string;
};

const ATCODER_CONTEST = /^\/contests\/([^/?#]+)/;
const ATCODER_TASK = /^\/contests\/[^/]+\/tasks\/([^/?#]+)/;
/** グループのコンテストと Gym を含む。問題集の問題は、元のコンテストのページを開く。 */
const CODEFORCES_CONTEST = /^\/(?:group\/[^/]+\/)?(?:contest|gym)\/\d+/;
const CODEFORCES_PROBLEMSET = /^\/problemset\/problem\/(\d+)\//;

/** 表示中のページが属するコンテストの、各ページの URL(パス)。コンテストの外なら null。 */
export function contestPagesOf(judgeId: string | undefined, pathname: string): ContestPages | null {
	if (judgeId === "atcoder") {
		const contest = ATCODER_CONTEST.exec(pathname)?.[1];
		if (!contest || contest === "archive") return null;
		const base = `/contests/${contest}`;
		const task = ATCODER_TASK.exec(pathname)?.[1];
		return {
			tasks: `${base}/tasks`,
			mySubmissions: `${base}/submissions/me`,
			standings: `${base}/standings`,
			editorial: task ? `${base}/tasks/${task}/editorial` : `${base}/editorial`,
			customTest: `${base}/custom_test`,
		};
	}
	if (judgeId === "codeforces") {
		const problemset = CODEFORCES_PROBLEMSET.exec(pathname)?.[1];
		const base = problemset ? `/contest/${problemset}` : CODEFORCES_CONTEST.exec(pathname)?.[0];
		if (!base) return null;
		return {
			tasks: base,
			mySubmissions: `${base}/my`,
			standings: `${base}/standings`,
			editorial: null,
			customTest: `${base}/customtest`,
		};
	}
	return null;
}

const TASK_PATHS = [
	/^\/contests\/([^/]+)\/tasks\/([^/?#]+)/,
	/^\/(?:group\/[^/]+\/)?(?:contest|gym)\/(\d+)\/problem\/([^/?#]+)/,
	/^\/problemset\/problem\/(\d+)\/([^/?#]+)/,
];

/** 問題のページなら、コンテストと問題の組。URL の書き方が違っても同じ問題なら同じ値になる。 */
export function taskKeyOf(pathname: string): string | null {
	for (const pattern of TASK_PATHS) {
		const match = pattern.exec(pathname);
		if (match) return `${match[1]}/${match[2]?.toLowerCase()}`;
	}
	return null;
}

const ORIGIN = /^[a-z]+:\/\/[^/]+/i;

type TaskLink = {
	readonly url: string;
	readonly label: string;
};

/** 表示中の問題から offset だけ離れた問題。端を越えるか、表示中の問題が一覧に無ければ null。 */
export function neighborTask<T extends TaskLink>(tasks: readonly T[], pathname: string, offset: number): T | null {
	const current = taskKeyOf(pathname);
	if (current === null) return null;
	const index = tasks.findIndex((task) => taskKeyOf(task.url.replace(ORIGIN, "")) === current);
	if (index < 0) return null;
	return tasks[index + offset] ?? null;
}

/**
 * 問題の記号が letter の問題。記号が完全に一致するものを優先し、無ければ letter で始まる最初の問題(Codeforces の C1 など)。
 * 大文字と小文字は区別しない。
 */
export function taskByLetter<T extends TaskLink>(tasks: readonly T[], letter: string): T | null {
	const wanted = letter.toLowerCase();
	const label = (task: T) => task.label.trim().toLowerCase();
	return tasks.find((task) => label(task) === wanted) ?? tasks.find((task) => label(task).startsWith(wanted)) ?? null;
}
