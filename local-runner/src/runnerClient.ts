import type {LocalRunnerRequest} from "@atcoder-tools/shared";
import {CLI_CONFIG} from "./config";
import type {RunnerStatusInfo} from "./types";

type ServerStatus = RunnerStatusInfo | {status: "starting"};

/** サーバーの状態確認と終了要求。 */
type ManagementRequest = {mode: "status"} | {mode: "shutdown"};

/** Local Runner のサーバーへ要求を送る。timeoutMs を省くと応答まで待つ。接続できなければ例外になる。 */
export function postToRunner(request: LocalRunnerRequest | ManagementRequest, timeoutMs?: number): Promise<Response> {
	return fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
		...(timeoutMs === undefined ? {} : {signal: AbortSignal.timeout(timeoutMs)}),
	});
}

/** 起動中のサーバーも検出する。応答がない場合や別のサービスが応答した場合は null。 */
export async function getRunnerStatus(timeoutMs: number): Promise<ServerStatus | null> {
	try {
		const response = await postToRunner({mode: "status"}, timeoutMs);
		if (!response.ok && response.status !== 503) return null;
		const info = await response.json() as ServerStatus | null;
		if (response.status === 503 && info?.status === "starting") return {status: "starting"};
		if (!response.ok || info?.status !== "running" || typeof info.pid !== "number") return null;
		return Array.isArray(info.languages) && Array.isArray(info.skippedLanguages) ? info : null;
	} catch {
		return null;
	}
}

/** 要求を送り、2xx 以外なら例外にして JSON を返す。サーバーが理由を返していれば、それを例外のメッセージにする。 */
export async function requestRunner<T>(request: LocalRunnerRequest, failure: string): Promise<T> {
	const response = await postToRunner(request);
	if (!response.ok) {
		const reason = await response.json().then((body) => (body as {stderr?: unknown} | null)?.stderr).catch(() => undefined);
		throw new Error(typeof reason === "string" && reason !== "" ? reason : `${failure}: ${response.status}`);
	}
	return await response.json() as T;
}
