import type { McpServer } from "@modelcontextprotocol/server";
import { runAnalyze } from "../operations/analyze";
import type { OperationDeps } from "../operations/shared";
import {
	failureResult,
	okResult,
	READ_ANNOTATIONS,
	runTool,
	type ToolCompat,
	toolConfig,
} from "./define";
import { analyzeImageOutputSchema } from "./output-schemas";
import {
	analyzeImageInputSchema,
	SETTINGS_HINT,
	toRefineSettings,
} from "./schemas";

const DESCRIPTION = [
	"Analyse one image without writing anything: reports the route the engine would take, the detected pixel",
	"grid and its rival candidates with confidence scores, warnings, and the output palette. It is much cheaper",
	"than refine_image, so run it first whenever the right settings are unclear. Every candidate carries an id",
	"you can pass to refine_image as candidateId to pin that grid.",
	SETTINGS_HINT,
].join(" ");

/** 解析だけを行うツール。ファイルは読むだけで、何も書かない。 */
export const registerAnalyzeImage = (
	server: McpServer,
	deps: OperationDeps,
	compat: ToolCompat,
): void => {
	server.registerTool(
		"analyze_image",
		toolConfig(
			{
				title: "Analyse pixel art",
				description: DESCRIPTION,
				inputSchema: analyzeImageInputSchema,
				outputSchema: analyzeImageOutputSchema,
				annotations: READ_ANNOTATIONS,
			},
			compat,
		),
		(args) =>
			runTool(compat, async () => {
				const result = await runAnalyze(deps, {
					input: args.input,
					settings: toRefineSettings(args.settings),
					detail: args.detail,
				});
				return result.ok
					? okResult(result.value, { compat })
					: failureResult(result.failure, compat);
			}),
	);
};
