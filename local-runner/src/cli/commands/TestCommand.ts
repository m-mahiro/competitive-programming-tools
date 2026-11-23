import {TaskCommand, type TaskRunContext} from "./TaskCommand";

/**
 * サンプルをローカル実行して AC 判定だけ行う（提出はしない）。DEBUG は既定で有効。
 * ヘッダーは submit と同じく既定で付ける。CP Toolkit の Easy Test+ もヘッダーの入ったコードを DEBUG ありで送るので、
 * 同じコードならサーバーのコンパイル結果を共有できる。
 */
export class TestCommand extends TaskCommand {
	readonly name = "test";
	readonly usageLines = [
		"  test [-d|--debug[=true|false]] [--lang=<name>] [--no-header|--header=<name>] [--full] [--wa-only] [--max-lines=N] <taskScreenName> <sourceFile>",
		"  test [...options] <sourceFile>          (infer from folder and file name; extension optional)",
	];
	protected readonly allowForce = false;
	protected readonly debug = true;
	protected readonly supportsDebugOption = true;
	protected readonly supportsDisplayOptions = true;
	protected readonly supportsHeaderOption = true;

	protected onSamplesComplete({allAccepted}: TaskRunContext): number {
		return allAccepted ? 0 : 5;
	}
}
