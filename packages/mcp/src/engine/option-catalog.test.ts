import { describe, expect, it } from "vitest";
import {
	BUILT_IN_PRESETS,
	QUICK_BACKGROUND_VALUES,
	QUICK_DITHERING_VALUES,
	QUICK_REDUCTION_MODE_VALUES,
	QUICK_SETTINGS_DEFAULTS,
} from "../../../../src/browser/quick-settings";
import { PROCESS_RANGES, RETRO_PALETTES } from "../../../../src/shared/config";
import {
	AUTO_BEHAVIOR_SETTING_VALUES,
	BACKGROUND_REMOVAL_SCOPE_VALUES,
	BG_EXTRACTION_METHOD_VALUES,
	CELL_SAMPLING_MODE_VALUES,
	CELL_SCALE_VALUES,
	CONNECTIVITY_VALUES,
	DETAIL_LEVEL_VALUES,
	DITHER_MODE_VALUES,
	GEMINI_WATERMARK_REMOVAL_MODE_VALUES,
	OUTLINE_STYLE_VALUES,
	PROCESSING_MODE_VALUES,
	REDUCE_COLOR_MODE_VALUES,
	SMALL_COMPONENT_REMOVAL_MODE_VALUES,
} from "../../../../src/shared/option-values";
import { ADVANCED_OPTION_SPECS } from "./option-catalog";
import { listOptions } from "./option-listing";
import { type AdvancedOptionKey, INTERNAL_OPTION_KEYS } from "./types";

/**
 * 公開すべき ProcessOptions のキー全集合。
 * [Intended] `satisfies Record<AdvancedOptionKey, true>` により、ProcessOptions に
 * キーが増減するとこのリテラルが型エラーになる。カタログとこの表を双方向で突き合わせる
 * ことで、「型の上では公開対象なのにカタログに無い」キーを実行時にも検出できる。
 */
const ALL_ADVANCED_KEYS = {
	processingMode: true,
	detailLevel: true,
	cellScale: true,
	convertPixelsW: true,
	convertPixelsH: true,
	detectionQuantStep: true,
	autoMaxCellsW: true,
	autoMaxCellsH: true,
	backgroundMask: true,
	backgroundMaskTolerance: true,
	enableGridDetection: true,
	forcePixelsW: true,
	forcePixelsH: true,
	hintPixelsW: true,
	hintPixelsH: true,
	autoGridFromTrimmed: true,
	fastAutoGridFromTrimmed: true,
	phaseAwareGridSearch: true,
	boundaryContrastOverride: true,
	smallAspectGridAlignment: true,
	watermarkSamplingCompat: true,
	sampleWindow: true,
	cellSamplingMode: true,
	maxSamplesPerCell: true,
	cellAlphaThreshold: true,
	preserveThinFeatures: true,
	preRemoveBackground: true,
	postRemoveBackground: true,
	bgExtractionMethod: true,
	bgRgb: true,
	bgRemovalScope: true,
	bgConnectivity: true,
	backgroundTolerance: true,
	backgroundDehalo: true,
	backgroundEdgeCleanup: true,
	backgroundRampFollow: true,
	backgroundRemovalRollback: true,
	alphaBorderBackgroundGuard: true,
	backgroundConfidenceGate: true,
	smallComponentBackgroundGate: true,
	smallComponentMode: true,
	geminiWatermarkRemoval: true,
	floatingMaxPixels: true,
	trimToContent: true,
	preserveProcessingScale: true,
	trimAlphaThreshold: true,
	makeSquare: true,
	keepAspectRatio: true,
	reduceColors: true,
	reduceColorMode: true,
	colorCount: true,
	fixedPalette: true,
	ditherMode: true,
	ditherStrength: true,
	outlineStyle: true,
	outlineColor: true,
} satisfies Record<AdvancedOptionKey, true>;

/** PROCESS_RANGES のうち整数範囲を持つキー（outlineColor だけ RGB なので除く）。 */
type IntRangeKey = Exclude<keyof typeof PROCESS_RANGES, "outlineColor">;

/** int 種別のオプションキーと、参照すべき PROCESS_RANGES のキーの対応。 */
const INT_RANGE_KEYS: Readonly<Record<string, IntRangeKey>> = {
	detectionQuantStep: "detectionQuantStep",
	backgroundMaskTolerance: "backgroundMaskTolerance",
	sampleWindow: "sampleWindow",
	maxSamplesPerCell: "maxSamplesPerCell",
	cellAlphaThreshold: "cellAlphaThreshold",
	backgroundTolerance: "backgroundTolerance",
	trimAlphaThreshold: "trimAlphaThreshold",
	floatingMaxPixels: "floatingMaxPixels",
	forcePixelsW: "forcePixelsW",
	forcePixelsH: "forcePixelsH",
	hintPixelsW: "forcePixelsW",
	hintPixelsH: "forcePixelsH",
	convertPixelsW: "convertPixelsW",
	convertPixelsH: "convertPixelsH",
	colorCount: "colorCount",
	ditherStrength: "ditherStrength",
	autoMaxCellsW: "autoMaxCells",
	autoMaxCellsH: "autoMaxCells",
};

const ENUM_VALUE_SOURCES: Readonly<Record<string, readonly string[]>> = {
	processingMode: PROCESSING_MODE_VALUES,
	detailLevel: DETAIL_LEVEL_VALUES,
	cellScale: CELL_SCALE_VALUES,
	smallAspectGridAlignment: AUTO_BEHAVIOR_SETTING_VALUES,
	watermarkSamplingCompat: AUTO_BEHAVIOR_SETTING_VALUES,
	bgRemovalScope: BACKGROUND_REMOVAL_SCOPE_VALUES,
	bgConnectivity: CONNECTIVITY_VALUES,
	cellSamplingMode: CELL_SAMPLING_MODE_VALUES,
	smallComponentMode: SMALL_COMPONENT_REMOVAL_MODE_VALUES,
	geminiWatermarkRemoval: GEMINI_WATERMARK_REMOVAL_MODE_VALUES,
	reduceColorMode: REDUCE_COLOR_MODE_VALUES,
	ditherMode: DITHER_MODE_VALUES,
	bgExtractionMethod: BG_EXTRACTION_METHOD_VALUES,
	outlineStyle: OUTLINE_STYLE_VALUES,
};

describe("ADVANCED_OPTION_SPECS", () => {
	it("キーは重複せず、内部専用キーを含まない", () => {
		const keys = ADVANCED_OPTION_SPECS.map((spec) => spec.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const internal of INTERNAL_OPTION_KEYS) {
			expect(keys).not.toContain(internal);
		}
	});

	it("公開対象のキー集合と過不足なく一致する", () => {
		const catalogKeys = new Set<string>(
			ADVANCED_OPTION_SPECS.map((spec) => spec.key),
		);
		expect(catalogKeys).toEqual(new Set(Object.keys(ALL_ADVANCED_KEYS)));
	});

	it("列挙型の値は shared の配列と一致する", () => {
		for (const spec of ADVANCED_OPTION_SPECS) {
			if (spec.kind !== "enum") continue;
			const expected = ENUM_VALUE_SOURCES[spec.key];
			expect(expected, `${spec.key} の期待値が未登録`).toBeDefined();
			expect(spec.values).toEqual(expected);
		}
		const enumKeys = ADVANCED_OPTION_SPECS.filter(
			(spec) => spec.kind === "enum",
		).map((spec) => spec.key);
		expect(new Set(enumKeys)).toEqual(new Set(Object.keys(ENUM_VALUE_SOURCES)));
	});

	it("整数型の min/max/default は PROCESS_RANGES に一致する", () => {
		const intKeys = ADVANCED_OPTION_SPECS.filter(
			(spec) => spec.kind === "int",
		).map((spec) => spec.key);
		expect(new Set(intKeys)).toEqual(new Set(Object.keys(INT_RANGE_KEYS)));
		for (const spec of ADVANCED_OPTION_SPECS) {
			if (spec.kind !== "int") continue;
			const range = PROCESS_RANGES[INT_RANGE_KEYS[spec.key]];
			expect({ min: spec.min, max: spec.max, default: spec.default }).toEqual({
				min: range.min,
				max: range.max,
				default: range.default,
			});
		}
	});

	it("すべての仕様に説明文がある", () => {
		for (const spec of ADVANCED_OPTION_SPECS) {
			expect(
				spec.description.length,
				`${spec.key} の説明文が空`,
			).toBeGreaterThan(10);
			if (spec.kind !== "enum") continue;
			expect(
				spec.valueDescriptions,
				`${spec.key} に選択肢の説明が無い`,
			).toBeDefined();
			for (const value of spec.values ?? []) {
				expect(
					spec.valueDescriptions?.[value],
					`${spec.key}.${value} の説明文が無い`,
				).toBeTruthy();
			}
		}
	});
});

describe("listOptions", () => {
	it("presets は組み込みプリセットの id とかんたん設定を返す", () => {
		const listing = listOptions("presets");
		expect(listing.presets?.map((preset) => preset.id)).toEqual(
			BUILT_IN_PRESETS.map((preset) => preset.id),
		);
		expect(listing.presets?.[0]?.quickSettings).toEqual(
			BUILT_IN_PRESETS[0].quickSettings,
		);
		expect(listing.advanced).toBeUndefined();
	});

	it("palettes はレトロパレットを 16 進表記で返す", () => {
		const listing = listOptions("palettes");
		const ids = listing.palettes?.map((palette) => palette.id) ?? [];
		expect(ids).toEqual(Object.keys(RETRO_PALETTES));
		const first = listing.palettes?.[0];
		expect(first?.name).toBe(RETRO_PALETTES[ids[0]].name);
		expect(first?.colors).toEqual(RETRO_PALETTES[ids[0]].colors);
		expect(first?.colorCount).toBe(RETRO_PALETTES[ids[0]].colors.length);
	});

	it("quick は 7 つのつまみと既定値を返す", () => {
		const listing = listOptions("quick");
		const byKey = new Map(
			(listing.quick ?? []).map((knob) => [knob.key, knob]),
		);
		expect([...byKey.keys()].sort()).toEqual(
			[
				"background",
				"backgroundColor",
				"cellScale",
				"detailLevel",
				"dithering",
				"processingMode",
				"reductionMode",
			].sort(),
		);
		expect(byKey.get("reductionMode")?.values).toEqual(
			QUICK_REDUCTION_MODE_VALUES,
		);
		expect(byKey.get("background")?.values).toEqual(QUICK_BACKGROUND_VALUES);
		expect(byKey.get("dithering")?.values).toEqual(QUICK_DITHERING_VALUES);
		expect(byKey.get("processingMode")?.default).toBe(
			QUICK_SETTINGS_DEFAULTS.processingMode,
		);
		expect(byKey.get("backgroundColor")?.values).toBeUndefined();
	});

	it("advanced は仕様表をそのまま返す", () => {
		const listing = listOptions("advanced");
		expect(listing.advanced).toEqual(ADVANCED_OPTION_SPECS);
	});

	it("all はすべての区画を返し、JSON 化できる", () => {
		const listing = listOptions("all");
		expect(listing.presets).toBeDefined();
		expect(listing.palettes).toBeDefined();
		expect(listing.quick).toBeDefined();
		expect(listing.advanced).toBeDefined();
		// [Intended] JSON 往復で同値になることが「JSON-safe」の定義そのもの。
		expect(JSON.parse(JSON.stringify(listing))).toEqual(listing);
	});
});
