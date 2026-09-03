import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "bin", "pixel-refiner-mcp.mjs");
const BUNDLE = path.join(PACKAGE_ROOT, "dist", "mcp.js");

/**
 * 実際に子プロセスを起こす煙テスト。
 * [Policy] dist/mcp.js が無ければ丸ごと飛ばす。make ci は Unit Tests と Production Build を
 * 並列に走らせるので、ビルド成果物の有無をテストの前提にはできない。ここが確かめたいのは
 * 「bin → dist → stdio」の配線であって、その配線はビルド済みのときだけ存在する。
 */
const built = existsSync(BUNDLE);

const openClients: (() => Promise<void>)[] = [];

afterEach(async () => {
	while (openClients.length > 0) {
		const close = openClients.pop();
		if (close !== undefined) await close();
	}
});

type Session = {
	client: Client;
	stderr: () => string;
};

/**
 * bin を子プロセスとして起動し、stdio でつなぐ。
 * [Intended] stderr は "pipe" で受け取る。既定の "inherit" だとログがテスト出力へ混ざるうえ、
 * ログの出方そのものを確かめられない。
 */
const connect = async (logLevel?: string): Promise<Session> => {
	const env = getDefaultEnvironment();
	if (logLevel !== undefined) env.PIXEL_REFINER_LOG = logLevel;
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [BIN],
		env,
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const client = new Client({
		name: "pixel-refiner-stdio-test",
		version: "0.0.0",
	});
	await client.connect(transport);
	openClients.push(() => client.close());
	return { client, stderr: () => stderr };
};

/** stderr は非同期に届くので、条件が満たされるまで少しだけ待つ。 */
const waitForStderr = async (
	session: Session,
	needle: string,
): Promise<string> => {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (session.stderr().includes(needle)) break;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return session.stderr();
};

describe.skipIf(!built)("bin/pixel-refiner-mcp.mjs", () => {
	it("stdio 越しに 4 つのツールを公開する", async () => {
		const session = await connect();

		const { tools } = await session.client.listTools();

		// [Intended] ここまで到達できること自体が「stdout がプロトコル専用」の証明になる。
		// ログや print が 1 行でも混ざれば、クライアントは JSON-RPC のパースに失敗する。
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"analyze_image",
			"list_options",
			"refine_batch",
			"refine_image",
		]);
	});

	it("list_options をテキストブロックで返す", async () => {
		const session = await connect();

		const result = await session.client.callTool({
			name: "list_options",
			arguments: { section: "presets" },
		});

		expect(result.isError).toBeFalsy();
		const block = result.content[0];
		if (block === undefined || block.type !== "text") {
			throw new Error(`最初のブロックがテキストではない: ${block?.type}`);
		}
		const listing = JSON.parse(block.text) as {
			presets?: { id: string }[];
		};
		expect(listing.presets?.length).toBeGreaterThan(0);
	});

	it("既定の詳細度では stderr へ何も書かない", async () => {
		const session = await connect();

		await session.client.listTools();
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(session.stderr()).not.toContain("[pixel-refiner]");
	});

	it("PIXEL_REFINER_LOG=info なら起動ログを stderr へ書く", async () => {
		const session = await connect("info");

		const stderr = await waitForStderr(session, "listening on stdio");

		expect(stderr).toContain("[pixel-refiner] info listening on stdio");
	});

	it("SIGINT を受けると終了コード 0 で止まり、stdout は空のまま", async () => {
		const child = spawn(process.execPath, [BIN], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		const exited = new Promise<number | null>((resolve) => {
			child.on("exit", (code) => resolve(code));
		});
		await new Promise((resolve) => setTimeout(resolve, 300));
		child.kill("SIGINT");

		expect(await exited).toBe(0);
		expect(stdout).toBe("");
	});
});
