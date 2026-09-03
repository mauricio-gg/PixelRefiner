import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import type { OptionsListing } from "./engine/option-listing";
import { decodeImage } from "./io/image-io";
import { createLogger } from "./log";
import { createServerFactory } from "./server";
import { fixtureBytes, tempDirs } from "./test-fixtures";
import type { ToolCompat } from "./tools/define";

const FIXTURE = "test/fixtures/quality_nearest_4x.png";

const directories = tempDirs();
const openClients: (() => Promise<void>)[] = [];

afterEach(async () => {
	while (openClients.length > 0) {
		const close = openClients.pop();
		if (close !== undefined) await close();
	}
	directories.cleanup();
});

/**
 * インプロセスの Streamable HTTP でサーバーへ繋ぐ。
 * [Intended] createMcpHandler の fetch へ直接流すので、ポートも子プロセスも要らないまま
 * 本番と同じ経路（JSON-RPC の往復、スキーマ検証、結果の投影）を通せる。
 */
const connect = async (compat?: ToolCompat) => {
	const directory = directories.create();
	const input = path.join(directory, "sprite.png");
	writeFileSync(input, fixtureBytes(FIXTURE));
	const handler = createMcpHandler(
		createServerFactory({
			compat,
			cwd: directory,
			log: createLogger("silent"),
		}),
	);
	const transport = new StreamableHTTPClientTransport(
		new URL("http://pixel-refiner.test/mcp"),
		{ fetch: (url, init) => handler.fetch(new Request(url, init)) },
	);
	const client = new Client({ name: "pixel-refiner-test", version: "0.0.0" });
	await client.connect(transport);
	openClients.push(async () => {
		await client.close();
		await handler.close();
	});
	return { client, directory, input };
};

const textOf = (result: CallToolResult): string => {
	const block = result.content[0];
	if (block === undefined || block.type !== "text") {
		throw new Error(`最初のブロックがテキストではない: ${block?.type}`);
	}
	return block.text;
};

const imageOf = (result: CallToolResult) => {
	const block = result.content[1];
	if (block === undefined || block.type !== "image") {
		throw new Error(`2 番目のブロックが画像ではない: ${block?.type}`);
	}
	return block;
};

const toolByName = (tools: Tool[], name: string): Tool => {
	const tool = tools.find((entry) => entry.name === name);
	if (tool === undefined) throw new Error(`${name} が公開されていない`);
	return tool;
};

describe("createPixelRefinerServer", () => {
	it("4 つのツールだけを公開する", async () => {
		const { client } = await connect();

		const { tools } = await client.listTools();

		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"analyze_image",
			"list_options",
			"refine_batch",
			"refine_image",
		]);
	});

	it("list_options は語彙一覧をテキストブロックで返す", async () => {
		const { client } = await connect();

		const result = await client.callTool({
			name: "list_options",
			arguments: {},
		});

		expect(result.isError).toBeFalsy();
		const listing = JSON.parse(textOf(result)) as OptionsListing;
		expect(listing.presets?.length).toBeGreaterThan(0);
		expect(listing.palettes?.length).toBeGreaterThan(0);
		expect(listing.quick?.length).toBe(7);
		expect(listing.advanced?.length).toBeGreaterThan(0);
	});

	it("analyze_image は 32px の入力を 8px と報告する", async () => {
		const { client, input } = await connect();

		const result = await client.callTool({
			name: "analyze_image",
			arguments: { input },
		});

		expect(result.isError).toBeFalsy();
		const value = JSON.parse(textOf(result)) as {
			report: { output: { width: number } };
		};
		expect(value.report.output.width).toBe(8);
	});

	it("refine_image はファイルを書き、512x512 のプレビューを画像ブロックで返す", async () => {
		const { client, directory, input } = await connect();

		const result = await client.callTool({
			name: "refine_image",
			arguments: { input },
		});

		expect(result.isError).toBeFalsy();
		const value = JSON.parse(textOf(result)) as {
			output: { path: string; width: number };
		};
		expect(value.output.path).toBe(path.join(directory, "sprite.refined.png"));
		expect(value.output.width).toBe(8);
		expect(existsSync(value.output.path)).toBe(true);

		const image = imageOf(result);
		expect(image.mimeType).toBe("image/png");
		const decoded = await decodeImage(
			new Uint8Array(Buffer.from(image.data, "base64")),
		);
		expect(decoded.image.width).toBe(512);
		expect(decoded.image.height).toBe(512);
		expect(result.structuredContent).toBeDefined();
	});

	it("2 回目は overwrite が無いと OUTPUT_EXISTS の isError になる", async () => {
		const { client, input } = await connect();

		expect(
			(await client.callTool({ name: "refine_image", arguments: { input } }))
				.isError,
		).toBeFalsy();
		const second = await client.callTool({
			name: "refine_image",
			arguments: { input },
		});

		expect(second.isError).toBe(true);
		const value = JSON.parse(textOf(second)) as {
			failure: { code: string; hint?: string };
		};
		expect(value.failure.code).toBe("OUTPUT_EXISTS");
	});

	it("相対パスは isError になり、メッセージに cwd が入る", async () => {
		const { client, directory } = await connect();

		const result = await client.callTool({
			name: "refine_image",
			arguments: { input: "sprite.png" },
		});

		expect(result.isError).toBe(true);
		const value = JSON.parse(textOf(result)) as {
			failure: { code: string; message: string };
		};
		expect(value.failure.code).toBe("INVALID_SETTINGS");
		expect(value.failure.message).toContain(directory);
	});

	it("未知の引数はスキーマ検証で拒む", async () => {
		const { client, input } = await connect();

		const result = await client.callTool({
			name: "refine_image",
			arguments: { input, unexpected: true },
		});

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("unexpected");
	});

	it("refine_batch は複数枚を書き出し、集計を返す", async () => {
		const { client, directory, input } = await connect();
		const second = path.join(directory, "second.png");
		writeFileSync(second, fixtureBytes(FIXTURE));

		const result = await client.callTool({
			name: "refine_batch",
			arguments: { inputs: [input, second] },
		});

		expect(result.isError).toBeFalsy();
		const value = JSON.parse(textOf(result)) as {
			summary: { done: number; failed: number };
		};
		expect(value.summary).toEqual({ done: 2, failed: 0 });
		expect(existsSync(path.join(directory, "second.refined.png"))).toBe(true);
		// preview の既定は false なので画像ブロックは付かない
		expect(result.content.length).toBe(1);
	});
});

describe("compat: minimal", () => {
	it("outputSchema・annotations・title を出さず structuredContent も付けない", async () => {
		const { client, input } = await connect("minimal");

		const { tools } = await client.listTools();
		const refine = toolByName(tools, "refine_image");
		expect(refine.outputSchema).toBeUndefined();
		expect(refine.annotations).toBeUndefined();
		expect(refine.title).toBeUndefined();
		expect(refine.description).toBeTruthy();
		expect(refine.inputSchema).toBeDefined();

		const result = await client.callTool({
			name: "refine_image",
			arguments: { input, preview: false },
		});
		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toBeUndefined();
		expect(textOf(result)).toContain("sprite.refined.png");
	});
});
