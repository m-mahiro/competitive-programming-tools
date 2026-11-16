import type {LocalRunnerHeaderOption} from "@atcoder-tools/shared";
import {CliUsageError, type Command} from "./Command";
import * as clipboard from "../clipboard";
import * as options from "./options";
import * as source from "./source";

/** 提出用に変換したソースを、ファイルを介さずクリップボードへコピーする。 */
export class ToclipCommand implements Command {
	readonly name = "toclip";
	readonly usageLines = [
		"  toclip [--lang=<name>] [--no-header|--header=<name>] <sourceFile>",
	];

	async execute(args: readonly string[]): Promise<number> {
		const positionals: string[] = [];
		let header: LocalRunnerHeaderOption = true;
		let lang: string | undefined;
		for (const arg of args) {
			const l = options.parseLangFlag(arg);
			if (l !== undefined) {
				lang = l;
				continue;
			}
			const h = options.parseHeaderFlag(arg);
			if (h !== undefined) {
				header = h;
				continue;
			}
			if (arg.startsWith("-")) throw new CliUsageError(`Unknown option: ${arg}`);
			positionals.push(arg);
		}
		if (positionals.length !== 1) throw new CliUsageError();
		const {resolvedSourcePath, transformed} = await source.transformSource(positionals[0], {header, lang});
		clipboard.copyToClipboard(transformed);
		console.log(`Copied submission source to clipboard: ${resolvedSourcePath}`);
		return 0;
	}
}
