import { describe, expect, it } from "vitest";
import type { RawImage } from "../shared/types";
import { applyCleanupStage } from "./cleanup";

type RGBTuple = [number, number, number];

/** 行×列の RGB 値から、アルファ255の RawImage を組み立てる。 */
const makeImage = (rows: RGBTuple[][]): RawImage => {
	const height = rows.length;
	const width = rows[0].length;
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b] = rows[y][x];
			const i = (y * width + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return { width, height, data };
};

const pixelAt = (image: RawImage, x: number, y: number): RGBTuple => {
	const i = (y * image.width + x) * 4;
	return [image.data[i], image.data[i + 1], image.data[i + 2]];
};

const alphaAt = (image: RawImage, x: number, y: number): number => image.data[(y * image.width + x) * 4 + 3];

const K: RGBTuple = [0, 0, 0]; // 黒
const W: RGBTuple = [255, 255, 255]; // 白

const fill = (width: number, height: number, colour: RGBTuple): RGBTuple[][] =>
	Array.from({ length: height }, () => Array.from({ length: width }, () => colour));

describe("applyCleanupStage", () => {
	// ルール1: 孤立ピクセル。この2件は「近い色は消える／遠い色は残る」という
	// しきい値そのものが正しく効いているかを検証する — しきい値の実装を
	// 間違えると、どちらか一方（あるいは両方）が逆の結果になる。
	it("removes a lone pixel that is close in colour to its neighbours", () => {
		const bg: RGBTuple = [100, 100, 100];
		const rows = fill(3, 3, bg);
		rows[1][1] = [103, 100, 100]; // Oklab 距離はしきい値 0.06 を十分下回る
		const result = applyCleanupStage(makeImage(rows));
		expect(pixelAt(result, 1, 1)).toEqual(bg);
	});

	it("keeps a strong small detail that is far in colour from its neighbours", () => {
		const bg: RGBTuple = [20, 20, 200]; // 青
		const rows = fill(3, 3, bg);
		const detail: RGBTuple = [220, 30, 30]; // 赤: Oklab では遠い
		rows[1][1] = detail;
		const result = applyCleanupStage(makeImage(rows));
		expect(pixelAt(result, 1, 1)).toEqual(detail);
	});

	// ルール2: 二重コーナー。垂直の腕 (0,2)-(1,2)-(2,2) と水平の腕
	// (2,2)-(2,3)-(2,4) が (2,2) で直角に交わる、幅1ピクセルの一本線。
	// 5ピクセルの成分に 2x2 ブロックは無く、両方の腕が折れ角の先へ
	// もう1ピクセルずつ続いているので、(2,2) は折れ角の「余分な」ピクセルとして
	// 残り6近傍の多数色（白い背景）に均される。
	it("smooths a doubled corner on a genuine one-pixel-wide line", () => {
		const rows = fill(5, 5, W);
		rows[0][2] = K;
		rows[1][2] = K;
		rows[2][2] = K;
		rows[2][3] = K;
		rows[2][4] = K;
		const result = applyCleanupStage(makeImage(rows));
		expect(pixelAt(result, 2, 2)).toEqual(W);
		// 線そのものは残っている（背景に消されたのは折れ角のピクセルだけ）。
		expect(pixelAt(result, 2, 1)).toEqual(K);
		expect(pixelAt(result, 3, 2)).toEqual(K);
	});

	// 「一本線」の保護: 同じ形の折れ角でも、線の幅が2ピクセル以上ある
	// （＝どこかに同色の2x2ブロックを含む）場合は、模様のたまたまの折れ角と
	// 区別できないため、ルール2は一切手を出さない。2x3 の黒い矩形
	// （6ピクセル、成分サイズの下限5は満たすが 2x2 ブロックを含む）の
	// 4つの角すべてが対象。
	it("leaves a thick shape's corner alone", () => {
		const rows = fill(5, 5, W);
		for (let x = 1; x <= 3; x++) {
			rows[1][x] = K;
			rows[2][x] = K;
		}
		const input = makeImage(rows);
		const result = applyCleanupStage(input);
		expect(result.data).toEqual(input.data);
	});

	// ルール3: 平らな境界の1ピクセルのでっぱり。上段=黒・下段=白の境界が
	// 列1,2,4,5では行1/行2の間で平らだが、列3だけ黒が1行余分にはみ出している。
	// はみ出した1ピクセルだけが白に戻る。
	it("pulls back a one-pixel bump on an otherwise flat border", () => {
		const rows: RGBTuple[][] = [fill(7, 1, K)[0], fill(7, 1, K)[0], fill(7, 1, W)[0], fill(7, 1, W)[0]];
		rows[2][3] = K; // でっぱり
		const result = applyCleanupStage(makeImage(rows));
		expect(pixelAt(result, 3, 2)).toEqual(W);
		// 隣接する平らな列は変わらない。
		expect(pixelAt(result, 2, 2)).toEqual(W);
		expect(pixelAt(result, 4, 2)).toEqual(W);
	});

	// ルール4: 不揃いな階段の1段。境界の行が列ごとに [2,2,1,0,0] と動く
	// （長さ2の段→長さ1の段→長さ2の段）。挟まれた長さ1の段は前の段（行2）に
	// 併合され、(列2, 行2) が白から黒に変わる。
	it("merges a single-column staircase step into the run before it", () => {
		const rows: RGBTuple[][] = [
			[K, K, K, K, K],
			[K, K, K, W, W],
			[K, K, W, W, W],
			[W, W, W, W, W],
		];
		const result = applyCleanupStage(makeImage(rows));
		expect(pixelAt(result, 2, 2)).toEqual(K);
		// 挟んでいた側の段は変わらない。
		expect(pixelAt(result, 0, 2)).toEqual(K);
		expect(pixelAt(result, 3, 0)).toEqual(K);
	});

	it("never changes alpha, even on pixels whose colour changes", () => {
		const bg: RGBTuple = [100, 100, 100];
		const rows = fill(3, 3, bg);
		rows[1][1] = [103, 100, 100];
		const image = makeImage(rows);
		image.data[(1 * 3 + 1) * 4 + 3] = 40; // このピクセルだけ半透明にしておく
		const result = applyCleanupStage(image);
		expect(alphaAt(result, 1, 1)).toBe(40);
		expect(alphaAt(result, 0, 0)).toBe(255);
	});

	it("does not mutate the input image", () => {
		const bg: RGBTuple = [100, 100, 100];
		const rows = fill(3, 3, bg);
		rows[1][1] = [103, 100, 100];
		const image = makeImage(rows);
		const before = new Uint8ClampedArray(image.data);
		applyCleanupStage(image);
		expect(image.data).toEqual(before);
	});

	it("does not crash on degenerate images (1x1, 2x2, a single row, fully transparent)", () => {
		const oneByOne = makeImage([[K]]);
		expect(() => applyCleanupStage(oneByOne)).not.toThrow();

		const twoByTwo = makeImage([
			[K, W],
			[W, K],
		]);
		expect(() => applyCleanupStage(twoByTwo)).not.toThrow();

		const singleRow = makeImage([[K, W, K, W, K, W, K]]);
		expect(() => applyCleanupStage(singleRow)).not.toThrow();

		const transparent = makeImage(fill(4, 4, K));
		transparent.data.fill(0); // 全ピクセルのアルファも0にする＝完全に透明
		const result = applyCleanupStage(transparent);
		expect(result.data).toEqual(transparent.data);
	});
});
