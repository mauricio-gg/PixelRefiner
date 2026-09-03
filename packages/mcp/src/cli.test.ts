import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli";
import { REPOSITORY_ROOT, tempDirs } from "./test-fixtures";
import { PIXEL_REFINER_MCP_VERSION } from "./version";

const PACKAGE_ROOT = fileURLToPath(new URL(".", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "..", "bin", "pixel-refiner.mjs");
const BUNDLE = path.join(PACKAGE_ROOT, "..", "dist", "cli.js");

const FIXTURE = "test/fixtures/quality_nearest_4x.png";
const BATCH_FIXTURES = [
	"test/fixtures/quality_prf420_shared_palette_target.png",
	"test/fixtures/quality_prf420_shared_palette_companion.png",
];

const directories = tempDirs();

afterEach(() => {
	directories.cleanup();
});

type Run = {
	exitCode: number;
	stdout: string;
	stderr: string;
	json: () => unknown;
};

/**
 * main を同じプロセスで動かし、書き出し先だけ差し替える。
 * [Intended] cwd はリポジトリルート。CLI は相対パスを cwd から解決するので、
 * フィクスチャをリポジトリからの相対パスのまま渡せる。
 */
const runCli = async (argv: readonly string[]): Promise<Run> => {
	let stdout = "";
	let stderr = "";
	const exitCode = await main([...argv], {
		stdout: (text) => {
			stdout += text;
		},
		stderr: (text) => {
			stderr += text;
		},
		cwd: REPOSITORY_ROOT,
	});
	return { exitCode, stdout, stderr, json: () => JSON.parse(stdout) };
};

type FailureOutput = { failure: { code: string; message: string } };
type RefineOutput = {
	output: { path: string; width: number };
	report: { output: { width: number } };
	preview?: unknown;
};
type BatchOutput = {
	items: { status: string; error?: { code: string } }[];
	summary: { done: number; failed: number };
	sharedPalette?: string[];
};

describe("main", () => {
	it("--help は使い方を stdout へ書いて 0 で終わる", async () => {
		const run = await runCli(["--help"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("Usage: pixel-refiner");
		expect(run.stderr).toBe("");
	});

	it("--version はバージョンだけを書く", async () => {
		const run = await runCli(["--version"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout.trim()).toBe(PIXEL_REFINER_MCP_VERSION);
	});

	it("options は語彙の一覧を JSON で書く", async () => {
		const run = await runCli(["options", "--section", "presets"]);

		expect(run.exitCode).toBe(0);
		const listing = run.json() as { presets: { id: string }[] };
		expect(listing.presets.length).toBeGreaterThan(0);
		expect(run.stdout).toContain("\n  ");
	});

	it("--compact は 1 行の JSON を書く", async () => {
		const run = await runCli(["options", "--section", "presets", "--compact"]);

		expect(run.exitCode).toBe(0);
		expect(run.stdout.trimEnd().split("\n")).toHaveLength(1);
	});

	it("refine は結果を書き出して 0 で終わる", async () => {
		const target = path.join(directories.create(), "x.png");

		const run = await runCli([
			"refine",
			FIXTURE,
			"--output",
			target,
			"--no-preview",
		]);

		expect(run.exitCode).toBe(0);
		const value = run.json() as RefineOutput;
		expect(value.output.path).toBe(target);
		expect(value.report.output.width).toBe(8);
		expect(value.preview).toBeUndefined();
		expect(existsSync(target)).toBe(true);
	});

	it("overwrite なしで二度書くと OUTPUT_EXISTS で 3 になる", async () => {
		const target = path.join(directories.create(), "x.png");
		const argv = ["refine", FIXTURE, "--output", target, "--no-preview"];
		await runCli(argv);

		const run = await runCli(argv);

		expect(run.exitCode).toBe(3);
		expect((run.json() as FailureOutput).failure.code).toBe("OUTPUT_EXISTS");
	});

	it("analyze はファイルを書かずにレポートだけ返す", async () => {
		const run = await runCli(["analyze", FIXTURE]);

		expect(run.exitCode).toBe(0);
		const value = run.json() as { report: { route: string } };
		expect(typeof value.report.route).toBe("string");
	});

	it("未知のフラグは使い方エラーとして 2 になる", async () => {
		const run = await runCli(["refine", FIXTURE, "--sharpen"]);

		expect(run.exitCode).toBe(2);
		expect(run.stderr).toContain("Usage: pixel-refiner");
		expect((run.json() as FailureOutput).failure.code).toBe("INVALID_SETTINGS");
	});

	it("設定の値が語彙に無ければ INVALID_SETTINGS で 2 になる", async () => {
		const run = await runCli([
			"refine",
			FIXTURE,
			"--quick",
			"reductionMode=bogus",
			"--no-preview",
		]);

		expect(run.exitCode).toBe(2);
		const value = run.json() as FailureOutput;
		expect(value.failure.code).toBe("INVALID_SETTINGS");
		expect(value.failure.message).toContain("reductionMode");
	});

	it("batch は共通パレットで 2 枚を書き出す", async () => {
		const directory = directories.create();

		const run = await runCli([
			"batch",
			...BATCH_FIXTURES,
			"--shared-palette",
			"--palette-colors",
			"4",
			"--output-dir",
			directory,
		]);

		expect(run.exitCode).toBe(0);
		const value = run.json() as BatchOutput;
		expect(value.summary).toEqual({ done: 2, failed: 0 });
		expect(value.sharedPalette).toHaveLength(4);
		for (const fixture of BATCH_FIXTURES) {
			const stem = path.basename(fixture, ".png");
			expect(existsSync(path.join(directory, `${stem}.refined.png`))).toBe(
				true,
			);
		}
	});

	it("batch は 1 枚でも失敗すると 1 になる", async () => {
		const directory = directories.create();

		const run = await runCli([
			"batch",
			BATCH_FIXTURES[0],
			"test/fixtures/does-not-exist.png",
			"--output-dir",
			directory,
		]);

		expect(run.exitCode).toBe(1);
		const value = run.json() as BatchOutput;
		expect(value.summary).toEqual({ done: 1, failed: 1 });
		expect(value.items[1].error?.code).toBe("INPUT_NOT_FOUND");
	});
});

/**
 * bin から dist を通した煙テスト。
 * [Policy] dist/cli.js が無ければ丸ごと飛ばす。make ci は Unit Tests と Production Build を
 * 並列に走らせるので、ビルド成果物の有無をテストの前提にはできない。ここが確かめたいのは
 * 「bin → dist → main」の配線であって、その配線はビルド済みのときだけ存在する。
 */
describe.skipIf(!existsSync(BUNDLE))("bin/pixel-refiner.mjs", () => {
	it("options --compact を 1 行の JSON として書く", () => {
		const result = spawnSync(process.execPath, [BIN, "options", "--compact"], {
			cwd: REPOSITORY_ROOT,
			encoding: "utf8",
		});

		expect(result.status).toBe(0);
		expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
		const listing = JSON.parse(result.stdout) as { presets: unknown[] };
		expect(listing.presets.length).toBeGreaterThan(0);
	});

	it("refine で 8x8 の PNG を書き出す", () => {
		const target = path.join(directories.create(), "x.png");

		const result = spawnSync(
			process.execPath,
			[BIN, "refine", FIXTURE, "--output", target, "--no-preview"],
			{ cwd: REPOSITORY_ROOT, encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		const value = JSON.parse(result.stdout) as RefineOutput;
		expect(value.output.width).toBe(8);
		expect(existsSync(target)).toBe(true);
	});
});
