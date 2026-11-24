import * as localSamples from "../localSamples";
import * as sampleJudge from "../sampleJudge";
import {CliUsageError, type Command} from "./Command";
import * as options from "./options";
import * as source from "./source";

/** ローカルの .in/.out をサンプルとして実行・判定する（AtCoder へはアクセスしない）。DEBUG は既定で有効。 */
export class LocalTestCommand implements Command {
	readonly name = "localtest";
	readonly usageLines = [
		"  localtest [-d|--debug[=true|false]] [--lang=<name>] [--no-header|--header=<name>] [--full] [--wa-only] [--max-lines=N] [--time-limit=N] <sourceFile> [testDir]",
		"                                          (run local .in/.out samples; DEBUG is on by default)",
	];

	async execute(args: readonly string[]): Promise<number> {
		let debug = true; // 既定で DEBUG 有効。-d/--debug で上書き。
		const display: sampleJudge.SampleDisplayOptions = {};
		const {positionals, lang, header} = options.parseSourceArgs(args, 2, (arg) => {
			const debugOption = options.parseBoolFlag(arg, "--debug", "-d");
			if (debugOption !== undefined) {
				debug = debugOption;
				return true;
			}
			return options.parseDisplayFlag(arg, display);
		});
		const [sourceFilePath, testDir] = positionals;
		if (!sourceFilePath) throw new CliUsageError();

		const {resolvedSourcePath, program, restoreNames} = await source.compileSource(sourceFilePath, debug, {lang, header});
		const samples = localSamples.loadLocalSamples(resolvedSourcePath, testDir);
		const allAccepted = await sampleJudge.runAndReportSamples(program, samples, restoreNames, display);
		return allAccepted ? 0 : 5;
	}
}
