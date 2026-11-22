/** 処理したキー操作なら true を返す。false ならサイトへそのまま渡す。 */
export type ShortcutHandler = () => boolean;

type Shortcut = {
	readonly handler: ShortcutHandler;
	readonly inTextFields: boolean;
};

const EDITOR_ELEMENTS = ".ace_editor, .monaco-editor, #editor, #editor-div";

const POSITIONAL_SYMBOLS: Readonly<Record<string, string>> = {Comma: ",", Period: "."};

const shortcuts = new Map<string, Shortcut>();
let listening = false;

/**
 * 文字と数字のキーは、Shift や Alt で変わる文字ではなく、押したキーの位置(event.code)で読む。
 * Shift+1 が「!」になったり、Mac の Option で別の文字になったりしても、設定の Shift+1 と照合できるようにする。
 */
function keyOf(event: KeyboardEvent): string {
	if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
	if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
	// 記号は配列で位置が違うので、JIS と US で同じ位置のものだけを位置で読む
	const symbol = POSITIONAL_SYMBOLS[event.code];
	if (symbol) return symbol;
	return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

function comboOf(event: KeyboardEvent): string {
	const key = keyOf(event);
	return [event.ctrlKey && "Ctrl", event.shiftKey && "Shift", event.altKey && "Alt", key].filter(Boolean).join("+");
}

function isTextField(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const isEditable = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
	return isEditable && target.closest(EDITOR_ELEMENTS) === null;
}

function onKeyDown(event: KeyboardEvent): void {
	// Windows では AltGr が Ctrl+Alt として届くので、AltGr で入力する文字(@ や { など)を妨げない
	if (event.ctrlKey && event.altKey && event.getModifierState("AltGraph")) return;
	const shortcut = shortcuts.get(comboOf(event));
	if (!shortcut || (!shortcut.inTextFields && isTextField(event.target))) return;
	if (!shortcut.handler()) return;
	event.preventDefault();
	event.stopPropagation();
}

/**
 * キー操作は修飾キーまで完全に一致したときだけ実行する。
 * 同じキーを別の機能が登録すると、後の登録で置き換わる。
 * 入力欄の中でも実行するなら inTextFields を指定する。
 */
export function registerShortcut(combo: string, handler: ShortcutHandler, {inTextFields = false} = {}): () => void {
	if (!listening) {
		document.addEventListener("keydown", onKeyDown, true);
		listening = true;
	}
	const shortcut = {handler, inTextFields};
	shortcuts.set(combo, shortcut);
	return () => {
		if (shortcuts.get(combo) === shortcut) shortcuts.delete(combo);
	};
}
