import * as color from "../../utils/color";
import * as atcoder from "../atcoder";
import {TaskCommand, type TaskRunContext} from "./TaskCommand";

/** サンプルが全 AC なら（-f 指定時は非 AC でも）AtCoder へ提出し、結果をポーリング表示する。 */
export class SubmitCommand extends TaskCommand {
	readonly name = "submit";
	readonly usageLines = [
		"  submit [-f|--force] [--lang=<name>] [--no-header|--header=<name>] [--full] [--wa-only] [--max-lines=N] <taskScreenName> <sourceFile>",
		"  submit [...options] <sourceFile>        (infer from folder and file name; extension optional)",
	];
	protected readonly allowForce = true;
	protected readonly debug = false;

	protected async onSamplesComplete({task, language, transformed, allAccepted, force}: TaskRunContext): Promise<number> {
		if (!allAccepted) {
			if (!force) {
				console.log(color.colorizeWarning("Not submitting because at least one sample test is not AC.", "cli"));
				return 5;
			}
			console.log(color.colorizeWarning("Warning: forcing submit despite non-AC sample results (-f/--force).", "cli"));
		}

		const cookieHeader = atcoder.toCookieHeader();
		const submitResult = await atcoder.submitToAtCoder(task, transformed, cookieHeader, language);

		const {submissionId, submissionUrl} = submitResult;
		if (submitResult.trackingUnavailable) {
			// 提出が受け付けられたかを確かめられないときは、別の提出の結果を表示しないよう、追跡せずに一覧を示す。
			console.log(color.colorizeWarning(`Submit was sent, but the new submission could not be identified. Check the list: ${submissionUrl}`, "cli"));
			return 9;
		}

		// ここまで来れば提出自体は成功している。以降の結果ポーリングが失敗しても
		// 「提出は成功」を明示し、提出 ID/URL を必ず表示して専用終了コードで返す。
		try {
			const finalResult = await atcoder.pollSubmissionFinal(task.contestId, submissionId, cookieHeader);
			console.log(
				`Result: ${color.colorizeStatus(finalResult.status)} | ID: ${submissionId} | Exec: ${atcoder.formatMetricValue(finalResult.execTime)} | Memory: ${atcoder.formatMetricValue(finalResult.memory)} | URL: ${submissionUrl}`,
			);
			return finalResult.status === "AC" ? 0 : 8;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.log(`${color.colorizeSuccess("Submitted successfully", "cli")} (ID: ${submissionId} | URL: ${submissionUrl}), but result tracking failed: ${message}`);
			return 9;
		}
	}
}
