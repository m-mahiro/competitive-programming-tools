import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * テストが使う設定ファイル。利用者の設定を読まないよう、一時フォルダのファイルを LOCAL_RUNNER_SETTINGS_FILE に設定する。
 * bun test はすべてのテストのファイルを1つのプロセスで動かし、config.ts は最初に読まれたときの値を使い続けるので、
 * 設定を使うテストは、config.ts を読む前にこのファイルを読み、同じ設定ファイルを共有する。
 */
function testSettingsFile(): string {
	// 利用者が環境変数で指定していても、そのファイルには書き込まない。このモジュールは1つのプロセスで1回だけ動く
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-runner-test-settings-"));
	process.once("exit", () => fs.rmSync(dir, {recursive: true, force: true}));
	return process.env.LOCAL_RUNNER_SETTINGS_FILE = path.join(dir, "local-runner.settings.json");
}

export const TEST_SETTINGS_FILE = testSettingsFile();
