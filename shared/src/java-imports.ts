import {createMaskedCode} from "./java-transform";
import type {CompilerDiagnostic} from "./local-runner";

const IMPORT_LINE = /^\s*import\s+(?:static\s+)?([\w$]+(?:\s*\.\s*[\w$]+)*(?:\s*\.\s*\*)?)\s*;/;

function importedNames(code: string): Map<number, string> {
	const names = new Map<number, string>();
	createMaskedCode(code).split("\n").forEach((line, index) => {
		const name = IMPORT_LINE.exec(line)?.[1];
		if (name) names.set(index + 1, name.replace(/\s+/g, ""));
	});
	return names;
}

/** packageName の中のものを import しているか。コメントや文字列の中は数えない。 */
export function importsPackage(code: string, packageName: string): boolean {
	const prefix = `${packageName}.`;
	return [...importedNames(code).values()].some((name) => name.startsWith(prefix));
}

/** javac がエラーを出した import の名前。行の順に、重ねずに返す。 */
export function unresolvedImports(code: string, diagnostics: readonly CompilerDiagnostic[]): string[] {
	const names = importedNames(code);
	const found = new Set<string>();
	for (const diagnostic of diagnostics) {
		const name = diagnostic.kind === "ERROR" ? names.get(diagnostic.line) : undefined;
		if (name) found.add(name);
	}
	return [...found];
}
