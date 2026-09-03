import {
	QUICK_BACKGROUND_VALUES,
	QUICK_DITHERING_VALUES,
	QUICK_REDUCTION_MODE_VALUES,
	type QuickSettingsState,
} from "../../../../src/browser/quick-settings";
import { clampInt } from "../../../../src/shared/config";
import {
	CELL_SCALE_VALUES,
	DETAIL_LEVEL_VALUES,
	PROCESSING_MODE_VALUES,
} from "../../../../src/shared/option-values";
import type { RGB } from "../../../../src/shared/types";
import {
	ADVANCED_OPTION_SPEC_BY_KEY,
	ADVANCED_OPTION_SPECS,
	type AdvancedOptionSpec,
} from "./option-catalog";
import type { SettingsAdjustment } from "./types";
import { INTERNAL_OPTION_KEYS, SettingsError } from "./types";

/** 検査を通った 1 項目。value は core がそのまま受け取れる形へ揃えてある。 */
export type ValidatedAdvancedEntry = {
	value: unknown;
	adjustment?: SettingsAdjustment;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** "#rrggbb" を RGB へ変換する。形式が違えば undefined を返す。 */
export const parseHexColor = (value: string): RGB | undefined => {
	if (!HEX_COLOR.test(value)) return undefined;
	return {
		r: Number.parseInt(value.slice(1, 3), 16),
		g: Number.parseInt(value.slice(3, 5), 16),
		b: Number.parseInt(value.slice(5, 7), 16),
	};
};

/** レーベンシュタイン距離。候補が数十件なので素朴な実装で足りる。 */
const editDistance = (a: string, b: string): number => {
	let previous: number[] = [];
	for (let j = 0; j <= b.length; j += 1) previous.push(j);
	for (let i = 1; i <= a.length; i += 1) {
		const current: number[] = [i];
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current.push(
				Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost),
			);
		}
		previous = current;
	}
	return previous[b.length];
};

const nearestKey = (key: string, candidates: readonly string[]): string => {
	const lower = key.toLowerCase();
	let best = candidates[0];
	let bestScore = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const target = candidate.toLowerCase();
		// [Intended] 前方一致は打鍵途中の切り詰めなので、距離より強い手がかりとして扱う。
		const score = target.startsWith(lower) ? 0 : editDistance(lower, target);
		if (score < bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return best;
};

const isRgbObject = (value: unknown): value is RGB => {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (["r", "g", "b"] as const).every((channel) => {
		const component = candidate[channel];
		return (
			typeof component === "number" &&
			Number.isInteger(component) &&
			component >= 0 &&
			component <= 255
		);
	});
};

const toRgb = (key: string, value: unknown): RGB => {
	if (typeof value === "string") {
		const parsed = parseHexColor(value);
		if (parsed !== undefined) return parsed;
	} else if (isRgbObject(value)) {
		return { r: value.r, g: value.g, b: value.b };
	}
	throw new SettingsError(
		`Advanced option "${key}" must be a "#rrggbb" string or an {r,g,b} object.`,
	);
};

const validateInt = (
	key: string,
	spec: AdvancedOptionSpec,
	requested: unknown,
): ValidatedAdvancedEntry => {
	if (typeof requested !== "number" || !Number.isFinite(requested)) {
		throw new SettingsError(
			`Advanced option "${key}" must be a number between ${spec.min} and ${spec.max}.`,
		);
	}
	const range = {
		min: spec.min ?? 0,
		max: spec.max ?? 0,
		default: typeof spec.default === "number" ? spec.default : 0,
	};
	const applied = clampInt(requested, range);
	// [Intended] 範囲外や小数はエラーにせず丸めて記録する。AI が「効かなかった」ことに
	// 気づけるようにするのが目的で、処理そのものは続けられる方が使い勝手が良い。
	return applied === requested
		? { value: applied }
		: { value: applied, adjustment: { key, requested, applied } };
};

const validatePalette = (key: string, requested: unknown): RGB[] => {
	if (!Array.isArray(requested) || requested.length === 0) {
		throw new SettingsError(
			`Advanced option "${key}" must be a non-empty array of "#rrggbb" strings.`,
		);
	}
	return requested.map((entry) => toRgb(key, entry));
};

const validateValue = (
	key: string,
	spec: AdvancedOptionSpec,
	requested: unknown,
): ValidatedAdvancedEntry => {
	if (spec.kind === "int") return validateInt(key, spec, requested);
	if (spec.kind === "boolean") {
		if (typeof requested !== "boolean") {
			throw new SettingsError(
				`Advanced option "${key}" must be true or false.`,
			);
		}
		return { value: requested };
	}
	if (spec.kind === "enum") {
		const values = spec.values ?? [];
		if (typeof requested !== "string" || !values.includes(requested)) {
			throw new SettingsError(
				`Advanced option "${key}" must be one of: ${values.join(", ")}.`,
			);
		}
		return { value: requested };
	}
	if (spec.kind === "palette")
		return { value: validatePalette(key, requested) };
	if (spec.kind === "color") {
		// [Intended] bgRgb は core が "#rrggbb" 文字列のまま受け取る唯一の色指定なので、
		// RGB オブジェクトへは変換せず文字列のまま通す。outlineColor は逆に RGB を要求する。
		if (key === "bgRgb") {
			if (
				typeof requested !== "string" ||
				parseHexColor(requested) === undefined
			) {
				throw new SettingsError(
					`Advanced option "${key}" must be a "#rrggbb" string.`,
				);
			}
			return { value: requested };
		}
		return { value: toRgb(key, requested) };
	}
	if (typeof requested !== "string") {
		throw new SettingsError(`Advanced option "${key}" must be a string.`);
	}
	return { value: requested };
};

/**
 * 詳細設定として指定できるキーかどうかを確かめ、その仕様を返す。
 * [Policy] 値が null（未設定へ戻す）でもキーの検査だけは必ず通す。内部専用キーを
 * null で消せてしまうと「AI からは触れない」保証が抜ける。
 */
export const assertAdvancedOptionKey = (key: string): AdvancedOptionSpec => {
	if (INTERNAL_OPTION_KEYS.includes(key)) {
		const hint =
			key === "gridSignals"
				? "Grid signal toggles are not published in v1; use gridDetection or processingMode instead."
				: "Debug and detected-grid handoffs are internal to the engine.";
		throw new SettingsError(
			`Advanced option "${key}" is internal and cannot be set.`,
			hint,
		);
	}
	const spec = ADVANCED_OPTION_SPEC_BY_KEY.get(key);
	if (spec === undefined) {
		const suggestion = nearestKey(
			key,
			ADVANCED_OPTION_SPECS.map((entry) => entry.key),
		);
		throw new SettingsError(
			`Unknown advanced option "${key}". Did you mean "${suggestion}"?`,
			'Call list_options with section "advanced" for the full list of keys.',
		);
	}
	return spec;
};

/**
 * 詳細設定の 1 項目を検査し、core が受け取れる値へ揃える。
 * 値が範囲外だったときだけ adjustment を添える。
 */
export const validateAdvancedEntry = (
	key: string,
	requested: unknown,
): ValidatedAdvancedEntry =>
	validateValue(key, assertAdvancedOptionKey(key), requested);

const QUICK_KNOB_VALUES: Readonly<Record<string, readonly string[]>> = {
	processingMode: PROCESSING_MODE_VALUES,
	detailLevel: DETAIL_LEVEL_VALUES,
	cellScale: CELL_SCALE_VALUES,
	reductionMode: QUICK_REDUCTION_MODE_VALUES,
	background: QUICK_BACKGROUND_VALUES,
	dithering: QUICK_DITHERING_VALUES,
};

const QUICK_KNOB_KEYS: readonly string[] = [
	...Object.keys(QUICK_KNOB_VALUES),
	"backgroundColor",
];

/**
 * かんたん設定の上書きを土台へ重ね、7 つのつまみとして成立することを確かめる。
 * [Policy] UI は不正な値を握り潰して既定へ落とすが、API では黙って別の設定で処理する方が
 * 危険なので失敗させる。
 */
export const resolveQuickState = (
	base: QuickSettingsState,
	overrides: Partial<QuickSettingsState> | undefined,
): QuickSettingsState => {
	const merged: QuickSettingsState = { ...base };
	const record = merged as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(overrides ?? {})) {
		if (value === undefined) continue;
		if (!QUICK_KNOB_KEYS.includes(key)) {
			throw new SettingsError(
				`Unknown quick setting "${key}". Did you mean "${nearestKey(key, QUICK_KNOB_KEYS)}"?`,
				'Call list_options with section "quick" for the full list of knobs.',
			);
		}
		if (key === "backgroundColor") {
			if (typeof value !== "string" || parseHexColor(value) === undefined) {
				throw new SettingsError(
					'Quick setting "backgroundColor" must be a "#rrggbb" string.',
				);
			}
			record[key] = value;
			continue;
		}
		const values = QUICK_KNOB_VALUES[key];
		if (typeof value !== "string" || !values.includes(value)) {
			throw new SettingsError(
				`Quick setting "${key}" must be one of: ${values.join(", ")}.`,
			);
		}
		record[key] = value;
	}
	if (merged.background === "pick" && merged.backgroundColor === undefined) {
		throw new SettingsError(
			'Quick setting "background" is "pick" but no backgroundColor was given.',
			'Pass quick.backgroundColor as a "#rrggbb" string, or use background "auto".',
		);
	}
	return merged;
};
