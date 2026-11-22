import {safeJsonParse} from "@atcoder-tools/shared";
import {
	createDefaultSettings,
	featureOptions,
	isFeatureEnabled,
	parseSettings,
	type Settings,
	updateFeatureSettings,
	updateSiteFeatureSettings,
} from "@domain/settings/settings";
import type {KeyValueStore} from "@application/ports/key-value-store";

const STORAGE_KEY = "settings";

/** 1つのサイトから見た機能の設定。機能の起動と設定画面が使う。 */
export interface FeatureSettingsStore {
	/** 対象のサイト。サイトの外のページなら null。 */
	readonly site: string | null;

	isEnabled(featureId: string, defaultEnabled: boolean): boolean;

	storedOptions(featureId: string): unknown;

	setEnabled(featureId: string, enabled: boolean): void;

	setOption(featureId: string, key: string, value: unknown): void;

	/** 全サイトで同じ値を使う項目を変える。 */
	setSharedOption(featureId: string, key: string, value: unknown): void;

	subscribe(listener: () => void): void;
}

/** 保存した設定の全体。サイトを指定しない操作は、全サイトで同じ値と、サイトごとに分ける前の値を扱う。 */
export class SettingsService implements FeatureSettingsStore {
	readonly site = null;
	private settings: Settings;
	private readonly listeners = new Set<() => void>();
	private readonly store: KeyValueStore;

	/**
	 * 保存した設定が無いとき、installedBefore なら設定を変えずに使っていた人として、最初の形式から移行する。
	 * そうでなければ新しい利用者として、今の既定値で始める。
	 */
	constructor(store: KeyValueStore, {installedBefore = false}: {installedBefore?: boolean} = {}) {
		this.store = store;
		const stored = store.get(STORAGE_KEY);
		const raw = typeof stored === "string" ? safeJsonParse<unknown>(stored, null) : stored;
		const fresh = raw === null || raw === undefined;
		this.settings = fresh && !installedBefore ? createDefaultSettings() : parseSettings(fresh ? {} : raw);
		const storedVersion = raw && typeof raw === "object" && !Array.isArray(raw) && "version" in raw ? raw.version : undefined;
		// 新しい利用者の設定も保存しておき、次に既定値を変えるときに、その時点の利用者として移行できるようにする
		if (storedVersion !== this.settings.version) store.set(STORAGE_KEY, this.settings);
		store.subscribeRemote(STORAGE_KEY, (value) => this.replace(parseSettings(value)));
	}

	/** サイトから見た設定。サイトの外のページ(null)では、サイトごとに分ける前の値を使う。 */
	forSite(site: string | null): FeatureSettingsStore {
		if (site === null) return this;
		return {
			site,
			isEnabled: (featureId, defaultEnabled) => isFeatureEnabled(this.settings, featureId, site, defaultEnabled),
			storedOptions: (featureId) => featureOptions(this.settings, featureId, site),
			setEnabled: (featureId, enabled) => this.commit(updateSiteFeatureSettings(this.settings, featureId, site, {enabled})),
			setOption: (featureId, key, value) => {
				this.commit(updateSiteFeatureSettings(this.settings, featureId, site, {options: {[key]: value}}));
			},
			setSharedOption: (featureId, key, value) => this.setOption(featureId, key, value),
			subscribe: (listener) => this.subscribe(listener),
		};
	}

	isEnabled(featureId: string, defaultEnabled: boolean): boolean {
		return this.settings.features[featureId]?.enabled ?? defaultEnabled;
	}

	/** 機能の ON/OFF が保存されているか。既定値のままなら偽。 */
	hasEnabledChoice(featureId: string): boolean {
		return this.settings.features[featureId]?.enabled !== undefined;
	}

	storedOptions(featureId: string): unknown {
		return this.settings.features[featureId]?.options;
	}

	setEnabled(featureId: string, enabled: boolean): void {
		this.commit(updateFeatureSettings(this.settings, featureId, {enabled}));
	}

	setOption(featureId: string, key: string, value: unknown): void {
		this.commit(updateFeatureSettings(this.settings, featureId, {options: {[key]: value}}));
	}

	setSharedOption(featureId: string, key: string, value: unknown): void {
		this.setOption(featureId, key, value);
	}

	reset(): void {
		this.commit(createDefaultSettings());
	}

	exportJson(): string {
		return JSON.stringify(this.settings, null, "\t");
	}

	/** JSON として読めない場合は false を返し、現在の設定を変更しない。 */
	importJson(text: string): boolean {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return false;
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
		this.commit(parseSettings(parsed));
		return true;
	}

	subscribe(listener: () => void): void {
		this.listeners.add(listener);
	}

	private commit(settings: Settings): void {
		this.store.set(STORAGE_KEY, settings);
		this.replace(settings);
	}

	private replace(settings: Settings): void {
		this.settings = settings;
		for (const listener of this.listeners) listener();
	}
}
