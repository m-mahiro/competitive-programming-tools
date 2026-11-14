import {readMetadataValue} from "@domain/update/version";
import type {ScriptHost} from "@application/ports/script-host";

/**
 * ヘッダーの項目を読む。配布元(Greasy Fork など)が書き換えたあとの、導入された値になる。
 * 管理ツールによって GM_info の項目が違うので、無ければヘッダーの本文から読む。
 */
function metadataUrl(direct: string | null | undefined, key: string): string | null {
	return direct || readMetadataValue(GM_info.scriptMetaStr ?? "", key);
}

export class GmScriptHost implements ScriptHost {
	readonly name = GM_info.script.name;
	readonly version = GM_info.script.version;
	readonly updateUrl = metadataUrl(GM_info.script.updateURL, "updateURL");
	readonly downloadUrl = metadataUrl(GM_info.script.downloadURL, "downloadURL");

	registerCommand(label: string, action: () => void): void {
		GM_registerMenuCommand(label, action);
	}
}
