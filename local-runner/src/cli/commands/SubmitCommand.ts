import * as shared from "@atcoder-tools/shared";
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
	// 提出前のサンプル表示は test と同じ表示オプションを使える（DEBUG は本番固定なので -d は不可）。
	protected readonly supportsDisplayOptions = true;
	protected readonly supportsHeaderOption = true;

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

		let submissionId = submitResult.submissionId;
		let submissionUrl = submitResult.submissionUrl;
		if (submitResult.trackingUnavailable) {
			const latestId = await atcoder.fetchLatestSubmissionId(task, cookieHeader);
			if (!latestId) {
				throw new Error("Submission tracking failed: could not resolve latest submission ID.");
			}
			submissionId = latestId;
			submissionUrl = shared.buildAtCoderSubmissionUrl(task.contestId, latestId);
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
