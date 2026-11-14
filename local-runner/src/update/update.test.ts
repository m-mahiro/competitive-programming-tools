import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {installPackage, type PackageFile, toPackageFiles} from "./installer";
import {compareVersions, type FetchFunction, fetchLatestRelease, findPackageAsset, selectLatestRelease} from "./release";
import {createTestZip} from "./testZip";
import {findNewerRelease, installRelease} from "./update";
import {readZip} from "./zip";

let dir: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-update-"));
});

afterEach(() => {
	fs.rmSync(dir, {recursive: true, force: true});
});

function write(relativePath: string, content: string): void {
	const file = path.join(dir, relativePath);
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, content);
}

function read(relativePath: string): string {
	return fs.readFileSync(path.join(dir, relativePath), "utf8");
}

/** 導入先にあるファイルの一覧。入れ替えのあとに、作業用のファイルが残っていないかを見る。 */
function listFiles(base = dir, prefix = ""): string[] {
	return fs.readdirSync(base, {withFileTypes: true}).flatMap((entry) => entry.isDirectory()
		? listFiles(path.join(base, entry.name), `${prefix}${entry.name}/`)
		: [`${prefix}${entry.name}`]).sort();
}

describe("readZip", () => {
	test("無圧縮と deflate の中身を取り出す", () => {
		const long = "abc".repeat(5000);
		const entries = readZip(createTestZip([
			{name: "top/"},
			{name: "top/plain.txt", data: "hello", stored: true},
			{name: "top/日本語.txt", data: long},
			{name: "top/empty.txt"},
		]));
		expect(entries.map(({name, isDirectory}) => ({name, isDirectory}))).toEqual([
			{name: "top/", isDirectory: true},
			{name: "top/plain.txt", isDirectory: false},
			{name: "top/日本語.txt", isDirectory: false},
			{name: "top/empty.txt", isDirectory: false},
		]);
		expect(entries[1]!.read().toString()).toBe("hello");
		expect(entries[2]!.read().toString()).toBe(long);
		expect(entries[3]!.read().length).toBe(0);
	});

	test("Unix で作った zip からは権限を読み、それ以外は null にする", () => {
		const [executable, plain] = readZip(createTestZip([{name: "bin/tool", data: "x", mode: 0o755}, {name: "bin/tool.cmd", data: "x"}]));
		expect(executable!.mode).toBe(0o755);
		expect(plain!.mode).toBeNull();
	});

	test("末尾にコメントがあっても読める", () => {
		expect(readZip(createTestZip([{name: "a.txt", data: "a"}], "a comment at the end")).map(({name}) => name)).toEqual(["a.txt"]);
	});

	test("zip でないものと、中身が壊れたものはエラーにする", () => {
		expect(() => readZip(Buffer.from("not a zip"))).toThrow("too short");
		expect(() => readZip(Buffer.alloc(100))).toThrow("end record was not found");
		const archive = createTestZip([{name: "a.txt", data: "hello hello hello", stored: true}]);
		archive[30 + "a.txt".length] = archive[30 + "a.txt".length]! ^ 0xff;
		expect(() => readZip(archive)[0]!.read()).toThrow("does not match its checksum");
	});
});

describe("バージョンの比較", () => {
	test("数として比べ、足りない桁は 0 とみなす", () => {
		expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
		expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
		expect(compareVersions("2.0", "2.0.0")).toBe(0);
	});

	test("バージョンの形でないものは受け付けない", () => {
		expect(() => compareVersions("latest", "1.0.0")).toThrow("Not a version: latest");
		expect(() => compareVersions("1.0.0", "1.2.3-beta")).toThrow("Not a version: 1.2.3-beta");
		expect(() => compareVersions("v1.2.3", "1.0.0")).toThrow("Not a version: v1.2.3");
	});
});

function release(tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	const version = tag.replace("local-runner-v", "");
	return {
		tag_name: tag,
		draft: false,
		prerelease: false,
		assets: [{
			name: `local-runner-${version}.zip`,
			size: 10,
			browser_download_url: `https://example.invalid/${tag}.zip`,
			digest: `sha256:${"ab".repeat(32)}`,
		}],
		...extra,
	};
}

describe("selectLatestRelease", () => {
	test("公開済みの Local Runner の Release から、最も新しいものを選ぶ", () => {
		const selected = selectLatestRelease([
			release("local-runner-v1.2.0"),
			release("local-runner-v1.10.0"),
			release("local-runner-v2.0.0", {draft: true}),
			release("local-runner-v3.0.0", {prerelease: true}),
			release("legacy-userscripts-final"),
			release("local-runner-v9.9.9-beta"),
			release("local-runner-v1.9.0"),
		]);
		expect(selected?.version).toBe("1.10.0");
		expect(selected?.tag).toBe("local-runner-v1.10.0");
	});

	test("該当する Release が無ければ null を返す", () => {
		expect(selectLatestRelease([release("legacy-userscripts-final")])).toBeNull();
		expect(selectLatestRelease({message: "Not Found"})).toBeNull();
	});

	test("配布物の zip と、配布元の示す SHA-256 を読む", () => {
		const selected = selectLatestRelease([release("local-runner-v1.2.0", {
			assets: [
				{name: "notes.txt", size: 1, browser_download_url: "https://example.invalid/notes.txt"},
				{name: "local-runner-1.2.0.zip", size: 5, browser_download_url: "https://example.invalid/p.zip", digest: `sha256:${"CD".repeat(32)}`},
			],
		})])!;
		expect(findPackageAsset(selected)).toEqual({name: "local-runner-1.2.0.zip", size: 5, url: "https://example.invalid/p.zip", sha256: "cd".repeat(32)});
		expect(selected.assets[0]!.sha256).toBeNull();
		expect(findPackageAsset({...selected, assets: selected.assets.slice(0, 1)})).toBeNull();
	});
});

/** 決まった応答を返す、通信の代役。呼ばれた URL を記録する。 */
function fakeFetch(responses: Record<string, () => Response>): {fetchImpl: FetchFunction; urls: string[]} {
	const urls: string[] = [];
	return {
		urls,
		fetchImpl: async (url) => {
			urls.push(url);
			return responses[url]?.() ?? new Response("not found", {status: 404});
		},
	};
}

describe("fetchLatestRelease", () => {
	const api = "https://api.github.com/repos/someone/tools/releases?per_page=100";

	test("設定のリポジトリの Release の一覧を取得する", async () => {
		const {fetchImpl, urls} = fakeFetch({[api]: () => Response.json([release("local-runner-v1.1.0")])});
		expect((await fetchLatestRelease("someone/tools", fetchImpl))?.version).toBe("1.1.0");
		expect(urls).toEqual([api]);
	});

	test("取得できなければ、理由を付けてエラーにする", async () => {
		const limited = fakeFetch({[api]: () => new Response("", {status: 403})});
		await expect(fetchLatestRelease("someone/tools", limited.fetchImpl)).rejects.toThrow("request limit of GitHub");
		const missing = fakeFetch({});
		await expect(fetchLatestRelease("someone/tools", missing.fetchImpl)).rejects.toThrow('Check "update.repository"');
	});

	test("今より新しい Release だけを返す", async () => {
		const {fetchImpl} = fakeFetch({[api]: () => Response.json([release("local-runner-v1.1.0")])});
		expect((await findNewerRelease("someone/tools", "1.0.0", fetchImpl))?.version).toBe("1.1.0");
		expect(await findNewerRelease("someone/tools", "1.1.0", fetchImpl)).toBeNull();
		expect(await findNewerRelease("someone/tools", "2.0.0", fetchImpl)).toBeNull();
	});
});

describe("toPackageFiles", () => {
	test("最上位のフォルダを除き、導入先からの相対パスにする", () => {
		const files = toPackageFiles(readZip(createTestZip([
			{name: "any-folder-name/"},
			{name: "any-folder-name/README.md", data: "readme"},
			{name: "any-folder-name/local-runner/bin/"},
			{name: "any-folder-name/local-runner/bin/tool", data: "tool", mode: 0o755},
		])));
		expect(files.map(({relativePath, mode}) => ({relativePath, mode}))).toEqual([
			{relativePath: "README.md", mode: null},
			{relativePath: "local-runner/bin/tool", mode: 0o755},
		]);
	});

	test("導入先の外へ出るパスと、最上位のフォルダが1つでないものは受け付けない", () => {
		const reject = (names: string[], message: string) => {
			const archive = createTestZip(names.map((name) => ({name, data: "x"})));
			expect(() => toPackageFiles(readZip(archive))).toThrow(message);
		};
		reject(["top/../outside.txt"], "unsafe path");
		reject(["top/a/../../outside.txt"], "unsafe path");
		reject(["/etc/passwd"], "unsafe path");
		reject(["top\\file.txt"], "unsafe path");
		reject(["C:/Windows/file.txt"], "unsafe path");
		reject(["top/a.txt", "other/b.txt"], "one top folder");
		reject(["file-at-the-top.txt"], "outside its top folder");
		expect(() => toPackageFiles(readZip(createTestZip([{name: "top/"}])))).toThrow("The package is empty.");
	});
});

function packageFiles(contents: Record<string, string>): PackageFile[] {
	return Object.entries(contents).map(([relativePath, content]) => ({relativePath, mode: null, read: () => Buffer.from(content)}));
}

describe("installPackage", () => {
	test("パッケージのファイルを入れ替え、ほかのファイルには触れない", () => {
		write("README.md", "old readme");
		write("local-runner/bin/tool.cmd", "old tool");
		write("local-runner.settings.json", "{\"mine\": true}");
		installPackage(packageFiles({
			"README.md": "new readme",
			"local-runner/bin/tool.cmd": "new tool",
			"local-runner/bin/added.cmd": "added",
		}), dir);
		expect(read("README.md")).toBe("new readme");
		expect(read("local-runner/bin/tool.cmd")).toBe("new tool");
		expect(read("local-runner/bin/added.cmd")).toBe("added");
		expect(read("local-runner.settings.json")).toBe("{\"mine\": true}");
		expect(listFiles()).toEqual(["README.md", "local-runner.settings.json", "local-runner/bin/added.cmd", "local-runner/bin/tool.cmd"]);
	});

	test("取り出しに失敗したら、導入先を変えない", () => {
		write("README.md", "old readme");
		const files = [...packageFiles({"README.md": "new readme"}), {
			relativePath: "broken.bin",
			mode: null,
			read: (): Buffer => {
				throw new Error("broken entry");
			},
		}];
		expect(() => installPackage(files, dir)).toThrow("broken entry");
		expect(listFiles()).toEqual(["README.md"]);
		expect(read("README.md")).toBe("old readme");
	});

	test("入れ替えの途中で失敗したら、入れ替えたファイルを元に戻す", () => {
		write("a.txt", "old a");
		write("b.txt", "old b");
		// blocker はファイルなので、その下にフォルダを作れずに失敗する
		write("blocker", "a file, not a folder");
		expect(() => installPackage(packageFiles({"a.txt": "new a", "b.txt": "new b", "blocker/c.txt": "new c"}), dir)).toThrow();
		expect(listFiles()).toEqual(["a.txt", "b.txt", "blocker"]);
		expect(read("a.txt")).toBe("old a");
		expect(read("b.txt")).toBe("old b");
	});
});

describe("installRelease", () => {
	const archive = createTestZip([{name: "package/"}, {name: "package/README.md", data: "new readme"}]);
	const sha256 = crypto.createHash("sha256").update(archive).digest("hex");
	const target = (digest: string | undefined) => ({
		version: "1.1.0",
		tag: "local-runner-v1.1.0",
		assets: [{name: "local-runner-1.1.0.zip", size: archive.length, url: "https://example.invalid/p.zip", sha256: digest ?? null}],
	});
	const options = (fetchImpl: FetchFunction, events: string[]) => ({
		installRoot: dir,
		fetchImpl,
		progress: () => undefined,
		beforeInstall: async (fileCount: number) => {
			events.push(`before install: ${fileCount}`);
		},
	});
	const download = () => fakeFetch({"https://example.invalid/p.zip": () => new Response(archive)});

	test("検証に通ったら、入れ替えの前の処理を呼んでから入れ替える", async () => {
		write("README.md", "old readme");
		const events: string[] = [];
		await installRelease(target(sha256), options(download().fetchImpl, events));
		expect(events).toEqual(["before install: 1"]);
		expect(read("README.md")).toBe("new readme");
	});

	test("SHA-256 が合わなければ、何も変えない", async () => {
		write("README.md", "old readme");
		const events: string[] = [];
		await expect(installRelease(target("00".repeat(32)), options(download().fetchImpl, events))).rejects.toThrow("does not match its checksum");
		expect(events).toEqual([]);
		expect(read("README.md")).toBe("old readme");
	});

	test("SHA-256 が示されていない配布物と、配布物の無い Release は入れない", async () => {
		const events: string[] = [];
		await expect(installRelease(target(undefined), options(download().fetchImpl, events))).rejects.toThrow("cannot be verified");
		await expect(installRelease({...target(sha256), assets: []}, options(download().fetchImpl, events))).rejects.toThrow("has no package");
		await expect(installRelease(target(sha256), options(fakeFetch({}).fetchImpl, events))).rejects.toThrow("Could not download");
		expect(events).toEqual([]);
	});
});
