/** AtCoder の日英のサンプル見出し。番号のない古い問題もある。 */
export function atCoderSampleHeading(text: string) {
	const match = /^(入力例|出力例|Sample Input|Sample Output)\s*(\d*)$/i.exec(text.trim());
	if (!match) return null;
	return {input: /^(入力例|Sample Input)$/i.test(match[1]), number: match[2] ? Number(match[2]) : undefined};
}
