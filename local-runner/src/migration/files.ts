import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 以前のバージョンが作り、今は使わないファイルとフォルダ。
 * 置き場所や名前を変えたら、古い場所をここに足す。
 */
export function legacyFiles(platform = process.platform, homeDir = os.homedir(), tempDir = os.tmpdir()): string[] {
	return [
		// 作業フォルダ(1.0.0 で local-runner に改名)
		platform === "linux" ? "/dev/shm/atcoder-local-runner" : path.join(tempDir, "atcoder-local-runner"),
		// WSL の中の CLI が書いた自動起動の記録(1.0.0 で ~/.cache/competitive-programming/local-runner へ移動)
		path.join(homeDir, ".atcoder", "runner-autostart.log"),
	];
}

/** 残っているものを消し、消せたものを返す。消せなければ残し、次の起動でまた試す。 */
export function removeLegacyFiles(targets = legacyFiles()): string[] {
	return targets.filter((target) => {
		if (!fs.existsSync(target)) return false;
		try {
			fs.rmSync(target, {recursive: true, force: true});
			return true;
		} catch {
			return false;
		}
	});
}
