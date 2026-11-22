import {httpsHostOf, isNewerVersion, readMetadataValue} from "@domain/update/version";
import {type Guard, isNumber, isObjectOf, isString} from "@domain/validation/guards";
import {type KeyValueStore, readStored} from "@application/ports/key-value-store";
import type {ScriptHost} from "@application/ports/script-host";
import type {HttpClient} from "@application/ports/services";

const STATE_KEY = "update:state";
const HOUR_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** ヘッダーだけを取得する。配布物の全体は大きいので、先頭の分だけを求める。 */
const HEADER_RANGE = "bytes=0-8191";

type Stored = {
	/** 配布元で最後に見たバージョン。まだ見ていなければ空。 */
	readonly latest: string;
	readonly checkedAt: number;
	/** 利用者に知らせたバージョン。同じバージョンを2回知らせないために覚える。 */
	readonly notified: string;
};

const isStored: Guard<Stored> = isObjectOf<Stored>({latest: isString, checkedAt: isNumber, notified: isString});
const EMPTY: Stored = {latest: "", checkedAt: 0, notified: ""};

export type UpdateStatus = {
	readonly current: string;
	/** 今より新しいバージョン。無いか、確かめられていなければ null。 */
	readonly latest: string | null;
	/** 新しいバージョンの入手先(@downloadURL)。開くと、UserScript の管理ツールが更新の画面を出す。 */
	readonly downloadUrl: string | null;
	/** この導入元で更新を確かめられるか。 */
	readonly supported: boolean;
};

export type UpdateCheckerDependencies = {
	readonly host: ScriptHost;
	readonly http: HttpClient;
	readonly state: KeyValueStore;
	/** 通信してよい配布元のホスト。 */
	readonly allowedHosts: readonly string[];
	readonly intervalHours: number;
};

/**
 * 配布元に新しいバージョンがあるかを確かめる。
 * 配布元は、導入されたスクリプト自身のヘッダー(@updateURL)から決める。入手した場所を見に行くためで、URL は持たない。
 */
export class UpdateChecker {
	private readonly dependencies: UpdateCheckerDependencies;

	constructor(dependencies: UpdateCheckerDependencies) {
		this.dependencies = dependencies;
	}

	/** 前に更新を確かめたことがあるか。起動のたびに確かめるので、以前から使っている環境の目印になる。 */
	hasCheckedBefore(): boolean {
		return this.dependencies.state.get(STATE_KEY) !== undefined;
	}

	/** 記憶している結果。通信しない。 */
	status(): UpdateStatus {
		const {host} = this.dependencies;
		const {latest} = this.stored();
		const newer = isNewerVersion(latest, host.version);
		return {
			current: host.version,
			latest: newer ? latest : null,
			downloadUrl: newer ? host.downloadUrl : null,
			supported: this.checkUrl() !== null,
		};
	}

	/**
	 * 前回の確認から間隔が空いていれば、配布元に確かめる。force なら間隔を見ない。
	 * 確かめられなかったときは、記憶している結果のまま返す。
	 */
	async check(now: number, force = false): Promise<UpdateStatus> {
		const url = this.checkUrl();
		const stored = this.stored();
		const due = now - stored.checkedAt >= this.dependencies.intervalHours * HOUR_MS;
		if (url === null || (!force && !due)) return this.status();
		// 先に時刻を書く。失敗したときや、複数のタブが同時に開いたときに、繰り返し通信しないため
		this.save({...stored, checkedAt: now});
		try {
			const response = await this.dependencies.http.send({url, headers: {Range: HEADER_RANGE}, timeoutMs: REQUEST_TIMEOUT_MS});
			const version = response.status === 200 || response.status === 206 ? readMetadataValue(response.text, "version") : null;
			if (version !== null) this.save({...this.stored(), latest: version});
		} catch {
			// オフラインのときなど。次の間隔でまた確かめる
		}
		return this.status();
	}

	/** 新しいバージョンをまだ知らせていなければ true を返し、知らせたと記録する。 */
	claimNotification(): boolean {
		const {latest} = this.status();
		const stored = this.stored();
		if (latest === null || stored.notified === latest) return false;
		this.save({...stored, notified: latest});
		return true;
	}

	/** 確認に使う URL。通信してよい配布元でなければ null。 */
	private checkUrl(): string | null {
		const {host, allowedHosts} = this.dependencies;
		const url = host.updateUrl ?? host.downloadUrl;
		if (url === null) return null;
		const urlHost = httpsHostOf(url);
		return urlHost !== null && allowedHosts.includes(urlHost) ? url : null;
	}

	private stored(): Stored {
		return readStored(this.dependencies.state, STATE_KEY, isStored, EMPTY);
	}

	private save(value: Stored): void {
		this.dependencies.state.set(STATE_KEY, value);
	}
}
