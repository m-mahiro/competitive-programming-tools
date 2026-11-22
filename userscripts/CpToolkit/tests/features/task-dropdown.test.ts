import {describe, expect, test} from "bun:test";
import {parseAtCoderTaskPage} from "@adapters/page/contest-tasks";
import {loadContestTasks} from "@application/contest/task-list";
import {taskDropdown} from "@features/task-dropdown/index";
import {createFakeServices, FakeHttpClient, MemoryStore} from "../support/fakes";

describe("taskDropdown", () => {
	const tasksPage = `<html><body><div id="contest-nav-tabs"></div><div class="col-sm-12"><table><tbody>
		<tr><td><a href="/contests/abc1/tasks/abc1_a">A</a></td><td><a>First</a></td></tr>
		<tr><td><a href="/contests/abc1/tasks/abc1_b">B</a></td><td><a>Second</a></td></tr>
	</tbody></table></div></body></html>`;

	const tasksFrom = (status: number, text: string) => () => loadContestTasks(location.pathname.split("/")[2] ?? "", {
		site: new FakeHttpClient(() => ({status, text})),
		state: new MemoryStore(),
		parse: parseAtCoderTaskPage,
		cacheDays: 1,
	});

	test("タブに問題の一覧を追加する", async () => {
		history.replaceState(null, "", "/contests/abc1/tasks/abc1_a");
		document.body.innerHTML = '<ul id="contest-nav-tabs-list"><li><a href="/contests/abc1/tasks">問題</a></li></ul>';
		document.querySelector("ul")!.id = "contest-nav-tabs";
		await taskDropdown.run(undefined, createFakeServices({contestTasks: tasksFrom(200, tasksPage)}));

		const labels = [...document.querySelectorAll(".cp-task-menu a")].map(({textContent}) => textContent?.trim());
		expect(labels).toEqual(["問題一覧", "まとめて開く...", "A - First", "B - Second"]);
	});

	test("読み込みに失敗したらその旨を表示する", async () => {
		history.replaceState(null, "", "/contests/abc2/tasks/abc2_a");
		document.body.innerHTML = '<ul id="contest-nav-tabs"><li><a href="/contests/abc2/tasks">問題</a></li></ul>';
		await taskDropdown.run(undefined, createFakeServices({contestTasks: tasksFrom(500, "")}));
		expect(document.querySelector(".cp-task-menu")?.textContent).toContain("読み込み失敗");
	});
});
