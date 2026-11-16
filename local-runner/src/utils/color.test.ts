import {afterAll, afterEach, describe, expect, spyOn, test} from "bun:test";
import {ANSI, colorizeError, colorizeNote, colorizeStatus, colorizeSuccess, colorizeWarning, supportsCliColor} from "./color";

const originalForceColor = process.env.FORCE_COLOR;
const originalNoColor = process.env.NO_COLOR;
const tty = spyOn(process.stdout, "isTTY", "get");

afterAll(() => tty.mockRestore());

afterEach(() => {
	if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
	else process.env.FORCE_COLOR = originalForceColor;
	if (originalNoColor === undefined) delete process.env.NO_COLOR;
	else process.env.NO_COLOR = originalNoColor;
	tty.mockReset();
});

describe("CLI の色", () => {
	test("指定がなければ端末かどうかで決める", () => {
		delete process.env.FORCE_COLOR;
		delete process.env.NO_COLOR;
		tty.mockReturnValue(false);
		expect(supportsCliColor()).toBe(false);
		expect(colorizeStatus("AC")).toBe("AC");
		tty.mockReturnValue(true);
		expect(colorizeStatus("AC")).toBe(`${ANSI.GREEN}AC${ANSI.RESET}`);
	});

	test("FORCE_COLOR で端末ではない出力先にも色を付ける", () => {
		delete process.env.NO_COLOR;
		process.env.FORCE_COLOR = "1";
		tty.mockReturnValue(false);
		expect(colorizeStatus("AC")).toBe(`${ANSI.GREEN}AC${ANSI.RESET}`);
	});

	test("FORCE_COLOR=0 なら端末でも色を付けない", () => {
		delete process.env.NO_COLOR;
		process.env.FORCE_COLOR = "0";
		tty.mockReturnValue(true);
		expect(colorizeStatus("AC")).toBe("AC");
	});

	test("NO_COLOR が空でなければ FORCE_COLOR より優先する", () => {
		process.env.FORCE_COLOR = "1";
		process.env.NO_COLOR = "1";
		tty.mockReturnValue(true);
		expect(colorizeStatus("AC")).toBe("AC");
	});

	test("文の種類ごとの色を付け、NO_COLOR なら付けない", () => {
		delete process.env.NO_COLOR;
		expect(colorizeWarning("w")).toBe(`${ANSI.YELLOW}w${ANSI.RESET}`);
		expect(colorizeError("e")).toBe(`${ANSI.RED}e${ANSI.RESET}`);
		expect(colorizeSuccess("s")).toBe(`${ANSI.GREEN}s${ANSI.RESET}`);
		expect(colorizeNote("n")).toBe(`${ANSI.CYAN}n${ANSI.RESET}`);
		process.env.NO_COLOR = "1";
		expect(colorizeError("e")).toBe("e");
		expect(colorizeError("e", "cli")).toBe("e");
	});
});
