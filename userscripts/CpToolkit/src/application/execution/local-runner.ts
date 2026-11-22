import {
	type LocalRunnerCompilerInfo,
	type CompilerDiagnostic,
	type LocalRunnerHeaderOption,
	type LocalRunnerRequest,
	type LocalRunnerRunResponse,
	type LocalRunnerTransformResponse,
	safeJsonParse,
} from "@atcoder-tools/shared";
import type {JudgeLanguage} from "@domain/execution/result";
import type {HttpClient} from "@application/ports/services";
import {orderLocalCompilers} from "./local-languages";

const METADATA_TIMEOUT_MS = 3_000;
const VERSION_CACHE_MS = 10_000;
const TRANSFORM_TIMEOUT_MS = 30_000;

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function compiler(value: unknown): value is LocalRunnerCompilerInfo {
	return object(value) && typeof value.language === "string" && typeof value.compilerName === "string" && typeof value.label === "string"
		&& (value.family === undefined || typeof value.family === "string") && (value.match === undefined || strings(value.match));
}

function diagnostic(value: unknown): value is CompilerDiagnostic {
	return object(value) && typeof value.kind === "string" && typeof value.line === "number" && typeof value.column === "number"
		&& typeof value.code === "string" && typeof value.message === "string" && (value.importName === undefined || typeof value.importName === "string");
}

export class LocalRunnerError extends Error {
	readonly status: number;

	readonly notify: boolean;

	constructor(message: string, status: number, notify = true) {
		super(message);
		this.status = status;
		this.notify = notify;
	}
}

/** Local Runner との通信。URL は設定から毎回取得し、未設定なら通信しない。 */
export class LocalRunnerClient {
	private readonly http: HttpClient;
	private readonly endpoint: () => string | null;
	/**
	 * 言語の一覧。提出補助、ヘッダー、Easy Test+ が同じページで何度も使うので、接続先ごとに覚えておく。
	 * 通信に失敗したら捨て、Local Runner を起動し直したあとは取り直す。
	 */
	private compilers: {readonly url: string; readonly list: Promise<LocalRunnerCompilerInfo[]>; settled: boolean} | null = null;

	private version: {url: string; expires: number; value: Promise<string>} | null = null;
	private warnedVersion = "";

	constructor(http: HttpClient, endpoint: () => string | null) {
		this.http = http;
		this.endpoint = endpoint;
	}

	isAvailable(): boolean {
		return this.endpoint() !== null;
	}

	list(refresh = false): Promise<LocalRunnerCompilerInfo[]> {
		const url = this.endpoint();
		if (this.compilers?.url === url && (!refresh || !this.compilers.settled)) return this.compilers.list;
		const list = this.post<unknown>({mode: "list"}, METADATA_TIMEOUT_MS).then((value) => {
			if (!Array.isArray(value) || !value.every(compiler)) throw new LocalRunnerError("Invalid Local Runner compiler list.", 200);
			return value;
		});
		if (url !== null) {
			const cached = {url, list, settled: false};
			this.compilers = cached;
			void list.then(() => { cached.settled = true; }, () => {
				if (this.compilers === cached) this.compilers = null;
			});
		}
		return list;
	}

	private async requireSubmissionApi(): Promise<void> {
		const url = this.endpoint();
		if (url === null) throw new LocalRunnerError("Local Runner is not configured.", 0);
		if (this.version?.url !== url || Date.now() >= this.version.expires) {
			const value = this.post<unknown>({mode: "status"}, METADATA_TIMEOUT_MS).then((info) => {
				if (!object(info) || info.status !== "running" || typeof info.version !== "string" || !/^\d+\.\d+\.\d+$/.test(info.version)) {
					throw new LocalRunnerError("Invalid Local Runner version response.", 200);
				}
				return info.version;
			});
			const cached = {url, expires: Date.now() + VERSION_CACHE_MS, value};
			this.version = cached;
			void value.catch(() => { if (this.version === cached) this.version = null; });
		}
		const version = await this.version.value;
		if (url !== this.endpoint()) throw new LocalRunnerError("Local Runner endpoint changed.", -1);
		if (Number(version.split(".")[0]) < 2) {
			const key = url + "/" + version;
			const notify = this.warnedVersion !== key;
			this.warnedVersion = key;
			throw new LocalRunnerError(`Local Runner ${version}: update to 2.0.0 or later to prepare submissions and attach headers.`, 400, notify);
		}
		this.warnedVersion = "";
	}

	/** ページの言語に使う Local Runner の言語の識別子。同じ種類の言語が無ければ null。 */
	async compilerFor(language: JudgeLanguage): Promise<string | null> {
		return orderLocalCompilers(await this.list(), language)[0]?.compilerName ?? null;
	}

	/** 提出用に変換する。ヘッダーはブラウザがほかの文と並べて付けるので、ここでは付けない。compilerName を省くと Java。 */
	async transform(sourceCode: string, compilerName?: string): Promise<LocalRunnerTransformResponse> {
		await this.requireSubmissionApi();
		const request = {
			mode: "transform",
			sourceCode,
			...(compilerName !== undefined && {compilerName}),
			debug: false,
			validate: true,
			header: false,
		} as const;
		const response = await this.post<unknown>(request, TRANSFORM_TIMEOUT_MS);
		if (!object(response) || (response.status !== "success" && response.status !== "compileError") || typeof response.sourceCode !== "string"
			|| typeof response.diagnostics !== "string" || !Array.isArray(response.diagnosticItems) || !response.diagnosticItems.every(diagnostic)
			|| !strings(response.inlinedClasses)) throw new LocalRunnerError("Invalid Local Runner transform response.", 200);
		return {status: response.status, sourceCode: response.sourceCode, diagnostics: response.diagnostics, diagnosticItems: response.diagnosticItems, inlinedClasses: response.inlinedClasses};
	}

	/** 提出物に付けるヘッダーの文。設定が無ければ null。compilerName を省くと Java。 */
	async header(compilerName: string | undefined, header: LocalRunnerHeaderOption): Promise<string | null> {
		await this.requireSubmissionApi();
		const response = await this.post<unknown>({mode: "header", ...(compilerName !== undefined && {compilerName}), header}, METADATA_TIMEOUT_MS);
		if (!object(response) || response.status !== "success" || (response.header !== null && typeof response.header !== "string")) {
			throw new LocalRunnerError("Invalid Local Runner header response.", 200);
		}
		return response.header;
	}

	/**
	 * 編集中のソースを、先にコンパイルしておく。サーバーは受け付けだけをすぐに返す。
	 * compilerName は list で返された識別子で、サーバーが言語を選ぶのに使う。
	 */
	async precompile(sourceCode: string, compilerName?: string): Promise<void> {
		await this.post({mode: "precompile", sourceCode, ...(compilerName !== undefined && {compilerName}), debug: true});
	}

	/** ソースを実行する。サーバーはコンパイルが終わるのを待ってから実行し、コンパイルエラーも実行の結果として返す。 */
	run(sourceCode: string, input: string, compilerName?: string): Promise<LocalRunnerRunResponse> {
		return this.post({mode: "run", sourceCode, ...(compilerName !== undefined && {compilerName}), stdin: input, debug: true});
	}

	/** 実行はサンプルの数だけ順番に待つことがあるので、既定では時間を制限しない。 */
	private async post<T>(request: LocalRunnerRequest, timeoutMs?: number): Promise<T> {
		const url = this.endpoint();
		if (url === null) throw new LocalRunnerError("Local Runner is not configured.", 0);
		const lostConnection = request.mode === "transform" || request.mode === "header" ? -1 : 0;
		let response;
		try {
			response = await this.http.send({
				url,
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify(request),
				timeoutMs,
			});
		} catch (error) {
			if (this.compilers?.url === url) this.compilers = null;
			if (this.version?.url === url) this.version = null;
			throw new LocalRunnerError(error instanceof Error ? error.message : String(error), lostConnection);
		}
		if (response.status < 200 || response.status >= 300) {
			if (this.compilers?.url === url) this.compilers = null;
			if (this.version?.url === url) this.version = null;
			// 誤りの理由は応答の stderr にある(名前を指定したヘッダーが無いなど)
			const reason = safeJsonParse<{stderr?: unknown} | null>(response.text, null)?.stderr;
			const detail = typeof reason === "string" && reason ? `\n${reason}` : "";
			throw new LocalRunnerError(`Local Runner returned ${response.status}.${detail}`, response.status || lostConnection);
		}
		try {
			return JSON.parse(response.text) as T;
		} catch {
			throw new LocalRunnerError("Invalid JSON from Local Runner.", response.status);
		}
	}
}
