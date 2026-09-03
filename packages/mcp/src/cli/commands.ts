import type { OperationResult, ToolFailureCode } from "../failure";
import type { LogLevel } from "../log";
import { startStdioServer } from "../mcp";
import { type AnalyzeArgs, runAnalyze } from "../operations/analyze";
import { type BatchArgs, runBatch } from "../operations/batch";
import { type ListOptionsArgs, runListOptions } from "../operations/options";
import { type RefineArgs, runRefine } from "../operations/refine";
import type { OperationDeps } from "../operations/shared";
import type { ServeArgs } from "./args";

/** 1 つの verb の結果。output が undefined のときは何も書かない（serve だけ）。 */
export type CommandOutcome = {
	exitCode: number;
	output: unknown;
};

/**
 * 終了コード。
 * [Policy] 呼び出し側（シェルや Python のパイプライン）は JSON を読む前にこの 4 値で
 * 分岐できる必要がある。0 成功 / 1 処理そのものの失敗 / 2 呼び出し方の誤り /
 * 3 断った入出力（読めない・大きすぎる・出力が既にある）。
 */
export const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 3;

/**
 * 失敗コードから終了コードへの対応表。
 * [Policy] INVALID_SETTINGS は 2 に入れる。エンジンが返すとはいえ「指定した設定が
 * 語彙に無い・範囲外」は呼び出し方の誤りで、同じ入力で再実行しても直らない。2 の意味を
 * 「呼び出し側が引数を直せば通る」で揃えると、3（環境を直す）と 1（処理の失敗）が分かれる。
 */
const EXIT_BY_FAILURE: Readonly<Record<ToolFailureCode, number>> = {
	INPUT_NOT_FOUND: EXIT_REFUSED,
	UNSUPPORTED_INPUT: EXIT_REFUSED,
	INPUT_TOO_LARGE: EXIT_REFUSED,
	OUTPUT_EXISTS: EXIT_REFUSED,
	INVALID_SETTINGS: EXIT_USAGE,
	ENGINE_ERROR: EXIT_FAILURE,
};

/**
 * 操作層の結果を終了コードと JSON へ写す。
 * [Policy] 成功したときの JSON は操作層の値そのまま。フィールド名を CLI 側で言い換えると、
 * MCP のツール結果と CLI の出力が別物になり、同じ台本で両方を使えなくなる。
 */
const outcomeOf = <T>(result: OperationResult<T>): CommandOutcome =>
	result.ok
		? { exitCode: EXIT_OK, output: result.value }
		: {
				exitCode: EXIT_BY_FAILURE[result.failure.code],
				output: { failure: result.failure },
			};

/** 引数の指定ミス。stdout の形は失敗した操作と同じにする。 */
export const usageOutcome = (message: string): CommandOutcome => ({
	exitCode: EXIT_USAGE,
	output: {
		failure: {
			code: "INVALID_SETTINGS",
			message,
			hint: "Run `pixel-refiner --help` for the verbs and flags.",
		},
	},
});

export const refineCommand = async (
	deps: OperationDeps,
	args: RefineArgs,
): Promise<CommandOutcome> => outcomeOf(await runRefine(deps, args));

export const analyzeCommand = async (
	deps: OperationDeps,
	args: AnalyzeArgs,
): Promise<CommandOutcome> => outcomeOf(await runAnalyze(deps, args));

/**
 * 複数枚を仕上げる。
 * [Policy] 1 枚でも失敗したら 1。呼び出し全体は成功していても、書けなかった枚がある
 * ことをシェルの側で見落とせないようにする。どの枚が失敗したかは items に残る。
 */
export const batchCommand = async (
	deps: OperationDeps,
	args: BatchArgs,
): Promise<CommandOutcome> => {
	const result = await runBatch(deps, args);
	if (!result.ok) return outcomeOf(result);
	return {
		exitCode: result.value.summary.failed > 0 ? EXIT_FAILURE : EXIT_OK,
		output: result.value,
	};
};

export const optionsCommand = async (
	args: ListOptionsArgs,
): Promise<CommandOutcome> => outcomeOf(await runListOptions(args));

/** 解決しない約束。await した先へは進まない。 */
const never = (): Promise<void> => new Promise<void>(() => undefined);

export type ServeOptions = {
	cwd: string;
	logLevel: LogLevel | undefined;
};

/**
 * MCP サーバーを stdio で走らせる。
 * [Intended] 立ち上げたら解決しない。停止はホストが送る SIGINT / SIGTERM で、その処理は
 * startStdioServer 側にあり、片付けたうえで終了コード 0 で抜ける。stdin が閉じたときは
 * トランスポートが閉じてイベントループが空になり、既定の 0 でプロセスが終わる。
 */
export const serveCommand = async (
	args: ServeArgs,
	options: ServeOptions,
): Promise<CommandOutcome> => {
	await startStdioServer({
		compat: args.compat,
		logLevel: options.logLevel,
		cwd: options.cwd,
	});
	await never();
	return { exitCode: EXIT_OK, output: undefined };
};
