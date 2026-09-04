import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createLogger, type LogLevel } from "./log";
import { createServerFactory } from "./server";
import type { ToolCompat } from "./tools/define";

export type StdioServerOptions = {
	/** 既定は PIXEL_REFINER_MCP_COMPAT 環境変数、無ければ "full"。 */
	compat?: ToolCompat;
	/** 既定は PIXEL_REFINER_LOG 環境変数、無ければ "warn"。 */
	logLevel?: LogLevel;
	/** 相対パスを拒むときのメッセージに出す作業ディレクトリ。既定は process.cwd()。 */
	cwd?: string;
};

/** startStdioServer が返す取っ手。close() は何度呼んでも同じ 1 回分として扱う。 */
export type StdioServer = {
	close: () => Promise<void>;
};

/** 受け取ったら後片付けして終了するシグナル。 */
const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * stdio で MCP サーバーを立ち上げる。
 * [Policy] ログは必ず stderr。stdout は JSON-RPC のフレームそのものなので、1 行でも
 * 混ざるとホスト側のパーサーが壊れて接続ごと落ちる。
 * [Intended] serveStdio へ渡すのは createServerFactory の戻り値。エンジンだけを閉じ込めて
 * 共有するので、接続が張り直されても検出結果のキャッシュは生き続ける。
 */
export const startStdioServer = async (
	options: StdioServerOptions = {},
): Promise<StdioServer> => {
	const log = createLogger(options.logLevel);
	const handle = serveStdio(
		createServerFactory({ compat: options.compat, cwd: options.cwd, log }),
		{ onerror: (error) => log.error(`stdio transport: ${error.message}`) },
	);

	const detach: (() => void)[] = [];
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closing === undefined) {
			while (detach.length > 0) detach.pop()?.();
			closing = handle.close();
		}
		return closing;
	};

	for (const signal of STOP_SIGNALS) {
		// [Intended] 終了は必ず 0。ホストは停止時にこのシグナルを送るだけなので、
		// 片付けが失敗しても異常終了として報告しない。
		const onSignal = () => {
			log.info(`received ${signal}, shutting down`);
			void close().then(
				() => process.exit(0),
				() => process.exit(0),
			);
		};
		process.on(signal, onSignal);
		detach.push(() => process.off(signal, onSignal));
	}

	log.info("listening on stdio");
	return { close };
};

/**
 * bin/pixel-refiner-mcp.mjs から呼ぶ入口。
 * [Policy] このモジュールは import しただけでは起動しない。vitest は同じプロセスで
 * テストファイルを読み込むため、副作用で stdio を奪うと他のテストごと巻き込む。
 * 起動するのは main() を呼んだときだけ、という 1 点に絞る。
 */
export const main = (): void => {
	startStdioServer().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(
			`[pixel-refiner] error failed to start the stdio server: ${message}\n`,
		);
		process.exit(1);
	});
};
