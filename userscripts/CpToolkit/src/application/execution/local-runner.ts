import {
	type LocalRunnerCompilerInfo,
	type LocalRunnerHeaderOption,
	type LocalRunnerHeaderResponse,
	type LocalRunnerRequest,
	type LocalRunnerRunResponse,
	type LocalRunnerTransformResponse,
	safeJsonParse,
} from "@atcoder-tools/shared";
import type {JudgeLanguage} from "@domain/execution/result";
import type {HttpClient} from "@application/ports/services";
import {orderLocalCompilers} from "./local-languages";

const TRANSFORM_TIMEOUT_MS = 30_000;

export class LocalRunnerError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
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
	private compilers: {readonly url: string; readonly list: Promise<LocalRunnerCompilerInfo[]>} | null = null;

	constructor(http: HttpClient, endpoint: () => string | null) {
		this.http = http;
		this.endpoint = endpoint;
	}

	isAvailable(): boolean {
		return this.endpoint() !== null;
	}

	list(): Promise<LocalRunnerCompilerInfo[]> {
		const url = this.endpoint();
		if (this.compilers && this.compilers.url === url) return this.compilers.list;
		const list = this.post<LocalRunnerCompilerInfo[]>({mode: "list"});
		if (url !== null) this.compilers = {url, list};
		return list;
	}

	/** ページの言語に使う Local Runner の言語の識別子。同じ種類の言語が無ければ null。 */
	async compilerFor(language: JudgeLanguage): Promise<string | null> {
		return orderLocalCompilers(await this.list(), language)[0]?.compilerName ?? null;
	}

	/** 提出用に変換する。ヘッダーはブラウザがほかの文と並べて付けるので、ここでは付けない。compilerName を省くと Java。 */
	transform(sourceCode: string, compilerName?: string): Promise<LocalRunnerTransformResponse> {
		const request = {
			mode: "transform",
			sourceCode,
			...(compilerName !== undefined && {compilerName}),
			debug: false,
			validate: false,
			header: false,
		} as const;
		return this.post(request, TRANSFORM_TIMEOUT_MS);
	}

	/** 提出物に付けるヘッダーの文。設定が無ければ null。compilerName を省くと Java。 */
	async header(compilerName: string | undefined, header: LocalRunnerHeaderOption): Promise<string | null> {
		const response = await this.post<LocalRunnerHeaderResponse>({mode: "header", ...(compilerName !== undefined && {compilerName}), header});
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
			this.compilers = null;
			throw error;
		}
		if (response.status < 200 || response.status >= 300) {
			this.compilers = null;
			// 誤りの理由は応答の stderr にある(名前を指定したヘッダーが無いなど)
			const reason = safeJsonParse<{stderr?: unknown}>(response.text, {}).stderr;
			const detail = typeof reason === "string" && reason ? `\n${reason}` : "";
			throw new LocalRunnerError(`Local Runner returned ${response.status}.${detail}`, response.status);
		}
		return JSON.parse(response.text) as T;
	}
}
