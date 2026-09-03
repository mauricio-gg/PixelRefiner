import {
	BUILT_IN_PRESETS,
	createQuickProcessOptions,
} from "../../../../src/browser/quick-settings";
import {
	type NormalizedProcessOptions,
	normalizeProcessOptions,
	type ProcessOptions,
} from "../../../../src/core/processor-options";
import { ADVANCED_OPTION_SPECS } from "./option-catalog";
import {
	assertAdvancedOptionKey,
	resolveQuickState,
	validateAdvancedEntry,
} from "./settings-validate";
import {
	type EffectiveOptions,
	type GridDetectionSpec,
	type RefineSettings,
	type ResolvedSettings,
	type SettingsAdjustment,
	SettingsError,
} from "./types";

const DEFAULT_PRESET_ID = "auto";

/** gridDetection が面倒を見る 5 つのキー。詳細設定との同時指定は矛盾になる。 */
const GRID_OPTION_KEYS: readonly string[] = [
	"enableGridDetection",
	"forcePixelsW",
	"forcePixelsH",
	"hintPixelsW",
	"hintPixelsH",
];

/** bgExtractionMethod が "none" のときに詳細設定タブが落とすキーと、その値。 */
const BACKGROUND_OFF_VALUES: Readonly<Record<string, boolean | string>> = {
	preRemoveBackground: false,
	postRemoveBackground: false,
	bgRemovalScope: "off",
};

type OptionRecord = Record<string, unknown>;

const asRecord = (options: ProcessOptions): OptionRecord =>
	options as unknown as OptionRecord;

const cloneJsonValue = (value: unknown): unknown =>
	value !== null && typeof value === "object"
		? (JSON.parse(JSON.stringify(value)) as unknown)
		: value;

/**
 * 関数と undefined を落として JSON にそのまま載る形にする。
 * [Intended] normalizeProcessOptions の戻り値には debugHook（関数）と、raw を丸ごと
 * 展開した detect が含まれる。浅いコピーでは関数が残るので再帰的に落とす。
 */
const toJsonSafe = (value: unknown): unknown => {
	if (typeof value === "function") return undefined;
	if (ArrayBuffer.isView(value)) {
		return Array.from(value as unknown as ArrayLike<number>);
	}
	if (Array.isArray(value)) return value.map(toJsonSafe);
	if (value !== null && typeof value === "object") {
		const output: OptionRecord = {};
		for (const [key, entry] of Object.entries(value)) {
			const converted = toJsonSafe(entry);
			if (converted === undefined) continue;
			output[key] = converted;
		}
		return output;
	}
	return value;
};

/**
 * 正規化済みオプションを JSON-safe な 1 段の辞書にする。
 * [Intended] normalizeProcessOptions の detect は raw をまるごと展開した控えなので、
 * そのまま載せると同じ値が 2 か所に出る。detect の中身を上へ畳み、衝突したときは
 * 正規化済みの上位の値を優先する。
 */
const flattenNormalized = (
	normalized: NormalizedProcessOptions,
): OptionRecord => {
	const { detect, ...rest } = normalized;
	return {
		...(toJsonSafe(detect) as OptionRecord),
		...(toJsonSafe(rest) as OptionRecord),
	};
};

/**
 * 詳細設定を 1 キーずつ重ねる。null は「未設定へ戻す」。
 * どのキーが明示されたかを返し、後段の導出規則が「触られていないキーだけ」を動かせるようにする。
 */
const applyAdvanced = (
	record: OptionRecord,
	advanced: Readonly<OptionRecord>,
	adjustments: SettingsAdjustment[],
): ReadonlySet<string> => {
	const mentioned = new Set<string>();
	for (const [key, requested] of Object.entries(advanced)) {
		if (requested === undefined) continue;
		mentioned.add(key);
		if (requested === null) {
			assertAdvancedOptionKey(key);
			delete record[key];
			continue;
		}
		const entry = validateAdvancedEntry(key, requested);
		if (entry.adjustment !== undefined) adjustments.push(entry.adjustment);
		record[key] = entry.value;
	}
	return mentioned;
};

/**
 * 詳細設定タブが持つ 2 つの導出規則を再現する。
 * [Intended] 明示されたキーは動かさないので、実効設定をそのまま advanced として
 * 渡し直したときは規則が空振りする（べき等性の根拠）。
 */
const applyDerivedRules = (
	record: OptionRecord,
	advanced: Readonly<OptionRecord>,
	mentioned: ReadonlySet<string>,
): void => {
	if (
		mentioned.has("reduceColorMode") &&
		advanced.reduceColorMode !== null &&
		!mentioned.has("reduceColors")
	) {
		record.reduceColors = record.reduceColorMode !== "none";
	}
	if (record.bgExtractionMethod !== "none") return;
	for (const [key, forced] of Object.entries(BACKGROUND_OFF_VALUES)) {
		if (!mentioned.has(key)) {
			record[key] = forced;
			continue;
		}
		// [Intended] null は「未設定へ戻す」意思表示なので、規則で戻さない。
		if (advanced[key] === null) continue;
		if (record[key] !== forced) {
			throw new SettingsError(
				`bgExtractionMethod "none" cannot be combined with ${key} ${JSON.stringify(record[key])}.`,
				`With bgExtractionMethod "none" the pipeline does no background handling, so ${key} must be ${JSON.stringify(forced)}.`,
			);
		}
	}
};

const requireDimension = (
	spec: GridDetectionSpec,
	axis: "width" | "height",
): number => {
	const value = spec[axis];
	if (value === undefined) {
		throw new SettingsError(
			`gridDetection mode "${spec.mode}" requires both width and height (${axis} is missing).`,
			'Pass both dimensions in logical pixels, or use mode "auto".',
		);
	}
	return value;
};

/**
 * gridDetection の 4 択を 5 つのオプションへ写す（settings-options.ts の select と同じ対応）。
 */
const applyGridDetection = (
	record: OptionRecord,
	spec: GridDetectionSpec,
	mentioned: ReadonlySet<string>,
	adjustments: SettingsAdjustment[],
): void => {
	for (const key of GRID_OPTION_KEYS) {
		if (!mentioned.has(key)) continue;
		throw new SettingsError(
			`gridDetection cannot be combined with the advanced option "${key}".`,
			"Use gridDetection on its own, or drop it and set the grid options directly.",
		);
	}
	record.enableGridDetection = spec.mode !== "off";
	for (const key of GRID_OPTION_KEYS) {
		if (key !== "enableGridDetection") delete record[key];
	}
	if (spec.mode === "off" || spec.mode === "auto") return;
	const prefix = spec.mode === "force" ? "force" : "hint";
	for (const axis of ["width", "height"] as const) {
		const key = `${prefix}Pixels${axis === "width" ? "W" : "H"}`;
		const entry = validateAdvancedEntry(key, requireDimension(spec, axis));
		if (entry.adjustment !== undefined) adjustments.push(entry.adjustment);
		record[key] = entry.value;
	}
};

/**
 * 既定プリセット（auto）のかんたん設定が実際に値を入れる公開キー。
 * [Intended] 実効設定を advanced として渡し直すときの土台がこれになる。土台が入れるキーは
 * 「消えている」ことを null で明示しないと復活してしまうので、その判定に使う。
 */
const collectDefaultBaseKeys = (): ReadonlySet<string> => {
	const preset =
		BUILT_IN_PRESETS.find((entry) => entry.id === DEFAULT_PRESET_ID) ??
		BUILT_IN_PRESETS[0];
	const base = asRecord(createQuickProcessOptions(preset.quickSettings));
	return new Set(
		ADVANCED_OPTION_SPECS.filter((spec) => base[spec.key] !== undefined).map(
			(spec) => spec.key,
		),
	);
};

const DEFAULT_BASE_KEYS: ReadonlySet<string> = collectDefaultBaseKeys();

const buildEffectiveOptions = (record: OptionRecord): EffectiveOptions => {
	const effective: OptionRecord = {};
	for (const spec of ADVANCED_OPTION_SPECS) {
		const value = record[spec.key];
		if (value === undefined) {
			if (DEFAULT_BASE_KEYS.has(spec.key)) effective[spec.key] = null;
			continue;
		}
		effective[spec.key] = cloneJsonValue(value);
	}
	return effective as EffectiveOptions;
};

/**
 * プリセット → かんたん設定 → 詳細設定 → グリッド指定の順に重ね、実行に使う設定一式を返す。
 * [Policy] UI の合成順（quick-settings.ts / settings-options.ts）をそのまま写す。順序を
 * 変えると「かんたん設定は詳細設定の組み合わせで再現できる」という AGENTS.md の約束が崩れる。
 */
export const resolveSettings = (
	settings: RefineSettings = {},
): ResolvedSettings => {
	const presetId = settings.preset ?? DEFAULT_PRESET_ID;
	const preset = BUILT_IN_PRESETS.find((entry) => entry.id === presetId);
	if (preset === undefined) {
		const ids = BUILT_IN_PRESETS.map((entry) => entry.id).join(", ");
		throw new SettingsError(
			`Unknown preset "${presetId}". Available presets: ${ids}.`,
			'Call list_options with section "presets" to see what each preset sets.',
		);
	}

	const quick = resolveQuickState(preset.quickSettings, settings.quick);
	const options = createQuickProcessOptions(quick);
	const record = asRecord(options);
	const adjustments: SettingsAdjustment[] = [];

	const advanced = (settings.advanced ?? {}) as Readonly<OptionRecord>;
	const mentioned = applyAdvanced(record, advanced, adjustments);
	applyDerivedRules(record, advanced, mentioned);
	if (settings.gridDetection !== undefined) {
		applyGridDetection(record, settings.gridDetection, mentioned, adjustments);
	}

	// [Policy] debug は AI からは指定できず、常に無効。中間画像のログはサーバー側の関心事。
	options.debug = false;

	if (record.reduceColorMode === "fixed" && record.fixedPalette === undefined) {
		throw new SettingsError(
			'reduceColorMode "fixed" needs an explicit palette.',
			"provide fixedPalette as an array of #rrggbb",
		);
	}

	return {
		options,
		effectiveOptions: buildEffectiveOptions(record),
		resolved: flattenNormalized(normalizeProcessOptions(options)),
		quick,
		presetId,
		adjustments,
	};
};
