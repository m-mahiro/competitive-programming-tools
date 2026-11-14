export interface ScriptHost {
	readonly name: string;
	readonly version: string;
	/** 更新を確かめる URL。配布物のヘッダーの @updateURL。無ければ null。 */
	readonly updateUrl: string | null;
	/** 新しいバージョンの入手先。配布物のヘッダーの @downloadURL。無ければ null。 */
	readonly downloadUrl: string | null;

	/** ユーザースクリプトのメニューに項目を追加する。 */
	registerCommand(label: string, action: () => void): void;
}
