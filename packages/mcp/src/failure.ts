import { EngineInputError, SettingsError } from "./engine/types";

/**
 * 操作層が返す失敗の種別。
 * [Policy] エンジン側の EngineErrorCode を含む上位集合にする。パスと出力先の検査は
 * transport に依らない操作層の関心事なので、エンジンには無い 3 種（見つからない／
 * 大きすぎる／出力が既にある）をここで足す。MCP は isError、CLI は終了コードへ写す。
 */
export type ToolFailureCode =
	| "INPUT_NOT_FOUND"
	| "UNSUPPORTED_INPUT"
	| "INPUT_TOO_LARGE"
	| "OUTPUT_EXISTS"
	| "INVALID_SETTINGS"
	| "ENGINE_ERROR";

/** JSON にそのまま載せられる失敗の値。hint は無いときキーごと落とす。 */
export type FailureValue = {
	code: ToolFailureCode;
	message: string;
	hint?: string;
};

/**
 * 操作層の内部で投げ、境界で必ず値へ写す失敗。
 * [Policy] 操作層の外へは投げない。runOperation が捕まえて OperationResult にする。
 */
export class ToolFailure extends Error {
	readonly code: ToolFailureCode;
	readonly hint?: string;

	constructor(code: ToolFailureCode, message: string, hint?: string) {
		super(message);
		this.name = "ToolFailure";
		this.code = code;
		this.hint = hint;
	}
}

/**
 * 何であれ ToolFailure へ写す。
 * [Intended] 想定外の例外も握りつぶさず ENGINE_ERROR として元のメッセージを残す。
 * transport が例外で落ちると呼び出し側には接続断としか見えないため。
 */
export const toToolFailure = (error: unknown): ToolFailure => {
	if (error instanceof ToolFailure) return error;
	if (error instanceof SettingsError || error instanceof EngineInputError) {
		return new ToolFailure(error.code, error.message, error.hint);
	}
	const message = error instanceof Error ? error.message : String(error);
	return new ToolFailure("ENGINE_ERROR", message);
};

/** ToolFailure を JSON へ載る値に写す。 */
export const failureValue = (failure: ToolFailure): FailureValue =>
	failure.hint === undefined
		? { code: failure.code, message: failure.message }
		: { code: failure.code, message: failure.message, hint: failure.hint };

/**
 * 操作層の戻り値。
 * [Policy] 想定内の失敗は例外にせず値で返す。MCP のツール結果も CLI の終了コードも
 * 「失敗を含む正常な応答」を組み立てる必要があり、例外にすると各 transport で
 * try/catch を書き分けることになるため。
 */
export type OperationResult<T> =
	| { ok: true; value: T }
	| { ok: false; failure: FailureValue };
