import type { QuickSettingsState } from "../../../../src/browser/quick-settings";
import type { ProcessOptions } from "../../../../src/core/processor-options";
import type { RGB } from "../../../../src/shared/types";

/**
 * ProcessOptions のうち AI 向けには公開しないキー。
 * [Policy] debug 系と detectedGrid 系は「同じ realm で core を直接呼ぶ側」専用の
 * 受け渡し口で、JSON では表現できないか、指定しても出力が変わらない。
 * gridSignals は入れ子オブジェクトのため v1 のスキーマからは外している。
 */
export const INTERNAL_OPTION_KEYS: readonly string[] = [
	"debug",
	"debugHook",
	"onDetectedGrid",
	"detectedGrid",
	"debugLabel",
	"gridSignals",
];

/** INTERNAL_OPTION_KEYS の型側の対応物。配列とこの型は同じ集合を指す。 */
export type InternalOptionKey =
	| "debug"
	| "debugHook"
	| "onDetectedGrid"
	| "detectedGrid"
	| "debugLabel"
	| "gridSignals";

/** 詳細設定として公開する ProcessOptions のキー。 */
export type AdvancedOptionKey = Exclude<
	keyof ProcessOptions,
	InternalOptionKey
>;

/** 色として指定でき、16 進表記も受け取るキー。 */
type ColorLikeOptionKey = "fixedPalette" | "outlineColor" | "bgRgb";

/**
 * 詳細設定の上書き。
 * [Intended] 値に null を渡すと「未設定へ戻す」。core の経路ごとの既定へ委ねたいときに、
 * かんたん設定やプリセットが入れたキーを取り除くための唯一の手段になる（undefined は
 * JSON では表現できず、キーの有無と区別が付かないため使わない）。
 */
export type AdvancedOverrides = {
	[K in Exclude<AdvancedOptionKey, ColorLikeOptionKey>]?:
		| ProcessOptions[K]
		| null;
} & {
	fixedPalette?: readonly (string | RGB)[] | null;
	outlineColor?: string | RGB | null;
	bgRgb?: string | null;
};

/**
 * 解決後の実効設定。関数と undefined は含まない。
 * [Intended] そのまま advanced として渡し直すと同じ実効設定に戻る（べき等）ことが契約。
 * そのため「値が確定しているキー」だけでは足りない。advanced の null で消したキーは、
 * 渡し直したときの土台（既定プリセット auto のかんたん設定）が入れ直してしまうので、
 * 消えている状態も null として明示する。土台が元から入れないキー（reductionMode:auto の
 * 色 3 キー、force/hint/convert の寸法、fixedPalette、bgRgb）は欠けていても土台に
 * 現れないため、null を置かずキーごと省く。
 */
export type EffectiveOptions = {
	[K in AdvancedOptionKey]?: ProcessOptions[K] | null;
};

/** グリッド検出の指定方法。詳細設定の select が公開する 4 択と同じ語彙。 */
export type GridDetectionMode = "auto" | "hint" | "force" | "off";

export type GridDetectionSpec = {
	mode: GridDetectionMode;
	width?: number;
	height?: number;
};

/** 組み込みプリセットの id。実行時に BUILT_IN_PRESETS と突き合わせる。 */
export type PresetId = string;

export type RefineSettings = {
	preset?: PresetId;
	quick?: Partial<QuickSettingsState>;
	advanced?: AdvancedOverrides;
	gridDetection?: GridDetectionSpec;
};

/** 指定値を範囲へ収めた記録。エラーにはせず、何をどう変えたかだけを返す。 */
export type SettingsAdjustment = {
	key: string;
	requested: unknown;
	applied: unknown;
};

export type ResolvedSettings = {
	options: ProcessOptions;
	effectiveOptions: EffectiveOptions;
	resolved: Record<string, unknown>;
	quick: QuickSettingsState;
	presetId: string;
	adjustments: SettingsAdjustment[];
};

/**
 * 設定の指定そのものが成立しないときの失敗。
 * [Policy] transport 層はこれを ToolFailure {code, message, hint} へそのまま写す。
 * 呼び出し側が直せる情報を hint に入れ、message には何が悪いかだけを書く。
 */
export class SettingsError extends Error {
	readonly code: "INVALID_SETTINGS" = "INVALID_SETTINGS";
	readonly hint?: string;

	constructor(message: string, hint?: string) {
		super(message);
		this.name = "SettingsError";
		this.hint = hint;
	}
}
