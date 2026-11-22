import {describe, expect, mock, test} from "bun:test";
import {paizaLanguage} from "@features/paiza-language/index";
import {createFakePage, createFakeServices} from "../support/fakes";
import {wait} from "../support/dom";

describe("paizaLanguage", () => {
	test("指定した言語を選び、隠し項目にも反映する", async () => {
		document.body.innerHTML = `<select id="language_id">
			<option value=""></option><option value="1">JavaScript</option><option value="2">Java (OpenJDK 21)</option>
		</select><input id="programming_language_id" type="hidden">`;
		const triggerChange = mock(() => undefined);
		const page = createFakePage({triggerChange});
		void paizaLanguage.run({language: "Java"}, createFakeServices({
			page,
			judge: null,
			editors: {locate: async () => null}
		}));
		await wait();

		expect(document.querySelector<HTMLSelectElement>("#language_id")?.value).toBe("2");
		expect(document.querySelector<HTMLInputElement>("#programming_language_id")?.value).toBe("2");
		expect(triggerChange).toHaveBeenCalled();
	});

	test("言語が未設定なら何もしない", async () => {
		document.body.innerHTML = `<select id="language_id">
			<option value=""></option><option value="1">JavaScript</option><option value="2">Java (OpenJDK 21)</option>
		</select>`;
		const triggerChange = mock(() => undefined);
		const locate = mock(async () => null);
		void paizaLanguage.run({language: " "}, createFakeServices({
			page: createFakePage({triggerChange}),
			judge: null,
			editors: {locate}
		}));
		await wait();

		expect(document.querySelector<HTMLSelectElement>("#language_id")?.value).toBe("");
		expect(triggerChange).not.toHaveBeenCalled();
		expect(locate).not.toHaveBeenCalled();
	});
});
