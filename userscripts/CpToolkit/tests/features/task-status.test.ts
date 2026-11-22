import {beforeEach, describe, expect, test} from "bun:test";
import type {Feature, FeatureServices} from "@application/feature/definition";
import {taskStatus} from "@features/task-status/index";
import {createFakePage, createFakeServices, FakeHttpClient} from "../support/fakes";

const HOUR_MS = 60 * 60 * 1000;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const run = (feature: Feature, overrides: Partial<FeatureServices> = {}, options?: unknown) => {
	return feature.run(options, createFakeServices(overrides));
};

function setFocus(focused: boolean): void {
	document.hasFocus = () => focused;
}

beforeEach(() => {
	setFocus(false);
});

describe("taskStatus", () => {
	const submissionRow = (task: string, score: number, status: string) => `<tr>
		<td>2026-11-01</td><td><a href="/contests/abc1/tasks/abc1_${task}">${task}</a></td>
		<td><a href="/users/me">me</a></td><td>C++</td>
		<td class="submission-score">${score}</td><td>100 Byte</td><td><span class="label">${status}</span></td>
	</tr>`;
	const submissionPage = (rows: string, lastPage = 1) => `<div class="table-responsive"><table><tbody>${rows}</tbody></table></div>
		<ul class="pagination">${Array.from({length: lastPage}, (_, i) => `<li><a href="/contests/abc1/submissions/me?page=${i + 1}">${i + 1}</a></li>`).join("")}</ul>`;
	const submissions = submissionPage(submissionRow("a", 100, "AC") + submissionRow("b", 0, "WA"));
	const taskRow = (id: string) => `<tr><td><a href="/contests/abc1/tasks/abc1_${id}">${id}</a></td></tr>`;
	const classOf = (selector: string) => document.querySelector(selector)?.className;

	beforeEach(() => history.replaceState(null, "", "/contests/abc1/tasks"));

	test("問題一覧の行を結果に合わせて色分けする", async () => {
		document.body.innerHTML = `<div id="main-container"><table><tbody>
			${taskRow("a")}${taskRow("b")}${taskRow("c")}
		</tbody></table></div>`;
		const site = new FakeHttpClient(() => ({status: 200, text: submissions}));
		await run(taskStatus, {
			isOnRoute: (route) => route === "atcoder:tasks",
			page: createFakePage(),
			site,
		});
		await flush();

		expect(site.requests[0]?.url).toBe("/contests/abc1/submissions/me?page=1");
		expect(classOf("tr:nth-child(1)")).toBe("cp-task-accepted");
		expect(classOf("tr:nth-child(2)")).toBe("cp-task-rejected");
		expect(classOf("tr:nth-child(3)")).toBe("");
		expect(document.documentElement.style.getPropertyValue("--cp-task-accepted")).toBe("#c3e6cb");
	});

	test("コンテスト後の提出も含め、全ページを読んで1回でも正解した問題を正解とする", async () => {
		document.body.innerHTML = `<div id="main-container"><table><tbody>
			${taskRow("a")}${taskRow("b")}${taskRow("c")}${taskRow("d")}
		</tbody></table></div>`;
		const pages: Record<string, string> = {
			1: submissionPage(submissionRow("a", 0, "WA") + submissionRow("c", 0, "WJ"), 2),
			2: submissionPage(submissionRow("a", 100, "AC") + submissionRow("b", 50, "WA") + submissionRow("d", 0, "TLE"), 2),
		};
		const site = new FakeHttpClient((request) => ({
			status: 200,
			text: pages[/page=(\d+)/.exec(request.url)?.[1] ?? ""] ?? "",
		}));
		await run(taskStatus, {
			isOnRoute: (route) => route === "atcoder:tasks",
			page: createFakePage(),
			site,
		});
		await flush();
		await flush();

		expect(site.requests.map(({url}) => url)).toEqual([
			"/contests/abc1/submissions/me?page=1",
			"/contests/abc1/submissions/me?page=2",
		]);
		expect(classOf("tr:nth-child(1)")).toBe("cp-task-accepted");
		expect(classOf("tr:nth-child(2)")).toBe("cp-task-accepted");
		expect(classOf("tr:nth-child(3)")).toBe("");
		expect(classOf("tr:nth-child(4)")).toBe("cp-task-rejected");
	});

	test("ページ送りが前後のリンクだけでも、最後のページまで読む", async () => {
		document.body.innerHTML = `<div id="main-container"><table><tbody>
			${taskRow("a")}${taskRow("b")}
		</tbody></table></div>`;
		const pagerLink = (page: number, label: string, exists: boolean) => {
			const href = exists ? ` href="/contests/abc1/submissions/me?page=${page}"` : "";
			return `<li${exists ? "" : ' class="disabled"'}><a${href}>${label}</a></li>`;
		};
		const pagerPage = (rows: string, page: number, lastPage: number) => `<div class="table-responsive">
			<table><tbody>${rows}</tbody></table></div>
			<nav><ul class="pager">
				${pagerLink(page - 1, "&lt; Prev", page > 1)}${pagerLink(page + 1, "Next &gt;", page < lastPage)}
			</ul></nav>`;
		const pages: Record<string, string> = {
			1: pagerPage(submissionRow("a", 0, "WA"), 1, 3),
			2: pagerPage(submissionRow("b", 0, "WA"), 2, 3),
			3: pagerPage(submissionRow("a", 100, "AC"), 3, 3),
		};
		const site = new FakeHttpClient((request) => ({
			status: 200,
			text: pages[/page=(\d+)/.exec(request.url)?.[1] ?? ""] ?? "",
		}));
		await run(taskStatus, {
			isOnRoute: (route) => route === "atcoder:tasks",
			page: createFakePage(),
			site,
		});
		await flush();
		await flush();
		await flush();

		expect(site.requests.map(({url}) => url)).toEqual([
			"/contests/abc1/submissions/me?page=1",
			"/contests/abc1/submissions/me?page=2",
			"/contests/abc1/submissions/me?page=3",
		]);
		expect(classOf("tr:nth-child(1)")).toBe("cp-task-accepted");
		expect(classOf("tr:nth-child(2)")).toBe("cp-task-rejected");
	});

	test("途中のページを読めなかったら、正解だけを塗り、不正解とは決めない", async () => {
		document.body.innerHTML = `<div id="main-container"><table><tbody>
			${taskRow("a")}${taskRow("b")}
		</tbody></table></div>`;
		// a の正解は、読めなかった2ページ目にあるかもしれない
		const firstPage = submissionPage(submissionRow("a", 0, "WA") + submissionRow("b", 100, "AC"), 2);
		const site = new FakeHttpClient((request) => {
			return request.url.endsWith("page=1") ? {status: 200, text: firstPage} : {status: 429, text: ""};
		});
		await run(taskStatus, {
			isOnRoute: (route) => route === "atcoder:tasks",
			page: createFakePage(),
			site,
		});
		await flush();
		await flush();

		expect(site.requests).toHaveLength(2);
		expect(classOf("tr:nth-child(1)")).toBe("");
		expect(classOf("tr:nth-child(2)")).toBe("cp-task-accepted");
	});

	test("ドロップダウンは開くまで取得せず、取得は1回にする", async () => {
		document.body.innerHTML = `<div id="contest-nav-tabs"><ul><li class="dropdown">
			<a id="toggle" href="#">Tasks</a>
			<ul class="cp-task-menu"><li><a href="/contests/abc1/tasks/abc1_a">A</a></li></ul>
		</li></ul></div>`;
		const site = new FakeHttpClient(() => ({status: 200, text: submissions}));
		await run(taskStatus, {isOnRoute: () => false, page: createFakePage(), site});
		expect(site.requests).toHaveLength(0);

		const hover = () => document.querySelector("#toggle")?.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
		hover();
		hover();
		await flush();
		expect(site.requests).toHaveLength(1);
		expect(classOf(".cp-task-menu li")).toBe("cp-task-accepted");
	});

	test("提出一覧の表は、ドロップダウンを開いても色分けしない", async () => {
		history.replaceState(null, "", "/contests/abc1/submissions/me");
		document.body.innerHTML = `<div id="contest-nav-tabs"><ul><li class="dropdown">
			<a id="toggle" href="#">Tasks</a>
			<ul class="cp-task-menu"><li id="item"><a href="/contests/abc1/tasks/abc1_a">A</a></li></ul>
		</li></ul></div>
		<div id="main-container"><table><tbody>${taskRow("a")}</tbody></table></div>`;
		const site = new FakeHttpClient(() => ({status: 200, text: submissions}));
		await run(taskStatus, {isOnRoute: () => false, page: createFakePage(), site});

		document.querySelector("#toggle")?.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
		await flush();

		expect(classOf("#item")).toBe("cp-task-accepted");
		expect(classOf("#main-container tr")).toBe("");
	});

	test("混み合う開始直後は取得しない", async () => {
		const site = new FakeHttpClient(() => ({status: 200, text: submissions}));
		const period = {startMs: Date.now() - 60 * 1000, endMs: Date.now() + HOUR_MS};
		await run(taskStatus, {
			isOnRoute: () => true,
			page: createFakePage({contestPeriod: () => period}),
			site,
		});
		expect(site.requests).toHaveLength(0);
	});

	test("ログインしていなければ取得しない", async () => {
		const site = new FakeHttpClient(() => ({status: 200, text: submissions}));
		await run(taskStatus, {
			isOnRoute: () => true,
			page: createFakePage({isLoggedIn: () => false}),
			site,
		});
		expect(site.requests).toHaveLength(0);
	});
});
