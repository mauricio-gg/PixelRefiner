import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RawImage } from "../../../../src/shared/types";
import { imagesEqual, readPng } from "../../../../test/quality/image";
import {
	decodeImage,
	encodePng,
	MAX_INPUT_PIXELS,
	SUPPORTED_INPUT_EXTENSIONS,
} from "./image-io";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const quality4xFixture = path.join(
	repoRoot,
	"test/fixtures/quality_nearest_4x.png",
);
const jpegFixture = path.join(repoRoot, "public/guide/recipe1-input.jpg");

describe("constants", () => {
	it("MAX_INPUT_PIXELS は 64 メガピクセル", () => {
		expect(MAX_INPUT_PIXELS).toBe(64 * 1024 * 1024);
	});

	it("SUPPORTED_INPUT_EXTENSIONS は decodeImage が扱える 6 種の拡張子を列挙する", () => {
		expect(SUPPORTED_INPUT_EXTENSIONS).toEqual([
			".png",
			".jpg",
			".jpeg",
			".webp",
			".gif",
			".avif",
		]);
	});
});

describe("decodeImage", () => {
	it("PNG を pngjs と同じ画素データにデコードする", async () => {
		const bytes = new Uint8Array(readFileSync(quality4xFixture));
		const decoded = await decodeImage(bytes);
		const expected = readPng(quality4xFixture);
		expect(imagesEqual(decoded.image, expected)).toBe(true);
		expect(decoded.format).toBe("png");
	});

	it("JPEG を format: jpeg でデコードし、アルファは全画素 255 になる", async () => {
		const bytes = new Uint8Array(readFileSync(jpegFixture));
		const decoded = await decodeImage(bytes);
		expect(decoded.format).toBe("jpeg");
		expect(decoded.image.width).toBe(512);
		expect(decoded.image.height).toBe(512);
		for (let i = 3; i < decoded.image.data.length; i += 4) {
			expect(decoded.image.data[i]).toBe(255);
		}
	});

	it("壊れた画像データは 'Unsupported or corrupt image:' で始まるエラーを投げる", async () => {
		const corrupt = new Uint8Array([1, 2, 3]);
		await expect(decodeImage(corrupt)).rejects.toThrow(
			/^Unsupported or corrupt image:/,
		);
	});
});

describe("encodePng / decodeImage round trip", () => {
	it("固定サンプル画像 (quality_nearest_4x.png) を可逆に往復する", async () => {
		const original = readPng(quality4xFixture);
		const encoded = await encodePng(original);
		const decoded = await decodeImage(encoded);
		expect(imagesEqual(decoded.image, original)).toBe(true);
	});

	it("半透明ピクセル（alpha 0, 1, 127, 254, 255）を量子化・事前乗算せずに往復する", async () => {
		const alphas = [0, 1, 127, 254, 255];
		const width = alphas.length;
		const height = 1;
		const data = new Uint8ClampedArray(width * height * 4);
		alphas.forEach((alpha, i) => {
			const offset = i * 4;
			data[offset] = (i * 37) % 256;
			data[offset + 1] = (i * 61 + 10) % 256;
			data[offset + 2] = (i * 97 + 20) % 256;
			data[offset + 3] = alpha;
		});
		const original: RawImage = { width, height, data };

		const encoded = await encodePng(original);
		const decoded = await decodeImage(encoded);

		expect(imagesEqual(decoded.image, original)).toBe(true);
	});
});
