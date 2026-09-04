import {
	CELL_SCALE_FACTORS,
	CONVERT_DETAIL_SCALES,
	RETRO_PALETTES,
} from "./config";
import type {
	AutoBehaviorSetting,
	BackgroundRemovalScope,
	BgExtractionMethod,
	CellSamplingMode,
	CellScale,
	Connectivity,
	DetailLevel,
	DitherMode,
	GeminiWatermarkRemovalMode,
	OutlineStyle,
	ProcessingMode,
	SmallComponentRemovalMode,
} from "./types";

/**
 * union 型の値集合を実行時の配列として取り出す。
 * [Intended] `Record<T, true>` の網羅性検査（値の増減が型エラーになる）を保ったまま、
 * select-options.test.ts のローカル定義と MCP 側のスキーマ生成が同じ配列を参照できるようにする。
 */
export const valuesOf = <T extends string>(
	values: Record<T, true>,
): readonly T[] => Object.keys(values) as T[];

export const PROCESSING_MODE_VALUES: readonly ProcessingMode[] =
	valuesOf<ProcessingMode>({
		auto: true,
		refine: true,
		convert: true,
		preserve: true,
	});

export const DITHER_MODE_VALUES: readonly DitherMode[] = valuesOf<DitherMode>({
	none: true,
	"floyd-steinberg": true,
	"bayer-2x2": true,
	"bayer-4x4": true,
	"bayer-8x8": true,
	ordered: true,
});

export const OUTLINE_STYLE_VALUES: readonly OutlineStyle[] =
	valuesOf<OutlineStyle>({
		none: true,
		rounded: true,
		sharp: true,
	});

export const BACKGROUND_REMOVAL_SCOPE_VALUES: readonly BackgroundRemovalScope[] =
	valuesOf<BackgroundRemovalScope>({
		off: true,
		selected: true,
		outer: true,
		auto: true,
		all: true,
	});

export const CONNECTIVITY_VALUES: readonly Connectivity[] =
	valuesOf<Connectivity>({
		"4": true,
		"8": true,
	});

export const SMALL_COMPONENT_REMOVAL_MODE_VALUES: readonly SmallComponentRemovalMode[] =
	valuesOf<SmallComponentRemovalMode>({
		off: true,
		light: true,
		auto: true,
		strong: true,
	});

export const GEMINI_WATERMARK_REMOVAL_MODE_VALUES: readonly GeminiWatermarkRemovalMode[] =
	valuesOf<GeminiWatermarkRemovalMode>({
		off: true,
		auto: true,
	});

export const AUTO_BEHAVIOR_SETTING_VALUES: readonly AutoBehaviorSetting[] =
	valuesOf<AutoBehaviorSetting>({
		auto: true,
		on: true,
		off: true,
	});

export const CELL_SAMPLING_MODE_VALUES: readonly CellSamplingMode[] =
	valuesOf<CellSamplingMode>({
		"legacy-median": true,
		"hard-alpha-medoid": true,
		"alpha-aware-medoid": true,
		"area-weighted": true,
		"edge-aware": true,
	});

export const BG_EXTRACTION_METHOD_VALUES: readonly BgExtractionMethod[] =
	valuesOf<BgExtractionMethod>({
		none: true,
		auto: true,
		"top-left": true,
		"bottom-left": true,
		"top-right": true,
		"bottom-right": true,
		rgb: true,
	});

// [Policy] CONVERT_DETAIL_SCALES / CELL_SCALE_FACTORS は config.ts 側で
// `satisfies Record<DetailLevel, number>` 等により既に網羅性が保証されているため、
// ここでは valuesOf を使わず Object.keys をそのまま型付けする。
export const DETAIL_LEVEL_VALUES: readonly DetailLevel[] = Object.keys(
	CONVERT_DETAIL_SCALES,
) as DetailLevel[];

export const CELL_SCALE_VALUES: readonly CellScale[] = Object.keys(
	CELL_SCALE_FACTORS,
) as CellScale[];

export const RETRO_PALETTE_IDS: readonly string[] = Object.keys(RETRO_PALETTES);

/**
 * 減色モードの選択肢。
 * [Intended] "fixed" は詳細設定 UI（advanced-color-reduction）が公開している値で、
 * 「fixedPalette を使う」ことを表す名前。core の reduceColorMode 自体には現れず
 * fixedPalette の有無で判定するが、UI とスキーマの語彙を一致させるためここへ含める。
 */
export const REDUCE_COLOR_MODE_VALUES: readonly string[] = [
	"none",
	"auto",
	"fixed",
	...RETRO_PALETTE_IDS,
];
