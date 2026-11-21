import type {LocalRunnerCompilerInfo} from "@atcoder-tools/shared";
import {languageCatalog} from "@catalog/tables";
import {resolveFamily} from "@domain/execution/language";
import type {JudgeLanguage} from "@domain/execution/result";

/**
 * ページの言語と同じ種類の Local Runner の言語を、使う順に並べる。種類は、サーバーが返した family を使い、無ければ言語の表記から判定する。
 * サーバーが match を返していれば、ページの言語の表記にその語を含む言語を先頭にし、残りはサーバーが返した順に並べる。
 * PyPy のページで CPython や Codon が先に選ばれないようにするためで、表記の近さだけでは処理系を選び分けられない。
 */
export function orderLocalCompilers(
	compilers: readonly LocalRunnerCompilerInfo[],
	{family, label}: JudgeLanguage,
): LocalRunnerCompilerInfo[] {
	const sameFamily = compilers.filter((compiler) => {
		return (compiler.family ?? resolveFamily(languageCatalog, compiler.language)) === family;
	});
	if (!sameFamily.some(({match}) => match !== undefined)) return sameFamily;
	const pageLabel = label.toLowerCase();
	const matches = ({match}: LocalRunnerCompilerInfo): boolean => {
		return (match ?? []).some((word) => pageLabel.includes(word.toLowerCase()));
	};
	return [...sameFamily.filter(matches), ...sameFamily.filter((compiler) => !matches(compiler))];
}
