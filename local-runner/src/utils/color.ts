export const ANSI = {
	RESET: "\x1b[0m",
	GREEN: "\x1b[32m",
	RED: "\x1b[31m",
	YELLOW: "\x1b[33m",
	ORANGE: "\x1b[38;5;208m",
	CYAN: "\x1b[36m",
};

/** 色の指定(ANSI のエスケープ)を除く。 */
export function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-9;]*m/g, "");
}

export function supportsCliColor() {
	if (process.env.NO_COLOR) return false;
	const forceColor = process.env.FORCE_COLOR;
	if (forceColor !== undefined) return forceColor !== "0";
	return Boolean(process.stdout.isTTY);
}

export function supportsRunnerColor() {
	return !process.env.NO_COLOR;
}

type ColorMode = "cli" | "runner";

/** 文を、色に対応していれば指定の色にする。 */
function paint(text: string, ansi: string, mode: ColorMode) {
	const supportsColor = mode === "runner" ? supportsRunnerColor() : supportsCliColor();
	return supportsColor ? `${ansi}${text}${ANSI.RESET}` : text;
}

/** 警告や通知の文を、対応していれば黄色にする。 */
export function colorizeWarning(text: string, mode: ColorMode = "runner") {
	return paint(text, ANSI.YELLOW, mode);
}

/** エラーの文を、対応していれば赤にする。 */
export function colorizeError(text: string, mode: ColorMode = "runner") {
	return paint(text, ANSI.RED, mode);
}

/** 成功の文を、対応していれば緑にする。 */
export function colorizeSuccess(text: string, mode: ColorMode = "runner") {
	return paint(text, ANSI.GREEN, mode);
}

/** 補足の文を、対応していればシアンにする。 */
export function colorizeNote(text: string, mode: ColorMode = "runner") {
	return paint(text, ANSI.CYAN, mode);
}

export function colorizeStatus(status: string, mode: "cli" | "runner" = "cli") {
	const supportsColor = mode === "runner" ? supportsRunnerColor() : supportsCliColor();
	if (!supportsColor) return status;
	if (status === "AC") return `${ANSI.GREEN}${status}${ANSI.RESET}`;
	if (status === "WA") return `${ANSI.RED}${status}${ANSI.RESET}`;
	if (status === "CE") return `${ANSI.YELLOW}${status}${ANSI.RESET}`;
	if (["RE", "TLE", "MLE", "OLE", "IE"].includes(status)) return `${ANSI.ORANGE}${status}${ANSI.RESET}`;
	if (["WJ", "WR"].includes(status)) return `${ANSI.CYAN}${status}${ANSI.RESET}`;
	return status;
}
