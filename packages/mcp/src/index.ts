/**
 * pixel-refiner-mcp の公開エントリーポイント。
 * [Policy] transport（MCP サーバー / CLI）は必ずここ経由でエンジンを使う。engine 配下の
 * モジュールを直接読み込むと、公開 API として保証していない内部の形に依存してしまう。
 */

export {
	type AnalysisReport,
	type AnalysisReportInput,
	buildAnalysisReport,
	type ReportClassification,
	type ReportContentLoss,
	type ReportDetail,
	type ReportGridCandidate,
	type ReportInput,
	type ReportOutput,
	rgbToHex,
	summarizeReport,
} from "./engine/analysis-report";
export {
	type AnalyzeRequest,
	type AnalyzeResult,
	createEngine,
	type PixelRefinerEngine,
	type RefineRequest,
	type RefineResult,
} from "./engine/engine";
export type {
	BatchItemFailure,
	BatchItemRequest,
	BatchItemResult,
	BatchItemSuccess,
	BatchRequest,
	BatchResult,
	BatchSharedPaletteRequest,
} from "./engine/engine-batch";
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
export { describeOptions, resolveSettings } from "./engine/settings-resolve";
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
	type EngineErrorCode,
	EngineInputError,
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
export {
	type FailureValue,
	type OperationResult,
	ToolFailure,
	type ToolFailureCode,
	toToolFailure,
} from "./failure";
export { createLogger, type Logger, type LogLevel } from "./log";
export {
	type AnalyzeArgs,
	type AnalyzeValue,
	runAnalyze,
} from "./operations/analyze";
export {
	type BatchArgs,
	type BatchItemValue,
	type BatchItemValueFailure,
	type BatchItemValueSuccess,
	type BatchValue,
	runBatch,
} from "./operations/batch";
export { type ListOptionsArgs, runListOptions } from "./operations/options";
export {
	type RefineArgs,
	type RefineValue,
	runRefine,
} from "./operations/refine";
export type { OperationDeps, OutputInfo } from "./operations/shared";
export type { PathPolicy } from "./paths";
export {
	buildPreview,
	PREVIEW_MAX_BASE64,
	type PreviewResult,
} from "./preview";
export {
	createPixelRefinerServer,
	createServerFactory,
	type PixelRefinerServerOptions,
} from "./server";
export { resolveToolCompat, type ToolCompat } from "./tools/define";
export { PIXEL_REFINER_MCP_VERSION } from "./version";
