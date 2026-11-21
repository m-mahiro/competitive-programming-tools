import {normalizeNewlines} from "./utils";

export type TransformOptions = {
	removePackage?: boolean;
	renameClass?: boolean;
	fixDebug?: boolean;
};

export type TransformResult = {
	modified: string;
	packageRemoved: boolean;
	classReplaced: boolean;
	debugReplaced: boolean;
};

type ModifyResult = {
	code: string;
	modified: boolean;
};

type TypeInfo = {
	keyword: string;
	name: string;
	start: number;
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

const LIBRARY_IMPORT_PATTERN = /^\s*import\s+(?:static\s+)?lib\./m;

/** lib.* を import しているか。コメントや文字列の中は数えない。 */
export function usesJavaLibrary(code: string): boolean {
	return LIBRARY_IMPORT_PATTERN.test(createMaskedCode(code));
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
		types.push({keyword: m[1], name: m[2], start: m.index, depth: depths[m.index], openBraceIdx, closeBraceIdx});
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
function findMainType(maskedText: string): TypeInfo | null {
	const depths = braceDepths(maskedText);
	const mains = [...maskedText.matchAll(MAIN_METHOD_REGEX)];
	const declaring = findTypes(maskedText, depths).filter((type) => type.depth === 0 && declaresMain(type, mains, depths));
	return declaring.length === 1 ? declaring[0] : declaring.find((type) => type.name === "Main") ?? null;
}

function removePackageDeclaration(maskedCode: string, currentCode: string): ModifyResult {
	const m = /\bpackage\s+[A-Za-z_][A-Za-z0-9_.]*\s*;/.exec(maskedCode);
	if (!m) return {code: currentCode, modified: false};
	let end = m.index + m[0].length;
	if (currentCode[end] === "\n") end++;
	return {
		code: currentCode.slice(0, m.index) + currentCode.slice(end),
		modified: true,
	};
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
function renameClassToMain(maskedCode: string, currentCode: string): ModifyResult {
	const type = findMainType(maskedCode);
	if (!type || type.name === "Main" || unqualifiedOccurrences(maskedCode, "Main").length > 0) {
		return {code: currentCode, modified: false};
	}
	let code = currentCode;
	for (const start of unqualifiedOccurrences(maskedCode, type.name).reverse()) {
		code = code.slice(0, start) + "Main" + code.slice(start + type.name.length);
	}
	return {code, modified: true};
}

function disableDebugStatements(maskedCode: string, currentCode: string): ModifyResult {
	const debugRegex = /\bDEBUG\b\s*=\s*true\b/g;
	const replacements: Array<{start: number; end: number}> = [];
	let dm: RegExpExecArray | null;
	while ((dm = debugRegex.exec(maskedCode)) !== null) {
		const trueIdx = dm.index + dm[0].lastIndexOf("true");
		replacements.push({start: trueIdx, end: trueIdx + 4});
	}
	if (!replacements.length) return {code: currentCode, modified: false};
	replacements.sort((a, b) => b.start - a.start);
	let code = currentCode;
	for (const {start, end} of replacements) {
		code = code.slice(0, start) + "false" + code.slice(end);
	}
	return {code, modified: true};
}

/**
 * Java ソースコードに対して指定された変換を順に適用する。
 */
export function modifyJavaCode(originalCode: string, options: TransformOptions): TransformResult {
	let currentCode = normalizeNewlines(originalCode);
	let packageRemoved = false;
	let classReplaced = false;
	let debugReplaced = false;

	if (options.removePackage) {
		const result = removePackageDeclaration(createMaskedCode(currentCode), currentCode);
		currentCode = result.code;
		packageRemoved = result.modified;
	}

	if (options.renameClass) {
		const result = renameClassToMain(createMaskedCode(currentCode), currentCode);
		currentCode = result.code;
		classReplaced = result.modified;
	}

	if (options.fixDebug) {
		const result = disableDebugStatements(createMaskedCode(currentCode), currentCode);
		currentCode = result.code;
		debugReplaced = result.modified;
	}
	currentCode = currentCode.replace(/^(?:[\t ]*\n)+/, "");

	return {modified: currentCode, packageRemoved, classReplaced, debugReplaced};
}
