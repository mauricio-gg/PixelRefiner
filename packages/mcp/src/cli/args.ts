import { parseArgs } from "node:util";
import { DITHER_MODE_VALUES } from "../../../../src/shared/option-values";
import type { DitherMode } from "../../../../src/shared/types";
import type { ReportDetail } from "../engine/analysis-report";
import type { OptionsSection } from "../engine/option-listing";
import type { AnalyzeArgs } from "../operations/analyze";
import type { BatchArgs } from "../operations/batch";
import type { ListOptionsArgs } from "../operations/options";
import type { RefineArgs } from "../operations/refine";
import type { ToolCompat } from "../tools/define";
import {
	booleanOf,
	enumOf,
	type FlagValues,
	numberOf,
	type OptionConfig,
	rejectPositionals,
	requireSinglePositional,
	stringOf,
	UsageFailure,
	usageMessageOf,
} from "./flag-values";
import { buildSettings, type SettingsFileReader } from "./settings-flags";

/** 全 verb で共通のフラグ。出力の整形とログの詳細度だけを決める。 */
type GlobalFlags = { compact: boolean; verbose: boolean };

export type ServeArgs = { compat?: ToolCompat };

/** 引数の指定そのものが成立しないとき。main が使い方と一緒に返す。 */
export type UsageError = { kind: "usage"; message: string };

export type ParsedCommand =
	| { kind: "help" }
	| { kind: "version" }
	| { kind: "refine"; global: GlobalFlags; args: RefineArgs }
	| { kind: "analyze"; global: GlobalFlags; args: AnalyzeArgs }
	| { kind: "batch"; global: GlobalFlags; args: BatchArgs }
	| { kind: "options"; global: GlobalFlags; args: ListOptionsArgs }
	| { kind: "serve"; global: GlobalFlags; args: ServeArgs };

const GLOBAL_OPTIONS: OptionConfig = {
	compact: { type: "boolean" },
	verbose: { type: "boolean" },
};

/** 3 層の設定を受け取るフラグ。refine / analyze / batch で共通。 */
const SETTINGS_OPTIONS: OptionConfig = {
	preset: { type: "string" },
	quick: { type: "string", multiple: true },
	advanced: { type: "string", multiple: true },
	settings: { type: "string" },
	grid: { type: "string" },
};

/** 書き出しを伴う verb（refine / batch）が共通で持つフラグ。 */
const WRITE_OPTIONS: OptionConfig = {
	scale: { type: "string" },
	overwrite: { type: "boolean" },
	preview: { type: "boolean" },
	detail: { type: "string" },
};

/**
 * verb ごとの受け付けるフラグ。
 * [Intended] verb 単位で表を分ける。1 つの表にまとめると `options --output` のような
 * 意味の無い組み合わせが黙って通り、無視された指定に呼び出し側が気付けない。
 */
const VERB_OPTIONS: Readonly<Record<string, OptionConfig>> = {
	refine: {
		...GLOBAL_OPTIONS,
		...SETTINGS_OPTIONS,
		...WRITE_OPTIONS,
		output: { type: "string" },
		candidate: { type: "string" },
	},
	analyze: {
		...GLOBAL_OPTIONS,
		...SETTINGS_OPTIONS,
		detail: { type: "string" },
	},
	batch: {
		...GLOBAL_OPTIONS,
		...SETTINGS_OPTIONS,
		...WRITE_OPTIONS,
		"output-dir": { type: "string" },
		suffix: { type: "string" },
		"shared-palette": { type: "boolean" },
		"palette-colors": { type: "string" },
		"palette-dither": { type: "string" },
		"palette-dither-strength": { type: "string" },
	},
	options: { ...GLOBAL_OPTIONS, section: { type: "string" } },
	serve: { ...GLOBAL_OPTIONS, compat: { type: "string" } },
};

const VERBS: readonly string[] = Object.keys(VERB_OPTIONS);
const REPORT_DETAILS: readonly ReportDetail[] = ["summary", "full"];
const TOOL_COMPATS: readonly ToolCompat[] = ["full", "minimal"];

type Parsed = {
	values: FlagValues;
	positionals: string[];
	global: GlobalFlags;
	read: SettingsFileReader | undefined;
};

const detailOf = (values: FlagValues): ReportDetail | undefined =>
	enumOf<ReportDetail>(values, "detail", REPORT_DETAILS);

const sharedPaletteOf = (values: FlagValues): BatchArgs["sharedPalette"] => {
	const enabled = booleanOf(values, "shared-palette") === true;
	const colorCount = numberOf(values, "palette-colors");
	const ditherMode = enumOf<DitherMode>(
		values,
		"palette-dither",
		DITHER_MODE_VALUES,
	);
	const ditherStrength = numberOf(values, "palette-dither-strength");
	if (enabled) return { enabled, colorCount, ditherMode, ditherStrength };
	// [Intended] パレットの調整だけを渡されたら黙って捨てず断る。共通パレットを
	// 使わない実行では効かない指定なので、無視すると結果だけが期待と食い違う。
	if (
		colorCount !== undefined ||
		ditherMode !== undefined ||
		ditherStrength !== undefined
	) {
		throw new UsageFailure(
			"--palette-colors, --palette-dither and --palette-dither-strength need --shared-palette.",
		);
	}
	return undefined;
};

const settingsOf = (parsed: Parsed) =>
	parsed.read === undefined
		? buildSettings(parsed.values)
		: buildSettings(parsed.values, parsed.read);

const parseRefine = (parsed: Parsed): ParsedCommand => ({
	kind: "refine",
	global: parsed.global,
	args: {
		input: requireSinglePositional(parsed.positionals, "input"),
		output: stringOf(parsed.values, "output"),
		settings: settingsOf(parsed),
		candidateId: stringOf(parsed.values, "candidate"),
		scale: numberOf(parsed.values, "scale"),
		overwrite: booleanOf(parsed.values, "overwrite"),
		preview: booleanOf(parsed.values, "preview"),
		detail: detailOf(parsed.values),
	},
});

const parseAnalyze = (parsed: Parsed): ParsedCommand => ({
	kind: "analyze",
	global: parsed.global,
	args: {
		input: requireSinglePositional(parsed.positionals, "input"),
		settings: settingsOf(parsed),
		detail: detailOf(parsed.values),
	},
});

const parseBatch = (parsed: Parsed): ParsedCommand => {
	if (parsed.positionals.length === 0) {
		throw new UsageFailure("inputs are required; pass one path per image.");
	}
	return {
		kind: "batch",
		global: parsed.global,
		args: {
			inputs: parsed.positionals,
			outputDir: stringOf(parsed.values, "output-dir"),
			suffix: stringOf(parsed.values, "suffix"),
			sharedPalette: sharedPaletteOf(parsed.values),
			settings: settingsOf(parsed),
			scale: numberOf(parsed.values, "scale"),
			overwrite: booleanOf(parsed.values, "overwrite"),
			preview: booleanOf(parsed.values, "preview"),
			detail: detailOf(parsed.values),
		},
	};
};

const parseOptions = (parsed: Parsed): ParsedCommand => {
	rejectPositionals(parsed.positionals, "options");
	return {
		kind: "options",
		global: parsed.global,
		// [Policy] 節の語彙は runListOptions が持つ。CLI へ写すと同じ一覧が 2 か所になる。
		args: {
			section: (stringOf(parsed.values, "section") ?? "all") as OptionsSection,
		},
	};
};

const parseServe = (parsed: Parsed): ParsedCommand => {
	rejectPositionals(parsed.positionals, "serve");
	return {
		kind: "serve",
		global: parsed.global,
		args: { compat: enumOf<ToolCompat>(parsed.values, "compat", TOOL_COMPATS) },
	};
};

const VERB_PARSERS: Readonly<
	Record<string, (parsed: Parsed) => ParsedCommand>
> = {
	refine: parseRefine,
	analyze: parseAnalyze,
	batch: parseBatch,
	options: parseOptions,
	serve: parseServe,
};

const parseVerb = (
	verb: string,
	argv: readonly string[],
	read: SettingsFileReader | undefined,
): Parsed => {
	const { values, positionals } = parseArgs({
		args: [...argv],
		options: VERB_OPTIONS[verb],
		strict: true,
		allowPositionals: true,
		// [Intended] --no-preview を受け取るために要る。preview の既定は操作層側
		// （refine は true、batch は false）なので、指定が無いときはキーごと落とす。
		allowNegative: true,
	});
	return {
		values,
		positionals,
		read,
		global: {
			compact: booleanOf(values, "compact") === true,
			verbose: booleanOf(values, "verbose") === true,
		},
	};
};

/**
 * 引数を 1 つのコマンドへ写す。
 * [Policy] ここでは設定の語彙を検査しない。プリセット名やつまみの値はエンジンが持つ
 * 語彙で、CLI へ写すと 2 か所に同じ一覧ができて必ずずれる。CLI が見るのはフラグの形だけ。
 */
export const parseCliArgs = (
	argv: readonly string[],
	read?: SettingsFileReader,
): ParsedCommand | UsageError => {
	if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
	if (argv.includes("--version")) return { kind: "version" };
	try {
		const verb = argv[0];
		if (verb === undefined) {
			throw new UsageFailure(
				`a verb is required; expected one of: ${VERBS.join(", ")}.`,
			);
		}
		const parser = VERB_PARSERS[verb];
		if (parser === undefined) {
			throw new UsageFailure(
				`unknown verb "${verb}"; expected one of: ${VERBS.join(", ")}.`,
			);
		}
		return parser(parseVerb(verb, argv.slice(1), read));
	} catch (error) {
		const message = usageMessageOf(error);
		if (message === undefined) throw error;
		return { kind: "usage", message };
	}
};
