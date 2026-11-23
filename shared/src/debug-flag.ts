import {isIdentifier} from "./utils";

// デバッグ用の変数(debugFlag)の書き換え。Local Runner のコマンドで動かす言語と、CP Toolkit の Local Runner がないときの変換で使う。
// 言語ごとの違いは、コメントと文字列の書き方(字句の規則)と、対象の宣言の形だけにし、DEBUG_FLAG_SYNTAXES に登録する。
// 書き換えるのは、ブロックの外にある宣言・代入がちょうど1つのときだけ。

function lineEnd(source: string, from: number): number {
	const match = /[\r\n]/g;
	match.lastIndex = from;
	return match.exec(source)?.index ?? source.length;
}

function afterNewline(source: string, index: number): number {
	return index + (source.startsWith("\r\n", index) ? 2 : 1);
}

/** source の at から始まる字句の終わり。当てはまらなければ null。literal なら文字列や文字のリテラル。 */
type Scanner = (source: string, at: number) => {readonly end: number; readonly literal: boolean} | null;

/** 行末までのコメント。continued なら、行末の \ で次の行へ続く(C の行の継続)。 */
const lineComment = (marker: string, continued = false): Scanner => (source, at) => {
	if (!source.startsWith(marker, at)) return null;
	let end = lineEnd(source, at);
	while (continued && end < source.length && source[end - 1] === "\\") end = lineEnd(source, afterNewline(source, end));
	return {end, literal: false};
};

const blockComment = (open: string, close: string): Scanner => (source, at) => {
	if (!source.startsWith(open, at)) return null;
	const end = source.indexOf(close, at + open.length);
	return {end: end < 0 ? source.length : end + close.length, literal: false};
};

/** 入れ子にできるブロックコメント(Rust)。内側の開きと閉じを数え、いちばん外側が閉じたところで終える。 */
const nestedBlockComment = (open: string, close: string): Scanner => (source, at) => {
	if (!source.startsWith(open, at)) return null;
	let depth = 0;
	for (let i = at; i < source.length;) {
		if (source.startsWith(open, i)) {
			depth++;
			i += open.length;
		} else if (source.startsWith(close, i)) {
			i += close.length;
			if (--depth === 0) return {end: i, literal: false};
		} else i++;
	}
	return {end: source.length, literal: false};
};

/** 引用符で囲んだリテラル。escapes なら \ の次の文字を飛ばす。multiline でなければ行末で終える。 */
const quoted = (quote: string, {escapes = true, multiline = false} = {}): Scanner => (source, at) => {
	if (!source.startsWith(quote, at)) return null;
	for (let i = at + quote.length; i < source.length; i++) {
		if (escapes && source[i] === "\\") i++;
		else if (!multiline && (source[i] === "\n" || source[i] === "\r")) return {end: i, literal: true};
		else if (source.startsWith(quote, i)) return {end: i + quote.length, literal: true};
	}
	return {end: source.length, literal: true};
};

/** 開きの正規表現(先頭に合わせる)と、そこから決まる閉じの文字列で囲んだリテラル。C++ の R"x(...)x"、Rust の r#"..."# など。 */
const rawQuoted = (open: RegExp, closeOf: (match: RegExpExecArray) => string): Scanner => (source, at) => {
	const match = open.exec(source.slice(at, at + 40));
	if (!match || match.index !== 0) return null;
	const close = closeOf(match);
	const end = source.indexOf(close, at + match[0].length);
	return {end: end < 0 ? source.length : end + close.length, literal: true};
};

/** 数のリテラル。C++ の桁区切り(1'000)を文字リテラルの始まりと取り違えないために読み飛ばす。 */
const numberLiteral: Scanner = (source, at) => {
	if (!/[0-9]/.test(source[at] ?? "") || /[\w$]/.test(source[at - 1] ?? "")) return null;
	let end = at + 1;
	while (end < source.length && /[\w']/.test(source[end])) end++;
	return {end, literal: false};
};

/** Rust の文字リテラル。ライフタイム('a)は文字リテラルではない。 */
const rustChar: Scanner = (source, at) => {
	const match = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\r\n])'/u.exec(source.slice(at, at + 12));
	return match ? {end: at + match[0].length, literal: true} : null;
};

/** Python の文字列。f 文字列では、置換フィールドの中の引用符を外側の終わりと区別する。 */
function pythonStringEnd(source: string, start: number): number {
	const quote = source[start];
	const delimiter = source.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
	const formatted = /^(?:f|fr|rf)$/i.test(source.slice(Math.max(0, start - 2), start).match(/[a-z]+$/i)?.[0] ?? "");
	let braces = 0;
	for (let i = start + delimiter.length; i < source.length; i++) {
		const ch = source[i];
		if (ch === "\\") {
			i += source.startsWith("\r\n", i + 1) ? 2 : 1;
		} else if (braces > 0) {
			if (ch === "'" || ch === '"') i = pythonStringEnd(source, i) - 1;
			else if (ch === "#") i = lineEnd(source, i) - 1;
			else if (ch === "{") braces++;
			else if (ch === "}") braces--;
		} else if (source.startsWith(delimiter, i)) {
			return i + delimiter.length;
		} else if (formatted && ch === "{") {
			if (source[i + 1] === "{") i++;
			else braces = 1;
		}
	}
	return source.length;
}

const pythonString: Scanner = (source, at) => {
	return source[at] === "'" || source[at] === '"' ? {end: pythonStringEnd(source, at), literal: true} : null;
};

/** 言語ごとの、デバッグ用の変数の書き方。 */
export type DebugFlagSyntax = {
	/** コメントと文字列の字句。先に書いたものから試す。 */
	readonly scanners: readonly Scanner[];
	/** 対象の宣言・代入の行に合う正規表現。1つ目の組は値の前まで、2つ目の組は値。 */
	declaration(flag: string): RegExp;
	/** 偽と真の書き方。 */
	readonly literals: readonly [string, string];
	/** ブロックの外を、波括弧(braces)で決めるか、字下げ(indent)で決めるか。 */
	readonly scope: "braces" | "indent";
	/** # で始まる行を前処理の指示として読み飛ばすか(C、C++)。 */
	readonly preprocessor?: boolean;
};

const C_FAMILY_DECLARATION = (flag: string) => new RegExp(
	String.raw`^([ \t]*(?:(?:static|const|constexpr|constinit|inline|volatile|extern)[ \t]+)*(?:bool|_Bool|auto)[ \t]+${flag}[ \t]*=[ \t]*)(true|false)[ \t]*;`,
);
const C_SCANNERS: readonly Scanner[] = [numberLiteral, lineComment("//", true), blockComment("/*", "*/"), quoted('"'), quoted("'")];

/** 対応する言語(設定の family)。ここに無い言語で debugFlag を書くと、変換のエラーにする。 */
const DEBUG_FLAG_SYNTAXES: Readonly<Record<string, DebugFlagSyntax>> = {
	python3: {
		scanners: [lineComment("#"), pythonString],
		declaration: (flag) => new RegExp(String.raw`^(${flag}[ \t]*(?::[ \t]*bool[ \t]*)?=[ \t]*)(True|False)[ \t]*;?[ \t]*$`),
		literals: ["False", "True"],
		scope: "indent",
	},
	c: {scanners: C_SCANNERS, declaration: C_FAMILY_DECLARATION, literals: ["false", "true"], scope: "braces", preprocessor: true},
	cpp: {
		scanners: [rawQuoted(/R"([^\s\\()]{0,16})\(/, (match) => `)${match[1]}"`), ...C_SCANNERS],
		declaration: C_FAMILY_DECLARATION,
		literals: ["false", "true"],
		scope: "braces",
		preprocessor: true,
	},
	go: {
		scanners: [lineComment("//"), blockComment("/*", "*/"), quoted('"'), quoted("'"), quoted("`", {escapes: false, multiline: true})],
		declaration: (flag) => new RegExp(String.raw`^([ \t]*(?:const|var)[ \t]+${flag}(?:[ \t]+bool)?[ \t]*=[ \t]*)(true|false)[ \t]*;?[ \t]*(?:$|//)`),
		literals: ["false", "true"],
		scope: "braces",
	},
	rust: {
		scanners: [lineComment("//"), nestedBlockComment("/*", "*/"), rawQuoted(/b?r(#*)"/, (match) => `"${match[1]}`), quoted('"', {multiline: true}), rustChar],
		declaration: (flag) => new RegExp(String.raw`^([ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:const|static)[ \t]+${flag}[ \t]*:[ \t]*bool[ \t]*=[ \t]*)(true|false)[ \t]*;`),
		literals: ["false", "true"],
		scope: "braces",
	},
};

/** debugFlag に対応する言語の種類。文書と誤りの案内に使う。 */
export const DEBUG_FLAG_FAMILIES: readonly string[] = Object.keys(DEBUG_FLAG_SYNTAXES);

export function canRewriteDebugFlag(family: string): boolean {
	return Object.hasOwn(DEBUG_FLAG_SYNTAXES, family);
}

/** コメントは空白に、リテラルは先頭を @ にした空白に置き換える。元のコードとの位置と改行は保つ。 */
function masked(source: string, scanners: readonly Scanner[]): string {
	const parts: string[] = [];
	for (let i = 0; i < source.length;) {
		let token: ReturnType<Scanner> = null;
		for (const scanner of scanners) {
			token = scanner(source, i);
			if (token) break;
		}
		if (!token || token.end <= i) {
			parts.push(source[i++]);
			continue;
		}
		const text = source.slice(i, token.end);
		if (token.literal) {
			let mask = text.replace(/[^\r\n]/g, " ");
			mask = "@" + mask.slice(1);
			parts.push(mask);
		} else {
			parts.push(/^[0-9]/.test(text) ? text : text.replace(/[^\r\n]/g, " "));
		}
		i = token.end;
	}
	return parts.join("");
}

/** ブロックの外にある flag の宣言・代入を、debug の値に書き換える。対象が無ければそのまま返し、2つ以上なら null。 */
export function rewriteDebugFlag(source: string, flag: string, debug: boolean, family: string): string | null {
	const syntax = DEBUG_FLAG_SYNTAXES[family];
	if (!syntax || !isIdentifier(flag)) return source;
	const code = masked(source, syntax.scanners);
	const pattern = syntax.declaration(flag);
	let depth = 0;
	let continued = false;
	let found: {start: number; end: number} | null = null;
	for (let lineStart = 0; lineStart < code.length;) {
		const end = lineEnd(code, lineStart);
		const line = code.slice(lineStart, end);
		const preprocessor = syntax.preprocessor === true && line.trimStart().startsWith("#");
		if (!continued && !preprocessor && depth === 0) {
			const declaration = pattern.exec(line);
			if (declaration) {
				if (found) return null;
				const start = lineStart + declaration[1].length;
				found = {start, end: start + declaration[2].length};
			}
		}
		// 字下げで区切る言語では、括弧の中の行だけをブロックの中とみなす
		if (!preprocessor && (syntax.scope === "indent" || !continued)) {
			for (const ch of line) {
				if ("([{".includes(ch)) depth++;
				else if (")]}".includes(ch)) depth--;
			}
		}
		continued = line.endsWith("\\");
		lineStart = end < code.length ? afterNewline(code, end) : end + 1;
	}
	if (!found) return source;
	return source.slice(0, found.start) + syntax.literals[debug ? 1 : 0] + source.slice(found.end);
}
