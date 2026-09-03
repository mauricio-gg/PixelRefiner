/**
 * pixel-refiner-mcp の公開エントリーポイント。
 * [Policy] refine/analyze/batch のエンジン API は Task 6 でここへ足す。現時点では
 * 設定解決（プリセット → かんたん → 詳細）とオプションカタログを公開する。
 */
export const PIXEL_REFINER_MCP_VERSION = "0.1.0";

export {
	ADVANCED_OPTION_SPEC_BY_KEY,
	ADVANCED_OPTION_SPECS,
	type AdvancedOptionKind,
	type AdvancedOptionSpec,
} from "./engine/option-catalog";
export {
	listOptions,
	type OptionsListing,
	type OptionsSection,
	type PaletteInfo,
	type PresetInfo,
	type QuickKnobInfo,
} from "./engine/option-listing";
export { resolveSettings } from "./engine/settings-resolve";
export {
	assertAdvancedOptionKey,
	parseHexColor,
	resolveQuickState,
	type ValidatedAdvancedEntry,
	validateAdvancedEntry,
} from "./engine/settings-validate";
export {
	type AdvancedOptionKey,
	type AdvancedOverrides,
	type EffectiveOptions,
	type GridDetectionMode,
	type GridDetectionSpec,
	INTERNAL_OPTION_KEYS,
	type InternalOptionKey,
	type PresetId,
	type RefineSettings,
	type ResolvedSettings,
	type SettingsAdjustment,
	SettingsError,
} from "./engine/types";
