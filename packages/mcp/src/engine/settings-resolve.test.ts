import { describe, expect, it } from "vitest";
import {
	BUILT_IN_PRESETS,
	type QuickSettingsState,
} from "../../../../src/browser/quick-settings";
import { normalizeProcessOptions } from "../../../../src/core/processor-options";
import { PROCESS_RANGES } from "../../../../src/shared/config";
import { resolveSettings } from "./settings-resolve";
import { SettingsError } from "./types";

type QuickOverrides = Partial<QuickSettingsState>;

describe("resolveSettings: プリセット / かんたん / 詳細の同値性", () => {
	it.each(BUILT_IN_PRESETS.map((preset) => preset.id))(
		"プリセット %s は quick 指定・advanced 再指定と同じ実効設定になる",
		(presetId) => {
			const preset = BUILT_IN_PRESETS.find((entry) => entry.id === presetId);
			if (preset === undefined) throw new Error("preset not found");
			const byPreset = resolveSettings({ preset: presetId });
			const byQuick = resolveSettings({ quick: preset.quickSettings });
			const byAdvanced = resolveSettings({
				advanced: byPreset.effectiveOptions,
			});

			expect(byQuick.effectiveOptions).toEqual(byPreset.effectiveOptions);
			expect(byAdvanced.effectiveOptions).toEqual(byPreset.effectiveOptions);
			expect(normalizeProcessOptions(byQuick.options)).toEqual(
				normalizeProcessOptions(byPreset.options),
			);
			expect(normalizeProcessOptions(byAdvanced.options)).toEqual(
				normalizeProcessOptions(byPreset.options),
			);
			expect(byPreset.presetId).toBe(presetId);
			expect(byPreset.adjustments).toEqual([]);
		},
	);

	it("effectiveOptions は JSON 化しても同値のまま往復する", () => {
		const resolved = resolveSettings({ preset: "retro-game" });
		expect(JSON.parse(JSON.stringify(resolved.effectiveOptions))).toEqual(
			resolved.effectiveOptions,
		);
		expect(JSON.parse(JSON.stringify(resolved.resolved))).toEqual(
			resolved.resolved,
		);
	});

	it.each(["sampleWindow", "bgRemovalScope", "trimToContent"] as const)(
		"null で消した %s は往復しても消えたまま",
		(key) => {
			const first = resolveSettings({ advanced: { [key]: null } });
			expect(first.effectiveOptions[key]).toBeNull();
			const second = resolveSettings({ advanced: first.effectiveOptions });
			expect(second.effectiveOptions).toEqual(first.effectiveOptions);
			expect(second.options).not.toHaveProperty(key);
			expect(normalizeProcessOptions(second.options)).toEqual(
				normalizeProcessOptions(first.options),
			);
		},
	);

	it("土台が入れないキーは消えていても null を置かない", () => {
		const resolved = resolveSettings({ advanced: { colorCount: null } });
		expect(resolved.effectiveOptions).not.toHaveProperty("colorCount");
		expect(resolved.effectiveOptions).not.toHaveProperty("fixedPalette");
		expect(resolved.effectiveOptions).not.toHaveProperty("forcePixelsW");
	});

	it("resolved は detect の控えを持たず 1 段に畳まれている", () => {
		const resolved = resolveSettings({ advanced: { colorCount: 9999 } });
		expect(resolved.resolved.detect).toBeUndefined();
		// [Intended] 畳んだ結果は正規化後の値（切り詰め済み）が 1 つだけ残る。
		expect(resolved.resolved.colorCount).toBe(PROCESS_RANGES.colorCount.max);
		expect(resolved.resolved.detectionQuantStep).toBe(
			PROCESS_RANGES.detectionQuantStep.default,
		);
	});

	it("resolved は経路既定を反映した正規化後の値を含む", () => {
		const resolved = resolveSettings({});
		expect(resolved.resolved.convertColorCount).toBe(
			normalizeProcessOptions(resolved.options).convertColorCount,
		);
		expect(resolved.resolved.debug).toBe(false);
		expect(resolved.resolved.debugHook).toBeUndefined();
	});

	it("既定はプリセット auto で、内部キーは実効設定に現れない", () => {
		const resolved = resolveSettings();
		expect(resolved.presetId).toBe("auto");
		expect(resolved.options.debug).toBe(false);
		expect(resolved.effectiveOptions).not.toHaveProperty("debug");
		expect(resolved.effectiveOptions).not.toHaveProperty("gridSignals");
	});

	it("未知のプリセットは利用可能な id を並べて失敗する", () => {
		expect(() => resolveSettings({ preset: "nope" })).toThrow(SettingsError);
		try {
			resolveSettings({ preset: "nope" });
		} catch (error) {
			expect(String(error)).toContain("crisp-sprite");
		}
	});
});

describe("resolveSettings: かんたん設定", () => {
	it("reductionMode:auto は色削減の 3 キーを未設定のままにする", () => {
		const resolved = resolveSettings({ quick: { reductionMode: "auto" } });
		expect(resolved.effectiveOptions).not.toHaveProperty("reduceColors");
		expect(resolved.effectiveOptions).not.toHaveProperty("reduceColorMode");
		expect(resolved.effectiveOptions).not.toHaveProperty("colorCount");
	});

	it("background:pick は backgroundColor を必須にする", () => {
		expect(() => resolveSettings({ quick: { background: "pick" } })).toThrow(
			/backgroundColor/,
		);
		const resolved = resolveSettings({
			quick: { background: "pick", backgroundColor: "#ff00ff" },
		});
		expect(resolved.effectiveOptions.bgRgb).toBe("#ff00ff");
		expect(resolved.effectiveOptions.bgExtractionMethod).toBe("rgb");
	});

	it("かんたん設定の未知のキーと値は失敗する", () => {
		const badValue = { dithering: "medium" } as unknown as QuickOverrides;
		const badKey = { ditherng: "off" } as unknown as QuickOverrides;
		expect(() => resolveSettings({ quick: badValue })).toThrow(/dithering/);
		expect(() => resolveSettings({ quick: badKey })).toThrow(/dithering/);
	});
});

describe("resolveSettings: 詳細設定の上書き", () => {
	it("null はかんたん設定が入れたキーを取り除く", () => {
		const withColors = resolveSettings({ quick: { reductionMode: "32" } });
		expect(withColors.effectiveOptions.colorCount).toBe(32);
		const resolved = resolveSettings({
			quick: { reductionMode: "32" },
			advanced: { colorCount: null },
		});
		expect(resolved.effectiveOptions).not.toHaveProperty("colorCount");
	});

	it("reduceColorMode だけの指定は reduceColors を導出する", () => {
		const resolved = resolveSettings({
			advanced: { reduceColorMode: "pico8" },
		});
		expect(resolved.effectiveOptions.reduceColors).toBe(true);
		const off = resolveSettings({ advanced: { reduceColorMode: "none" } });
		expect(off.effectiveOptions.reduceColors).toBe(false);
	});

	it("reduceColors を明示したときは導出しない", () => {
		const resolved = resolveSettings({
			advanced: { reduceColorMode: "pico8", reduceColors: false },
		});
		expect(resolved.effectiveOptions.reduceColors).toBe(false);
	});

	it("bgExtractionMethod:none は背景除去の 3 キーを落とす", () => {
		const resolved = resolveSettings({
			advanced: { bgExtractionMethod: "none" },
		});
		expect(resolved.effectiveOptions.preRemoveBackground).toBe(false);
		expect(resolved.effectiveOptions.postRemoveBackground).toBe(false);
		expect(resolved.effectiveOptions.bgRemovalScope).toBe("off");
	});

	it("bgExtractionMethod:none と矛盾する明示指定は失敗する", () => {
		expect(() =>
			resolveSettings({
				advanced: { bgExtractionMethod: "none", preRemoveBackground: true },
			}),
		).toThrow(/bgExtractionMethod/);
	});

	it("色は #rrggbb でも RGB オブジェクトでも受け取る", () => {
		const resolved = resolveSettings({
			advanced: {
				outlineColor: "#102030",
				fixedPalette: ["#000000", "#ffffff"],
				reduceColorMode: "fixed",
			},
		});
		expect(resolved.effectiveOptions.outlineColor).toEqual({
			r: 16,
			g: 32,
			b: 48,
		});
		expect(resolved.effectiveOptions.fixedPalette).toEqual([
			{ r: 0, g: 0, b: 0 },
			{ r: 255, g: 255, b: 255 },
		]);
		const again = resolveSettings({ advanced: resolved.effectiveOptions });
		expect(again.effectiveOptions).toEqual(resolved.effectiveOptions);
	});

	it("reduceColorMode:fixed は fixedPalette を必須にする", () => {
		try {
			resolveSettings({ advanced: { reduceColorMode: "fixed" } });
			throw new Error("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(SettingsError);
			if (!(error instanceof SettingsError)) throw error;
			expect(error.code).toBe("INVALID_SETTINGS");
			expect(error.hint).toContain("fixedPalette");
		}
	});

	it("範囲外の整数は切り詰めて adjustments に記録する", () => {
		const resolved = resolveSettings({
			advanced: { colorCount: 9999, sampleWindow: 3.7 },
		});
		expect(resolved.effectiveOptions.colorCount).toBe(
			PROCESS_RANGES.colorCount.max,
		);
		expect(resolved.effectiveOptions.sampleWindow).toBe(3);
		expect(resolved.adjustments).toEqual([
			{
				key: "colorCount",
				requested: 9999,
				applied: PROCESS_RANGES.colorCount.max,
			},
			{ key: "sampleWindow", requested: 3.7, applied: 3 },
		]);
	});

	it("範囲内の整数は adjustments を作らない", () => {
		const resolved = resolveSettings({ advanced: { colorCount: 12 } });
		expect(resolved.adjustments).toEqual([]);
	});
});

describe("resolveSettings: グリッド検出", () => {
	it("off はグリッド検出を切り、寸法指定を残さない", () => {
		const resolved = resolveSettings({ gridDetection: { mode: "off" } });
		expect(resolved.effectiveOptions.enableGridDetection).toBe(false);
		expect(resolved.effectiveOptions).not.toHaveProperty("forcePixelsW");
		expect(resolved.effectiveOptions).not.toHaveProperty("hintPixelsW");
	});

	it("auto はグリッド検出を入れる", () => {
		const resolved = resolveSettings({ gridDetection: { mode: "auto" } });
		expect(resolved.effectiveOptions.enableGridDetection).toBe(true);
		expect(resolved.effectiveOptions).not.toHaveProperty("forcePixelsW");
	});

	it("force は forcePixelsW/H を設定する", () => {
		const resolved = resolveSettings({
			gridDetection: { mode: "force", width: 32, height: 48 },
		});
		expect(resolved.effectiveOptions.forcePixelsW).toBe(32);
		expect(resolved.effectiveOptions.forcePixelsH).toBe(48);
		expect(resolved.effectiveOptions.enableGridDetection).toBe(true);
		expect(resolved.effectiveOptions).not.toHaveProperty("hintPixelsW");
	});

	it("hint は hintPixelsW/H を設定する", () => {
		const resolved = resolveSettings({
			gridDetection: { mode: "hint", width: 64, height: 64 },
		});
		expect(resolved.effectiveOptions.hintPixelsW).toBe(64);
		expect(resolved.effectiveOptions.hintPixelsH).toBe(64);
		expect(resolved.effectiveOptions).not.toHaveProperty("forcePixelsW");
	});

	it("寸法を切り詰めたときは adjustments に記録する", () => {
		const resolved = resolveSettings({
			gridDetection: { mode: "force", width: 99999, height: 16 },
		});
		expect(resolved.effectiveOptions.forcePixelsW).toBe(
			PROCESS_RANGES.forcePixelsW.max,
		);
		expect(resolved.adjustments).toEqual([
			{
				key: "forcePixelsW",
				requested: 99999,
				applied: PROCESS_RANGES.forcePixelsW.max,
			},
		]);
	});

	it("hint/force で寸法が欠けていれば失敗する", () => {
		expect(() =>
			resolveSettings({ gridDetection: { mode: "force", width: 32 } }),
		).toThrow(/height/);
		expect(() =>
			resolveSettings({ gridDetection: { mode: "hint", height: 32 } }),
		).toThrow(/width/);
	});

	it("advanced のグリッドキーと同時指定は失敗する", () => {
		expect(() =>
			resolveSettings({
				gridDetection: { mode: "auto" },
				advanced: { forcePixelsW: 32 },
			}),
		).toThrow(/forcePixelsW/);
		expect(() =>
			resolveSettings({
				gridDetection: { mode: "off" },
				advanced: { enableGridDetection: true },
			}),
		).toThrow(/enableGridDetection/);
	});

	it("gridDetection を使わなければ advanced のグリッドキーは通る", () => {
		const resolved = resolveSettings({ advanced: { forcePixelsW: 32 } });
		expect(resolved.effectiveOptions.forcePixelsW).toBe(32);
	});
});
