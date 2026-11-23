import {JAVA_IDENTIFIER, type JavaToken, qualifiedName, scanJava} from "./java-lex";
import {normalizeNewlines} from "./utils";

export type TransformOptions = {debugFlag?: string};
export type JavaTransformIssue = "mainNotFound" | "ambiguousMain" | "nameCollision" | "ambiguousReference" | "unsupportedSyntax";
export type JavaFallbackResult = {sourceCode: string; issue: JavaTransformIssue | null};

type JavaType = {nameIndex: number; open: number; close: number; kind: string};
type Edit = {start: number; end: number; text: string};

const TYPE_KEYWORDS = new Set(["class", "interface", "record", "enum"]);
/** 直後の名前が変数の宣言ではないことを示す語。 */
const NOT_TYPE_WORDS = new Set([...TYPE_KEYWORDS, "new", "return", "throw", "case", "instanceof", "extends", "implements", "import", "package"]);
const MODIFIERS = new Set(["public", "protected", "private", "static", "final", "abstract", "native", "synchronized", "strictfp"]);

function declaresStringParameter(tokens: JavaToken[], index: number): boolean {
	// List<String> のような型引数は String の宣言ではない。
	let previous = index - 1;
	while (previous >= 0 && tokens[previous].text === ",") {
		previous -= 2;
	}
	if (tokens[previous]?.text !== "<") return false;
	const before = tokens[previous - 1]?.text;
	return TYPE_KEYWORDS.has(tokens[previous - 2]?.text) || MODIFIERS.has(before) || ["{", ";", "}"].includes(before);
}

/** 注釈名と、対応する閉じ括弧までの引数を取り除く。引数中に配列や別の注釈があってもよい。 */
function withoutAnnotations(tokens: JavaToken[], start: number, end: number): string[] {
	const words: string[] = [];
	for (let i = start; i < end; i++) {
		if (tokens[i].text !== "@") {
			words.push(tokens[i].text);
			continue;
		}
		i++;
		while (tokens[i + 1]?.text === ".") i += 2;
		if (tokens[i + 1]?.text === "(") i = tokens[i + 1].pair;
	}
	return words;
}

function topLevelTypes(tokens: JavaToken[]): JavaType[] {
	const types: JavaType[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.pair > i) {
			i = token.pair;
			continue;
		}
		if (!TYPE_KEYWORDS.has(token.text) || tokens[i - 1]?.text === "." || !JAVA_IDENTIFIER.test(tokens[i + 1]?.text ?? "")) continue;
		const nameIndex = i + 1;
		let open = nameIndex + 1;
		while (open < tokens.length && tokens[open].text !== "{") {
			open = Math.max(open, tokens[open].pair) + 1;
		}
		if (open === tokens.length) break;
		types.push({nameIndex, open, close: tokens[open].pair, kind: token.text});
		i = tokens[open].pair;
	}
	return types;
}

function isMainParameter(tokens: JavaToken[], start: number, end: number, stringShadowed: boolean): boolean {
	const words = withoutAnnotations(tokens, start, end).filter((word) => word !== "final");
	if (words.slice(0, 4).join("") === "java.lang.") words.splice(0, 4);
	else if (stringShadowed) return false;
	if (words.shift() !== "String") return false;
	if (words[0] === "...") return words.length === 2 && JAVA_IDENTIFIER.test(words[1]);
	if (words.length !== 3) return false;
	return (words[0] === "[" && words[1] === "]" && JAVA_IDENTIFIER.test(words[2]))
		|| (JAVA_IDENTIFIER.test(words[0]) && words[1] === "[" && words[2] === "]");
}

function declaresMain(tokens: JavaToken[], type: JavaType, stringShadowed: boolean): boolean {
	let memberStart = type.open + 1;
	for (let i = memberStart; i < type.close; i++) {
		const token = tokens[i];
		if (token.text === "void" && tokens[i + 1]?.text === "main" && tokens[i + 2]?.text === "(") {
			const modifiers = withoutAnnotations(tokens, memberStart, i);
			if (modifiers.includes("static") && (modifiers.includes("public") || type.kind === "interface" && !modifiers.includes("private"))
				&& isMainParameter(tokens, i + 3, tokens[i + 2].pair, stringShadowed)) return true;
		}
		if (token.pair > i) i = token.pair;
		if (token.text === "{" || token.text === ";") memberStart = i + 1;
	}
	return false;
}

/**
 * 起動する型の名前を Main に変える。字句だけでは型か変数かを見分けられないので、同じ名前の変数もそろえて変える(意味は変わらない)。
 * ほかの型のメンバー(Map.Entry など)は変えない。自分のメンバー(this.A、A.A)は宣言と合わせて変える。
 * Main という名前がすでにあれば重なるので、変換全体を取り消す。
 */
function addRenameEdits(tokens: JavaToken[], type: JavaType, packageName: string, edits: Edit[]): JavaTransformIssue | null {
	const name = tokens[type.nameIndex].text;
	if (name === "Main") return null;
	// 同じ名前の変数があり、ほかの値のメンバーとしても使っていれば(new A().A など)、どちらを指すか字句では決められない
	const declaredAsValue = tokens.some((token, i) => {
		if (token.text !== name || i === type.nameIndex) return false;
		const before = tokens[i - 1]?.text ?? "";
		// 型の後ろに名前が来て、その後に = ; , ) : が続けば変数の宣言
		const afterType = before === "]" || before === ">" || JAVA_IDENTIFIER.test(before) && !NOT_TYPE_WORDS.has(before);
		return afterType && ["=", ";", ",", ")", ":"].includes(tokens[i + 1]?.text ?? "");
	});
	const members = memberLevel(tokens, type);
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const prev = tokens[i - 1]?.text;
		if (token.text === "Main" && (prev !== "." || insideImport(tokens, i) && tokens[i + 1]?.text === ";")) return "nameCollision";
		if (token.text !== name) continue;
		// 名前の後に ( が続くのは、コンストラクターかメソッド。メソッドの名前は型の名前と別なので変えない。
		if (tokens[i + 1]?.text === "(" && i !== type.nameIndex && prev !== "new") {
			if (prev === ".") {
				// new a.b.Solver(...) は修飾したコンストラクターの呼び出し。それ以外の x.Solver(...) はメソッドの呼び出し。
				if (tokens[qualifiedStart(tokens, i) - 1]?.text !== "new") continue;
			} else if (!members.has(i)) continue;
			else if (prev === ">") return "ambiguousReference"; // 型引数を持つコンストラクターと、型引数を返すメソッドは、字句では見分けられない
			// 自分のメンバーの位置で、修飾子か区切りの後にあればコンストラクターの宣言。型の後にあればメソッドの宣言。
			else if (prev !== undefined && !MODIFIERS.has(prev) && !["{", "}", ";", ")"].includes(prev) && !afterAnnotationName(tokens, i)) continue;
		}
		if (prev === ".") {
			const owner = tokens[i - 2]?.text;
			const ownMember = owner === "this" || owner === name && tokens[i - 3]?.text !== ".";
			if (ownMember) edits.push({start: token.start, end: token.end, text: "Main"});
			// package を消すので、package 付きで自分を指す名前は直せない
			else if (packageName && qualifiedPrefix(tokens, i) === packageName || declaredAsValue) return "ambiguousReference";
			continue;
		}
		edits.push({start: token.start, end: token.end, text: "Main"});
	}
	return null;
}

/** a.b.c の c の番号から、修飾した名前の先頭(a)の番号を返す。 */
function qualifiedStart(tokens: JavaToken[], index: number): number {
	let start = index;
	while (tokens[start - 1]?.text === "." && JAVA_IDENTIFIER.test(tokens[start - 2]?.text ?? "")) start -= 2;
	return start;
}

/** 直前が引数のない注釈の名前(@Inject、@a.B)か。 */
function afterAnnotationName(tokens: JavaToken[], index: number): boolean {
	const start = qualifiedStart(tokens, index - 1);
	return JAVA_IDENTIFIER.test(tokens[index - 1]?.text ?? "") && tokens[start - 1]?.text === "@";
}

/** 型の本体の直下(メンバーの宣言の位置)にある字句の番号。括弧の中は含まない。 */
function memberLevel(tokens: JavaToken[], type: JavaType): Set<number> {
	const indexes = new Set<number>();
	for (let i = type.open + 1; i < type.close; i++) {
		indexes.add(i);
		if (tokens[i].pair > i) i = tokens[i].pair;
	}
	return indexes;
}

function insideImport(tokens: JavaToken[], index: number): boolean {
	for (let i = index - 1; i >= 0 && ![";", "{", "}"].includes(tokens[i].text); i--) {
		if (tokens[i].text === "import") return true;
	}
	return false;
}

function qualifiedPrefix(tokens: JavaToken[], index: number): string {
	const parts: string[] = [];
	for (let i = index - 1; i >= 1 && tokens[i].text === "." && JAVA_IDENTIFIER.test(tokens[i - 1].text); i -= 2) parts.unshift(tokens[i - 1].text);
	return parts.join(".");
}

function addDebugEdit(tokens: JavaToken[], type: JavaType, flag: string, edits: Edit[]): void {
	for (let i = type.open + 1; i < type.close; i++) {
		if (tokens[i].pair > i) {
			i = tokens[i].pair;
			continue;
		}
		if (tokens[i].text !== "boolean" || !JAVA_IDENTIFIER.test(tokens[i + 1]?.text ?? "") || tokens[i + 2]?.text === "(") continue;
		// boolean A = expr, DEBUG = true; の各宣言。呼び出しの引数や配列初期化のカンマは飛ばす。
		for (let j = i + 1; j < type.close; j++) {
			const token = tokens[j];
			if (token.text === ";" || token.text === "{") break;
			if (token.pair > j) {
				j = token.pair;
				continue;
			}
			if ((j === i + 1 || tokens[j - 1].text === ",") && token.text === flag
				&& tokens[j + 1]?.text === "=" && tokens[j + 2]?.text === "true" && [",", ";"].includes(tokens[j + 3]?.text)) {
				edits.push({start: tokens[j + 2].start, end: tokens[j + 2].end, text: "false"});
				return;
			}
		}
	}
}

/** 判定に失敗したときは package を含む元のコードを返す。成功時は LF に正規化した同一ソース上の編集をまとめて適用する。 */
export function transformJavaForSubmission(originalCode: string, options: TransformOptions = {}): JavaFallbackResult {
	const source = normalizeNewlines(originalCode);
	const {tokens, complete} = scanJava(source);
	const failure = (issue: JavaTransformIssue): JavaFallbackResult => ({sourceCode: originalCode, issue});
	if (!complete) return failure("unsupportedSyntax");
	const edits: Edit[] = [];
	let packageName = "";
	let stringShadowed = false;
	for (let i = 0; i < tokens.length; i++) {
		const word = tokens[i].text;
		if (word === "package") {
			const declaration = qualifiedName(tokens, i + 1);
			if (!declaration || declaration.name.endsWith(".*")) return failure("unsupportedSyntax");
			packageName = declaration.name;
			const end = tokens[declaration.end].end;
			edits.push({start: tokens[i].start, end: source[end] === "\n" ? end + 1 : end, text: ""});
		}
		if (word === "import") {
			const declaration = qualifiedName(tokens, i + (tokens[i + 1]?.text === "static" ? 2 : 1));
			if (declaration?.name.endsWith(".String") && declaration.name !== "java.lang.String") stringShadowed = true;
		}
		if (word === "String" && (TYPE_KEYWORDS.has(tokens[i - 1]?.text) || declaresStringParameter(tokens, i))) stringShadowed = true;
	}
	const candidates = topLevelTypes(tokens).filter((type) => declaresMain(tokens, type, stringShadowed));
	const type = candidates.length === 1 ? candidates[0] : candidates.find(({nameIndex}) => tokens[nameIndex].text === "Main");
	if (!type) return failure(candidates.length === 0 ? "mainNotFound" : "ambiguousMain");
	const issue = addRenameEdits(tokens, type, packageName, edits);
	if (issue) return failure(issue);
	if (options.debugFlag) addDebugEdit(tokens, type, options.debugFlag, edits);
	const result: string[] = [];
	let cursor = 0;
	for (const edit of edits.sort((a, b) => a.start - b.start)) {
		if (edit.start < cursor) return failure("ambiguousReference");
		result.push(source.slice(cursor, edit.start), edit.text);
		cursor = edit.end;
	}
	result.push(source.slice(cursor));
	return {sourceCode: result.join(""), issue: null};
}

export function modifyJavaCode(originalCode: string, options: TransformOptions = {}): string {
	return transformJavaForSubmission(originalCode, options).sourceCode;
}
