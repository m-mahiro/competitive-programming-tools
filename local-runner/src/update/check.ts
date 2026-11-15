import type {FetchFunction} from "./release";
import {findNewerRelease} from "./update";

// サーバーの起動時の更新の確認。画面への表示は呼び出し側から受け取る。

/** 起動時に配布元で見つけた、より新しいバージョン。無いか、確かめていなければ null。 */
let availableVersion: string | null = null;

/** checkForUpdate が見つけた、より新しいバージョン。 */
export function latestVersion(): string | null {
	return availableVersion;
}

/**
 * 配布元に新しいバージョンがあれば知らせる。起動を待たせないよう、呼び出し側は結果を待たずに裏で動かす。
 * 通信できないときは、利用に支障が無いので何も知らせない。
 */
export async function checkForUpdate(
	repository: string,
	currentVersion: string,
	notify: (message: string) => void,
	fetchImpl?: FetchFunction,
): Promise<void> {
	try {
		const release = await findNewerRelease(repository, currentVersion, fetchImpl);
		if (release === null) return;
		availableVersion = release.version;
		notify(`Local Runner ${release.version} is available (running: ${currentVersion}). Run update to install it.`);
	} catch {
		// オフラインのときなど。次の起動でまた確かめる
	}
}
