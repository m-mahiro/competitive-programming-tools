import {describe, expect, test} from "bun:test";
import {resolveSettingPath} from "./settingPath";
import {SettingsError} from "./settings";

describe("resolveSettingPath", () => {
	const linux = {platform: "linux", homeDir: "/home/me"} as const;
	const windows = {platform: "win32", homeDir: "C:\\Users\\me"} as const;

	test("~ は読んでいる側のホームにする", () => {
		expect(resolveSettingPath("~/.atcoder/session.txt", "/mnt/c/tools/s.json", linux)).toBe("/home/me/.atcoder/session.txt");
		expect(resolveSettingPath("~/.atcoder/session.txt", "C:\\tools\\s.json", windows)).toBe("C:\\Users\\me\\.atcoder\\session.txt");
	});

	test("相対パスは設定ファイルのあるフォルダから解決する", () => {
		expect(resolveSettingPath("../library/java/src", "/mnt/c/repo/tools/s.json", linux)).toBe("/mnt/c/repo/library/java/src");
		expect(resolveSettingPath("../library/java/src", "C:\\repo\\tools\\s.json", windows)).toBe("C:\\repo\\library\\java\\src");
	});

	test("WSL では Windows のパスを /mnt の形にする", () => {
		expect(resolveSettingPath("C:\\Users\\me\\library\\src", "/mnt/c/tools/s.json", linux)).toBe("/mnt/c/Users/me/library/src");
		expect(resolveSettingPath("D:/library/src", "/mnt/c/tools/s.json", linux)).toBe("/mnt/d/library/src");
	});

	test("Windows では /mnt のパスをドライブのパスにする", () => {
		expect(resolveSettingPath("/mnt/c/Users/me/library/src", "C:\\tools\\s.json", windows)).toBe("C:\\Users\\me\\library\\src");
	});

	test("WSL だけにあるパスを Windows から読むとエラーにする", () => {
		expect(() => resolveSettingPath("/home/me/session.txt", "C:\\tools\\s.json", windows)).toThrow(SettingsError);
	});

	test("読んでいる側の絶対パスは変えない", () => {
		expect(resolveSettingPath("/home/me/library/src", "/mnt/c/tools/s.json", linux)).toBe("/home/me/library/src");
		expect(resolveSettingPath("C:\\library\\src", "C:\\tools\\s.json", windows)).toBe("C:\\library\\src");
	});
});
