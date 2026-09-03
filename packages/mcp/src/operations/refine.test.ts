import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeImage } from "../io/image-io";
import { fixtureBytes, operationDeps, tempDirs } from "../test-fixtures";
import { runRefine } from "./refine";

const FIXTURE = "test/fixtures/quality_nearest_4x.png";

const directories = tempDirs();

afterEach(() => {
	directories.cleanup();
});

const workspace = () => {
	const directory = directories.create();
	const input = path.join(directory, "sprite.png");
	writeFileSync(input, fixtureBytes(FIXTURE));
	return { directory, input, deps: operationDeps(directory) };
};

const decodeFile = (filePath: string) =>
	decodeImage(new Uint8Array(readFileSync(filePath)));

describe("runRefine", () => {
	it("既定で <stem>.refined.png を書き、レポートとプレビューを返す", async () => {
		const { directory, input, deps } = workspace();

		const result = await runRefine(deps, { input });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.output.path).toBe(
			path.join(directory, "sprite.refined.png"),
		);
		expect(result.value.output.scale).toBe(1);
		expect(result.value.output.width).toBe(8);
		expect(result.value.output.height).toBe(8);
		expect(result.value.output.bytes).toBeGreaterThan(0);
		expect(result.value.report.output.width).toBe(8);
		// summary の既定では full 専用の項目を載せない
		expect(result.value.report.effectiveOptions).toBeUndefined();

		const written = await decodeFile(result.value.output.path);
		expect(written.image.width).toBe(8);
		expect(written.image.height).toBe(8);

		const preview = result.value.preview;
		expect(preview?.included).toBe(true);
		if (preview === undefined || !preview.included) return;
		expect(preview.scale).toBe(64);
		expect(preview.width).toBe(512);
	});

	it("detail: full は実効設定まで載せる", async () => {
		const { input, deps } = workspace();

		const result = await runRefine(deps, { input, detail: "full" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.report.effectiveOptions).toBeDefined();
	});

	it("preview: false ならプレビューを作らない", async () => {
		const { input, deps } = workspace();

		const result = await runRefine(deps, { input, preview: false });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.preview).toBeUndefined();
	});

	it("2 回目は overwrite が無いと OUTPUT_EXISTS、指定すれば書き換える", async () => {
		const { input, deps } = workspace();

		expect((await runRefine(deps, { input })).ok).toBe(true);

		const second = await runRefine(deps, { input });
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.failure.code).toBe("OUTPUT_EXISTS");

		const third = await runRefine(deps, { input, overwrite: true });
		expect(third.ok).toBe(true);
	});

	it("scale: 4 は 4 倍に拡大した PNG を書き、プレビューは論理解像度から作る", async () => {
		const { input, deps } = workspace();

		const result = await runRefine(deps, { input, scale: 4 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.output.scale).toBe(4);
		expect(result.value.output.width).toBe(32);
		expect(result.value.output.height).toBe(32);

		const written = await decodeFile(result.value.output.path);
		expect(written.image.width).toBe(32);
		expect(written.image.height).toBe(32);

		const preview = result.value.preview;
		if (preview === undefined || !preview.included) {
			throw new Error("プレビューが載っていない");
		}
		expect(preview.scale).toBe(64);
		expect(preview.width).toBe(512);
	});

	it("scale が 1..32 の外なら INVALID_SETTINGS で、ファイルは作らない", async () => {
		const { directory, input, deps } = workspace();

		for (const scale of [0, 33, 1.5]) {
			const result = await runRefine(deps, { input, scale });
			expect(result.ok).toBe(false);
			if (result.ok) continue;
			expect(result.failure.code).toBe("INVALID_SETTINGS");
		}
		expect(existsSync(path.join(directory, "sprite.refined.png"))).toBe(false);
	});

	it("存在しない入力は INPUT_NOT_FOUND を値として返す", async () => {
		const { directory, deps } = workspace();

		const result = await runRefine(deps, {
			input: path.join(directory, "missing.png"),
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("INPUT_NOT_FOUND");
	});

	it("設定が不正なら INVALID_SETTINGS を値として返す", async () => {
		const { input, deps } = workspace();

		const result = await runRefine(deps, {
			input,
			settings: { preset: "does-not-exist" },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("INVALID_SETTINGS");
	});
});
