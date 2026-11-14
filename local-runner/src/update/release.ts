import crypto from "node:crypto";
import {VERSION} from "../version";

// 配布元(GitHub の Release)から、新しいバージョンを探す。
// リポジトリは設定の update.repository で受け取る。同じリポジトリにほかの Release があってもよいよう、タグの書き出しで選ぶ。

/** Local Runner の Release のタグの書き出し。後ろにバージョンが続く。 */
const RELEASE_TAG_PREFIX = "local-runner-v";

const API_TIMEOUT_MS = 10_000;

export type ReleaseAsset = {
	readonly name: string;
	readonly size: number;
	readonly url: string;
	/** 配布元が示す SHA-256(16進)。示されていなければ null。 */
	readonly sha256: string | null;
};

export type Release = {
	readonly version: string;
	readonly tag: string;
	readonly assets: readonly ReleaseAsset[];
};

export type FetchFunction = (url: string, init?: {headers?: Record<string, string>; signal?: AbortSignal}) => Promise<Response>;

/** `1.2.3` の形のバージョンを数の並びにする。ほかの形は null。 */
function parseVersion(text: string): number[] | null {
	return /^\d+(\.\d+)*$/.test(text) ? text.split(".").map(Number) : null;
}

/** a が b より新しければ正、古ければ負、同じなら 0。足りない桁は 0 として比べる。 */
export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (left === null || right === null) throw new Error(`Not a version: ${left === null ? a : b}`);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAsset(value: unknown): ReleaseAsset | null {
	if (!isRecord(value)) return null;
	const {name, size, browser_download_url: url, digest} = value;
	if (typeof name !== "string" || typeof size !== "number" || typeof url !== "string") return null;
	const sha256 = typeof digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(digest)?.[1]?.toLowerCase() ?? null : null;
	return {name, size, url, sha256};
}

/**
 * Release の一覧の応答から、公開済みで最も新しい Local Runner の Release を選ぶ。
 * 下書き、プレリリース、タグの書き出しが違うもの、バージョンとして読めないものは除く。
 */
export function selectLatestRelease(payload: unknown): Release | null {
	if (!Array.isArray(payload)) return null;
	let latest: Release | null = null;
	for (const item of payload) {
		if (!isRecord(item) || item.draft === true || item.prerelease === true) continue;
		const tag = item.tag_name;
		if (typeof tag !== "string" || !tag.startsWith(RELEASE_TAG_PREFIX)) continue;
		const version = tag.slice(RELEASE_TAG_PREFIX.length);
		if (parseVersion(version) === null) continue;
		if (latest !== null && compareVersions(version, latest.version) <= 0) continue;
		const assets = Array.isArray(item.assets) ? item.assets.map(toAsset).filter((asset) => asset !== null) : [];
		latest = {version, tag, assets};
	}
	return latest;
}

/** Release に添付された配布物の zip。名前はバージョンから決まる。 */
export function findPackageAsset(release: Release): ReleaseAsset | null {
	return release.assets.find(({name}) => name === `local-runner-${release.version}.zip`) ?? null;
}

/** 配布元から最新の Release を取得する。Local Runner の Release が1つも無ければ null。通信の失敗はエラーにする。 */
export async function fetchLatestRelease(repository: string, fetchImpl: FetchFunction = fetch): Promise<Release | null> {
	const url = `https://api.github.com/repos/${repository}/releases?per_page=100`;
	const response = await fetchImpl(url, {
		headers: {"Accept": "application/vnd.github+json", "User-Agent": `local-runner/${VERSION}`},
		signal: AbortSignal.timeout(API_TIMEOUT_MS),
	});
	if (!response.ok) {
		const reason = response.status === 403 || response.status === 429
			? "The request limit of GitHub was reached. Try again later."
			: `Check "update.repository" in the settings (${repository}).`;
		throw new Error(`Could not get the releases (status ${response.status}). ${reason}`);
	}
	return selectLatestRelease(await response.json());
}

/** 配布物をダウンロードする。progress には、受け取ったバイト数を渡す。 */
export async function downloadAsset(asset: ReleaseAsset, progress: (received: number) => void, fetchImpl: FetchFunction = fetch): Promise<Buffer> {
	const response = await fetchImpl(asset.url, {headers: {"User-Agent": `local-runner/${VERSION}`}});
	if (!response.ok || response.body === null) throw new Error(`Could not download ${asset.name} (status ${response.status}).`);
	const chunks: Uint8Array[] = [];
	let received = 0;
	const reader = response.body.getReader();
	for (; ;) {
		const {done, value} = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		progress(received);
	}
	return Buffer.concat(chunks);
}

/** ダウンロードした配布物が、配布元の示す SHA-256 と同じか。 */
export function matchesSha256(data: Buffer, sha256: string): boolean {
	return crypto.createHash("sha256").update(data).digest("hex") === sha256.toLowerCase();
}
