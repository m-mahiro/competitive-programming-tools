import {describe, expect, mock, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import {submissionQuery} from "@features/submission-query/index";
import {createFakePage, createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("submissionQuery", () => {
	test("検索条件を提出ページのタブへ引き継ぐ", async () => {
		history.replaceState(null, "", "/contests/abc420/submissions?f.Task=abc420_a&f.Status=AC");
		document.body.innerHTML = `<div id="main-container"><div class="row"><div></div><div><ul>
			<li><a href="/contests/abc420/submissions">すべての提出</a></li>
			<li><a href="/contests/abc420/submissions/me">自分の提出</a></li>
		</ul></div></div></div>`;
		await run(submissionQuery);

		const hrefs = [...document.querySelectorAll("a")].map((link) => link.getAttribute("href"));
		expect(hrefs).toEqual([
			"/contests/abc420/submissions?f.Task=abc420_a&f.Status=AC",
			"/contests/abc420/submissions/me?f.Task=abc420_a&f.Status=AC",
		]);
	});

	const renderLanguageFilter = (language: string | null): HTMLSelectElement => {
		const query = new URLSearchParams({"f.Task": "abc420_a", "f.Status": "AC", orderBy: "source_length"});
		if (language !== null) query.set("f.LanguageName", language);
		history.replaceState(null, "", `/contests/abc420/submissions?${query}`);
		document.body.innerHTML = `<select id="select-language" name="f.LanguageName">
			<option value=""></option><option value="Python">Python</option>
			<option value="JavaScript">JavaScript</option><option value="C++">C++</option>
		</select>`;
		return document.querySelector<HTMLSelectElement>("#select-language")!;
	};

	test.each([
		["python", "Python"], ["PYTHON", "Python"], ["Python", "Python"],
		["javascript", "JavaScript"], ["c++", "C++"],
	])("%s の検索条件を言語欄にも表示する", async (language, expected) => {
		const select = renderLanguageFilter(language);
		const search = location.search;
		const triggerChange = mock((_element: object) => undefined);
		await run(submissionQuery, undefined, {page: createFakePage({triggerChange})});
		expect(select.value).toBe(expected);
		expect(triggerChange).toHaveBeenCalledWith(select);
		expect(location.search).toBe(search);
		const form = document.createElement("form");
		form.append(select);
		expect(new FormData(form).get("f.LanguageName")).toBe(expected);
	});

	test.each([null, "", "py", "unknown"])("言語が %s なら選択欄を変更しない", async (language) => {
		const select = renderLanguageFilter(language);
		const triggerChange = mock((_element: object) => undefined);
		await run(submissionQuery, undefined, {page: createFakePage({triggerChange})});
		expect(select.value).toBe("");
		expect(triggerChange).not.toHaveBeenCalled();
	});

	test("ページが選択済みの値は変更しない", async () => {
		const select = renderLanguageFilter("python");
		select.value = "C++";
		const triggerChange = mock((_element: object) => undefined);
		await run(submissionQuery, undefined, {page: createFakePage({triggerChange})});
		expect(select.value).toBe("C++");
		expect(triggerChange).not.toHaveBeenCalled();
	});
});
