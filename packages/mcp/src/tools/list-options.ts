import type { McpServer } from "@modelcontextprotocol/server";
import { runListOptions } from "../operations/options";
import {
	failureResult,
	okResult,
	READ_ANNOTATIONS,
	runTool,
	type ToolCompat,
	toolConfig,
} from "./define";
import { listOptionsOutputSchema } from "./output-schemas";
import { listOptionsInputSchema } from "./schemas";

const DESCRIPTION = [
	"List the whole settings vocabulary with its descriptions: the built-in preset ids and the quick settings",
	"each one stands for, the retro palettes with their colours, the seven quick knobs, and every advanced",
	"option with its kind, range, default and what it is for. Read this instead of guessing a setting name or a",
	"palette id. It writes nothing and touches no image; narrow the answer with section when the full listing is",
	"more than you need.",
].join(" ");

/** 設定の語彙を返すツール。エンジンにもファイルにも触れない。 */
export const registerListOptions = (
	server: McpServer,
	compat: ToolCompat,
): void => {
	server.registerTool(
		"list_options",
		toolConfig(
			{
				title: "List Pixel Refiner options",
				description: DESCRIPTION,
				inputSchema: listOptionsInputSchema,
				outputSchema: listOptionsOutputSchema,
				annotations: READ_ANNOTATIONS,
			},
			compat,
		),
		(args) =>
			runTool(compat, async () => {
				const result = await runListOptions({ section: args.section });
				return result.ok
					? okResult(result.value, { compat })
					: failureResult(result.failure, compat);
			}),
	);
};
