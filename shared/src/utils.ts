export function normalizeNewlines(text: string) {
	return text.replace(/\r\n?/g, "\n");
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 英字か _ で始まり、英数字と _ だけでできた名前か。正規表現に埋め込む名前の検査に使う。 */
export function isIdentifier(name: string): boolean {
	return IDENTIFIER.test(name);
}
