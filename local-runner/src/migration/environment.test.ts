import {describe, expect, test} from "bun:test";
import {legacyEnvironmentWarnings} from "./environment";

const file = "/tools/local-runner.settings.json";

describe("legacyEnvironmentWarnings", () => {
	test("設定されている古い環境変数だけを、値を出さずに案内する", () => {
		const warnings = legacyEnvironmentWarnings({
			LOCAL_RUNNER_PORT: "9000",
			ATCODER_SESSION: "secret-value",
			LOCAL_RUNNER_BACKEND: "",
			NO_COLOR: "1",
		}, file);
		expect(warnings).toEqual([
			`The environment variable LOCAL_RUNNER_PORT is no longer read. Write "server.port" in ${file} instead.`,
			"The environment variable ATCODER_SESSION is no longer read.",
		]);
	});
});
