import * as shared from "@atcoder-tools/shared";
import fs from "node:fs";
import type {SubmissionFinalResult, SubmitResult, Task} from "../types";
import {CLI_CONFIG, resolveConfiguredPath, SETTINGS} from "../config";
import * as color from "../utils/color";
import type {SourceLanguage} from "./language";
import * as parser from "./parser";

/** 提出一覧と提出状況の確認は短い間隔で繰り返すので、429 のときは取り直す。 */
const POLL_ATTEMPTS_ON_429 = 4;

const AUTH_ERROR_MESSAGE = [
	"[auth] Checking AtCoder session...",
	"[auth] ERROR: REVEL_SESSION is missing, expired, or has been replaced.",
	"",
	"Save a new one with:",
	"  setsession",
].join("\n");

function ensureNotLoginPage(body: string, url: string) {
	if (parser.isAtCoderLoginPage(body, url)) throw new Error(AUTH_ERROR_MESSAGE);
}

export function toCookieHeader() {
	const sessionFromFile = readSessionFromFile();
	if (sessionFromFile) {
		return `REVEL_SESSION=${sessionFromFile}`;
	}
	return "";
}

/** 設定の atcoder.sessionFile から REVEL_SESSION の値を読む。読めなければ空にし、呼び出し側が案内を出す。 */
function readSessionFromFile() {
	try {
		const raw = fs.readFileSync(resolveConfiguredPath(SETTINGS.atcoder.sessionFile), "utf8").trim();
		return raw.replace(/^REVEL_SESSION=/i, "").trim();
	} catch {
		return "";
	}
}

/** 429 が返ったときは maxAttempts 回まで待って取り直す。既定では取り直さない。 */
export async function httpGetText(url: string, cookieHeader = "", maxAttempts = 1) {
	const headers: Record<string, string> = {
		"User-Agent": CLI_CONFIG.userAgent,
		"Accept-Language": "ja,en;q=0.9",
	};
	if (cookieHeader) headers.Cookie = cookieHeader;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const res = await fetch(url, {headers, redirect: "follow"});
		if (res.ok) {
			const body = await res.text();
			ensureNotLoginPage(body, res.url);
			return body;
		}
		if (res.status !== 429 || attempt + 1 === maxAttempts) {
			throw new Error(`GET failed (${res.status}) for ${url}`);
		}
		const retryAfterHeader = res.headers.get("retry-after") || "";
		const retryAfterSec = Number.parseInt(retryAfterHeader, 10);
		const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
			? retryAfterSec * 1000
			: 700 + attempt * 700;
		await shared.sleep(waitMs);
	}
	throw new Error(`GET failed (429) for ${url}`);
}

/** その問題の自分の提出のうち、after より新しい最大の ID を返す。after が空なら最新の ID。無ければ空。 */
export async function fetchLatestSubmissionId(task: Task, cookieHeader: string, after = "") {
	const listUrl = shared.buildAtCoderSubmissionsMeUrl(task.contestId, {task: task.taskScreenName});
	const html = await httpGetText(listUrl, cookieHeader, POLL_ATTEMPTS_ON_429);
	return parser.findNewestSubmissionId(html, task.contestId, task.taskScreenName, after);
}

async function waitForNewSubmissionId(task: Task, cookieHeader: string, previousSubmissionId: string) {
	const started = Date.now();
	while (Date.now() - started < CLI_CONFIG.submissionIdDetectTimeoutMs) {
		const latestId = await fetchLatestSubmissionId(task, cookieHeader, previousSubmissionId);
		if (latestId) return latestId;
		await shared.sleep(CLI_CONFIG.submissionIdDetectIntervalMs);
	}
	return "";
}

/** 応答の URL のパス。読めなければ空。 */
function pathOf(url: string): string {
	try {
		return new URL(url).pathname.replace(/\/+$/, "");
	} catch {
		return "";
	}
}

/**
 * 送信のあと、今回の提出の ID を決める。提出前の ID より新しい、その問題の行だけを使う。
 * 提出前の ID が分からないとき(429)や、決められないときは、一覧の URL だけを返す。
 */
async function trackNewSubmission(task: Task, cookieHeader: string, html: string, previousSubmissionId: string | null): Promise<SubmitResult> {
	if (previousSubmissionId !== null) {
		const id = parser.findNewestSubmissionId(html, task.contestId, task.taskScreenName, previousSubmissionId)
			|| await waitForNewSubmissionId(task, cookieHeader, previousSubmissionId);
		if (id) return {submissionId: id, submissionUrl: shared.buildAtCoderSubmissionUrl(task.contestId, id)};
	}
	return {
		submissionId: "-",
		submissionUrl: shared.buildAtCoderSubmissionsMeUrl(task.contestId, {task: task.taskScreenName}),
		trackingUnavailable: true,
	};
}

function parseRetryAfterToMs(headerValue: string | null, fallbackMs: number) {
	const sec = Number.parseInt((headerValue || "").trim(), 10);
	if (Number.isFinite(sec) && sec > 0) {
		return sec * 1000;
	}
	return fallbackMs;
}

async function postSubmitWithRetry(url: string, headers: Record<string, string>, body: string) {
	for (let attempt = 0; attempt < CLI_CONFIG.submitPostRetryMax; attempt++) {
		const res = await fetch(url, {
			method: "POST",
			headers,
			redirect: "follow",
			body,
		});
		if (res.status !== 429) {
			return res;
		}
		if (attempt + 1 >= CLI_CONFIG.submitPostRetryMax) {
			return res;
		}
		const waitMs = parseRetryAfterToMs(
			res.headers.get("retry-after"),
			CLI_CONFIG.submitPostRetryBaseMs * (attempt + 1),
		);
		console.log(color.colorizeWarning(`Warning: submit is rate-limited (429). Retrying in ${waitMs}ms...`, "cli"));
		await shared.sleep(waitMs);
	}
	throw new Error("Unreachable submit retry state.");
}

export async function submitToAtCoder(
	task: Task,
	sourceCode: string,
	cookieHeader: string,
	language: SourceLanguage,
): Promise<SubmitResult> {
	if (!cookieHeader) {
		throw new Error(AUTH_ERROR_MESSAGE);
	}
	const submitPage = await httpGetText(task.submitUrl, cookieHeader);
	const csrfToken = parser.extractCsrfToken(submitPage);
	const submitForm = parser.extractSubmitForm(submitPage, task);
	const languageCandidates = parser.chooseSubmitLanguageIds(
		parser.extractLanguageOptionsFromSubmitPage(submitPage, task.taskScreenName),
		language,
		CLI_CONFIG.defaultLanguageId,
	);
	// 提出前の最新の ID。429 で読めなければ null にし、提出のあとで新旧を比べない。
	let previousSubmissionId: string | null = "";
	try {
		previousSubmissionId = await fetchLatestSubmissionId(task, cookieHeader);
	} catch (error) {
		if (String(error instanceof Error ? error.message : error).includes("(429)")) {
			previousSubmissionId = null;
			console.log(color.colorizeWarning("Warning: submissions/me is rate-limited (429). Continue submit without strict ID diff tracking.", "cli"));
		} else {
			throw error;
		}
	}

	// 次の言語の候補で送り直すのは、提出ページに戻されて拒否が分かったときだけ。
	// 受け付けられたか分からないときに送り直すと、同じコードを2回提出してしまう。
	let lastRejectReason = "";
	for (const languageId of languageCandidates) {
		const params = new URLSearchParams();
		for (const [k, v] of submitForm.formValues.entries()) {
			params.set(k, v);
		}
		params.set("data.TaskScreenName", task.taskScreenName);
		params.set("data.LanguageId", languageId);
		params.set("sourceCode", sourceCode);
		params.set("csrf_token", csrfToken);
		console.log(`LanguageId: ${languageId}`);

		const submitHeaders = {
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
			"User-Agent": CLI_CONFIG.userAgent,
			"Accept-Language": "ja,en;q=0.9",
			Origin: "https://atcoder.jp",
			Referer: task.submitUrl,
			Cookie: cookieHeader,
		};
		const res = await postSubmitWithRetry(submitForm.actionUrl, submitHeaders, params.toString());
		if (!res.ok && res.status < 500) {
			lastRejectReason = `Submit request failed (${res.status}).`;
			continue;
		}
		const html = res.ok ? await res.text() : "";
		if (res.ok) ensureNotLoginPage(html, res.url);
		const redirectMatch = pathOf(res.url).match(/\/submissions\/(\d+)$/);
		if (redirectMatch) {
			return {
				submissionId: redirectMatch[1],
				submissionUrl: res.url,
			};
		}
		if (res.ok && pathOf(res.url).endsWith("/submit")) {
			lastRejectReason = parser.extractSubmitFailureReason(html) || "AtCoder returned to the submit page.";
			continue;
		}
		return await trackNewSubmission(task, cookieHeader, html, previousSubmissionId);
	}

	throw new Error(`Submit was rejected by AtCoder: ${lastRejectReason || "unknown error"}`);
}

export function formatMetricValue(value: string) {
	return value && String(value).trim() ? String(value).trim() : "N/A";
}

// ジャッジ確定を表す終端ステータス。これ以外（WJ / WR / 空 / "3/14" 等の進捗）はまだ判定中。
const TERMINAL_SUBMISSION_STATUSES = new Set(["AC", "WA", "TLE", "MLE", "RE", "OLE", "IE", "CE", "QLE"]);

/**
 * status/json API をポーリングしてジャッジ確定まで待つ。
 * 提出詳細ページ(/submissions/<id>)は WAF に 403 で弾かれるため、
 * 提出一覧が内部で使う JSON API を使う（自分の提出のみ、要ログイン）。
 *
 * 確定判定は「サーバが Interval を返さなくなった」かつ「ステータスが終端(AC/WA/...)」の両方が
 * 揃ったときのみとする。提出直後に Result が空、または WJ のまま Interval がまだ付かない一過性の
 * 状態を「確定」と誤認して早期に打ち切らないための二重条件。
 */
export async function pollSubmissionFinal(
	contestId: string,
	submissionId: string,
	cookieHeader: string,
): Promise<SubmissionFinalResult> {
	const statusUrl = shared.buildAtCoderSubmissionStatusJsonUrl(contestId, [submissionId]);
	const started = Date.now();
	let lastStatus = "";
	while (Date.now() - started < CLI_CONFIG.submissionPollTimeoutMs) {
		const body = await httpGetText(statusUrl, cookieHeader, POLL_ATTEMPTS_ON_429);
		const snapshot = parser.parseSubmissionStatusJson(body, submissionId);
		const display = snapshot.status || lastStatus || "WJ";
		if (display !== lastStatus) {
			console.log(`Status: ${color.colorizeStatus(display)}`);
			lastStatus = display;
		}
		const isTerminal = TERMINAL_SUBMISSION_STATUSES.has(snapshot.status.toUpperCase());
		if (!snapshot.pending && isTerminal) {
			// 確定。この時点で実行時間・メモリも埋まっている。
			return {status: snapshot.status, execTime: snapshot.execTime, memory: snapshot.memory};
		}
		// ジャッジ中はサーバ推奨間隔(Interval)を尊重。まだ Result 未反映等の一過性状態なら最小間隔で再試行。
		const waitMs = Math.max(snapshot.intervalMs, CLI_CONFIG.submissionPollIntervalMs);
		await shared.sleep(waitMs);
	}
	return {status: lastStatus || "PENDING", execTime: "", memory: ""};
}
