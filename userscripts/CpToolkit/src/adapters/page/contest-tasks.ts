import type {ContestTask} from "@application/contest/task-list";

/** AtCoder の問題一覧のページから、問題を順番どおりに読む。 */
export function parseAtCoderTaskPage(html: string): readonly ContestTask[] {
	const page = new DOMParser().parseFromString(html, "text/html");
	return [...page.querySelectorAll("#contest-nav-tabs + .col-sm-12 tbody tr")].flatMap((row) => {
		const [labelCell, nameCell] = row.querySelectorAll("td");
		const link = labelCell?.querySelector("a");
		const url = link?.getAttribute("href");
		if (!link || !url) return [];
		return [{url, label: link.textContent ?? "", name: nameCell?.textContent?.trim() ?? ""}];
	});
}

/** Codeforces のコンテストのページ(問題の表)から、問題を順番どおりに読む。 */
export function parseCodeforcesContestPage(html: string): readonly ContestTask[] {
	const page = new DOMParser().parseFromString(html, "text/html");
	return [...page.querySelectorAll("table.problems tr")].flatMap((row) => {
		const link = row.querySelector("td.id a");
		const url = link?.getAttribute("href");
		if (!link || !url) return [];
		const name = row.querySelectorAll("td")[1]?.querySelector("a")?.textContent?.trim() ?? "";
		return [{url, label: link.textContent?.trim() ?? "", name}];
	});
}
