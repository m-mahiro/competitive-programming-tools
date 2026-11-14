import fs from "node:fs";
import path from "node:path";
import {PROJECT_ROOT, SETTINGS} from "../../config";
import {findNewerRelease, installRelease} from "../../update/update";
import {VERSION} from "../../version";
import {postToRunner} from "../runnerClient";
import type {Command} from "./Command";
import {CliUsageError} from "./Command";

const MEBIBYTE = 1024 * 1024;
const SERVER_STOP_WAIT_MS = 10_000;

/** リポジトリのソースから動いているか。配布物には package.json が無い。 */
function isSourceCheckout(): boolean {
	return fs.existsSync(path.join(PROJECT_ROOT, "local-runner", "package.json"));
}

function megabytes(bytes: number): string {
	return `${(bytes / MEBIBYTE).toFixed(1)} MB`;
}

async function isServerRunning(): Promise<boolean> {
	try {
		return (await postToRunner({mode: "status"}, 1000)).ok;
	} catch {
		return false;
	}
}

/** サーバーが動いていれば止め、終わるまで待つ。実行ファイルを入れ替える前に呼ぶ。 */
async function stopServer(): Promise<void> {
	if (!await isServerRunning()) return;
	console.log("Stopping the Local Runner server...");
	await postToRunner({mode: "shutdown"}, 3000);
	const deadline = Date.now() + SERVER_STOP_WAIT_MS;
	while (await isServerRunning()) {
		if (Date.now() > deadline) throw new Error("The Local Runner server did not stop. Stop it with stop and run update again.");
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

/** 配布元の新しいバージョンへ入れ替える。設定ファイルには触れない。 */
export class UpdateCommand implements Command {
	readonly name = "update";
	readonly usageLines = [
		"  update                                  (update Local Runner to the latest release)",
		"  update --check                          (only show whether a newer release exists)",
	];

	async execute(args: readonly string[]): Promise<number> {
		const [option, extra] = args;
		if (extra !== undefined || (option !== undefined && option !== "--check")) throw new CliUsageError(`Unknown argument: ${extra ?? option}`);
		const release = await findNewerRelease(SETTINGS.update.repository, VERSION);
		if (release === null) {
			console.log(`Local Runner ${VERSION} is the latest version.`);
			return 0;
		}
		console.log(`Local Runner ${release.version} is available (installed: ${VERSION}).`);
		if (option === "--check") {
			console.log("Run update to install it.");
			return 0;
		}
		if (isSourceCheckout()) {
			throw new Error("This Local Runner runs from the source of the repository, so update does not replace it. Update the repository instead (git pull).");
		}

		const showProgress = process.stdout.isTTY === true;
		let shownMegabytes = -1;
		await installRelease(release, {
			installRoot: PROJECT_ROOT,
			progress: (received, total) => {
				const current = Math.floor(received / MEBIBYTE);
				if (!showProgress || current === shownMegabytes) return;
				shownMegabytes = current;
				process.stdout.write(`\rDownloading: ${megabytes(received)} / ${megabytes(total)}`);
			},
			beforeInstall: async (fileCount) => {
				if (showProgress) process.stdout.write("\n");
				await stopServer();
				console.log(`Installing ${fileCount} files into ${PROJECT_ROOT}...`);
			},
		});
		console.log(`Updated Local Runner to ${release.version}. The settings file was not changed.`);
		return 0;
	}
}
