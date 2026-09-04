import {
	PROCESS_DEFAULTS,
	PROCESS_RANGES,
} from "../../../../src/shared/config";
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
import {
	ENUM_VALUE_DESCRIPTIONS,
	OPTION_DESCRIPTIONS,
} from "./option-descriptions";
import type { AdvancedOptionKey } from "./types";

export type AdvancedOptionKind =
	| "int"
	| "boolean"
	| "enum"
	| "color"
	| "palette"
	| "string";

export type AdvancedOptionSpec = {
	key: AdvancedOptionKey;
	kind: AdvancedOptionKind;
	min?: number;
	max?: number;
	default?: number | boolean | string;
	values?: readonly string[];
	valueDescriptions?: Readonly<Record<string, string>>;
	description: string;
};

type IntRange = { min: number; max: number; default: number };

const intSpec = (
	key: AdvancedOptionKey,
	range: IntRange,
): AdvancedOptionSpec => ({
	key,
	kind: "int",
	min: range.min,
	max: range.max,
	default: range.default,
	description: OPTION_DESCRIPTIONS[key],
});

const boolSpec = (
	key: AdvancedOptionKey,
	defaultValue: boolean,
): AdvancedOptionSpec => ({
	key,
	kind: "boolean",
	default: defaultValue,
	description: OPTION_DESCRIPTIONS[key],
});

const enumSpec = (
	key: AdvancedOptionKey,
	values: readonly string[],
	defaultValue?: string,
): AdvancedOptionSpec => ({
	key,
	kind: "enum",
	values,
	default: defaultValue,
	valueDescriptions: ENUM_VALUE_DESCRIPTIONS[key],
	description: OPTION_DESCRIPTIONS[key],
});

const plainSpec = (
	key: AdvancedOptionKey,
	kind: AdvancedOptionKind,
): AdvancedOptionSpec => ({
	key,
	kind,
	description: OPTION_DESCRIPTIONS[key],
});

/**
 * 詳細設定として公開するオプションの一覧。
 * [Policy] ここに載っているキーだけが advanced として受け付けられ、実効設定にも現れる。
 * 内部専用キー（types.ts の INTERNAL_OPTION_KEYS）を載せないことが、そのまま
 * 「AI からは注入できない」保証になる。
 */
export const ADVANCED_OPTION_SPECS: readonly AdvancedOptionSpec[] = [
	enumSpec(
		"processingMode",
		PROCESSING_MODE_VALUES,
		PROCESS_DEFAULTS.processingMode,
	),
	enumSpec("detailLevel", DETAIL_LEVEL_VALUES, PROCESS_DEFAULTS.detailLevel),
	enumSpec("cellScale", CELL_SCALE_VALUES, PROCESS_DEFAULTS.cellScale),
	intSpec("convertPixelsW", PROCESS_RANGES.convertPixelsW),
	intSpec("convertPixelsH", PROCESS_RANGES.convertPixelsH),
	intSpec("detectionQuantStep", PROCESS_RANGES.detectionQuantStep),
	intSpec("autoMaxCellsW", PROCESS_RANGES.autoMaxCells),
	intSpec("autoMaxCellsH", PROCESS_RANGES.autoMaxCells),
	boolSpec("backgroundMask", PROCESS_DEFAULTS.backgroundMask),
	intSpec("backgroundMaskTolerance", PROCESS_RANGES.backgroundMaskTolerance),
	boolSpec("enableGridDetection", PROCESS_DEFAULTS.enableGridDetection),
	intSpec("forcePixelsW", PROCESS_RANGES.forcePixelsW),
	intSpec("forcePixelsH", PROCESS_RANGES.forcePixelsH),
	intSpec("hintPixelsW", PROCESS_RANGES.forcePixelsW),
	intSpec("hintPixelsH", PROCESS_RANGES.forcePixelsH),
	boolSpec("autoGridFromTrimmed", PROCESS_DEFAULTS.autoGridFromTrimmed),
	boolSpec("fastAutoGridFromTrimmed", PROCESS_DEFAULTS.fastAutoGridFromTrimmed),
	boolSpec("phaseAwareGridSearch", PROCESS_DEFAULTS.phaseAwareGridSearch),
	boolSpec(
		"boundaryContrastOverride",
		PROCESS_DEFAULTS.boundaryContrastOverride,
	),
	enumSpec(
		"smallAspectGridAlignment",
		AUTO_BEHAVIOR_SETTING_VALUES,
		PROCESS_DEFAULTS.smallAspectGridAlignment,
	),
	enumSpec(
		"watermarkSamplingCompat",
		AUTO_BEHAVIOR_SETTING_VALUES,
		PROCESS_DEFAULTS.watermarkSamplingCompat,
	),
	intSpec("sampleWindow", PROCESS_RANGES.sampleWindow),
	enumSpec(
		"cellSamplingMode",
		CELL_SAMPLING_MODE_VALUES,
		PROCESS_DEFAULTS.cellSamplingMode,
	),
	intSpec("maxSamplesPerCell", PROCESS_RANGES.maxSamplesPerCell),
	intSpec("cellAlphaThreshold", PROCESS_RANGES.cellAlphaThreshold),
	boolSpec("preserveThinFeatures", PROCESS_DEFAULTS.preserveThinFeatures),
	boolSpec("preRemoveBackground", PROCESS_DEFAULTS.preRemoveBackground),
	boolSpec("postRemoveBackground", PROCESS_DEFAULTS.postRemoveBackground),
	enumSpec(
		"bgExtractionMethod",
		BG_EXTRACTION_METHOD_VALUES,
		PROCESS_DEFAULTS.bgExtractionMethod,
	),
	plainSpec("bgRgb", "color"),
	enumSpec(
		"bgRemovalScope",
		BACKGROUND_REMOVAL_SCOPE_VALUES,
		PROCESS_DEFAULTS.bgRemovalScope,
	),
	enumSpec(
		"bgConnectivity",
		CONNECTIVITY_VALUES,
		PROCESS_DEFAULTS.bgConnectivity,
	),
	intSpec("backgroundTolerance", PROCESS_RANGES.backgroundTolerance),
	boolSpec("backgroundDehalo", PROCESS_DEFAULTS.backgroundDehalo),
	boolSpec("backgroundEdgeCleanup", PROCESS_DEFAULTS.backgroundEdgeCleanup),
	boolSpec("backgroundRampFollow", PROCESS_DEFAULTS.backgroundRampFollow),
	boolSpec(
		"backgroundRemovalRollback",
		PROCESS_DEFAULTS.backgroundRemovalRollback,
	),
	boolSpec(
		"alphaBorderBackgroundGuard",
		PROCESS_DEFAULTS.alphaBorderBackgroundGuard,
	),
	boolSpec(
		"backgroundConfidenceGate",
		PROCESS_DEFAULTS.backgroundConfidenceGate,
	),
	boolSpec(
		"smallComponentBackgroundGate",
		PROCESS_DEFAULTS.smallComponentBackgroundGate,
	),
	enumSpec(
		"smallComponentMode",
		SMALL_COMPONENT_REMOVAL_MODE_VALUES,
		PROCESS_DEFAULTS.smallComponentMode,
	),
	enumSpec(
		"geminiWatermarkRemoval",
		GEMINI_WATERMARK_REMOVAL_MODE_VALUES,
		PROCESS_DEFAULTS.geminiWatermarkRemoval,
	),
	intSpec("floatingMaxPixels", PROCESS_RANGES.floatingMaxPixels),
	boolSpec("trimToContent", PROCESS_DEFAULTS.trimToContent),
	boolSpec("preserveProcessingScale", PROCESS_DEFAULTS.preserveProcessingScale),
	intSpec("trimAlphaThreshold", PROCESS_RANGES.trimAlphaThreshold),
	boolSpec("makeSquare", PROCESS_DEFAULTS.makeSquare),
	boolSpec("keepAspectRatio", PROCESS_DEFAULTS.keepAspectRatio),
	boolSpec("reduceColors", PROCESS_DEFAULTS.reduceColors),
	enumSpec(
		"reduceColorMode",
		REDUCE_COLOR_MODE_VALUES,
		PROCESS_DEFAULTS.reduceColorMode,
	),
	intSpec("colorCount", PROCESS_RANGES.colorCount),
	plainSpec("fixedPalette", "palette"),
	enumSpec("ditherMode", DITHER_MODE_VALUES, PROCESS_DEFAULTS.ditherMode),
	intSpec("ditherStrength", PROCESS_RANGES.ditherStrength),
	enumSpec("outlineStyle", OUTLINE_STYLE_VALUES, PROCESS_DEFAULTS.outlineStyle),
	plainSpec("outlineColor", "color"),
];

export const ADVANCED_OPTION_SPEC_BY_KEY: ReadonlyMap<
	string,
	AdvancedOptionSpec
> = new Map(ADVANCED_OPTION_SPECS.map((spec) => [spec.key, spec]));
