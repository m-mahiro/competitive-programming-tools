import {matchPage} from "@domain/page/route";
import {FeatureRuntime} from "@application/feature/runtime";
import {importLegacySettings} from "@application/settings/legacy-import";
import {SettingsService} from "@application/settings/settings-service";
import {UpdateChecker} from "@application/update/update-checker";
import {updateCatalog} from "@catalog/tables";
import {ConsoleLogger} from "@adapters/console-logger";
import {DocumentLifecycle} from "@adapters/page/document-lifecycle";
import {LocalStorageLegacyInbox} from "@adapters/page/local-storage-legacy-inbox";
import {GmKeyValueStore} from "@adapters/userscript/gm-key-value-store";
import {GmScriptHost} from "@adapters/userscript/gm-script-host";
import {GmHttpClient} from "@adapters/userscript/gm-services";
import {createSettingsPanel, type SettingsPanel} from "@features/settings-panel/index";
import {addNavigationEntry} from "@features/settings-panel/navigation-entry";
import {notifyUpdate} from "@features/settings-panel/update-notice";
import {configureToasts} from "@ui/toast/toast";
import {createServices, judges} from "./container";
import {features} from "./registry";

export function bootstrap(): void {
	const host = new GmScriptHost();
	// 移行前のスクリプトは、この印を見て二重に動かないようにする
	document.documentElement.dataset.cpToolkit = host.version;

	const lifecycle = new DocumentLifecycle();
	const store = new GmKeyValueStore();
	const updates = new UpdateChecker({
		host,
		http: new GmHttpClient(),
		state: store,
		allowedHosts: updateCatalog.connect,
		intervalHours: updateCatalog.checkIntervalHours,
	});
	const settings = new SettingsService(store);
	importLegacySettings(new LocalStorageLegacyInbox(), settings);
	const page = matchPage(judges, location.href);
	const siteSettings = settings.forSite(page?.judge.id ?? null);
	let panel: SettingsPanel | null = null;
	const services = createServices(page, siteSettings, () => panel?.open());
	configureToasts({region: host.name, close: () => services.translate("settings.close")});

	const runtime = new FeatureRuntime({
		features,
		page,
		lifecycle,
		settings: siteSettings,
		services,
		logger: new ConsoleLogger(host.name),
	});
	runtime.start();

	const {translate} = services;
	panel = createSettingsPanel({features, settings, sites: judges, currentSite: page?.judge.id ?? null, runtime, translate, updates});
	// ページの言語は DOM の構築後に確定するので、それを待ってから文言を決める
	void lifecycle.reach("ready").then(() => {
		host.registerCommand(translate("settings.open"), () => panel?.open());
		if (page) addNavigationEntry(page.judge.navigationLists, host.name, () => panel?.open());
		// 新しいバージョンは、バージョンごとに1回だけ知らせる。設定画面にはいつでも表示する
		void updates.check(Date.now()).then((status) => {
			if (updates.claimNotification()) notifyUpdate(host.name, status, translate);
		});
	});
}
