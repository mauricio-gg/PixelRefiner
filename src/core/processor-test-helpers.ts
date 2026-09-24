import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { expect } from "vitest";
import type { RawImage } from "../shared/types";

const DEBUG_IMAGES = Boolean(process.env.PIXELATE_DEBUG_IMAGES);
export const UPDATE_EXPECT = Boolean(process.env.UPDATE_EXPECT);
const DEBUG_ROOT = path.resolve("tmp/debug/test");

export const readPngAsRawImage = async (
	filePath: string,
): Promise<RawImage> => {
	const buf = await readFile(filePath);
	const png = PNG.sync.read(buf);
	return {
		width: png.width,
		height: png.height,
		data: new Uint8ClampedArray(png.data),
	};
};

export const writeRawImageAsPngSync = (
	outPath: string,
	img: RawImage,
): void => {
	const png = new PNG({ width: img.width, height: img.height });
	png.data = Buffer.from(img.data);
	const buf = PNG.sync.write(png);
	writeFileSync(outPath, buf);
};

/**
 * PNG 内の完全に透明なピクセル（alpha=0）の RGB 値は見た目に影響しないが、
 * 生成ツールによって RGB がゼロ埋めされたり元の値を保持したりするため、差異が生じる場合がある。
 * テストでは比較前に、alpha=0 の RGB を 0 へ正規化する。
 */
const normalizeTransparentRgb = (img: RawImage): Uint8ClampedArray => {
	const out = new Uint8ClampedArray(img.data);
	for (let i = 0; i < out.length; i += 4) {
		const a = out[i + 3];
		if (a === 0) {
			out[i] = 0;
			out[i + 1] = 0;
			out[i + 2] = 0;
		}
	}
	return out;
};

/**
 * 画像が完全に一致することを確認する（一致しない場合も重い差分を出さず、原因追跡向けに短いメッセージを提供する）。
 *
 * Vitest の `toEqual(Buffer)` は不一致時に大きな差分を生成して非常に遅くなる場合があるため、
 * ここでは `Buffer.equals()` による真偽評価と最初の差異の座標を報告する。
 */
export const expectSameImage = (
	actual: RawImage,
	expected: RawImage,
	expectPath?: string,
): void => {
	if (UPDATE_EXPECT && expectPath) {
		writeRawImageAsPngSync(expectPath, actual);
		return;
	}
	expect(actual.width).toBe(expected.width);
	expect(actual.height).toBe(expected.height);

	const a = Buffer.from(normalizeTransparentRgb(actual));
	const b = Buffer.from(normalizeTransparentRgb(expected));

	if (a.equals(b)) return;

	let first = -1;
	for (let i = 0; i < a.length && i < b.length; i += 1) {
		if (a[i] !== b[i]) {
			first = i;
			break;
		}
	}
	if (first < 0) {
		throw new Error(
			`Image mismatch (length difference) actual=${a.length} expected=${b.length}`,
		);
	}

	const pixel = (first / 4) | 0;
	const ch = first % 4;
	const x = pixel % actual.width;
	const y = (pixel / actual.width) | 0;
	throw new Error(
		`Image mismatch: firstDiff=idx${first} (x=${x}, y=${y}, ch=${ch}) actual=${a[first]} expected=${b[first]}`,
	);
};

/** 期待値画像と 1 画素だけ違う色を、座標付きで指定する。 */
export type PixelException = {
	x: number;
	y: number;
	/** その座標で期待する RGB。アルファは期待値画像と一致していなければならない。 */
	rgb: readonly [number, number, number];
};

/**
 * 指定した座標だけ別の色を期待し、それ以外の画素は期待値画像と完全一致することを確認する。
 *
 * [Intended] Auto 経路は縁に残った背景色の汚染を原寸の色へ差し替えるため、手書きの期待値画像に
 * わずかな背景色が残っている画素だけ色が変わる。変わる画素を座標と色で固定することで、
 * それ以外の画素の変化と、指定した画素が期待どおりの色になっているかの両方を検知する。
 */
export const expectSameImageExcept = (
	actual: RawImage,
	expected: RawImage,
	exceptions: readonly PixelException[],
): void => {
	expect(actual.width).toBe(expected.width);
	expect(actual.height).toBe(expected.height);
	const patched = normalizeTransparentRgb(expected);
	for (const exception of exceptions) {
		const offset = (exception.y * expected.width + exception.x) * 4;
		// 期待値画像と同じ色を指定していたら、この例外はもう不要である。
		const unchanged =
			patched[offset] === exception.rgb[0] &&
			patched[offset + 1] === exception.rgb[1] &&
			patched[offset + 2] === exception.rgb[2];
		if (unchanged) {
			throw new Error(
				`Stale exception at (${exception.x},${exception.y}): expected image already has this color`,
			);
		}
		patched[offset] = exception.rgb[0];
		patched[offset + 1] = exception.rgb[1];
		patched[offset + 2] = exception.rgb[2];
	}
	expectSameImage(actual, {
		width: expected.width,
		height: expected.height,
		data: patched,
	});
};

/**
 * resize_with_trimming の期待値画像に対し、Auto 経路で色が変わる画素。
 *
 * [Intended] 手書きの期待値画像は縁に背景色（緑）がわずかに残る画素を持つ。Auto は
 * その汚染を原寸の色へ差し替えるので、この 2 画素だけ期待値画像と色が違う。
 */
export const RESIZE_WITH_TRIMMING_AUTO_EDGE_PIXELS: readonly PixelException[] = [
	{ x: 43, y: 4, rgb: [6, 9, 6] },
	{ x: 44, y: 11, rgb: [4, 4, 4] },
];

const buildExpectPath = (root: string, fixtureBase: string): string =>
	fileURLToPath(
		new URL(`../../${root}/${fixtureBase}-expect.png`, import.meta.url),
	);

export const getExpectPath = (fixtureBase: string): string =>
	buildExpectPath("test/fixtures", fixtureBase);

/**
 * ユニットテスト専用のゴールデン画像へのパスを返す。
 * [Intended] `test/fixtures/` は品質ケースの一部でなければならず、
 * `test/quality/manifest.ts` が全 PNG をケースの参照から辿れることを検査する
 * (未登録の fixture はテスト失敗になる)。合成入力を使うユニットテストの
 * ゴールデン(品質ケースではない)はここに置き分けて、そのチェックの対象外にする。
 */
export const getGoldenPath = (fixtureBase: string): string =>
	buildExpectPath("test/golden", fixtureBase);

/**
 * 12x12 の合成入力。cohesion（色域のグルーピング）と clean-up（迷いピクセル・
 * 階段の段差の補正）の両方が有効なら見た目が変わるように作ってある：
 * ノイズの乗った青灰色の領域（1〜5 行目）、緑一色の地に対する迷い赤ピクセル
 * (8,8)、右端の 1 ピクセルだけの階段（0〜5 行目は列 10、6〜11 行目は列 11）、
 * 透明な角（9〜11 行目・0〜2 列目）を持つ。
 *
 * [Policy] `src/core/processor.test.ts`（M4 の pre-cohesion ゴールデン）と
 * `packages/mcp/src/engine/cohesion-renderer.test.ts`（同じゴールデンに対する
 * cohesion オン/オフの比較）の両方が同じ入力を要るため、jscpd の重複検知に
 * 引っかからないようここへ 1 箇所だけ定義する。
 */
export const mkCohesionInput = (): RawImage => {
	const w = 12;
	const h = 12;
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const staircaseCol = y < 6 ? 10 : 11;
			const transparent = y >= 9 && x < 3;
			let r = 40;
			let g = 160;
			let b = 40;
			let a = 255;
			if (y >= 1 && y <= 5 && x >= 1 && x <= 5) {
				const jitter = ((x * 5 + y * 3) % 4) - 2;
				r = 90 + jitter;
				g = 90 + jitter;
				b = 120 + jitter;
			}
			if (x === 8 && y === 8) {
				r = 220;
				g = 20;
				b = 20;
			}
			if (x === staircaseCol) {
				r = 20;
				g = 20;
				b = 200;
			}
			if (transparent) a = 0;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = a;
		}
	}
	return { width: w, height: h, data };
};

const sanitizeForPath = (s: string): string => {
	const out = s
		.trim()
		.replace(/[\\/]/g, "_")
		.replace(/[:*?"<>|]/g, "_")
		.replace(/\s+/g, "_");
	return out.length > 0 ? out.slice(0, 120) : "unnamed";
};

export const cleanDebugDir = (testcaseName: string): void => {
	if (!DEBUG_IMAGES) return;
	// `make test-debug` は先に `rm -rf tmp/debug` を実行するため、ルート自体を再作成する。
	mkdirSync(DEBUG_ROOT, { recursive: true });
	const dir = path.join(DEBUG_ROOT, sanitizeForPath(testcaseName));
	rmSync(dir, { recursive: true, force: true });

	// 旧形式の後始末（currentTestName を直接ディレクトリ名としていた頃のもの）。
	// 例: processImage___test6__... のような長いディレクトリが残らないようにする。
	const legacyPrefix = `processImage___${sanitizeForPath(testcaseName)}__`;
	try {
		for (const e of readdirSync(DEBUG_ROOT, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			if (!e.name.startsWith(legacyPrefix)) continue;
			rmSync(path.join(DEBUG_ROOT, e.name), { recursive: true, force: true });
		}
	} catch {
		// 念のため、DEBUG_ROOT が存在しない場合は後始末を省略する
	}
};

export const makeDebugHook = (testcaseName: string, testName: string) => {
	if (!DEBUG_IMAGES) return undefined;

	const dir = path.join(
		DEBUG_ROOT,
		sanitizeForPath(testcaseName),
		sanitizeForPath(testName),
	);
	mkdirSync(dir, { recursive: true });

	return (name: string, raw: RawImage) => {
		const filename = `${sanitizeForPath(name)}.png`;
		writeRawImageAsPngSync(path.join(dir, filename), raw);
	};
};

declare global {
	var __PIXEL_REFINER_DEBUG_HOOK__:
		| ((name: string, img: RawImage, meta?: Record<string, unknown>) => void)
		| undefined;
}

const fnv1a32Base36 = (s: string): string => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i += 1) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
};

const currentTestDebugDir = (): string => {
	const current = expect.getState().currentTestName ?? "unknown-test";
	const parts = current
		.split(">")
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	const groupCandidate =
		parts.find((p) => /^test\d+\b/.test(p)) ??
		parts[1] ??
		parts[0] ??
		"unknown";
	const m = /^test(\d+)\b/.exec(groupCandidate);
	const group = sanitizeForPath(m ? `test${m[1]}` : groupCandidate);

	const caseCandidate = parts[parts.length - 1] ?? current;
	const label = sanitizeForPath(caseCandidate).slice(0, 32);
	const hash = fnv1a32Base36(current).slice(0, 6);
	const caseDir = label.length > 0 ? `${label}__${hash}` : hash;

	return path.join(DEBUG_ROOT, group, caseDir);
};

// `processImage({ debug: true })` 時、テスト側で `debugHook` を渡さなくても中間画像と最終結果（99-result）を
// 出力するようにする。
if (DEBUG_IMAGES) {
	globalThis.__PIXEL_REFINER_DEBUG_HOOK__ = (name, raw) => {
		const dir = currentTestDebugDir();
		mkdirSync(dir, { recursive: true });
		const filename = `${sanitizeForPath(name)}.png`;
		writeRawImageAsPngSync(path.join(dir, filename), raw);
	};
} else {
	globalThis.__PIXEL_REFINER_DEBUG_HOOK__ = undefined;
}
