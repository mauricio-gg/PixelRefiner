import { z } from "zod";

/**
 * 結果の形。
 * [Policy] ここは「上から数階層の目印」だけを宣言し、中身は緩いまま残す。契約はテキスト
 * ブロックに載る JSON 全体で、レポートは深く大きいので、厳密に写すとツール定義が
 * レポートの型定義ごと膨らんでしまう。
 */
const failureSchema = z
	.looseObject({
		code: z.string(),
		message: z.string(),
		hint: z.string().optional(),
	})
	.describe(
		"Present instead of the result when the call failed; isError is set too.",
	);

const outputInfoSchema = z
	.looseObject({
		path: z.string(),
		width: z.number(),
		height: z.number(),
		scale: z.number(),
		bytes: z.number(),
	})
	.describe("The PNG that was written; read path to see the real file.");

const reportSchema = z
	.looseObject({})
	.describe(
		"Analysis report: route, confidence, warnings, grid candidates with reusable ids, and the output palette.",
	);

const previewSchema = z
	.looseObject({ included: z.boolean() })
	.describe(
		"Whether a preview image block came with this result, and why not when it did not.",
	);

export const refineImageOutputSchema = z.looseObject({
	output: outputInfoSchema.optional(),
	report: reportSchema.optional(),
	preview: previewSchema.optional(),
	failure: failureSchema.optional(),
});

export const analyzeImageOutputSchema = z.looseObject({
	input: z.looseObject({ path: z.string() }).optional(),
	report: reportSchema.optional(),
	failure: failureSchema.optional(),
});

export const refineBatchOutputSchema = z.looseObject({
	items: z
		.array(z.looseObject({ id: z.string(), status: z.string() }))
		.optional()
		.describe(
			"One entry per input, in the order given; status is 'done' or 'error'.",
		),
	sharedPalette: z.array(z.string()).optional(),
	summary: z.looseObject({ done: z.number(), failed: z.number() }).optional(),
	failure: failureSchema.optional(),
});

export const listOptionsOutputSchema = z.looseObject({
	presets: z.array(z.looseObject({})).optional(),
	palettes: z.array(z.looseObject({})).optional(),
	quick: z.array(z.looseObject({})).optional(),
	advanced: z.array(z.looseObject({})).optional(),
	failure: failureSchema.optional(),
});
