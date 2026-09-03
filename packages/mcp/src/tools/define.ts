import type {
	CallToolResult,
	ContentBlock,
	ToolAnnotations,
} from "@modelcontextprotocol/server";
import { type FailureValue, failureValue, toToolFailure } from "../failure";
import type { PreviewResult } from "../preview";

/**
 * ホストごとの結果の作り分け。
 * [Workaround] "minimal" は structuredContent があると content[] を捨てるホスト
 * （openai/codex#10334）向け。outputSchema・title・annotations も落とし、テキスト
 * ブロック 1 本だけで成立させる。テキストには常に全部載っているので情報は失われない。
 */
export type ToolCompat = "full" | "minimal";

const COMPAT_ENV = "PIXEL_REFINER_MCP_COMPAT";

/** 引数 → 環境変数 → 既定（full）の順に決める。 */
export const resolveToolCompat = (compat?: ToolCompat): ToolCompat => {
	if (compat !== undefined) return compat;
	return process.env[COMPAT_ENV] === "minimal" ? "minimal" : "full";
};

export type ToolDefinition<Input, Output> = {
	title: string;
	description: string;
	inputSchema: Input;
	outputSchema: Output;
	annotations: ToolAnnotations;
};

export type ToolRegistration<Input, Output> = {
	title?: string;
	description: string;
	inputSchema: Input;
	outputSchema?: Output;
	annotations?: ToolAnnotations;
};

/** registerTool へ渡す設定を compat に応じて削る。 */
export const toolConfig = <Input, Output>(
	definition: ToolDefinition<Input, Output>,
	compat: ToolCompat,
): ToolRegistration<Input, Output> =>
	compat === "minimal"
		? {
				description: definition.description,
				inputSchema: definition.inputSchema,
			}
		: { ...definition };

/** 書き込み系ツールの注記。overwrite を明示しない限り既存ファイルは壊さない。 */
export const WRITE_ANNOTATIONS: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};

/** 読み取り系ツールの注記。 */
export const READ_ANNOTATIONS: ToolAnnotations = {
	readOnlyHint: true,
	openWorldHint: false,
};

const imageBlock = (base64: string): ContentBlock => ({
	type: "image",
	mimeType: "image/png",
	data: base64,
});

export type OkOptions = {
	compat: ToolCompat;
	/** 載せられるものだけ画像ブロックにする。undefined と included:false は飛ばす。 */
	previews?: readonly (PreviewResult | undefined)[];
};

/**
 * 成功した結果を組み立てる。
 * [Policy] テキストブロックが契約で、structuredContent はその写し。画像ブロックは
 * あくまで確認用の付け足しなので、無くても呼び出し側は output.path から実物を読める。
 */
export const okResult = <T extends Record<string, unknown>>(
	value: T,
	options: OkOptions,
): CallToolResult => {
	const content: ContentBlock[] = [
		{ type: "text", text: JSON.stringify(value) },
	];
	for (const preview of options.previews ?? []) {
		if (preview?.included === true) {
			content.push(imageBlock(preview.base64));
		}
	}
	return options.compat === "minimal"
		? { content, isError: false }
		: { content, structuredContent: value, isError: false };
};

/**
 * 失敗を結果として返す。
 * [Policy] 例外にはしない。JSON-RPC のエラーにすると呼び出し側には接続や実装の問題と
 * 区別が付かず、code / hint を読んで直す道が閉じる。
 */
export const failureResult = (
	failure: FailureValue,
	compat: ToolCompat,
): CallToolResult => {
	const value = { failure };
	const content: ContentBlock[] = [
		{ type: "text", text: JSON.stringify(value) },
	];
	return compat === "minimal"
		? { content, isError: true }
		: { content, structuredContent: value, isError: true };
};

/**
 * ツールのハンドラ全体を包む。
 * [Intended] 操作層が値で返す失敗に加え、想定外の例外もここで ENGINE_ERROR の結果へ
 * 写す。ツールのコールバックから外へ投げると、ホストによっては応答自体が欠ける。
 */
export const runTool = async (
	compat: ToolCompat,
	run: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
	try {
		return await run();
	} catch (error) {
		return failureResult(failureValue(toToolFailure(error)), compat);
	}
};
