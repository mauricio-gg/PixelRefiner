import {
	BUILT_IN_PRESETS,
	QUICK_BACKGROUND_VALUES,
	QUICK_DITHERING_VALUES,
	QUICK_REDUCTION_MODE_VALUES,
	QUICK_SETTINGS_DEFAULTS,
	type QuickSettingsState,
} from "../../../../src/browser/quick-settings";
import { RETRO_PALETTES } from "../../../../src/shared/config";
import {
	CELL_SCALE_VALUES,
	DETAIL_LEVEL_VALUES,
	PROCESSING_MODE_VALUES,
} from "../../../../src/shared/option-values";
import {
	ADVANCED_OPTION_SPECS,
	type AdvancedOptionSpec,
} from "./option-catalog";
import { OPTION_DESCRIPTIONS } from "./option-descriptions";

export type OptionsSection =
	| "all"
	| "presets"
	| "palettes"
	| "quick"
	| "advanced";

export type PresetInfo = {
	id: string;
	quickSettings: QuickSettingsState;
};

export type PaletteInfo = {
	id: string;
	name: string;
	colorCount: number;
	colors: readonly string[];
};

type QuickKnobInfo = {
	key: string;
	values?: readonly string[];
	default?: string;
	description: string;
};

export type OptionsListing = {
	presets?: readonly PresetInfo[];
	palettes?: readonly PaletteInfo[];
	quick?: readonly QuickKnobInfo[];
	advanced?: readonly AdvancedOptionSpec[];
};

const QUICK_KNOBS: readonly QuickKnobInfo[] = [
	{
		key: "processingMode",
		values: PROCESSING_MODE_VALUES,
		default: QUICK_SETTINGS_DEFAULTS.processingMode,
		description: OPTION_DESCRIPTIONS.processingMode,
	},
	{
		key: "detailLevel",
		values: DETAIL_LEVEL_VALUES,
		default: QUICK_SETTINGS_DEFAULTS.detailLevel,
		description: OPTION_DESCRIPTIONS.detailLevel,
	},
	{
		key: "cellScale",
		values: CELL_SCALE_VALUES,
		default: QUICK_SETTINGS_DEFAULTS.cellScale,
		description: OPTION_DESCRIPTIONS.cellScale,
	},
	{
		key: "reductionMode",
		values: QUICK_REDUCTION_MODE_VALUES,
		default: QUICK_SETTINGS_DEFAULTS.reductionMode,
		description:
			"Colour reduction in one knob: 'auto' lets the route decide, '8'/'16'/'24'/'32' keep that many colours, and the rest are retro palettes.",
	},
	{
		key: "background",
		values: QUICK_BACKGROUND_VALUES,
		default: QUICK_SETTINGS_DEFAULTS.background,
		description:
			"'keep' leaves the background and the full canvas, 'auto' estimates it and makes it transparent, 'pick' uses backgroundColor.",
	},
	{
		key: "dithering",
		values: QUICK_DITHERING_VALUES,
		default: QUICK_SETTINGS_DEFAULTS.dithering,
		description:
			"'off' disables dithering, 'subtle' is ordered at strength 20, 'strong' is Floyd-Steinberg at strength 60.",
	},
	{
		key: "backgroundColor",
		description:
			"Background colour as '#rrggbb'. Required when background is 'pick', ignored otherwise.",
	},
];

const listPresets = (): readonly PresetInfo[] =>
	BUILT_IN_PRESETS.map((preset) => ({
		id: preset.id,
		quickSettings: { ...preset.quickSettings },
	}));

const listPalettes = (): readonly PaletteInfo[] =>
	Object.entries(RETRO_PALETTES).map(([id, palette]) => ({
		id,
		name: palette.name,
		colorCount: palette.colors.length,
		colors: [...palette.colors],
	}));

/**
 * AI 向けの語彙一覧。JSON にそのまま載せられる値だけを返す。
 * [Intended] 区画を分けるのは応答量のためで、内容はどの区画でも同じ表から作る。
 */
export const listOptions = (section: OptionsSection): OptionsListing => ({
	presets:
		section === "all" || section === "presets" ? listPresets() : undefined,
	palettes:
		section === "all" || section === "palettes" ? listPalettes() : undefined,
	quick: section === "all" || section === "quick" ? QUICK_KNOBS : undefined,
	advanced:
		section === "all" || section === "advanced"
			? ADVANCED_OPTION_SPECS
			: undefined,
});
