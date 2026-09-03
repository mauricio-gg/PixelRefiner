import { describe, expect, it } from "vitest";
import {
	ADVANCED_OPTION_SPECS,
	listOptions,
	PIXEL_REFINER_MCP_VERSION,
	resolveSettings,
	SettingsError,
} from "./index";

describe("公開エントリーポイント", () => {
	it("プレースホルダーのバージョン文字列を公開する", () => {
		expect(PIXEL_REFINER_MCP_VERSION).toBe("0.1.0");
	});

	it("設定解決をエントリーポイントから呼べる", () => {
		const resolved = resolveSettings({});
		expect(resolved.presetId).toBe("auto");
		expect(resolved.adjustments).toEqual([]);
	});

	it("オプションカタログと語彙一覧をエントリーポイントから呼べる", () => {
		expect(ADVANCED_OPTION_SPECS.length).toBeGreaterThan(0);
		expect(listOptions("presets").presets?.length).toBeGreaterThan(0);
	});

	it("設定エラーの型をエントリーポイントから参照できる", () => {
		expect(() => resolveSettings({ preset: "nope" })).toThrow(SettingsError);
	});
});
