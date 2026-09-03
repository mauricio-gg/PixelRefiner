/**
 * util.parseArgs の戻り値から型の付いた値を取り出す小道具。
 * [Policy] parseArgs は options 表を実行時の値として受け取るので、戻り値の型は
 * 「文字列か真偽値か、その配列」まで緩む。フラグごとの読み取りをここへ集めて、
 * 呼び出し側が値の形を確かめ直さずに済むようにする。
 */

/**
 * 引数の指定ミス。
 * [Policy] 解析の途中からでも 1 か所へ集めたいので例外にし、parseCliArgs の境界で
 * 必ず UsageError の値へ写す。この型が parseCliArgs の外へ漏れることはない。
 */
export class UsageFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageFailure";
	}
}

type OptionSpec = { type: "string" | "boolean"; multiple?: boolean };
export type OptionConfig = Record<string, OptionSpec>;
export type FlagValues = Record<
	string,
	undefined | string | boolean | (string | boolean)[]
>;

/**
 * util.parseArgs が投げる「呼び出し側が直せる」失敗。
 * [Intended] コードで見分ける。メッセージ本文で判定すると Node の文言変更で
 * 想定外の例外まで使い方エラーとして握り潰してしまう。
 */
const PARSE_ARGS_CODES: readonly string[] = [
	"ERR_PARSE_ARGS_UNKNOWN_OPTION",
	"ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
	"ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
];

/** 使い方エラーとして扱える例外ならそのメッセージを返す。それ以外は undefined。 */
export const usageMessageOf = (error: unknown): string | undefined => {
	if (error instanceof UsageFailure) return error.message;
	if (!(error instanceof Error) || !("code" in error)) return undefined;
	const { code } = error;
	if (typeof code !== "string" || !PARSE_ARGS_CODES.includes(code)) {
		return undefined;
	}
	return error.message;
};

export const stringOf = (
	values: FlagValues,
	key: string,
): string | undefined => {
	const value = values[key];
	return typeof value === "string" ? value : undefined;
};

export const booleanOf = (
	values: FlagValues,
	key: string,
): boolean | undefined => {
	const value = values[key];
	return typeof value === "boolean" ? value : undefined;
};

export const listOf = (values: FlagValues, key: string): readonly string[] => {
	const value = values[key];
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
};

/**
 * 語彙の決まったフラグを読む。
 * [Policy] ここで検査するのは CLI が自分で決めている語彙（--detail / --compat /
 * --palette-dither）だけ。プリセット名やつまみの値はエンジンの語彙なので写さない。
 */
export const enumOf = <T extends string>(
	values: FlagValues,
	key: string,
	allowed: readonly T[],
): T | undefined => {
	const value = stringOf(values, key);
	if (value === undefined) return undefined;
	if (!(allowed as readonly string[]).includes(value)) {
		throw new UsageFailure(
			`--${key} must be one of: ${allowed.join(", ")}, but received "${value}".`,
		);
	}
	return value as T;
};

export const numberOf = (
	values: FlagValues,
	key: string,
): number | undefined => {
	const value = stringOf(values, key);
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (value.trim() === "" || !Number.isFinite(parsed)) {
		throw new UsageFailure(
			`--${key} must be a number, but received "${value}".`,
		);
	}
	return parsed;
};

/**
 * 位置引数をちょうど 1 つ要求する。
 * [Policy] 余りは黙って捨てず断る。`refine *.png` はシェルが複数のパスへ展開するので
 * 起こりやすく、先頭 1 枚だけ処理して 0 で終わると「全部仕上げた」ように見えてしまう。
 * 複数枚を渡す入口は batch なので、そちらへ誘導する。
 */
export const requireSinglePositional = (
	positionals: readonly string[],
	label: string,
): string => {
	const value = positionals[0];
	if (value === undefined) throw new UsageFailure(`${label} is required.`);
	if (positionals.length > 1) {
		throw new UsageFailure(
			`${label} takes one path, but received ${positionals.length}: ` +
				`${positionals.join(", ")}. Use the batch verb for several images.`,
		);
	}
	return value;
};

/** 位置引数を取らない verb のためのもの。余りがあれば断る。 */
export const rejectPositionals = (
	positionals: readonly string[],
	verb: string,
): void => {
	if (positionals.length === 0) return;
	throw new UsageFailure(
		`the ${verb} verb takes no positional arguments, but received: ` +
			`${positionals.join(", ")}.`,
	);
};
