import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolFailure } from "./failure";
import type { PathPolicy } from "./paths";
import { resolveInputPath, resolveOutputPath, writeFileAtomic } from "./paths";
import { fixtureBytes, tempDirs } from "./test-fixtures";

const FIXTURE = "test/fixtures/quality_nearest_4x.png";

const directories = tempDirs();
const tempDir = (): string => directories.create();

afterEach(() => {
	directories.cleanup();
});

const mcpPolicy = (cwd: string): PathPolicy => ({ mode: "mcp", cwd });
const cliPolicy = (cwd: string): PathPolicy => ({ mode: "cli", cwd });

const failureOf = async (run: () => Promise<unknown>): Promise<ToolFailure> => {
	try {
		await run();
	} catch (error) {
		if (error instanceof ToolFailure) return error;
		throw error;
	}
	throw new Error("ToolFailure が投げられなかった");
};

const writeFixture = (directory: string, name: string): string => {
	const target = path.join(directory, name);
	writeFileSync(target, fixtureBytes(FIXTURE));
	return target;
};

describe("resolveInputPath", () => {
	it("MCP モードでは相対パスを拒み、cwd と絶対パス要求をメッセージに含める", async () => {
		const directory = tempDir();
		const failure = await failureOf(() =>
			resolveInputPath(mcpPolicy(directory), "sprite.png"),
		);

		expect(failure.code).toBe("INVALID_SETTINGS");
		expect(failure.message).toContain(directory);
		expect(failure.message.toLowerCase()).toContain("absolute");
	});

	it("CLI モードでは相対パスを cwd から解決する", async () => {
		const directory = tempDir();
		writeFixture(directory, "sprite.png");

		const resolved = await resolveInputPath(cliPolicy(directory), "sprite.png");

		expect(resolved).toBe(path.join(directory, "sprite.png"));
	});

	it("拡張子が対応外なら UNSUPPORTED_INPUT", async () => {
		const directory = tempDir();
		const target = path.join(directory, "sprite.bmp");
		writeFileSync(target, fixtureBytes(FIXTURE));

		const failure = await failureOf(() =>
			resolveInputPath(mcpPolicy(directory), target),
		);

		expect(failure.code).toBe("UNSUPPORTED_INPUT");
	});

	it("拡張子の大文字小文字は区別しない", async () => {
		const directory = tempDir();
		const target = writeFixture(directory, "SPRITE.PNG");

		expect(await resolveInputPath(mcpPolicy(directory), target)).toBe(target);
	});

	it("存在しないファイルは INPUT_NOT_FOUND", async () => {
		const directory = tempDir();
		const failure = await failureOf(() =>
			resolveInputPath(mcpPolicy(directory), path.join(directory, "no.png")),
		);

		expect(failure.code).toBe("INPUT_NOT_FOUND");
	});

	it("ディレクトリは INPUT_NOT_FOUND", async () => {
		const directory = tempDir();
		const nested = path.join(directory, "shots.png");
		mkdirSync(nested);

		const failure = await failureOf(() =>
			resolveInputPath(mcpPolicy(directory), nested),
		);

		expect(failure.code).toBe("INPUT_NOT_FOUND");
	});

	it("64 MiB を超えるファイルは INPUT_TOO_LARGE", async () => {
		const directory = tempDir();
		const target = path.join(directory, "huge.jpg");
		const handle = await open(target, "w");
		try {
			await handle.truncate(65 * 1024 * 1024);
		} finally {
			await handle.close();
		}

		const failure = await failureOf(() =>
			resolveInputPath(mcpPolicy(directory), target),
		);

		expect(failure.code).toBe("INPUT_TOO_LARGE");
	});

	it("PNG は IHDR の画素数だけを見てデコード前に INPUT_TOO_LARGE を返す", async () => {
		const directory = tempDir();
		const target = path.join(directory, "wide.png");
		// 8 バイトの PNG シグネチャ + チャンク長 + "IHDR" + 幅/高さ（各 4 バイト BE）。
		// 20000x20000 = 4 億画素で、実データは持たせない（デコードできれば失敗する）。
		const header = Buffer.alloc(24);
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
			header,
			0,
		);
		header.writeUInt32BE(13, 8);
		header.write("IHDR", 12, "ascii");
		header.writeUInt32BE(20000, 16);
		header.writeUInt32BE(20000, 20);
		writeFileSync(target, header);

		const failure = await failureOf(() =>
			resolveInputPath(mcpPolicy(directory), target),
		);

		expect(failure.code).toBe("INPUT_TOO_LARGE");
	});
});

describe("resolveOutputPath", () => {
	const request = (input: string, overwrite = false) => ({
		input,
		overwrite,
		defaultSuffix: ".refined",
	});

	it("既定は入力と同じディレクトリの <stem>.refined.png", async () => {
		const directory = tempDir();
		const input = writeFixture(directory, "sprite.png");

		const output = await resolveOutputPath(
			mcpPolicy(directory),
			request(input),
		);

		expect(output).toBe(path.join(directory, "sprite.refined.png"));
	});

	it("outputDir を指定すると既定名をそのディレクトリに置く", async () => {
		const directory = tempDir();
		const input = writeFixture(directory, "sprite.png");
		const outputDir = path.join(directory, "out");

		const output = await resolveOutputPath(mcpPolicy(directory), {
			...request(input),
			outputDir,
		});

		expect(output).toBe(path.join(outputDir, "sprite.refined.png"));
	});

	it("出力が .png でなければ INVALID_SETTINGS", async () => {
		const directory = tempDir();
		const input = writeFixture(directory, "sprite.png");

		const failure = await failureOf(() =>
			resolveOutputPath(mcpPolicy(directory), {
				...request(input),
				output: path.join(directory, "sprite.jpg"),
			}),
		);

		expect(failure.code).toBe("INVALID_SETTINGS");
		expect(failure.message).toContain(".png");
	});

	it("MCP モードでは相対の出力パスも拒む", async () => {
		const directory = tempDir();
		const input = writeFixture(directory, "sprite.png");

		const failure = await failureOf(() =>
			resolveOutputPath(mcpPolicy(directory), {
				...request(input),
				output: "out/sprite.png",
			}),
		);

		expect(failure.code).toBe("INVALID_SETTINGS");
		expect(failure.message).toContain(directory);
	});

	it("既存の出力は overwrite が無ければ OUTPUT_EXISTS、あれば通す", async () => {
		const directory = tempDir();
		const input = writeFixture(directory, "sprite.png");
		const output = path.join(directory, "sprite.refined.png");
		writeFileSync(output, "old");

		const failure = await failureOf(() =>
			resolveOutputPath(mcpPolicy(directory), request(input)),
		);
		expect(failure.code).toBe("OUTPUT_EXISTS");

		expect(
			await resolveOutputPath(mcpPolicy(directory), request(input, true)),
		).toBe(output);
	});

	it("出力が入力と同じパスなら overwrite でも拒み、理由を hint に書く", async () => {
		const directory = tempDir();
		const input = writeFixture(directory, "sprite.png");

		const failure = await failureOf(() =>
			resolveOutputPath(mcpPolicy(directory), {
				...request(input, true),
				output: input,
			}),
		);

		expect(failure.code).toBe("OUTPUT_EXISTS");
		expect(failure.hint).toBeDefined();
		expect(failure.hint ?? "").toContain("input");
	});
});

describe("writeFileAtomic", () => {
	it("親ディレクトリを作って書き、一時ファイルを残さない", async () => {
		const directory = tempDir();
		const target = path.join(directory, "nested", "deep", "sprite.png");

		await writeFileAtomic(target, new Uint8Array([1, 2, 3, 4]));

		expect([...readFileSync(target)]).toEqual([1, 2, 3, 4]);
		expect(readdirSync(path.dirname(target))).toEqual(["sprite.png"]);
	});

	it("既存ファイルを置き換える", async () => {
		const directory = tempDir();
		const target = path.join(directory, "sprite.png");
		writeFileSync(target, "old");

		await writeFileAtomic(target, new Uint8Array([9]));

		expect([...readFileSync(target)]).toEqual([9]);
		expect(readdirSync(directory)).toEqual(["sprite.png"]);
	});
});
