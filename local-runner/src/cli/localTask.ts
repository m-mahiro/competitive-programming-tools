import path from "node:path";
import type {Task} from "../types";
import {createTask} from "./task";
import {resolveContestId, resolveTaskScreenName, taskIndexFromSourceArg} from "./taskScreenName";

// 通常は問題IDの接頭辞にもなるコンテスト名（例: ABC463, typical90）。
const CONVENTIONAL_CONTEST_DIR_PATTERN = /^[A-Za-z]+\d+$/;
// AtCoder のコンテストURLに使えるフォルダ名。`src` の親に限って採用し、範囲フォルダ等は弾く。
const CONTEST_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** cwd から上方向に辿り、原則として `src` の親フォルダ名をコンテストIDとして返す。 */
export function detectContestId(startDir: string): string {
	let dir = path.resolve(startDir);
	for (; ;) {
		const name = path.basename(dir);
		if (name.toLowerCase() === "src") {
			const candidate = path.basename(path.dirname(dir));
			if (CONTEST_SLUG_PATTERN.test(candidate)) return resolveContestId(candidate);
		}
		// 従来どおり、コンテスト直下で実行した場合も ABC463 等は認識する。
		if (CONVENTIONAL_CONTEST_DIR_PATTERN.test(name)) return resolveContestId(name);
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		`Could not find the contest name from the folders (no contest folder above src).\n` +
		`  Use the full form: test <contestId>_<task> <sourceFile>`,
	);
}

/** 旧コンテスト・同時開催・別名コンテストの問題IDを復元する。 */
export function resolveShortTask(contestId: string, taskLetter: string): Task {
	contestId = resolveContestId(contestId);
	return createTask(contestId, resolveTaskScreenName(contestId, taskLetter));
}

/** フォルダから開催回、ファイル名から問題記号を決める。 */
export function inferTask(sourceArg: string): Task {
	return resolveShortTask(detectContestId(process.cwd()), taskIndexFromSourceArg(sourceArg));
}
