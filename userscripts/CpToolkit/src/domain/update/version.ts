/** `1.2.3` の形のバージョンを数の並びにする。ほかの形は null。 */
function parseVersion(text: string): number[] | null {
	return /^\d+(\.\d+)*$/.test(text) ? text.split(".").map(Number) : null;
}

/** latest が current より新しいか。どちらかがバージョンとして読めなければ、新しいとはみなさない。 */
export function isNewerVersion(latest: string, current: string): boolean {
	const left = parseVersion(latest);
	const right = parseVersion(current);
	if (left === null || right === null) return false;
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return false;
}

/** UserScript のヘッダーから、`// @version 1.2.3` のような項目の値を読む。無ければ null。 */
export function readMetadataValue(metadata: string, key: string): string | null {
	for (const line of metadata.split("\n")) {
		const match = /^\s*\/\/\s*@(\S+)\s+(.*?)\s*$/.exec(line);
		if (match && match[1] === key && match[2] !== "") return match[2]!;
	}
	return null;
}

/** https の URL のホストを返す。https でなければ null。 */
export function httpsHostOf(url: string): string | null {
	return /^https:\/\/([^/:?#@]+)(?=[/:?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? null;
}
