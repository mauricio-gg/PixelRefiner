import { McpServer } from "@modelcontextprotocol/server";
import { createEngine, type PixelRefinerEngine } from "./engine/engine";
import { createLogger, type Logger } from "./log";
import type { OperationDeps } from "./operations/shared";
import { registerAnalyzeImage } from "./tools/analyze-image";
import { resolveToolCompat, type ToolCompat } from "./tools/define";
import { registerListOptions } from "./tools/list-options";
import { registerRefineBatch } from "./tools/refine-batch";
import { registerRefineImage } from "./tools/refine-image";
import { PIXEL_REFINER_MCP_VERSION } from "./version";

const SERVER_NAME = "pixel-refiner";

/**
 * サーバー説明。
 * [Policy] Claude Code はこれをシステムプロンプトへ入れるので、ツール説明より強く効く。
 * 語彙の全文ではなく「どの順で呼ぶか」だけを置き、詳細は list_options へ送る。
 */
const INSTRUCTIONS = [
	"1. Call analyze_image on the file first: it writes nothing, and reports the route, the detected pixel grid, the rival grid candidates and their ids.",
	"2. Call refine_image to write the result. It goes next to the input as <stem>.refined.png unless you pass output.",
	"3. Look at the preview image block that comes back (or read output.path) and compare it with the input.",
	"4. If the dot size is wrong, adjust quick.cellScale, try another preset, or pass a candidateId from the analysis, then refine again with overwrite: true.",
	"5. Call list_options for the full vocabulary: preset ids, retro palettes, the quick knobs and every advanced option with its range and description.",
].join("\n");

export type PixelRefinerServerOptions = {
	/** 既定は PIXEL_REFINER_MCP_COMPAT 環境変数、無ければ "full"。 */
	compat?: ToolCompat;
	log?: Logger;
	/** 相対パスを拒むときのメッセージに出す作業ディレクトリ。既定は process.cwd()。 */
	cwd?: string;
};

/**
 * 4 つのツールを載せた MCP サーバーを作る。
 * [Policy] エンジンは引数で受け取る。長く生きるプロセスでは 1 個のエンジンを使い回し、
 * 検出結果のキャッシュがリクエストをまたいで効くようにするため。
 */
export const createPixelRefinerServer = (
	engine: PixelRefinerEngine,
	options: PixelRefinerServerOptions = {},
): McpServer => {
	const compat = resolveToolCompat(options.compat);
	const deps: OperationDeps = {
		engine,
		policy: { mode: "mcp", cwd: options.cwd ?? process.cwd() },
		log: options.log ?? createLogger(),
	};
	const server = new McpServer(
		{ name: SERVER_NAME, version: PIXEL_REFINER_MCP_VERSION },
		{ instructions: INSTRUCTIONS },
	);
	registerRefineImage(server, deps, compat);
	registerAnalyzeImage(server, deps, compat);
	registerRefineBatch(server, deps, compat);
	registerListOptions(server, compat);
	return server;
};

/**
 * stdio と HTTP のどちらの入口もこの形の factory を受け取る。
 * [Intended] エンジンだけを閉じ込めて共有し、McpServer は呼ばれるたびに作る。v2 の HTTP は
 * リクエストごとにサーバーを組み立てるので、キャッシュを持つのはエンジン側でなければならない。
 */
export const createServerFactory = (
	options: PixelRefinerServerOptions = {},
): (() => McpServer) => {
	const engine = createEngine();
	return () => createPixelRefinerServer(engine, options);
};
