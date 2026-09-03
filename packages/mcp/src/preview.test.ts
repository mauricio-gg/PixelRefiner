import { describe, expect, it } from "vitest";
import type { RawImage } from "../../../src/shared/types";
import { decodeImage } from "./io/image-io";
import { choosePreviewScale } from "./io/scale";
import { buildPreview, PREVIEW_MAX_BASE64 } from "./preview";
import { fixtureBytes } from "./test-fixtures";

/**
 * 決定的な擬似乱数で RGBA を埋めた画像を作る。PNG の可逆圧縮がほとんど効かないので、
 * プレビューの上限に当たる状況を安定して再現できる。
 */
const noiseImage = (width: number, height: number): RawImage => {
	const data = new Uint8ClampedArray(width * height * 4);
	let state = 0x12345678;
	for (let index = 0; index < data.length; index += 1) {
		state = (state * 1664525 + 1013904223) >>> 0;
		data[index] = (state >>> 16) & 0xff;
	}
	return { width, height, data };
};

describe("buildPreview", () => {
	it("512px に収まる倍率で拡大した PNG を base64 で返す", async () => {
		const decoded = await decodeImage(
			fixtureBytes("test/fixtures/quality_nearest_4x.png"),
		);
		const preview = await buildPreview(decoded.image);

		expect(preview.included).toBe(true);
		if (!preview.included) return;
		expect(preview.scale).toBe(
			choosePreviewScale(decoded.image.width, decoded.image.height),
		);
		expect(preview.width).toBe(decoded.image.width * preview.scale);
		expect(preview.height).toBe(decoded.image.height * preview.scale);
		expect(preview.width).toBe(512);
		expect(preview.base64.length).toBeLessThanOrEqual(PREVIEW_MAX_BASE64);
		expect(preview.bytes).toBeGreaterThan(0);

		const roundTrip = await decodeImage(
			new Uint8Array(Buffer.from(preview.base64, "base64")),
		);
		expect(roundTrip.image.width).toBe(preview.width);
		expect(roundTrip.image.height).toBe(preview.height);
	});

	it("8x8 の論理解像度は 64 倍で 512x512 になる", async () => {
		const preview = await buildPreview(noiseImage(8, 8));

		expect(preview.included).toBe(true);
		if (!preview.included) return;
		expect(preview.scale).toBe(64);
		expect(preview.width).toBe(512);
	});

	it("上限を超えるときは倍率を半分ずつ下げ、1 倍でも超えるなら載せない", async () => {
		// 215x215 は 2 倍で上限を超え、等倍なら収まる大きさ（実測で選んだ）。
		const image = noiseImage(215, 215);
		const initial = choosePreviewScale(215, 215);
		expect(initial).toBeGreaterThan(1);

		const preview = await buildPreview(image);

		if (preview.included) {
			expect(preview.scale).toBeLessThan(initial);
			expect(preview.base64.length).toBeLessThanOrEqual(PREVIEW_MAX_BASE64);
			return;
		}
		expect(preview.reason).toContain(String(PREVIEW_MAX_BASE64));
	});
});
