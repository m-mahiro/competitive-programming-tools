import type {Command} from "./Command";
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
		const {positionals, lang, header} = options.parseSourceArgs(args, 1);
		const {resolvedSourcePath, transformed} = await source.transformSource(positionals[0], {header, lang});
		clipboard.copyToClipboard(transformed);
		console.log(`Copied submission source to clipboard: ${resolvedSourcePath}`);
		return 0;
	}
}
