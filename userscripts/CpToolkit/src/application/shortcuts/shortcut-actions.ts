/** 処理したキー操作なら true を返す。false ならサイトへそのまま渡す。 */
export type ShortcutAction = () => boolean;

/**
 * 機能が持つ操作と、ショートカットキーの機能が割り当てたキーの対応。
 * 操作は各機能が登録し、キーはショートカットキーの機能が決める。機能の起動の順番には依存しない。
 */
export class ShortcutActions {
	private readonly actions = new Map<string, ShortcutAction>();
	private readonly keys = new Map<string, string>();

	/** 操作を登録する。返す関数で外す。同じ id を登録し直すと置き換わる。 */
	register(id: string, action: ShortcutAction): () => void {
		this.actions.set(id, action);
		return () => {
			if (this.actions.get(id) === action) this.actions.delete(id);
		};
	}

	/** 登録された操作を実行する。登録が無ければ false。 */
	run(id: string): boolean {
		return this.actions.get(id)?.() ?? false;
	}

	/** 操作に割り当てたキーを覚える。null なら割り当てない。 */
	assign(id: string, key: string | null): void {
		if (key === null) this.keys.delete(id);
		else this.keys.set(id, key);
	}

	/** 操作に割り当てたキー。ボタンの説明に使う。割り当てが無ければ null。 */
	keyOf(id: string): string | null {
		return this.keys.get(id) ?? null;
	}
}

/** ほかの機能が登録する操作。キーはショートカットキーの機能の設定で決める。 */
export const SHORTCUT_ACTIONS = {
	testAndSubmit: "easy-test.testAndSubmit",
	testAll: "easy-test.testAll",
	toggleEasyTest: "easy-test.togglePanel",
	acByTime: "submission-shortcuts.byTime",
	acByLength: "submission-shortcuts.byLength",
	acByCreated: "submission-shortcuts.byCreated",
	acByMemory: "submission-shortcuts.byMemory",
	copyStatement: "statement-copy.copyAll",
} as const;
