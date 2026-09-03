import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DitherMode } from "../../../../src/shared/types";
import { effectiveCaseOptions } from "../../../../test/quality/benchmark";
import { imagesEqual, readPng } from "../../../../test/quality/image";
import type { QualityImageCase } from "../../../../test/quality/types";
import { decodeImage } from "../io/image-io";
import { createEngine } from "./engine";
import { SettingsError } from "./types";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const repositoryPath = (relative: string): string =>
	path.join(REPOSITORY_ROOT, relative);

const QUALITY_CASES = JSON.parse(
	readFileSync(repositoryPath("test/quality/cases.json"), "utf8"),
) as QualityImageCase[];

const qualityCase = (id: string): QualityImageCase => {
	const found = QUALITY_CASES.find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`Unknown quality case: ${id}`);
	return found;
};

const expectedImage = (entry: QualityImageCase) => {
	if (entry.expected === undefined) {
		throw new Error(`Quality case ${entry.id} has no expected image`);
	}
	return readPng(repositoryPath(entry.expected));
};

const inputBytes = (entry: QualityImageCase): Uint8Array =>
	new Uint8Array(readFileSync(repositoryPath(entry.input)));

describe("createEngine refineWithOptions", () => {
	it("品質ケース remove-background-trim-auto-grid の正解画像と一致し、2 回とも同じ結果になる", async () => {
		const entry = qualityCase("remove-background-trim-auto-grid");
		const options = { ...effectiveCaseOptions(entry), debug: false };
		const engine = createEngine();
		const bytes = inputBytes(entry);

		const first = await engine.refineWithOptions(bytes, options);
		const second = await createEngine().refineWithOptions(bytes, options);

		const expected = expectedImage(entry);
		expect(first.image.width).toBe(expected.width);
		expect(first.image.height).toBe(expected.height);
		expect(imagesEqual(first.image, expected)).toBe(true);
		expect(imagesEqual(second.image, expected)).toBe(true);
		expect(Buffer.from(first.png)).toEqual(Buffer.from(second.png));
	});

	it("返す PNG は結果画像をそのまま往復できる", async () => {
		const entry = qualityCase("remove-background-trim-auto-grid");
		const result = await createEngine().refineWithOptions(inputBytes(entry), {
			...effectiveCaseOptions(entry),
			debug: false,
		});
		const decoded = await decodeImage(result.png);
		expect(imagesEqual(decoded.image, result.image)).toBe(true);
	});

	it("レポートに実効設定と正規化済み設定を載せる", async () => {
		const entry = qualityCase("remove-background-trim-auto-grid");
		const result = await createEngine().refineWithOptions(inputBytes(entry), {
			...effectiveCaseOptions(entry),
			debug: false,
		});
		expect(result.report.input).toStrictEqual({
			width: 500,
			height: 500,
			format: "png",
		});
		expect(result.report.effectiveOptions?.trimToContent).toBe(true);
		expect(result.report.resolved?.processingMode).toBe("auto");
		expect(result.report.adjustments).toStrictEqual([]);
		expect(JSON.parse(JSON.stringify(result.report))).toStrictEqual(
			result.report,
		);
	});
});

describe("createEngine refine", () => {
	it("プリセット auto でガイドの掲載画像を再現する", async () => {
		const entry = qualityCase("guide-recipe1-knight-sprite");
		const result = await createEngine().refine(inputBytes(entry), {
			settings: { preset: "auto" },
		});
		const expected = expectedImage(entry);
		expect(result.image.width).toBe(60);
		expect(result.image.height).toBe(85);
		expect(imagesEqual(result.image, expected)).toBe(true);
	});

	it("デコードできない入力は UNSUPPORTED_INPUT になる", async () => {
		await expect(
			createEngine().refine(new Uint8Array([1, 2, 3]), {}),
		).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
	});

	it("知らないプリセットは SettingsError のまま伝わる", async () => {
		const entry = qualityCase("remove-background-trim-auto-grid");
		await expect(
			createEngine().refine(inputBytes(entry), {
				settings: { preset: "no-such-preset" },
			}),
		).rejects.toBeInstanceOf(SettingsError);
	});
});

describe("createEngine analyze", () => {
	it("解析結果の推奨候補を指定した refine は、候補なしの refine と同じ画像になる", async () => {
		const entry = qualityCase("remove-background-trim-auto-grid");
		const bytes = inputBytes(entry);
		const engine = createEngine();

		const analyzed = await engine.analyze(bytes, {});
		const recommended = analyzed.report.candidates.find(
			(candidate) => candidate.recommended,
		);
		expect(recommended?.kind).toBe("auto-result");
		expect(analyzed.report.gridCandidates.length).toBeGreaterThan(0);
		expect(analyzed.report.output.palette.length).toBeGreaterThan(0);

		const plain = await engine.refine(bytes, {});
		const picked = await engine.refine(bytes, { candidateId: recommended?.id });
		expect(imagesEqual(picked.image, plain.image)).toBe(true);
	});

	it("知らない候補 ID は INVALID_SETTINGS で候補一覧を返す", async () => {
		const entry = qualityCase("remove-background-trim-auto-grid");
		const engine = createEngine();
		await expect(
			engine.refine(inputBytes(entry), { candidateId: "cell-scale:nope" }),
		).rejects.toMatchObject({ code: "INVALID_SETTINGS" });
	});
});

describe("createEngine refineBatch", () => {
	const batchSettings = {
		quick: { processingMode: "preserve", background: "keep" },
		gridDetection: { mode: "off" },
	} as const;

	it("共通パレットで 2 枚を処理し、色数を指定どおりに抑える", async () => {
		const target = repositoryPath(
			"test/fixtures/quality_prf420_shared_palette_target.png",
		);
		const companion = repositoryPath(
			"test/fixtures/quality_prf420_shared_palette_companion.png",
		);
		const result = await createEngine().refineBatch({
			items: [
				{ id: "target", input: new Uint8Array(readFileSync(target)) },
				{ id: "companion", input: new Uint8Array(readFileSync(companion)) },
			],
			settings: batchSettings,
			sharedPalette: {
				enabled: true,
				colorCount: 4,
				ditherMode: "none",
				ditherStrength: 0,
			},
		});

		expect(result.items.map((item) => item.status)).toStrictEqual([
			"done",
			"done",
		]);
		expect(result.sharedPalette).toBeDefined();
		expect(result.sharedPalette?.length).toBeLessThanOrEqual(4);
		for (const color of result.sharedPalette ?? []) {
			expect(color).toMatch(/^#[0-9a-f]{6}$/);
		}
		const [first] = result.items;
		if (first.status !== "done") throw new Error("expected a done item");
		expect(first.image.width).toBe(16);
		expect(first.image.height).toBe(16);
		expect(first.report.output.colorCount).toBeLessThanOrEqual(4);
		expect(typeof first.needsAttention).toBe("boolean");
	});

	it("壊れた 1 枚だけを error にし、残りは処理を続ける", async () => {
		const target = repositoryPath(
			"test/fixtures/quality_prf420_shared_palette_target.png",
		);
		const result = await createEngine().refineBatch({
			items: [
				{ id: "broken", input: new Uint8Array([0, 1, 2, 3]) },
				{ id: "target", input: new Uint8Array(readFileSync(target)) },
			],
			settings: batchSettings,
		});

		const [broken, ok] = result.items;
		expect(broken.status).toBe("error");
		if (broken.status !== "error") throw new Error("expected an error item");
		expect(broken.id).toBe("broken");
		expect(broken.error.code).toBe("UNSUPPORTED_INPUT");
		expect(ok.status).toBe("done");
		expect(result.sharedPalette).toBeUndefined();
	});

	it("知らないディザ方式は SettingsError で突き返す", async () => {
		const target = repositoryPath(
			"test/fixtures/quality_prf420_shared_palette_target.png",
		);
		await expect(
			createEngine().refineBatch({
				items: [{ id: "target", input: new Uint8Array(readFileSync(target)) }],
				settings: batchSettings,
				// [Intended] JSON 経由の呼び出しは型で守れないため、実行時の検査を確かめる。
				sharedPalette: {
					enabled: true,
					ditherMode: "nope" as DitherMode,
				},
			}),
		).rejects.toBeInstanceOf(SettingsError);
	});

	it("項目ごとの設定は共通設定へ上書きで重なる", async () => {
		const target = repositoryPath(
			"test/fixtures/quality_prf420_shared_palette_target.png",
		);
		const bytes = new Uint8Array(readFileSync(target));
		const result = await createEngine().refineBatch({
			items: [
				{ id: "common", input: bytes },
				{
					id: "override",
					input: bytes,
					settings: { quick: { processingMode: "convert" } },
				},
			],
			settings: batchSettings,
		});
		const [common, override] = result.items;
		if (common.status !== "done" || override.status !== "done") {
			throw new Error("expected done items");
		}
		expect(common.report.resolved?.processingMode).toBe("preserve");
		expect(override.report.resolved?.processingMode).toBe("convert");
	});
});
