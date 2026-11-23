import {parseStoredObject} from "@atcoder-tools/shared";

import {migrateToVersion2} from "./migrations";

export const CURRENT_SETTINGS_VERSION = 2;

/** 1つのサイトでの ON/OFF と値。 */
export type SiteFeatureSettings = {
	readonly enabled?: boolean;
	readonly options?: Readonly<Record<string, unknown>>;
};

/**
 * 機能の設定。ON/OFF と値はサイトごとに持つ(sites)。
 * enabled と options は、全サイトで同じ値を使う項目と、サイトごとに分ける前の設定。サイトの値が無ければこれを使う。
 */
export type FeatureSettings = SiteFeatureSettings & {
	readonly sites?: Readonly<Record<string, SiteFeatureSettings>>;
};

export type Settings = {
	readonly version: number;
	readonly features: Readonly<Record<string, FeatureSettings>>;
};

type SettingsMigration = (settings: Settings) => Settings;

/** キーの版から次の版へ移行する処理。保存形式を変えるたびに追加する。 */
const MIGRATIONS: Readonly<Record<number, SettingsMigration>> = {1: migrateToVersion2};

export function createDefaultSettings(): Settings {
	return {version: CURRENT_SETTINGS_VERSION, features: {}};
}

function parseSiteFeatureSettings(raw: unknown): SiteFeatureSettings {
	const {enabled, options} = parseStoredObject<Record<string, unknown>>(raw);
	return {
		...(typeof enabled === "boolean" ? {enabled} : {}),
		options: parseStoredObject<Record<string, unknown>>(options),
	};
}

function parseFeatureSettings(raw: unknown): FeatureSettings {
	const sites = Object.entries(parseStoredObject<Record<string, unknown>>(parseStoredObject<Record<string, unknown>>(raw).sites));
	return {
		...parseSiteFeatureSettings(raw),
		...(sites.length > 0 ? {sites: Object.fromEntries(sites.map(([site, value]) => [site, parseSiteFeatureSettings(value)]))} : {}),
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSiteFeatureSettings(value: unknown): boolean {
	return isPlainObject(value) && (value.enabled === undefined || typeof value.enabled === "boolean")
		&& (value.options === undefined || isPlainObject(value.options));
}

/**
 * 書き出した設定(exportJson)の形か。読み込み(importJson)で、ほかの用途の JSON を設定として扱わないために使う。
 * 版は 1 から現在の版まで、features は機能ごとの ON/OFF、値、サイトごとの設定を持つ。
 */
export function isSettingsBackup(raw: unknown): boolean {
	if (!isPlainObject(raw) || !isPlainObject(raw.features)) return false;
	const {version} = raw;
	if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || version > CURRENT_SETTINGS_VERSION) return false;
	return Object.values(raw.features).every((feature) => isSiteFeatureSettings(feature)
		&& (!isPlainObject(feature) || feature.sites === undefined || isPlainObject(feature.sites) && Object.values(feature.sites).every(isSiteFeatureSettings)));
}

/** 保存値を読み取り、現在の版へ移行する。壊れた値は既定値として扱う。 */
export function parseSettings(raw: unknown): Settings {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return createDefaultSettings();
	const {version, features} = parseStoredObject<Record<string, unknown>>(raw);
	const entries = Object.entries(parseStoredObject<Record<string, unknown>>(features));
	let settings: Settings = {
		version: typeof version === "number" && Number.isSafeInteger(version) && version >= 0 ? version : 1,
		features: Object.fromEntries(entries.map(([id, value]) => [id, parseFeatureSettings(value)])),
	};
	while (settings.version < CURRENT_SETTINGS_VERSION) {
		const migrated = MIGRATIONS[settings.version]?.(settings) ?? settings;
		settings = {...migrated, version: settings.version + 1};
	}
	return settings;
}

export function updateFeatureSettings(settings: Settings, featureId: string, patch: SiteFeatureSettings): Settings {
	const current = settings.features[featureId];
	const next = {...current, ...patch, options: {...current?.options, ...patch.options}};
	return {...settings, features: {...settings.features, [featureId]: next}};
}

/** 1つのサイトの ON/OFF と値を変える。ほかのサイトには影響しない。 */
export function updateSiteFeatureSettings(settings: Settings, featureId: string, site: string, patch: SiteFeatureSettings): Settings {
	const current = settings.features[featureId];
	const currentSite = current?.sites?.[site];
	const nextSite = {...currentSite, ...patch, options: {...currentSite?.options, ...patch.options}};
	const next = {...current, sites: {...current?.sites, [site]: nextSite}};
	return {...settings, features: {...settings.features, [featureId]: next}};
}

/** サイトでの ON/OFF。サイトの値が無ければ、分ける前の値、既定値の順に使う。 */
export function isFeatureEnabled(settings: Settings, featureId: string, site: string | null, defaultEnabled: boolean): boolean {
	const feature = settings.features[featureId];
	const own = site === null ? undefined : feature?.sites?.[site]?.enabled;
	return own ?? feature?.enabled ?? defaultEnabled;
}

/** サイトでの値。サイトの値を、全サイト共通の値と分ける前の値に重ねる。 */
export function featureOptions(settings: Settings, featureId: string, site: string | null): Readonly<Record<string, unknown>> {
	const feature = settings.features[featureId];
	return {...feature?.options, ...(site === null ? undefined : feature?.sites?.[site]?.options)};
}
