import {pathToFileURL} from "node:url";
import {migrateFromEarlierVersions} from "../migration";
import {removeStaleFile} from "../update/installer";
import {colorizeError} from "../utils/color";
import {CliUsageError} from "./commands/Command";
import * as registry from "./commands/registry";

/**
 * エントリポイント。
 * コマンド名でレジストリを引き、見つかったコマンドの execute() に残り引数を渡すだけ。
 * 引数の検証・実行は各コマンドクラスの内部に閉じている。
 */
export async function main(rawArgs = process.argv.slice(2)): Promise<number> {
	const [name, ...rest] = rawArgs;
	const command = name ? registry.getCommand(name) : undefined;
	if (!command) {
		registry.printUsage();
		return 1;
	}

	// update が入れ替えた実行ファイルの古いものは、動いている間は消せないので、次の起動で消す。
	removeStaleFile(process.execPath);

	// daemon はサーバーが行って記録に残すので、ここでは行わない。
	if (command.name !== "daemon") {
		migrateFromEarlierVersions({warn: (message) => console.error(`Warning: ${message}`), info: (message) => console.error(message)});
	}

	try {
		return await command.execute(rest);
	} catch (error) {
		if (error instanceof CliUsageError) {
			if (error.message) console.error(error.message);
			registry.printUsage();
			return 1;
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(colorizeError(message.startsWith("[auth] ") ? message : `Error: ${message}`, "cli"));
		return 1;
	}
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
const isBunEntry = Boolean(import.meta.main);

if (isDirectRun || isBunEntry) process.exit(await main());
