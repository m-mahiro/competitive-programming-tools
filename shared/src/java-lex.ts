/** ソース位置は LF に揃えた文字列の UTF-16 オフセット。対応する区切りを記録して、注釈や入れ子を読み飛ばす。 */
export type JavaToken = {text: string; start: number; end: number; pair: number};

const JAVA_LEXEME = /\s+|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"""(?:\\[\s\S]|(?!""")[^\\])*?(?:"""|$)|"(?:\\[\s\S]|[^"\\\n])*(?:"|$)|'(?:\\[\s\S]|[^'\\\n])*(?:'|$)|[\p{ID_Start}\p{Sc}\p{Pc}$][\p{ID_Continue}\p{Sc}\p{Pc}$]*|\.\.\.|::|[^\s]/gu;
const PAIRS: Readonly<Record<string, string>> = {")": "(", "]": "[", "}": "{"};
export const JAVA_IDENTIFIER = /^[\p{ID_Start}\p{Sc}\p{Pc}$][\p{ID_Continue}\p{Sc}\p{Pc}$]*$/u;

export function scanJava(source: string): {tokens: JavaToken[]; complete: boolean} {
	const tokens: JavaToken[] = [];
	const stack: number[] = [];
	// Unicode エスケープはコメントや引用符より先に Java コンパイラが解釈する。
	let complete = !/\\u+[\da-fA-F]{4}/.test(source);
	for (const m of source.matchAll(JAVA_LEXEME)) {
		const text = m[0];
		if (text.startsWith("/*") && !text.endsWith("*/")) complete = false;
		if (/^\s/u.test(text) || text.startsWith("//") || text.startsWith("/*")) continue;
		const token = {text, start: m.index, end: m.index + text.length, pair: -1};
		if (text.startsWith('"') || text.startsWith("'")) {
			const delimiter = text.startsWith('"""') ? '"""' : text[0];
			if (text.length < 2 * delimiter.length || !text.endsWith(delimiter)) complete = false;
		} else if (text === "(" || text === "[" || text === "{") {
			stack.push(tokens.length);
		} else if (Object.hasOwn(PAIRS, text)) {
			const open = stack.pop();
			if (open === undefined || tokens[open].text !== PAIRS[text]) complete = false;
			else {
				token.pair = open;
				tokens[open].pair = tokens.length;
			}
		}
		tokens.push(token);
	}
	return {tokens, complete: complete && stack.length === 0};
}

/** package または import 宣言の名前とセミコロンの位置。 */
export function qualifiedName(tokens: JavaToken[], start: number): {name: string; end: number} | null {
	let index = start;
	if (!JAVA_IDENTIFIER.test(tokens[index]?.text ?? "")) return null;
	let name = tokens[index++].text;
	while (tokens[index]?.text === ".") {
		const part = tokens[index + 1]?.text ?? "";
		if (part !== "*" && !JAVA_IDENTIFIER.test(part)) return null;
		name += "." + part;
		index += 2;
		if (part === "*") break;
	}
	return tokens[index]?.text === ";" ? {name, end: index} : null;
}

/**
 * Unicode エスケープ(\uXXXX)を、同じ長さの x に置き換える。位置と行を変えずに、字句を読み切れるようにする。
 * 文字列の中の × などのためで、引用符や改行を表すエスケープ("、\u000a)は読み違える。字句の位置を使う処理だけに使う。
 */
export function maskUnicodeEscapes(source: string): string {
	return source.replace(/\\u+[\da-fA-F]{4}/g, (escape) => "x".repeat(escape.length));
}

/**
 * package と import の宣言より後の、最初の字句(型の宣言や、その注釈)がある行(1 から)。無いか、字句を読み切れなければ null。
 * Local Runner の変換は、この行より前(import と package)だけで行数を変えるので、前後の差がそれより後のずれになる。
 */
export function firstDeclarationLine(source: string): number | null {
	const {tokens, complete} = scanJava(maskUnicodeEscapes(source));
	if (!complete) return null;
	let index = 0;
	while (tokens[index]?.text === "package" || tokens[index]?.text === "import" || tokens[index]?.text === ";") {
		if (tokens[index]?.text === ";") {
			index++;
			continue;
		}
		while (index < tokens.length && tokens[index]?.text !== ";") index++;
		index++;
	}
	const token = tokens[index];
	return token === undefined ? null : source.slice(0, token.start).split("\n").length;
}
