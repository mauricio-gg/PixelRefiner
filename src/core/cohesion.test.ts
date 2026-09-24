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

/**
 * 一様な背景の中に矩形パッチを 1 つだけ置いた画像。境界に触れないので、パッチを除いた
 * 背景は必ず 1 つの連結領域になる -- mergeSmallAreas の「近い色は統合する／遠い色は
 * 本物の細部として残す」判定だけを、他の要因抜きで検証するための構図。
 */
const mkPatchImage = (
	canvasW: number,
	canvasH: number,
	patch: {
		x: number;
		y: number;
		w: number;
		h: number;
		color: [number, number, number];
	},
	backgroundColor: [number, number, number] = [60, 60, 60],
): RawImage => {
	const data = new Uint8ClampedArray(canvasW * canvasH * 4);
	for (let y = 0; y < canvasH; y++) {
		for (let x = 0; x < canvasW; x++) {
			const i = (y * canvasW + x) * 4;
			const inPatch =
				x >= patch.x &&
				x < patch.x + patch.w &&
				y >= patch.y &&
				y < patch.y + patch.h;
			const [r, g, b] = inPatch ? patch.color : backgroundColor;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return { width: canvasW, height: canvasH, data };
};

/** 出力に含まれる distinct な不透明色の数。tones=1 で使うと「何個の領域に分かれたか」の
 * 直接の証拠になる -- 統合されれば領域は 1 つの色に、されなければ複数の色になる。 */
const distinctColours = (image: RawImage): Set<string> => {
	const colours = new Set<string>();
	for (let i = 0; i < image.data.length; i += 4) {
		if (image.data[i + 3] === 0) continue;
		colours.add(`${image.data[i]},${image.data[i + 1]},${image.data[i + 2]}`);
	}
	return colours;
};

/**
 * 決定論性テスト用の、意図的に散らかった多領域入力。4 象限それぞれ別の基準色に、
 * 座標だけで決まるジッターを乗せている。families=14/tones=2 でクラスタリングすると
 * 小さく似た色の領域がいくつもでき、mergeSmallAreas の統合判定やタイブレークが
 * 実際に発生する -- 単色画像では検知できない「Map/Set の反復順に依存した非決定性」
 * を検知できる入力。
 */
const noisyMultiAreaImage = (size: number): RawImage => {
	const data = new Uint8ClampedArray(size * size * 4);
	const bases: ReadonlyArray<[number, number, number]> = [
		[60, 60, 60],
		[180, 60, 60],
		[60, 180, 60],
		[60, 60, 180],
	];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			const quadrant = (x < size / 2 ? 0 : 1) + (y < size / 2 ? 0 : 2);
			const [br, bg, bb] = bases[quadrant];
			const jitter = ((x * 7 + y * 13) % 9) - 4;
			data[i] = br + jitter;
			data[i + 1] = bg + jitter;
			data[i + 2] = bb + jitter;
			data[i + 3] = 255;
		}
	}
	return { width: size, height: size, data };
};

describe("mergeSmallAreas via applyCohesionStage (tones=1, so one area = one output colour)", () => {
	it("merges a small area (12px, under MERGE_MIN_PX) into the background when the colour is close (Oklab dist ~0.017)", () => {
		const image = mkPatchImage(8, 8, {
			x: 2,
			y: 2,
			w: 4,
			h: 3,
			color: [66, 64, 63],
		});
		const result = applyCohesionStage(
			image,
			{ width: 8, height: 8 },
			14,
			1,
			fakeResizeRenderer,
		);
		expect(distinctColours(result).size).toBe(1);
	});

	it("keeps a small area (12px, under MERGE_MIN_PX) separate when the colour is far (Oklab dist ~0.365, real detail)", () => {
		const image = mkPatchImage(8, 8, {
			x: 2,
			y: 2,
			w: 4,
			h: 3,
			color: [250, 10, 10],
		});
		const result = applyCohesionStage(
			image,
			{ width: 8, height: 8 },
			14,
			1,
			fakeResizeRenderer,
		);
		const colours = distinctColours(result);
		expect(colours.size).toBe(2);
		expect(colours.has("60,60,60")).toBe(true);
		expect(colours.has("250,10,10")).toBe(true);
	});

	it("merges a close-coloured area of exactly MERGE_MIN_PX - 1 (19px)", () => {
		const image = mkPatchImage(25, 5, {
			x: 3,
			y: 2,
			w: 19,
			h: 1,
			color: [66, 64, 63],
		});
		const result = applyCohesionStage(
			image,
			{ width: 25, height: 5 },
			14,
			1,
			fakeResizeRenderer,
		);
		expect(distinctColours(result).size).toBe(1);
	});

	it("does not merge a close-coloured area of exactly MERGE_MIN_PX (20px) -- the boundary is exclusive", () => {
		const image = mkPatchImage(25, 5, {
			x: 3,
			y: 2,
			w: 20,
			h: 1,
			color: [66, 64, 63],
		});
		const result = applyCohesionStage(
			image,
			{ width: 25, height: 5 },
			14,
			1,
			fakeResizeRenderer,
		);
		expect(distinctColours(result).size).toBe(2);
	});
});

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

	it("is deterministic on a noisy multi-area input: the same input produces byte-identical output twice", () => {
		// [Policy] 単色画像では領域が 1 つしかできず、Map/Set の反復順に依存した非決定性が
		// あっても絶対に検知できない（code-guardian round 2, S3）。複数の小領域・統合・
		// タイブレークが実際に起きる入力でなければ、このテストは意味を持たない。
		const image = noisyMultiAreaImage(20);
		const first = applyCohesionStage(
			image,
			{ width: 20, height: 20 },
			14,
			2,
			fakeResizeRenderer,
		);
		const second = applyCohesionStage(
			image,
			{ width: 20, height: 20 },
			14,
			2,
			fakeResizeRenderer,
		);
		expect(Buffer.from(second.data)).toEqual(Buffer.from(first.data));
	});
});
