import { describe, expect, it } from "vitest";
import { PROCESS_RANGES } from "../../../../src/shared/config";
import { parseHexColor, validateAdvancedEntry } from "./settings-validate";
import { SettingsError } from "./types";

const expectSettingsError = (run: () => unknown): SettingsError => {
	try {
		run();
	} catch (error) {
		if (error instanceof SettingsError) return error;
		throw error;
	}
	throw new Error("SettingsError が投げられなかった");
};

describe("parseHexColor", () => {
	it("#rrggbb を RGB へ変換する", () => {
		expect(parseHexColor("#0A1b2C")).toEqual({ r: 10, g: 27, b: 44 });
	});

	it("形式が違えば undefined を返す", () => {
		expect(parseHexColor("0a1b2c")).toBeUndefined();
		expect(parseHexColor("#abc")).toBeUndefined();
		expect(parseHexColor("#gggggg")).toBeUndefined();
	});
});

describe("validateAdvancedEntry: キーの検査", () => {
	it("内部専用キーは理由付きで拒否する", () => {
		const error = expectSettingsError(() =>
			validateAdvancedEntry("debugHook", null),
		);
		expect(error.code).toBe("INVALID_SETTINGS");
		expect(error.message).toContain("debugHook");
	});

	it("gridSignals は v1 で非公開だと伝える", () => {
		const error = expectSettingsError(() =>
			validateAdvancedEntry("gridSignals", {}),
		);
		expect(error.hint).toContain("v1");
	});

	it("未知のキーは近いキーを示す", () => {
		const error = expectSettingsError(() =>
			validateAdvancedEntry("colorCont", 8),
		);
		expect(error.message).toContain("colorCount");
	});
});

describe("validateAdvancedEntry: 値の検査", () => {
	it("整数は clampInt で丸め、変更を adjustment に載せる", () => {
		expect(validateAdvancedEntry("colorCount", 8)).toEqual({ value: 8 });
		expect(validateAdvancedEntry("colorCount", 1)).toEqual({
			value: PROCESS_RANGES.colorCount.min,
			adjustment: {
				key: "colorCount",
				requested: 1,
				applied: PROCESS_RANGES.colorCount.min,
			},
		});
	});

	it("数値でない整数指定は失敗する", () => {
		const error = expectSettingsError(() =>
			validateAdvancedEntry("colorCount", "many"),
		);
		expect(error.message).toContain("colorCount");
	});

	it("列挙は許可値を並べて失敗する", () => {
		const error = expectSettingsError(() =>
			validateAdvancedEntry("processingMode", "nope"),
		);
		expect(error.message).toContain("refine");
		expect(error.message).toContain("preserve");
	});

	it("真偽値は型を検査する", () => {
		expect(validateAdvancedEntry("makeSquare", true)).toEqual({ value: true });
		expect(() => validateAdvancedEntry("makeSquare", "true")).toThrow(
			SettingsError,
		);
	});

	it("色は 16 進表記と RGB オブジェクトを受け取る", () => {
		expect(validateAdvancedEntry("outlineColor", "#ffffff")).toEqual({
			value: { r: 255, g: 255, b: 255 },
		});
		expect(validateAdvancedEntry("outlineColor", { r: 1, g: 2, b: 3 })).toEqual(
			{ value: { r: 1, g: 2, b: 3 } },
		);
		expect(() => validateAdvancedEntry("outlineColor", "red")).toThrow(
			SettingsError,
		);
	});

	it("bgRgb は #rrggbb 文字列のまま保つ", () => {
		expect(validateAdvancedEntry("bgRgb", "#00FF00")).toEqual({
			value: "#00FF00",
		});
		expect(() => validateAdvancedEntry("bgRgb", { r: 0, g: 0, b: 0 })).toThrow(
			SettingsError,
		);
	});

	it("パレットは配列で受け取り RGB へ揃える", () => {
		expect(
			validateAdvancedEntry("fixedPalette", ["#000000", { r: 1, g: 2, b: 3 }]),
		).toEqual({
			value: [
				{ r: 0, g: 0, b: 0 },
				{ r: 1, g: 2, b: 3 },
			],
		});
		expect(() => validateAdvancedEntry("fixedPalette", "#000000")).toThrow(
			SettingsError,
		);
		expect(() => validateAdvancedEntry("fixedPalette", [])).toThrow(
			SettingsError,
		);
	});
});
