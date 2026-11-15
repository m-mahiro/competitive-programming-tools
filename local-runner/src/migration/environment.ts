/**
 * 以前のバージョンの文書に載せていた環境変数と、代わりに書く設定の項目。値が null のものは、代わりの項目が無い。
 * 文書に載せていなかった開発用の変数は、利用者が設定していることがないので案内しない。
 * 名前は過去の環境変数の名前そのものなので、変えない。
 */
const LEGACY_ENVIRONMENT: Readonly<Record<string, string | null>> = {
	LOCAL_RUNNER_URL: "server.port",
	LOCAL_RUNNER_PORT: "server.port",
	LOCAL_RUNNER_BACKEND: "server.backend",
	ATCODER_RUNNER_AUTOSTART: "server.autoStart",
	LOCAL_RUNNER_START_TIMEOUT_MS: "server.startTimeoutMs",
	LOCAL_RUNNER_ALLOWED_ORIGINS: "server.extraOrigins",
	ATCODER_JAVA_VER: "languages.java.release",
	ATCODER_LIB_SRC: "languages.java.library",
	LOCAL_RUNNER_RUN_STACK_BYTES: "languages.java.stackMb",
	ATCODER_SESSION_FILE: "atcoder.sessionFile",
	ATCODER_SESSION: null,
	ATCODER_COOKIE: null,
	LOCAL_RUNNER_HOST: null,
	LOCAL_RUNNER_BUN: null,
	LOCAL_RUNNER_INPROCESS_COMPILE: null,
};

/** 設定されたままの古い環境変数について、移行先を案内する文を返す。値は秘密になりうるので表示しない。 */
export function legacyEnvironmentWarnings(environment: NodeJS.ProcessEnv, settingsFile: string): string[] {
	return Object.entries(LEGACY_ENVIRONMENT)
		.filter(([name]) => environment[name] !== undefined && environment[name] !== "")
		.map(([name, setting]) => setting === null
			? `The environment variable ${name} is no longer read.`
			: `The environment variable ${name} is no longer read. Write "${setting}" in ${settingsFile} instead.`);
}
