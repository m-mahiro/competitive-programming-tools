import {isIdentifier, normalizeNewlines} from "./utils";

export type TransformOptions = {
	/** 起動クラスのフィールドで、false にする boolean の名前。空なら変えない。 */
	debugFlag?: string;
};

type TypeInfo = {
	keyword: string;
	name: string;
	depth: number;
	openBraceIdx: number;
	closeBraceIdx: number;
}

// enum は型を消すだけでは JS にならないので、定数のオブジェクトで表す
const State = {Normal: 0, LineComment: 1, BlockComment: 2, String: 3, Char: 4, TextBlock: 5} as const;
type State = (typeof State)[keyof typeof State];

const TEXT_BLOCK_QUOTE = "\"\"\"";

/** コメントと文字列(テキストブロックを含む)を空白に置き換える。改行と文字の位置は保つ。 */
export function createMaskedCode(text: string): string {
	const out: string[] = [];
	let state: State = State.Normal;
	let isEscape = false;
	const mask = (c: string) => c === "\n" ? "\n" : " ";

	for (let i = 0, len = text.length; i < len; i++) {
		const c = text[i], n = i + 1 < len ? text[i + 1] : "";
		if (state === State.TextBlock) {
			if (isEscape) {
				isEscape = false;
				out.push(mask(c));
			} else if (c === "\\") {
				isEscape = true;
				out.push(" ");
			} else if (text.startsWith(TEXT_BLOCK_QUOTE, i)) {
				out.push("   ");
				i += 2;
				state = State.Normal;
			} else {
				out.push(mask(c));
			}
		} else if (state === State.LineComment) {
			out.push(mask(c));
			if (c === "\n") state = State.Normal;
		} else if (state === State.BlockComment) {
			if (c === "*" && n === "/") {
				out.push(" ", " ");
				i++;
				state = State.Normal;
			} else {
				out.push(mask(c));
			}
		} else if (state === State.String || state === State.Char) {
			const closeChar = state === State.String ? "\"" : "'";
			if (isEscape) {
				isEscape = false;
				out.push(" ");
			} else if (c === "\\") {
				isEscape = true;
				out.push(" ");
			} else if (c === closeChar) {
				state = State.Normal;
				out.push(" ");
			} else {
				out.push(mask(c));
			}
		} else {
			if (c === "/" && n === "/") {
				out.push(" ", " ");
				i++;
				state = State.LineComment;
			} else if (c === "/" && n === "*") {
				out.push(" ", " ");
				i++;
				state = State.BlockComment;
			} else if (text.startsWith(TEXT_BLOCK_QUOTE, i)) {
				out.push("   ");
				i += 2;
				state = State.TextBlock;
			} else if (c === "\"") {
				state = State.String;
				out.push(" ");
			} else if (c === "'") {
				state = State.Char;
				out.push(" ");
			} else {
				out.push(c);
			}
		}
	}
	return out.join("");
}

function findMatchingBrace(maskedText: string, openBraceIdx: number): number {
	let depth = 1;
	for (let i = openBraceIdx + 1; i < maskedText.length; i++) {
		if (maskedText[i] === "{") depth++;
		else if (maskedText[i] === "}" && --depth === 0) return i;
	}
	return -1;
}

/** 各位置より前に開いている波括弧の数。 */
function braceDepths(maskedText: string): Int32Array {
	const depths = new Int32Array(maskedText.length + 1);
	let depth = 0;
	for (let i = 0; i < maskedText.length; i++) {
		depths[i] = depth;
		if (maskedText[i] === "{") depth++;
		else if (maskedText[i] === "}") depth--;
	}
	depths[maskedText.length] = depth;
	return depths;
}

/** 名前の直前が `.` なら、ほかの型や値のメンバーを指している。可変長引数の `...` は除く。 */
function isQualified(maskedText: string, index: number): boolean {
	let i = index - 1;
	while (i >= 0 && /\s/.test(maskedText[i])) i--;
	return maskedText[i] === "." && maskedText[i - 1] !== ".";
}

const TYPE_DECLARATION_REGEX = /\b(class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

function findTypes(maskedText: string, depths: Int32Array): TypeInfo[] {
	const types: TypeInfo[] = [];
	for (const m of maskedText.matchAll(TYPE_DECLARATION_REGEX)) {
		// Foo.class のようなクラスリテラルは宣言ではない
		if (isQualified(maskedText, m.index)) continue;
		const openBraceIdx = maskedText.indexOf("{", m.index + m[0].length);
		if (openBraceIdx === -1) continue;
		const closeBraceIdx = findMatchingBrace(maskedText, openBraceIdx);
		if (closeBraceIdx === -1) continue;
		types.push({keyword: m[1], name: m[2], depth: depths[m.index], openBraceIdx, closeBraceIdx});
	}
	return types;
}

const ANNOTATION = String.raw`@[\w.]+(?:\s*\([^)]*\))?`;
const MAIN_METHOD_REGEX = new RegExp(
	String.raw`((?:(?:public|static|final|synchronized|strictfp|${ANNOTATION})\s+)+)void\s+main\s*\(\s*` +
	String.raw`(?:(?:final|${ANNOTATION})\s+)*String\s*(?:\[\s*]|\.\.\.|\s+[A-Za-z_$][\w$]*\s*\[\s*])`,
	"g",
);

/** 型の直下に public static void main(String[]) があるか。interface のメソッドは public を書かなくても public になる。 */
function declaresMain(type: TypeInfo, mains: readonly RegExpExecArray[], depths: Int32Array): boolean {
	return mains.some((m) => m.index > type.openBraceIdx && m.index < type.closeBraceIdx
		&& depths[m.index] === type.depth + 1
		&& /\bstatic\b/.test(m[1]) && (type.keyword === "interface" || /\bpublic\b/.test(m[1])));
}

/** 起動するトップレベルの型。Compiler API の変換と同じく、複数あれば Main という名前の型を選び、決まらなければ null を返す。 */
function findMainType(maskedText: string, depths: Int32Array): TypeInfo | null {
	const mains = [...maskedText.matchAll(MAIN_METHOD_REGEX)];
	const declaring = findTypes(maskedText, depths).filter((type) => type.depth === 0 && declaresMain(type, mains, depths));
	return declaring.length === 1 ? declaring[0] : declaring.find((type) => type.name === "Main") ?? null;
}

function removePackageDeclaration(maskedCode: string, currentCode: string): string {
	const m = /\bpackage\s+[A-Za-z_][A-Za-z0-9_.]*\s*;/.exec(maskedCode);
	if (!m) return currentCode;
	let end = m.index + m[0].length;
	if (currentCode[end] === "\n") end++;
	return currentCode.slice(0, m.index) + currentCode.slice(end);
}

/** `.` の付かない name の位置。name は英数字と _ だけなので、正規表現の記号を含まない。 */
function unqualifiedOccurrences(maskedText: string, name: string): number[] {
	return [...maskedText.matchAll(new RegExp(String.raw`\b${name}\b`, "g"))]
		.map((m) => m.index)
		.filter((index) => !isQualified(maskedText, index));
}

/**
 * 起動する型の名前を Main に変える。字句の置き換えなので、同じ名前の変数もそろえて変える。
 * Main という名前がすでにあると重なるので、そのときは変えない。
 */
function renameClassToMain(maskedCode: string, currentCode: string): string {
	const type = findMainType(maskedCode, braceDepths(maskedCode));
	if (!type || type.name === "Main" || unqualifiedOccurrences(maskedCode, "Main").length > 0) return currentCode;
	let code = currentCode;
	for (const start of unqualifiedOccurrences(maskedCode, type.name).reverse()) {
		code = code.slice(0, start) + "Main" + code.slice(start + type.name.length);
	}
	return code;
}

/** 起動クラスの直下にある `boolean flag = true` の宣言だけを false にする。メソッドの中の変数や代入は変えない。 */
function disableDebugFlag(maskedCode: string, currentCode: string, flag: string): string {
	if (!isIdentifier(flag)) return currentCode;
	const depths = braceDepths(maskedCode);
	const type = findMainType(maskedCode, depths);
	if (!type) return currentCode;
	const starts = [...maskedCode.matchAll(new RegExp(String.raw`\bboolean\s+${flag}\s*=\s*true\b`, "g"))]
		.filter((m) => m.index > type.openBraceIdx && m.index < type.closeBraceIdx && depths[m.index] === type.depth + 1)
		.map((m) => m.index + m[0].length - "true".length);
	let code = currentCode;
	for (const start of starts.reverse()) code = code.slice(0, start) + "false" + code.slice(start + "true".length);
	return code;
}

/**
 * Local Runner がないときの、Java の提出用の字句の変換。パッケージ宣言を消し、起動する型を Main にし、
 * 名前を指定したデバッグ用の変数を false にする。
 */
export function modifyJavaCode(originalCode: string, options: TransformOptions = {}): string {
	let code = normalizeNewlines(originalCode);
	code = removePackageDeclaration(createMaskedCode(code), code);
	code = renameClassToMain(createMaskedCode(code), code);
	if (options.debugFlag) code = disableDebugFlag(createMaskedCode(code), code, options.debugFlag);
	return code.replace(/^(?:[\t ]*\n)+/, "");
}
