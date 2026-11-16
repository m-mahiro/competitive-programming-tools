import type http from "node:http";
import * as config from "../config";
import {prepareLibrarySourceRoot, resolveLibrarySourceRoot} from "../javaLibrary/prepare";
import {migrateFromEarlierVersions} from "../migration";
import {checkForUpdate} from "../update/check";
import {VERSION} from "../version";
import * as color from "../utils/color";
import * as filesystem from "../utils/filesystem";
import * as logging from "../utils/logging";
import {CommandEngine} from "./commandEngine";
import * as compiler from "./compiler";
import * as dispatcher from "./dispatcher";
import {EMBEDDED_FILES, extractEmbeddedFile} from "./embedded";
import {setCommandEngine, setLanguages} from "./execution";
import {pruneHeaderUnits} from "./headerUnit";
import {resolveLanguages} from "./languages";
import {ALLOWED_ORIGIN_HOSTS} from "./origin";
import {ensureLauncher} from "./processRunner";
import {createRunnerServer} from "./server";

// サーバーの起動と終了。起動時の準備(言語、ライブラリ、常駐 JVM)を順に行ってから待ち受ける。

const server: http.Server = createRunnerServer(() => shutdown("api"));

/** 設定から使える言語を決め、コマンドで動かす言語の実行環境を用意する。 */
async function prepareLanguages(): Promise<void> {
	const resolved = resolveLanguages(config.SETTINGS, compiler.RUNNER_LABEL, config.resolveConfiguredPath, process.platform === "linux");
	setLanguages(resolved.languages, resolved.skipped);
	logging.logInfo(`Languages: ${resolved.languages.map(({name}) => name).join(", ")}`);
	for (const {name, reason} of resolved.skipped) {
		logging.logWarn(color.colorizeWarning(`Language "${name}" is not available: ${reason}.`));
	}
	const commandLanguages = resolved.languages.flatMap(({command}) => (command === null ? [] : [command]));
	if (commandLanguages.length === 0) return;

	// 配布用の実行ファイルには、ビルドした起動プログラムを埋め込んである。無ければ C か C++ のコンパイラでビルドする。
	const compilerCandidates = ["cc", "gcc", ...commandLanguages.map(({command}) => command).filter((command) => /(?:cc|\+\+|clang)[^/]*$/.test(command))];
	const launcher = await extractEmbeddedFile(EMBEDDED_FILES.launcher, config.RUNNER_CONFIG.launcherFile, 0o755)
		?? await ensureLauncher(config.RUNNER_CONFIG.launcherSourceFile, config.RUNNER_CONFIG.launcherFile, compilerCandidates);
	if (launcher === null) {
		logging.logWarn("No C compiler was found, so memory is measured less precisely: values below about 20 MB are not reliable. Install gcc to fix this.");
	}
	const engine = new CommandEngine({
		rootDir: config.RUNNER_CONFIG.programRootDir,
		headerUnitCacheDir: config.RUNNER_CONFIG.headerUnitCacheDir,
		compileTimeoutMs: config.RUNNER_CONFIG.compileTimeoutMs,
		runTimeoutMs: config.RUNNER_CONFIG.runTimeoutMs,
		outputLimitBytes: config.RUNNER_CONFIG.outputLimitBytes,
		maxPrograms: config.RUNNER_CONFIG.maxCacheSize,
		launcher,
		log: logging.logInfo,
	});
	setCommandEngine(engine);
	const headerUnitLanguages = commandLanguages.filter(({headerUnit}) => headerUnit);
	pruneHeaderUnits(
		config.RUNNER_CONFIG.headerUnitCacheDir,
		headerUnitLanguages.flatMap((language) => [true, false].map((debug) => engine.compileTemplate(language, debug) ?? [])),
	);
	for (const language of headerUnitLanguages) engine.warmUp(language);
}

async function bootstrap() {
	migrateFromEarlierVersions({warn: logging.logWarn, info: logging.logInfo});
	if (compiler.JAVA_VERSION === "Unknown") {
		throw new Error(`Java was not found: ${compiler.JAVA_PATH}. Install a JDK, or write its java command in "languages.java.command" of ${config.SETTINGS_FILE}.`);
	}
	filesystem.ensureDirectory(config.RUNNER_CONFIG.baseDir);
	filesystem.ensureDirectory(config.RUNNER_CONFIG.compileRootDir);
	const libraryRoots = prepareLibrarySourceRoot();
	logging.logInfo(`Settings file: ${config.SETTINGS_FILE}`);
	logging.logInfo(`Local Runner base directory: ${config.RUNNER_CONFIG.baseDir}`);
	if (libraryRoots.source === null) {
		const configured = config.SETTINGS.languages.java.library;
		logging.logWarn(configured
			? `Java library not found: ${configured}. Starting without it.`
			: "Java library is not set. Starting without it. To use one, run setlib <path>.");
	} else {
		logging.logInfo(`Library source: ${libraryRoots.source}`);
		logging.logInfo(`Prepared library source: ${libraryRoots.prepared}`);
	}
	logging.logInfo(`Log file: ${config.LOG_FILE_PATH}`);
	logging.logInfo(`Log rotation size: ${config.RUNNER_CONFIG.maxLogFileSize} bytes`);
	if (compiler.JAVA_VERSION !== config.TARGET_JAVA_VERSION) {
		logging.logWarn(`Java ${compiler.JAVA_VERSION} differs from the submission target Java ${config.TARGET_JAVA_VERSION}.`);
	}
	logging.logInfo(`Output limit: ${config.RUNNER_CONFIG.outputLimitBytes} bytes`);
	dispatcher.logCaptureAndBodySizeBalance();
	if (process.platform === "linux" && config.RUNNER_CONFIG.baseDir.startsWith("/dev/shm")) {
		logging.logInfo("Using /dev/shm for low-latency compile cache.");
	}
	await prepareLanguages();
	compiler.warmUpJavaTools();
	filesystem.ensureDirectory(config.RUNNER_CONFIG.dispatcherBuildDir);
	await dispatcher.ensureDispatcherReady();
	await dispatcher.warmUpDispatcher(resolveLibrarySourceRoot());
	const host = config.RUNNER_CONFIG.host;
	server.listen(config.RUNNER_CONFIG.port, host, () => {
		const message = "✓ Local Runner server is ready:";
		const link = `http://${host}:${config.RUNNER_CONFIG.port}`;
		logging.logInfo(color.supportsRunnerColor() ? `${color.ANSI.GREEN}${message}${color.ANSI.RESET} ${color.ANSI.CYAN}${link}${color.ANSI.RESET}` : `${message} ${link}`);
		logging.logInfo(`Allowed browser origins: ${[...ALLOWED_ORIGIN_HOSTS, ...config.SETTINGS.server.extraOrigins].join(", ")}`);
		logging.logInfo(`Runner label: ${compiler.RUNNER_LABEL}`);
		if (config.SETTINGS.update.check) void checkForUpdate(config.SETTINGS.update.repository, VERSION, (message) => logging.logInfo(color.colorizeWarning(message)));
	});
}

function shutdown(signal: string) {
	logging.logInfo(`Shutting down Local Runner server (${signal})...`);
	dispatcher.stopDispatcher();
	server.close(() => {
		process.exit(0);
	});
	// 接続が残っていても確実にプロセスを終了させる保険。
	setTimeout(() => process.exit(0), 1500).unref();
}

/**
 * サーバーを起動する。入口は、ソースから動かすときの daemon/main.ts と、CLI の daemon コマンド。
 * 1つの実行ファイルにまとめると、どのモジュールでも import.meta.url が同じになるので、直接実行されたかでは決めない。
 */
export async function startServer(): Promise<void> {
	server.on("error", (error) => {
		logging.logError(color.colorizeError(`[Server] ${error.message}`));
		process.exit(1);
	});
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("exit", () => dispatcher.stopDispatcher());
	try {
		await bootstrap();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logging.logError(color.colorizeError(`[Bootstrap] ${message}`));
		process.exit(1);
	}
}
