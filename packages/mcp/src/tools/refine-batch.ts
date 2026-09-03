import type { McpServer } from "@modelcontextprotocol/server";
import type { BatchValue } from "../operations/batch";
import { runBatch } from "../operations/batch";
import type { OperationDeps } from "../operations/shared";
import type { PreviewResult } from "../preview";
import {
	failureResult,
	okResult,
	runTool,
	type ToolCompat,
	toolConfig,
	WRITE_ANNOTATIONS,
} from "./define";
import { refineBatchOutputSchema } from "./output-schemas";
import {
	refineBatchInputSchema,
	SETTINGS_HINT,
	toRefineSettings,
} from "./schemas";

const DESCRIPTION = [
	"Refine several images in one call, optionally quantising all of them against one shared palette so a set of",
	"sprites stays consistent. A failure on one file is reported in that item and does not stop the others.",
	"Each result is written next to its input as <stem>.refined.png unless outputDir or suffix say otherwise, and",
	"items[].output.path is the file to read.",
	SETTINGS_HINT,
].join(" ");

/** 仕上がった各件のプレビュー。included でないものは okResult 側が読み飛ばす。 */
const previewsOf = (value: BatchValue): (PreviewResult | undefined)[] =>
	value.items.map((item) =>
		item.status === "done" ? item.preview : undefined,
	);

/** 複数枚をまとめて仕上げるツール。 */
export const registerRefineBatch = (
	server: McpServer,
	deps: OperationDeps,
	compat: ToolCompat,
): void => {
	server.registerTool(
		"refine_batch",
		toolConfig(
			{
				title: "Refine pixel art in bulk",
				description: DESCRIPTION,
				inputSchema: refineBatchInputSchema,
				outputSchema: refineBatchOutputSchema,
				annotations: WRITE_ANNOTATIONS,
			},
			compat,
		),
		(args) =>
			runTool(compat, async () => {
				const result = await runBatch(deps, {
					inputs: args.inputs,
					outputDir: args.outputDir,
					suffix: args.suffix,
					sharedPalette: args.sharedPalette,
					settings: toRefineSettings(args.settings),
					scale: args.scale,
					overwrite: args.overwrite,
					preview: args.preview,
					detail: args.detail,
				});
				return result.ok
					? okResult(result.value, {
							compat,
							previews: previewsOf(result.value),
						})
					: failureResult(result.failure, compat);
			}),
	);
};
