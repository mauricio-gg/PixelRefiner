import { describe, expect, it } from "vitest";
import type { RawImage } from "../../../../src/shared/types";
import { choosePreviewScale, scaleNearest } from "./scale";

describe("choosePreviewScale", () => {
	it("512 に収まる最大の整数倍率を選ぶ", () => {
		expect(choosePreviewScale(22, 22)).toBe(23);
		expect(choosePreviewScale(60, 85)).toBe(6);
		expect(choosePreviewScale(600, 10)).toBe(1);
		expect(choosePreviewScale(8, 8)).toBe(64);
	});
});

describe("scaleNearest", () => {
	it("倍率1は同じオブジェクトをそのまま返す（コピーしない）", () => {
		const image: RawImage = {
			width: 2,
			height: 2,
			data: new Uint8ClampedArray([
				255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
			]),
		};
		expect(scaleNearest(image, 1)).toBe(image);
	});

	it("最近傍法で各ソース画素を factor x factor ブロックに複製する", () => {
		// 2x2 の各画素が異なる RGBA を持つ画像を作る
		const image: RawImage = {
			width: 2,
			height: 2,
			data: new Uint8ClampedArray([
				255,
				0,
				0,
				255, // (0,0) 赤
				0,
				255,
				0,
				255, // (1,0) 緑
				0,
				0,
				255,
				255, // (0,1) 青
				255,
				255,
				0,
				128, // (1,1) 半透明の黄
			]),
		};
		const factor = 3;
		const scaled = scaleNearest(image, factor);
		expect(scaled.width).toBe(image.width * factor);
		expect(scaled.height).toBe(image.height * factor);

		const pixelAt = (img: RawImage, x: number, y: number): number[] => {
			const idx = (y * img.width + x) * 4;
			return Array.from(img.data.subarray(idx, idx + 4));
		};

		for (let sy = 0; sy < image.height; sy += 1) {
			for (let sx = 0; sx < image.width; sx += 1) {
				const expectedPixel = pixelAt(image, sx, sy);
				for (let dy = 0; dy < factor; dy += 1) {
					for (let dx = 0; dx < factor; dx += 1) {
						const actualPixel = pixelAt(
							scaled,
							sx * factor + dx,
							sy * factor + dy,
						);
						expect(actualPixel).toEqual(expectedPixel);
					}
				}
			}
		}
	});
});
