import {safeJsonParse} from "@atcoder-tools/shared";
import {createDefaultSettings, parseSettings, type Settings, updateFeatureSettings} from "@domain/settings/settings";
import type {KeyValueStore} from "@application/ports/key-value-store";

const STORAGE_KEY = "settings";

export class SettingsService {
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
