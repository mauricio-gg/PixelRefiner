import { readFileSync } from "node:fs";
import type { QuickSettingsState } from "../../../../src/browser/quick-settings";
import { ADVANCED_OPTION_SPEC_BY_KEY } from "../engine/option-catalog";
import type {
	AdvancedOverrides,
	GridDetectionMode,
	GridDetectionSpec,
	RefineSettings,
} from "../engine/types";
import { type FlagValues, listOf, stringOf, UsageFailure } from "./flag-values";

const INTEGER_PATTERN = /^-?\d+$/;

/**
 * 種別が分からない値の素朴な解釈。
 * [Intended] JSON で書けるものは JSON として読む。角括弧と波括弧で始まる文字列を
 * そのまま渡してもエンジンは配列やオブジェクトとして扱えないため。
 */
const coerceGeneric = (raw: string, label: string): unknown => {
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw === "null") return null;
	if (INTEGER_PATTERN.test(raw)) return Number(raw);
	if (!raw.startsWith("[") && !raw.startsWith("{")) return raw;
	try {
		return JSON.parse(raw);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new UsageFailure(`--${label} value is not valid JSON: ${reason}`);
	}
};

/**
 * 詳細設定の値をキーの種別に合わせて解釈する。
 * [Policy] 種別を無視して「数字に見えたら数値」にすると、bgConnectivity=8 のような
 * 公開済みの列挙値（文字列の "8"）が数値になってエンジンに弾かれる。種別を引けない
 * キーだけ素朴な推測へ落とし、誤りの説明はエンジンの語彙検査に任せる。
 */
const coerceAdvanced = (key: string, raw: string): unknown => {
	if (raw === "null") return null;
	const spec = ADVANCED_OPTION_SPEC_BY_KEY.get(key);
	if (spec === undefined) return coerceGeneric(raw, "advanced");
	if (spec.kind === "enum" || spec.kind === "color" || spec.kind === "string") {
		return raw;
	}
	return coerceGeneric(raw, "advanced");
};

/**
 * かんたん設定の値。
 * [Policy] 語彙はすべて文字列（"16" や "2" を含む）なので数値へは寄せない。
 */
const coerceQuick = (_key: string, raw: string): string => raw;

/** k=v の並びを 1 つのオブジェクトへまとめる。後から来た同名キーが勝つ。 */
const entriesOf = (
	list: readonly string[],
	label: string,
	coerce: (key: string, raw: string) => unknown,
): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	for (const entry of list) {
		const separator = entry.indexOf("=");
		if (separator < 1) {
			throw new UsageFailure(
				`--${label} expects key=value, but received "${entry}".`,
			);
		}
		const key = entry.slice(0, separator);
		result[key] = coerce(key, entry.slice(separator + 1));
	}
	return result;
};

const GRID_MODES: readonly GridDetectionMode[] = [
	"auto",
	"hint",
	"force",
	"off",
];
const GRID_SIZE_PATTERN = /^(\d+)x(\d+)$/i;

/** --grid off|auto|hint:WxH|force:WxH を GridDetectionSpec へ写す。 */
const parseGrid = (raw: string): GridDetectionSpec => {
	const separator = raw.indexOf(":");
	const mode = separator < 0 ? raw : raw.slice(0, separator);
	const size = separator < 0 ? undefined : raw.slice(separator + 1);
	if (!(GRID_MODES as readonly string[]).includes(mode)) {
		throw new UsageFailure(
			`--grid mode must be one of: ${GRID_MODES.join(", ")}, but received "${mode}".`,
		);
	}
	const detection = mode as GridDetectionMode;
	const needsSize = detection === "hint" || detection === "force";
	if (size === undefined) {
		if (needsSize) {
			throw new UsageFailure(
				`--grid ${detection} needs a size, written as ${detection}:WxH.`,
			);
		}
		return { mode: detection };
	}
	if (!needsSize) {
		throw new UsageFailure(
			`--grid ${detection} takes no size, but received "${raw}".`,
		);
	}
	const matched = GRID_SIZE_PATTERN.exec(size);
	if (matched === null) {
		throw new UsageFailure(
			`--grid size must be written as WxH, but received "${size}".`,
		);
	}
	return {
		mode: detection,
		width: Number(matched[1]),
		height: Number(matched[2]),
	};
};

/** --settings のファイルを読む口。テストが実ファイル無しで差し替えられるようにする。 */
export type SettingsFileReader = (filePath: string) => string;

const defaultSettingsReader: SettingsFileReader = (filePath) =>
	readFileSync(filePath, "utf8");

const readSettingsFile = (
	filePath: string,
	read: SettingsFileReader,
): RefineSettings => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(read(filePath));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new UsageFailure(
			`--settings ${filePath} could not be read: ${reason}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new UsageFailure(`--settings ${filePath} must hold a JSON object.`);
	}
	return parsed as RefineSettings;
};

/**
 * ファイルとフラグから設定 3 層を組み立てる。
 * [Intended] 重ねる単位はキー。--settings のかんたん設定に触れていないつまみは残り、
 * 同じつまみを指したフラグだけが勝つ。層ごと置き換えると「1 つ変えるためにファイルを
 * 書き直す」ことになり、ファイルとフラグを併用する意味が無くなる。
 */
export const buildSettings = (
	values: FlagValues,
	read: SettingsFileReader = defaultSettingsReader,
): RefineSettings | undefined => {
	const file = stringOf(values, "settings");
	const base: RefineSettings =
		file === undefined ? {} : readSettingsFile(file, read);
	const quick = {
		...base.quick,
		...entriesOf(listOf(values, "quick"), "quick", coerceQuick),
	};
	const advanced = {
		...base.advanced,
		...entriesOf(listOf(values, "advanced"), "advanced", coerceAdvanced),
	};
	const gridValue = stringOf(values, "grid");
	const grid =
		gridValue === undefined ? base.gridDetection : parseGrid(gridValue);
	const preset = stringOf(values, "preset") ?? base.preset;
	const settings: RefineSettings = {};
	if (preset !== undefined) settings.preset = preset;
	if (Object.keys(quick).length > 0) {
		settings.quick = quick as Partial<QuickSettingsState>;
	}
	if (Object.keys(advanced).length > 0) {
		settings.advanced = advanced as AdvancedOverrides;
	}
	if (grid !== undefined) settings.gridDetection = grid;
	return Object.keys(settings).length === 0 ? undefined : settings;
};
