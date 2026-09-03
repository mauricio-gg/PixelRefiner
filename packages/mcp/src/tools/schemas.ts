import { z } from "zod";
import {
	BUILT_IN_PRESETS,
	QUICK_BACKGROUND_VALUES,
	QUICK_DITHERING_VALUES,
	QUICK_REDUCTION_MODE_VALUES,
} from "../../../../src/browser/quick-settings";
import { PROCESS_RANGES } from "../../../../src/shared/config";
import {
	CELL_SCALE_VALUES,
	DETAIL_LEVEL_VALUES,
	DITHER_MODE_VALUES,
	PROCESSING_MODE_VALUES,
} from "../../../../src/shared/option-values";
import type { ReportDetail } from "../engine/analysis-report";
import type { OptionsSection } from "../engine/option-listing";
import type { GridDetectionMode, RefineSettings } from "../engine/types";
import { MAX_INPUTS, PREVIEW_ITEM_LIMIT } from "../operations/batch";
import { DEFAULT_SUFFIX } from "../operations/shared";
import { advancedSchema, HEX_COLOR_PATTERN } from "./advanced-schema";

/** 出力倍率の範囲。operations/shared.ts の normalizeScale と同じ 1..32。 */
const MIN_SCALE = 1;
const MAX_SCALE = 32;

/** 説明文で繰り返す言い回し。ツールごとに書き分けるとすぐ食い違うのでまとめる。 */
const INPUT_PATH_HINT = [
	"Absolute path to the image file. Relative paths are rejected because this process's working directory",
	"is not yours.",
].join(" ");

/** 設定の階層。ツール説明にも同じ文を載せるので export する。 */
export const SETTINGS_HINT = [
	"Optional settings. They layer as preset -> quick -> advanced: a preset is a named quick-settings",
	"combination, quick is seven knobs that cover most work, and advanced exposes each pipeline option on its",
	"own; later layers win, and every 'auto' value is resolved by the engine. Call list_options for the full",
	"vocabulary.",
].join(" ");

const DETAIL_HINT = [
	"'full' adds the effective options, the normalised settings and per-candidate subscores to the report.",
].join(" ");

// [Intended] 実行時の語彙は型と同じ集合であることを satisfies で縛る。値を足し忘れても
// 型側が先に壊れるので、スキーマだけ古いまま公開されることがない。
const GRID_DETECTION_MODES = [
	"auto",
	"hint",
	"force",
	"off",
] as const satisfies readonly GridDetectionMode[];
const REPORT_DETAILS = [
	"summary",
	"full",
] as const satisfies readonly ReportDetail[];
const OPTIONS_SECTIONS = [
	"all",
	"presets",
	"palettes",
	"quick",
	"advanced",
] as const satisfies readonly OptionsSection[];

const PRESET_IDS: readonly string[] = BUILT_IN_PRESETS.map(
	(preset) => preset.id,
);

const quickSchema = z.strictObject({
	processingMode: z
		.enum([...PROCESSING_MODE_VALUES])
		.optional()
		.describe("Which pipeline to run; 'auto' classifies the input."),
	detailLevel: z
		.enum([...DETAIL_LEVEL_VALUES])
		.optional()
		.describe("Logical resolution preset for the convert route."),
	cellScale: z
		.enum([...CELL_SCALE_VALUES])
		.optional()
		.describe(
			"Multiplier on the detected cell size; fixes a 2x or half-size grid.",
		),
	reductionMode: z
		.enum([...QUICK_REDUCTION_MODE_VALUES])
		.optional()
		.describe(
			"Colour reduction: 'auto', 'none', a colour count, or a retro palette id.",
		),
	background: z
		.enum([...QUICK_BACKGROUND_VALUES])
		.optional()
		.describe(
			"'keep' leaves it, 'auto' estimates it, 'pick' uses backgroundColor.",
		),
	dithering: z
		.enum([...QUICK_DITHERING_VALUES])
		.optional()
		.describe("Dithering strength preset."),
	backgroundColor: z
		.string()
		.regex(HEX_COLOR_PATTERN)
		.optional()
		.describe(
			"Background colour as '#rrggbb'; required when background is 'pick'.",
		),
});

const gridDetectionSchema = z
	.strictObject({
		mode: z
			.enum(GRID_DETECTION_MODES)
			.describe(
				"'auto' detects, 'hint' seeds the search, 'force' fixes it, 'off' skips it.",
			),
		width: z.number().int().positive().optional(),
		height: z.number().int().positive().optional(),
	})
	.describe(
		"Grid handling in one place; 'hint' and 'force' need both width and height in logical pixels.",
	);

export const settingsSchema = z.strictObject({
	preset: z
		.enum([...PRESET_IDS])
		.optional()
		.describe("Built-in preset id; a named quick-settings combination."),
	quick: quickSchema.optional().describe("The seven everyday knobs."),
	advanced: advancedSchema
		.optional()
		.describe(
			"Individual pipeline options, keyed by name; null on a key clears it. Call list_options with section 'advanced' for what each one does.",
		),
	gridDetection: gridDetectionSchema.optional(),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

/**
 * 検証済みの設定をエンジンの型へ戻す。
 * [Intended] advanced はキーごとの形をスキーマで守っているが、表から動的に組み立てる都合で
 * z.infer では Record<string, unknown> にしかならない。値の検査は済んでいるので、
 * ここで一度だけ型を付け直す。
 */
export const toRefineSettings = (
	input: SettingsInput | undefined,
): RefineSettings | undefined => input as unknown as RefineSettings | undefined;

const inputSchema = z.string().describe(INPUT_PATH_HINT);
const settingsField = settingsSchema.optional().describe(SETTINGS_HINT);
const detailField = z
	.enum(REPORT_DETAILS)
	.default("summary")
	.describe(DETAIL_HINT);
const scaleField = z
	.number()
	.int()
	.min(MIN_SCALE)
	.max(MAX_SCALE)
	.default(MIN_SCALE)
	.describe("Nearest-neighbour upscale applied to the written PNG only.");
const overwriteField = z
	.boolean()
	.default(false)
	.describe("Allow replacing an existing output file.");

export const refineImageInputSchema = z.strictObject({
	input: inputSchema,
	output: z
		.string()
		.optional()
		.describe(
			`Absolute .png path to write; defaults to <stem>${DEFAULT_SUFFIX}.png next to the input.`,
		),
	settings: settingsField,
	candidateId: z
		.string()
		.optional()
		.describe(
			"Grid candidate id from an analyze_image report; refines with that grid.",
		),
	scale: scaleField,
	overwrite: overwriteField,
	preview: z
		.boolean()
		.default(true)
		.describe("Return the result as an image block scaled to about 512px."),
	detail: detailField,
});

export const analyzeImageInputSchema = z.strictObject({
	input: inputSchema,
	settings: settingsField,
	detail: detailField,
});

export const refineBatchInputSchema = z.strictObject({
	inputs: z
		.array(z.string())
		.min(1)
		.max(MAX_INPUTS)
		.describe(
			`Absolute paths, 1..${MAX_INPUTS}. A per-file failure does not stop the others.`,
		),
	outputDir: z
		.string()
		.optional()
		.describe(
			"Absolute directory for the results; defaults to each input's own directory.",
		),
	suffix: z
		.string()
		.default(DEFAULT_SUFFIX)
		.describe("Suffix added to each stem before '.png'."),
	sharedPalette: z
		.strictObject({
			enabled: z.boolean(),
			colorCount: z
				.number()
				.int()
				.min(PROCESS_RANGES.colorCount.min)
				.max(PROCESS_RANGES.colorCount.max)
				.optional(),
			ditherMode: z.enum([...DITHER_MODE_VALUES]).optional(),
			ditherStrength: z
				.number()
				.int()
				.min(PROCESS_RANGES.ditherStrength.min)
				.max(PROCESS_RANGES.ditherStrength.max)
				.optional(),
		})
		.optional()
		.describe(
			"Quantise every image against one palette built from all of them. The shared palette " +
				"overrides each item's colour-reduction settings and fixedPalette, and outlines are " +
				"not drawn on the pass that determines the palette.",
		),
	settings: settingsField,
	scale: scaleField,
	overwrite: overwriteField,
	preview: z
		.boolean()
		.default(false)
		.describe(
			`Return preview image blocks; honoured only when inputs holds at most ${PREVIEW_ITEM_LIMIT} paths.`,
		),
	detail: detailField,
});

export const listOptionsInputSchema = z.strictObject({
	section: z
		.enum(OPTIONS_SECTIONS)
		.default("all")
		.describe("Which part of the vocabulary to return."),
});
