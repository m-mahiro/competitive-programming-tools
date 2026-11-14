import {installPackage, toPackageFiles} from "./installer";
import {compareVersions, downloadAsset, type FetchFunction, fetchLatestRelease, findPackageAsset, matchesSha256, type Release} from "./release";
import {readZip} from "./zip";

// 更新の手順。画面への表示、サーバーの停止、通信は呼び出し側から受け取り、ここでは順番だけを決める。

export type UpdateOptions = {
	/** 配布物を入れ替えるフォルダ。`local-runner` フォルダの親。 */
	readonly installRoot: string;
	readonly fetchImpl?: FetchFunction;
	/** ダウンロードの進み具合。受け取ったバイト数と、全体のバイト数。 */
	progress(received: number, total: number): void;
	/** 検証が済み、ファイルを入れ替える直前に呼ぶ。動いているサーバーを止めるのに使う。 */
	beforeInstall(fileCount: number): Promise<void>;
};

/** 今より新しい Release を返す。無ければ null。 */
export async function findNewerRelease(repository: string, currentVersion: string, fetchImpl?: FetchFunction): Promise<Release | null> {
	const release = await fetchLatestRelease(repository, fetchImpl);
	return release !== null && compareVersions(release.version, currentVersion) > 0 ? release : null;
}

/**
 * Release の配布物をダウンロードし、検証してから入れ替える。
 * 検証に通らなければ、導入先には触れずにエラーにする。
 */
export async function installRelease(release: Release, options: UpdateOptions): Promise<void> {
	const asset = findPackageAsset(release);
	if (asset === null) throw new Error(`The release ${release.tag} has no package (local-runner-${release.version}.zip).`);
	if (asset.sha256 === null) throw new Error(`The release ${release.tag} does not show the checksum of its package, so it cannot be verified.`);
	const archive = await downloadAsset(asset, (received) => options.progress(received, asset.size), options.fetchImpl);
	if (!matchesSha256(archive, asset.sha256)) {
		throw new Error(`The downloaded ${asset.name} does not match its checksum. Nothing was changed. Try again.`);
	}
	const files = toPackageFiles(readZip(archive));
	await options.beforeInstall(files.length);
	installPackage(files, options.installRoot);
}
