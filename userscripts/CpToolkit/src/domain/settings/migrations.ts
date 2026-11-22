import type {FeatureSettings, Settings} from "./settings";

/** Easy Test+ のキーを使わない設定。旧版の設定の取り込みでも使う。 */
export const EASY_TEST_KEYS_OFF = {testAndSubmit: "none", testAll: "none", toggleEasyTest: "none"} as const;

/**
 * Toolkit 3.0 への移行。今までの利用者の動作を変えない。
 * - 提出補助(java-submit)は新しい利用者では既定で OFF にしたので、ON/OFF を選んでいない人は ON のままにする。
 * - 提出用のヘッダーの設定は、コードのヘッダーとフッターへ移す。ヘッダーを付けていなかった人は付けないままにする。
 * - 提出と折りたたみのキーはショートカットキーの機能へ移したので、提出補助を OFF にしていた人はキーを使わないままにする。
 * - Easy Test+ のキーも同じ機能へ移したので、Easy Test+ のショートカットを OFF にしていた人はキーを使わないままにする。
 * - 簡易変換の個別の設定は無くなったので消す。
 */
export function migrateToVersion2(settings: Settings): Settings {
	const helper = settings.features["java-submit"] ?? {};
	const {addHeader, headerName, removePackage, renameClass, fixDebug, ...remaining} = helper.options ?? {};
	const helperDisabled = helper.enabled === false;
	const features: Record<string, FeatureSettings> = {
		...settings.features,
		"java-submit": {...helper, enabled: helper.enabled ?? true, options: remaining},
	};

	const comments = settings.features["source-comments"];
	const commentOptions = {...comments?.options};
	if (commentOptions.runnerHeader === undefined && (helperDisabled || addHeader === false)) commentOptions.runnerHeader = "none";
	if (commentOptions.runnerHeaderName === undefined && typeof headerName === "string" && headerName !== "") {
		commentOptions.runnerHeaderName = headerName;
	}
	if (comments || Object.keys(commentOptions).length > 0) features["source-comments"] = {...comments, options: commentOptions};

	const easyTest = settings.features["easy-test"];
	const {keyboardShortcuts, ...easyTestOptions} = easyTest?.options ?? {};
	if (easyTest) features["easy-test"] = {...easyTest, options: easyTestOptions};

	const disabledKeys = {
		...helperDisabled ? {submit: "none", fold: "none"} : {},
		...keyboardShortcuts === false ? EASY_TEST_KEYS_OFF : {},
	};
	if (Object.keys(disabledKeys).length > 0) {
		const shortcuts = settings.features["keyboard-shortcuts"];
		features["keyboard-shortcuts"] = {...shortcuts, options: {...disabledKeys, ...shortcuts?.options}};
	}
	return {...settings, features};
}
