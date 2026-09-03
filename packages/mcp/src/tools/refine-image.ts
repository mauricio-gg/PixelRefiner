import type { McpServer } from "@modelcontextprotocol/server";
import { runRefine } from "../operations/refine";
import type { OperationDeps } from "../operations/shared";
import {
	failureResult,
	okResult,
	runTool,
	type ToolCompat,
	toolConfig,
	WRITE_ANNOTATIONS,
} from "./define";
import { refineImageOutputSchema } from "./output-schemas";
import {
	refineImageInputSchema,
	SETTINGS_HINT,
	toRefineSettings,
} from "./schemas";

const DESCRIPTION = [
	"Refine one AI-generated pixel-art image and write the result as a PNG: strips anti-aliasing, restores the",
	"logical pixel grid, can make the background transparent and reduce colours to a retro palette.",
	SETTINGS_HINT,
	"analyze_image is the cheap first step - it writes nothing and returns grid candidate ids you can pass back",
	"here as candidateId. The result is written next to the input as <stem>.refined.png unless output is given;",
	"with preview it also comes back as an image block scaled to about 512px so you can look at it, and",
	"output.path is the file to read otherwise.",
].join(" ");

/**
 * 1 枚を仕上げるツール。
 * [Policy] 引数の写しだけを行い、パス解決も書き出しも操作層に任せる。CLI と同じ経路を
 * 通すことが、両者の挙動が食い違わない唯一の担保になる。
 */
export const registerRefineImage = (
	server: McpServer,
	deps: OperationDeps,
	compat: ToolCompat,
): void => {
	server.registerTool(
		"refine_image",
		toolConfig(
			{
				title: "Refine pixel art",
				description: DESCRIPTION,
				inputSchema: refineImageInputSchema,
				outputSchema: refineImageOutputSchema,
				annotations: WRITE_ANNOTATIONS,
			},
			compat,
		),
		(args) =>
			runTool(compat, async () => {
				const result = await runRefine(deps, {
					input: args.input,
					output: args.output,
					settings: toRefineSettings(args.settings),
					candidateId: args.candidateId,
					scale: args.scale,
					overwrite: args.overwrite,
					preview: args.preview,
					detail: args.detail,
				});
				return result.ok
					? okResult(result.value, {
							compat,
							previews: [result.value.preview],
						})
					: failureResult(result.failure, compat);
			}),
	);
};
