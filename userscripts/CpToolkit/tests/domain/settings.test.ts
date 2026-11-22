import {describe, expect, test} from "bun:test";
import {
	createDefaultSettings,
	CURRENT_SETTINGS_VERSION,
	parseSettings,
	updateFeatureSettings,
} from "@domain/settings/settings";

describe("parseSettings", () => {
	test("値がなければ既定の設定を返す", () => {
		expect(parseSettings(undefined)).toEqual(createDefaultSettings());
	});

	test("壊れた値は既定の設定として扱う", () => {
		expect(parseSettings("{broken")).toEqual(createDefaultSettings());
		expect(parseSettings([1, 2])).toEqual(createDefaultSettings());
	});

	test("機能の設定を読み取り、型の違う項目は捨てる", () => {
		const settings = parseSettings({
			version: CURRENT_SETTINGS_VERSION,
			features: {a: {enabled: "yes", options: {x: 1}}, b: {enabled: false}},
		});
		expect(settings.features).toEqual({a: {options: {x: 1}}, b: {enabled: false, options: {}}});
	});

	test("古い版は現在の版に上げる", () => {
		expect(parseSettings({version: 0, features: {}}).version).toBe(CURRENT_SETTINGS_VERSION);
	});

	test("新しい版を読んでも版を下げない", () => {
		const version = CURRENT_SETTINGS_VERSION + 1;
		expect(parseSettings({version, features: {}}).version).toBe(version);
	});
});

describe("updateFeatureSettings", () => {
	test("元の値を変更せず、他の項目を保持する", () => {
		const original = updateFeatureSettings(createDefaultSettings(), "a", {enabled: true, options: {x: 1}});
		const updated = updateFeatureSettings(original, "a", {options: {y: 2}});
		expect(original.features.a?.options).toEqual({x: 1});
		expect(updated.features.a).toEqual({enabled: true, options: {x: 1, y: 2}});
	});
});

describe("3.0 への移行", () => {
	test("提出補助の ON/OFF を選んでいなければ、今までどおり ON にする", () => {
		expect(parseSettings({version: 1, features: {}}).features["java-submit"]?.enabled).toBe(true);
		expect(parseSettings({version: 1, features: {"java-submit": {enabled: false}}}).features["java-submit"]?.enabled).toBe(false);
	});

	test("ヘッダーの名前を移し、ヘッダーを付けていなかった人は付けないままにする", () => {
		const raw = {version: 1, features: {"java-submit": {options: {addHeader: true, headerName: "license", renameClass: false}}}};
		const migrated = parseSettings(raw);
		expect(migrated.features["source-comments"]?.options).toEqual({runnerHeaderName: "license"});
		expect(migrated.features["java-submit"]?.options).toEqual({});
		expect(parseSettings(migrated)).toEqual(migrated);
		const withoutHeader = parseSettings({version: 1, features: {"java-submit": {options: {addHeader: false}}}});
		expect(withoutHeader.features["source-comments"]?.options).toEqual({runnerHeader: "none"});
	});

	test("提出補助を OFF にしていた人は、ヘッダーも提出のキーも使わないままにする", () => {
		const migrated = parseSettings({version: 1, features: {"java-submit": {enabled: false}}});
		expect(migrated.features["source-comments"]?.options).toEqual({runnerHeader: "none"});
		expect(migrated.features["keyboard-shortcuts"]?.options).toEqual({submit: "none"});
	});

	test("Easy Test+ のショートカットを OFF にしていた人は、Easy Test+ のキーを使わないままにする", () => {
		const migrated = parseSettings({version: 1, features: {"easy-test": {enabled: true, options: {keyboardShortcuts: false, precompile: false}}}});
		expect(migrated.features["easy-test"]).toEqual({enabled: true, options: {precompile: false}});
		expect(migrated.features["keyboard-shortcuts"]?.options).toEqual({testAndSubmit: "none", testAll: "none", toggleEasyTest: "none"});
		const kept = parseSettings({version: 1, features: {"easy-test": {options: {keyboardShortcuts: true}}}});
		expect(kept.features["keyboard-shortcuts"]).toBeUndefined();
	});

	test("新しい形式の設定を優先する", () => {
		const raw = {version: 1, features: {"java-submit": {enabled: false}, "source-comments": {options: {runnerHeader: "below"}}}};
		expect(parseSettings(raw).features["source-comments"]?.options?.runnerHeader).toBe("below");
	});
});
