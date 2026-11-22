import {describe, expect, test} from "bun:test";
import type {Feature} from "@application/feature/definition";
import {editorialList} from "@features/editorial-list/index";
import {createFakeServices} from "../support/fakes";

const run = (feature: Feature, options?: unknown, overrides = {}) => feature.run(options, createFakeServices(overrides));

describe("editorialList", () => {
	const observed: Element[] = [];

	class FakeObserver {
		observe(target: Element): void {
			observed.push(target);
		}

		unobserve(): void {
		}
	}

	test("別のサイトのリンクは、同じ形のパスでも読み込まない", async () => {
		observed.length = 0;
		const original = globalThis.IntersectionObserver;
		globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
		document.body.innerHTML = `<a id="own" href="${location.origin}/contests/abc1/editorial/1">own</a>
			<a id="other" href="https://evil.example/contests/abc1/editorial/2">other</a>`;
		await run(editorialList, undefined, {
			scripts: {loadScript: async () => undefined, loadStylesheet: async () => undefined},
		});
		globalThis.IntersectionObserver = original;

		expect(observed.map(({id}) => id)).toEqual(["own"]);
	});
});
