import { describe, expect, it } from "vitest";
import type { RawImage } from "../shared/types";
import { applyCohesionStage, type CohesionRenderer } from "./cohesion";

const solidImage = (
	width: number,
	height: number,
	color: [number, number, number],
): RawImage => {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = color[0];
		data[i + 1] = color[1];
		data[i + 2] = color[2];
		data[i + 3] = 255;
	}
	return { width, height, data };
};

const transparentImage = (width: number, height: number): RawImage => ({
	width,
	height,
	data: new Uint8ClampedArray(width * height * 4),
});

/**
 * 最近傍リサイズだけを行うフェイク: 本物のトレースではないが、`applyCohesionStage` が
 * レンダラーを正しい引数で呼び、その戻り値をそのまま返すことを確かめるには十分。
 * ルートパッケージに vtracer/resvg を入れずに済む。
 */
const fakeResizeRenderer: CohesionRenderer = (
	rgba,
	sourceWidth,
	sourceHeight,
	target,
) => {
	const data = new Uint8ClampedArray(target.width * target.height * 4);
	for (let y = 0; y < target.height; y++) {
		for (let x = 0; x < target.width; x++) {
			const sx = Math.floor((x / target.width) * sourceWidth);
			const sy = Math.floor((y / target.height) * sourceHeight);
			const srcI = (sy * sourceWidth + sx) * 4;
			const dstI = (y * target.width + x) * 4;
			data[dstI] = rgba[srcI];
			data[dstI + 1] = rgba[srcI + 1];
			data[dstI + 2] = rgba[srcI + 2];
			data[dstI + 3] = rgba[srcI + 3];
		}
	}
	return { width: target.width, height: target.height, data };
};

describe("applyCohesionStage", () => {
	it("throws a plain named error when no renderer is supplied", () => {
		const image = solidImage(4, 4, [10, 10, 10]);
		expect(() =>
			applyCohesionStage(
				image,
				{ width: 4, height: 4 },
				14,
				2,
				undefined as unknown as CohesionRenderer,
			),
		).toThrow(/CohesionRenderer/);
	});

	it("does not throw when there are fewer opaque colours than cohesionFamilies", () => {
		const image = solidImage(8, 8, [200, 50, 50]);
		expect(() =>
			applyCohesionStage(
				image,
				{ width: 8, height: 8 },
				14,
				2,
				fakeResizeRenderer,
			),
		).not.toThrow();
	});

	it("returns a fully transparent target-sized image without calling the renderer, for a fully transparent crop", () => {
		const image = transparentImage(6, 6);
		let rendererCalled = false;
		const spyRenderer: CohesionRenderer = (
			rgba,
			sourceWidth,
			sourceHeight,
			target,
		) => {
			rendererCalled = true;
			return fakeResizeRenderer(rgba, sourceWidth, sourceHeight, target);
		};
		const result = applyCohesionStage(
			image,
			{ width: 6, height: 6 },
			14,
			2,
			spyRenderer,
		);
		expect(rendererCalled).toBe(false);
		expect([result.width, result.height]).toEqual([6, 6]);
		expect(result.data.every((byte) => byte === 0)).toBe(true);
	});

	it("does not throw on a 1x1 target", () => {
		const image = solidImage(10, 10, [30, 200, 90]);
		expect(() =>
			applyCohesionStage(
				image,
				{ width: 1, height: 1 },
				14,
				2,
				fakeResizeRenderer,
			),
		).not.toThrow();
	});

	it("calls the renderer with the requested target size and returns its result verbatim", () => {
		const image = solidImage(10, 6, [80, 80, 200]);
		const result = applyCohesionStage(
			image,
			{ width: 60, height: 20 },
			14,
			2,
			fakeResizeRenderer,
		);
		expect([result.width, result.height]).toEqual([60, 20]);
	});

	it("zeroes the colour under fully transparent pixels before handing them to the renderer", () => {
		// 透明な画素にも元の RGB が残っている画像 -- 背景除去後の working が持ちうる状態。
		// スパイクの restore_alpha と同じく、cohesion は渡す前に透明部分の色をゼロで埋める。
		// 不透明な画素を 1 つだけ混ぜてある: 全画素が透明だと新しい「不透明画素 0 件」ガードが
		// 先に発火して renderer が呼ばれなくなり、この検証ができなくなるため。
		const width = 4;
		const height = 4;
		const data = new Uint8ClampedArray(width * height * 4);
		for (let i = 0; i < data.length; i += 4) {
			data[i] = 250;
			data[i + 1] = 10;
			data[i + 2] = 10;
			data[i + 3] = 0; // 完全透明だが RGB は非ゼロのまま残っている
		}
		data[3] = 255; // 画素 0 だけ不透明にする
		let seenRgba: Uint8Array | undefined;
		const capturingRenderer: CohesionRenderer = (
			rgba,
			sourceWidth,
			sourceHeight,
		) => {
			seenRgba = rgba;
			return {
				width: sourceWidth,
				height: sourceHeight,
				data: new Uint8ClampedArray(rgba),
			};
		};
		applyCohesionStage(
			{ width, height, data },
			{ width, height },
			14,
			2,
			capturingRenderer,
		);
		expect(seenRgba).toBeDefined();
		// 画素 0（唯一の不透明画素）は対象外 -- 透明な画素だけ RGB がゼロであることを確かめる。
		for (let i = 4; i < (seenRgba as Uint8Array).length; i += 4) {
			expect((seenRgba as Uint8Array)[i]).toBe(0);
			expect((seenRgba as Uint8Array)[i + 1]).toBe(0);
			expect((seenRgba as Uint8Array)[i + 2]).toBe(0);
		}
	});

	it("is deterministic: the same input produces byte-identical output twice", () => {
		const image = solidImage(16, 16, [140, 90, 60]);
		const first = applyCohesionStage(
			image,
			{ width: 16, height: 16 },
			14,
			2,
			fakeResizeRenderer,
		);
		const second = applyCohesionStage(
			image,
			{ width: 16, height: 16 },
			14,
			2,
			fakeResizeRenderer,
		);
		expect(Buffer.from(second.data)).toEqual(Buffer.from(first.data));
	});
});
