import {describe, expect, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import {averageResult} from "@features/average-result/index";
import {createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("averageResult", () => {
	const table = (rows: string) => `<table></table><table></table><table></table><table></table>
		<table><tbody>${rows}</tbody></table>`;

	test("テストケースの平均を先頭の行に追加する", async () => {
		document.body.innerHTML = table(`
			<tr><td>01</td><td>AC</td><td>10 ms</td><td>100 KiB</td></tr>
			<tr><td>02</td><td>TLE</td><td>2000 ms</td><td>300 KiB</td></tr>`);
		const dispose = await run(averageResult);

		const cells = document.querySelector("tbody tr")?.querySelectorAll("td");
		expect(cells?.[1]?.textContent).toBe("1/2");
		expect(cells?.[2]?.textContent).toBe("1005+ ms");
		expect(cells?.[3]?.textContent).toBe("200 KiB");
		dispose?.();
		expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
	});

	test("テストケースの表がなければ何もしない", async () => {
		document.body.innerHTML = "<table><tbody><tr><td>1</td></tr></tbody></table>";
		await run(averageResult);
		expect(document.querySelectorAll("tr")).toHaveLength(1);
	});
});
