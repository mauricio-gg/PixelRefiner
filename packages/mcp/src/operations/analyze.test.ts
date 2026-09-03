import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureBytes, operationDeps, tempDirs } from "../test-fixtures";
import { runAnalyze } from "./analyze";

const directories = tempDirs();

afterEach(() => {
	directories.cleanup();
});

const workspace = () => {
	const directory = directories.create();
	const input = path.join(directory, "sprite.png");
	writeFileSync(input, fixtureBytes("test/fixtures/quality_nearest_4x.png"));
	return { directory, input, deps: operationDeps(directory) };
};

describe("runAnalyze", () => {
	it("32px の入力から 8px の出力を見積もり、入力パスを返す", async () => {
		const { input, deps } = workspace();

		const result = await runAnalyze(deps, { input });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.input.path).toBe(input);
		expect(result.value.report.input.width).toBe(32);
		expect(result.value.report.output.width).toBe(8);
		expect(result.value.report.output.height).toBe(8);
		expect(result.value.report.effectiveOptions).toBeUndefined();
	});

	it("detail: full は実効設定を載せる", async () => {
		const { input, deps } = workspace();

		const result = await runAnalyze(deps, { input, detail: "full" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.report.effectiveOptions).toBeDefined();
	});

	it("MCP モードの相対パスは INVALID_SETTINGS", async () => {
		const { deps } = workspace();

		const result = await runAnalyze(deps, { input: "sprite.png" });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("INVALID_SETTINGS");
	});

	it("ファイルは 1 枚も書かない", async () => {
		const { directory, input, deps } = workspace();

		const result = await runAnalyze(deps, { input });

		expect(result.ok).toBe(true);
		expect(readdirSync(directory)).toStrictEqual(["sprite.png"]);
	});
});
