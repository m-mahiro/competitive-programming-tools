/** ソース位置は LF に揃えた文字列の UTF-16 オフセット。対応する区切りを記録して、注釈や入れ子を読み飛ばす。 */
export type JavaToken = {text: string; start: number; end: number; pair: number};

const JAVA_LEXEME = /\s+|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"""(?:\\[\s\S]|(?!""")[^\\])*?(?:"""|$)|"(?:\\[\s\S]|[^"\\\n])*(?:"|$)|'(?:\\[\s\S]|[^'\\\n])*(?:'|$)|[\p{ID_Start}\p{Sc}\p{Pc}$][\p{ID_Continue}\p{Sc}\p{Pc}$]*|\.\.\.|::|[^\s]/gu;
const PAIRS: Readonly<Record<string, string>> = {")": "(", "]": "[", "}": "{"};
export const JAVA_IDENTIFIER = /^[\p{ID_Start}\p{Sc}\p{Pc}$][\p{ID_Continue}\p{Sc}\p{Pc}$]*$/u;

/**
 * Java の字句を読む。Unicode エスケープはコメントや引用符より先に Java コンパイラが解釈するので、
 * 訳していないソースにエスケープがあれば読み切れないものとする。decoded なら、decodeUnicodeEscapes で訳したあとのソースとして読む。
 */
export function scanJava(source: string, decoded = false): {tokens: JavaToken[]; complete: boolean} {
	const tokens: JavaToken[] = [];
	const stack: number[] = [];
	let complete = decoded || !/\\u+[\da-fA-F]{4}/.test(source);
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

/** Unicode エスケープ(バックスラッシュ、1つ以上の u、16進数4桁)。 */
const UNICODE_ESCAPE = /^\\u+([\da-fA-F]{4})/;

/**
 * Unicode エスケープを、javac と同じく文字に訳す。前にバックスラッシュが奇数個続くもの(文字列の中の二重のバックスラッシュの後)は訳さない。
 * offsets[i] は、訳した文字列の i 文字目が元のソースで始まる位置。offsets[text.length] は元のソースの長さ。
 * 引用符や改行を表すエスケープも訳すので、javac と同じ字句として読める。位置は offsets で元のソースへ戻す。
 */
export function decodeUnicodeEscapes(source: string): {text: string; offsets: number[]} {
	const chars: string[] = [];
	const offsets: number[] = [];
	let backslashes = 0;
	for (let i = 0; i < source.length;) {
		const escape = source[i] === "\\" && backslashes % 2 === 0 ? UNICODE_ESCAPE.exec(source.slice(i, i + 32)) : null;
		if (escape) {
			chars.push(String.fromCharCode(Number.parseInt(escape[1]!, 16)));
			offsets.push(i);
			i += escape[0].length;
			backslashes = 0;
			continue;
		}
		backslashes = source[i] === "\\" ? backslashes + 1 : 0;
		chars.push(source[i]!);
		offsets.push(i);
		i++;
	}
	offsets.push(source.length);
	return {text: chars.join(""), offsets};
}

/**
 * package と import の宣言より後の、最初の字句(型の宣言や、その注釈)がある行(1 から)。無いか、字句を読み切れなければ null。
 * Local Runner の変換は、この行より前(import と package)だけで行数を変えるので、前後の差がそれより後のずれになる。
 */
export function firstDeclarationLine(source: string): number | null {
	const {text, offsets} = decodeUnicodeEscapes(source);
	const {tokens, complete} = scanJava(text, true);
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
	// 行は元のソースの改行で数える(javac の行番号と同じ)
	return token === undefined ? null : source.slice(0, offsets[token.start]).split("\n").length;
}
