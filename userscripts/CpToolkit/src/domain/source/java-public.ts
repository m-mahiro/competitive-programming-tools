import {type JavaToken, maskUnicodeEscapes, scanJava} from "@atcoder-tools/shared";

const TYPE_KEYWORDS = new Set(["class", "interface", "enum", "record"]);
/** 型の宣言で public の後に続けられる修飾子。non-sealed は non、-、sealed の3つの字句になる。 */
const TYPE_MODIFIERS = new Set(["abstract", "final", "sealed", "non", "-", "strictfp", "static"]);

/** public の後の修飾子と注釈を飛ばし、型の宣言が始まる字句の番号を返す。型の宣言でなければ -1。 */
function typeKeywordAfter(tokens: readonly JavaToken[], index: number): number {
	let i = index + 1;
	for (let token = tokens[i]; token; token = tokens[i]) {
		const {text} = token;
		if (TYPE_MODIFIERS.has(text)) {
			i++;
		} else if (text === "@" && tokens[i + 1]?.text !== "interface") {
			// 注釈の名前(a.b.C)と、あれば引数を飛ばす
			i += 2;
			while (tokens[i]?.text === "." && tokens[i + 1]) i += 2;
			const open = tokens[i];
			if (open?.text === "(" && open.pair > i) i = open.pair + 1;
		} else break;
	}
	if (TYPE_KEYWORDS.has(tokens[i]?.text ?? "")) return i;
	return tokens[i]?.text === "@" && tokens[i + 1]?.text === "interface" ? i + 1 : -1;
}

/**
 * いちばん外側の型の宣言から public を外す。行数は変えない。
 * コメント、文字列、テキストブロックの中と、型の中のメンバーには触れない。字句を読み切れないソースは変えない。
 */
export function withoutPublicTypes(source: string): string {
	// 文字列の中の Unicode エスケープ(× など)があっても外せるよう、位置を変えずに読む
	const {tokens, complete} = scanJava(maskUnicodeEscapes(source));
	if (!complete) return source;
	const parts: string[] = [];
	let cursor = 0;
	let skipTo = 0;
	for (const [i, token] of tokens.entries()) {
		if (i < skipTo) continue;
		if (token.text === "public" && typeKeywordAfter(tokens, i) >= 0) {
			let end = token.end;
			while (source[end] === " " || source[end] === "\t") end++;
			parts.push(source.slice(cursor, token.start));
			cursor = end;
		}
		// 括弧の中(型の本体、注釈の引数)は外側の宣言ではない
		if (token.pair > i) skipTo = token.pair;
	}
	parts.push(source.slice(cursor));
	return parts.join("");
}
