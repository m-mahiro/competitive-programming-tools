import {SETTINGS_FILE} from "../config";
import {legacyEnvironmentWarnings} from "./environment";
import {removeLegacyFiles} from "./files";

// 以前のバージョンからの後始末。名前や置き場所を変えたときは、古いものをこのフォルダに足し、本体には互換の分岐を残さない。
// 設定ファイルの書き換え(settingsFile.ts)だけは、設定を読む前に要るので config.ts から呼ぶ。

export type MigrationReporter = {
	warn(message: string): void;
	info(message: string): void;
};

/** 起動時に呼ぶ。残っている古い環境変数を案内し、以前のバージョンのファイルを消す。何も無ければ何も出さない。 */
export function migrateFromEarlierVersions(reporter: MigrationReporter): void {
	for (const warning of legacyEnvironmentWarnings(process.env, SETTINGS_FILE)) reporter.warn(warning);
	const removed = removeLegacyFiles();
	if (removed.length > 0) reporter.info(`Removed files left by an earlier version: ${removed.join(", ")}`);
}
