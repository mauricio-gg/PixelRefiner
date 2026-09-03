import type { ProcessOptions } from "../core/processor";
import { createDefaultProcessOptions } from "../core/processor-options";
import { PROCESS_DEFAULTS } from "../shared/config";
import { valuesOf } from "../shared/option-values";
import type { CellScale, DetailLevel, ProcessingMode } from "../shared/types";
import type { ResourceKey } from "./i18n";

export type QuickReductionMode =
	| "auto"
	| "none"
	| "8"
	| "16"
	| "24"
	| "32"
	| "mono"
	| "gb_legacy"
	| "gb_pocket"
	| "gb_light"
	| "pico8"
	| "nes"
	| "pc98"
	| "msx"
	| "c64"
	| "arne16"
	| "sfc_sprite"
	| "sfc_bg";
export type QuickBackground = "keep" | "auto" | "pick";
export type QuickDithering = "off" | "subtle" | "strong";

/**
 * かんたん設定の選択肢を実行時に列挙する配列。
 * [Intended] select-options.test.ts のドリフト検査と、MCP パッケージのスキーマ生成が
 * 同じ配列を参照する。shared/option-values.ts の valuesOf を使い、union に値を
 * 増減したときは Record<T, true> リテラル側が型エラーになるようにする。
 */
export const QUICK_REDUCTION_MODE_VALUES: readonly QuickReductionMode[] =
	valuesOf<QuickReductionMode>({
		auto: true,
		none: true,
		"8": true,
		"16": true,
		"24": true,
		"32": true,
		mono: true,
		gb_legacy: true,
		gb_pocket: true,
		gb_light: true,
		pico8: true,
		nes: true,
		pc98: true,
		msx: true,
		c64: true,
		arne16: true,
		sfc_sprite: true,
		sfc_bg: true,
	});

export const QUICK_BACKGROUND_VALUES: readonly QuickBackground[] =
	valuesOf<QuickBackground>({
		keep: true,
		auto: true,
		pick: true,
	});

export const QUICK_DITHERING_VALUES: readonly QuickDithering[] =
	valuesOf<QuickDithering>({
		off: true,
		subtle: true,
		strong: true,
	});

export type QuickSettingsState = {
	processingMode: ProcessingMode;
	detailLevel: DetailLevel;
	cellScale: CellScale;
	reductionMode: QuickReductionMode;
	background: QuickBackground;
	dithering: QuickDithering;
	backgroundColor?: string;
};

export type BuiltInPreset = {
	id: string;
	// [Intended] 訳文キーの型に縛る。string だと未登録キーやタイプミスが
	// 型検査もテストも通り、画面にキー文字列がそのまま出る。
	labelKey: ResourceKey;
	quickSettings: QuickSettingsState;
};

export const QUICK_SETTINGS_DEFAULTS: QuickSettingsState = {
	processingMode: PROCESS_DEFAULTS.processingMode,
	detailLevel: PROCESS_DEFAULTS.detailLevel,
	cellScale: PROCESS_DEFAULTS.cellScale,
	reductionMode: "auto",
	background: "auto",
	dithering: "off",
};

/**
 * かんたん設定だけから処理オプションを作る。
 * [Intended] 詳細設定を土台にしないことで、非表示タブの値が混入しないようにする。
 */
export const createQuickProcessOptions = (
	quick: QuickSettingsState,
): ProcessOptions => {
	const fixedColorCount =
		quick.reductionMode === "8" ||
		quick.reductionMode === "16" ||
		quick.reductionMode === "24" ||
		quick.reductionMode === "32"
			? Number(quick.reductionMode)
			: undefined;
	const options: ProcessOptions = {
		...createDefaultProcessOptions(),
		processingMode: quick.processingMode,
		detailLevel: quick.detailLevel,
		cellScale: quick.cellScale,
		outlineStyle: PROCESS_DEFAULTS.outlineStyle,
		// [Policy] 背景を残す出力はキャンバス全体を維持し、背景を透過する出力だけを内容範囲へ詰める。
		trimToContent: quick.background !== "keep",
		preserveProcessingScale: true,
		fixedPalette: undefined,
	};
	if (quick.reductionMode === "auto") {
		// [Policy] 仕上がりが Convert なら公開選択肢の「24色」、それ以外なら
		// 「元の色を維持」を選ぶ。core の経路既定へ委ねるため指定自体を外す。
		delete options.reduceColors;
		delete options.reduceColorMode;
		delete options.colorCount;
	} else {
		options.reduceColors = quick.reductionMode !== "none";
		options.reduceColorMode =
			fixedColorCount === undefined ? quick.reductionMode : "auto";
		options.colorCount = fixedColorCount ?? PROCESS_DEFAULTS.colorCount;
	}

	if (quick.background === "keep") {
		options.bgExtractionMethod = "none";
		options.bgRemovalScope = "off";
		options.preRemoveBackground = false;
		options.postRemoveBackground = false;
	} else {
		const method = quick.background === "auto" ? "auto" : "rgb";
		options.bgExtractionMethod = method;
		options.bgRemovalScope = PROCESS_DEFAULTS.bgRemovalScope;
		options.preRemoveBackground = true;
		options.postRemoveBackground = true;
		if (method === "rgb") options.bgRgb = quick.backgroundColor;
	}

	if (quick.dithering === "off") {
		options.ditherMode = "none";
		options.ditherStrength = 0;
	} else if (quick.dithering === "subtle") {
		options.ditherMode = "ordered";
		options.ditherStrength = 20;
	} else {
		options.ditherMode = "floyd-steinberg";
		options.ditherStrength = 60;
	}

	return options;
};

const presetQuickSettings = (
	quick: Partial<QuickSettingsState>,
): QuickSettingsState => ({ ...QUICK_SETTINGS_DEFAULTS, ...quick });

export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
	{
		id: "auto",
		labelKey: "preset.auto",
		quickSettings: presetQuickSettings({}),
	},
	{
		id: "crisp-sprite",
		labelKey: "preset.crisp_sprite",
		quickSettings: presetQuickSettings({ processingMode: "refine" }),
	},
	{
		id: "keep-fine-details",
		labelKey: "preset.keep_fine_details",
		quickSettings: presetQuickSettings({ processingMode: "preserve" }),
	},
	{
		id: "photo-to-pixel",
		labelKey: "preset.photo_to_pixel",
		quickSettings: presetQuickSettings({ processingMode: "convert" }),
	},
	{
		id: "transparent-icon",
		labelKey: "preset.transparent_icon",
		quickSettings: presetQuickSettings({ reductionMode: "32" }),
	},
	{
		id: "retro-game",
		labelKey: "preset.retro_game",
		quickSettings: presetQuickSettings({ reductionMode: "gb_pocket" }),
	},
	{
		id: "background-art",
		labelKey: "preset.background_art",
		quickSettings: presetQuickSettings({ background: "keep" }),
	},
	{
		id: "illustration-to-pixel-art",
		labelKey: "preset.illustration_to_pixel_art",
		quickSettings: presetQuickSettings({
			processingMode: "convert",
			reductionMode: "32",
		}),
	},
] as const;

export const createBuiltInPresetOptions = (
	presetId: string,
): ProcessOptions => {
	const preset = BUILT_IN_PRESETS.find((entry) => entry.id === presetId);
	return createQuickProcessOptions(
		(preset ?? BUILT_IN_PRESETS[0]).quickSettings,
	);
};

/** UI 初期状態と品質テストで共有するAutoプリセット。 */
export const createUiInitialProcessOptions = (): ProcessOptions =>
	createBuiltInPresetOptions("auto");
