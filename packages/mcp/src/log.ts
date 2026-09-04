/**
 * ログの詳細度。PIXEL_REFINER_LOG と CLI の --verbose がこの語彙を使う。
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type Logger = {
	error: (message: string) => void;
	warn: (message: string) => void;
	info: (message: string) => void;
	debug: (message: string) => void;
	level: LogLevel;
};

/** 数が小さいほど深刻。silent は 0 件も通さないための番兵。 */
const LEVEL_RANK: Record<LogLevel, number> = {
	silent: 0,
	error: 1,
	warn: 2,
	info: 3,
	debug: 4,
};

const DEFAULT_LEVEL: LogLevel = "warn";

const isLogLevel = (value: string | undefined): value is LogLevel =>
	value !== undefined && value in LEVEL_RANK;

/**
 * 引数 → 環境変数 → 既定（warn）の順に詳細度を決める。
 * [Intended] 環境変数が未知の値でも失敗させず既定へ落とす。ログ設定のタイプミスで
 * MCP サーバーが起動しないほうが困るため。
 */
const resolveLevel = (level: LogLevel | undefined): LogLevel => {
	if (level !== undefined) return level;
	const fromEnv = process.env.PIXEL_REFINER_LOG;
	return isLogLevel(fromEnv) ? fromEnv : DEFAULT_LEVEL;
};

/** 1 行を書き出す先。既定は process.stderr。 */
export type LogSink = (line: string) => void;

const processStderr: LogSink = (line) => void process.stderr.write(line);

/**
 * stderr だけに書くロガーを作る。
 * [Policy] stdout は MCP サーバーではプロトコル、CLI では JSON 出力そのものなので、
 * ログを 1 行でも混ぜると相手側のパースが壊れる。書き先の既定は process.stderr に固定し、
 * 差し替えられるのは「自分のストリームを捕まえている呼び出し側」（CLI の main）だけにする。
 */
export const createLogger = (
	level?: LogLevel,
	sink: LogSink = processStderr,
): Logger => {
	const resolved = resolveLevel(level);
	const threshold = LEVEL_RANK[resolved];
	const write = (
		messageLevel: Exclude<LogLevel, "silent">,
		message: string,
	) => {
		if (LEVEL_RANK[messageLevel] > threshold) return;
		sink(`[pixel-refiner] ${messageLevel} ${message}\n`);
	};
	return {
		error: (message) => write("error", message),
		warn: (message) => write("warn", message),
		info: (message) => write("info", message),
		debug: (message) => write("debug", message),
		level: resolved,
	};
};
