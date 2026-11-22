import {qualifiedName, scanJava} from "./java-lex";
import type {CompilerDiagnostic} from "./local-runner";
import {normalizeNewlines} from "./utils";

type ImportRange = {name: string; start: number; end: number};

function importRanges(source: string): ImportRange[] {
	const {tokens} = scanJava(source);
	const result: ImportRange[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.text === "{") break;
		if (token.pair > i) {
			i = token.pair;
			continue;
		}
		if (token.text !== "import") continue;
		const declaration = qualifiedName(tokens, i + (tokens[i + 1]?.text === "static" ? 2 : 1));
		if (declaration) {
			result.push({name: declaration.name, start: token.start, end: tokens[declaration.end].end});
			i = declaration.end;
		}
	}
	return result;
}

export function importsPackage(code: string, packageName: string): boolean {
	return importRanges(normalizeNewlines(code)).some(({name}) => name.startsWith(packageName + "."));
}

/** javac の診断は1始まり。タブは8列の停止位置まで進む。 */
function diagnosticOffset(lineStarts: number[], source: string, diagnostic: CompilerDiagnostic): number {
	const start = lineStarts[diagnostic.line - 1];
	if (start === undefined || diagnostic.column <= 0) return -1;
	let column = 1;
	for (let offset = start; offset < source.length && source[offset] !== "\n"; offset++) {
		if (column === diagnostic.column) return offset;
		column += source[offset] === "\t" ? 8 - (column - 1) % 8 : 1;
		if (column > diagnostic.column) return -1;
	}
	return -1;
}

/** javac が import に結び付けた名前を使う。旧サーバーの診断は、解決不能エラーの行と列が宣言内にある場合だけ補う。 */
export function unresolvedImports(code: string, diagnostics: readonly CompilerDiagnostic[]): string[] {
	const source = normalizeNewlines(code);
	const imports = importRanges(source);
	const found = new Set<string>();
	const starts = [0];
	for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
	for (const item of diagnostics) {
		if (item.kind !== "ERROR" || !/^compiler\.err\.(?:doesnt\.exist$|cant\.resolve(?:\.|$))/.test(item.code)) continue;
		if (item.importName) {
			found.add(item.importName);
			continue;
		}
		const offset = diagnosticOffset(starts, source, item);
		const range = imports.find(({start, end}) => start <= offset && offset < end);
		if (range) found.add(range.name);
	}
	const inSourceOrder = imports.map(({name}) => name).filter((name) => found.has(name));
	return [...new Set([...inSourceOrder, ...found])];
}
