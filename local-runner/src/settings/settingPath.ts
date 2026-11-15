import os from "node:os";
import path from "node:path";
import {SettingsError} from "./settings";

// 設定に書かれたパスの読み替え。設定ファイルは Windows の CLI と WSL のサーバーの両方が読む。

export type PathEnvironment = {
	platform: NodeJS.Platform;
	homeDir: string;
};

function currentEnvironment(): PathEnvironment {
	return {platform: process.platform, homeDir: os.homedir()};
}

/** 命令の名前(java など)ではなく、場所を指しているか。 */
export function isPathLike(value: string): boolean {
	return value.startsWith("~") || /[\\/]/.test(value);
}

/**
 * 設定に書かれたパスを、読んでいる側の OS のパスにする。
 * - `~` は読んでいる側のホーム
 * - 相対パスは設定ファイルのあるフォルダから
 * - `C:/...` と `/mnt/c/...` は互いに読み替える
 */
export function resolveSettingPath(value: string, settingsFile: string, environment = currentEnvironment()): string {
	const {platform, homeDir} = environment;
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	if (value === "~" || /^~[\\/]/.test(value)) return pathApi.join(homeDir, value.slice(1));
	const drivePath = /^([A-Za-z]):[\\/](.*)$/.exec(value);
	if (drivePath) {
		const [, drive = "", rest = ""] = drivePath;
		return platform === "win32" ? pathApi.normalize(value) : `/mnt/${drive.toLowerCase()}/${rest.replaceAll("\\", "/")}`;
	}
	if (platform === "win32" && value.startsWith("/")) {
		const mounted = /^\/mnt\/([A-Za-z])\/(.*)$/.exec(value);
		if (!mounted) throw new SettingsError(`This path exists only inside WSL and cannot be read from Windows: ${value}`);
		const [, drive = "", rest = ""] = mounted;
		return pathApi.normalize(`${drive.toUpperCase()}:/${rest}`);
	}
	if (pathApi.isAbsolute(value)) return value;
	return pathApi.resolve(pathApi.dirname(settingsFile), value);
}
