import { beforeAll, describe, expect, it } from "vitest";
import { applyCohesionStage } from "../../../../src/core/cohesion";
import { processImage } from "../../../../src/core/processor";
import {
	getExpectPath,
	mkCohesionInput,
	readPngAsRawImage,
} from "../../../../src/core/processor-test-helpers";
import type { RawImage } from "../../../../src/shared/types";
import {
	ensureCohesionRendererReady,
	nodeCohesionRenderer,
} from "./cohesion-renderer";

// [Intended] `nodeCohesionRenderer` は resvg の wasm を初期化してからでないと
// 「Wasm has not been initialized」で例外を投げる（実測で確認済み）。本番では
// `packages/mcp/src/engine/engine.ts` が `refine` などの中で必ず先に
// `await ensureCohesionRendererReady()` を呼ぶので問題にならないが、レンダラーを
// 直接呼ぶこのテストファイルでは自分で一度だけ呼んでおく必要がある。
beforeAll(() => ensureCohesionRendererReady());

/**
 * 1 色の連結領域に、はっきり分かれた `bandCount` 段の明度バンド（それぞれ横一列の
 * 塊）を、±2 の画素単位ジッターを乗せて作る。cohesion を通したあとに正しく
 * `bandCount` 色ちょうどへ収束することが一意に判定できるように作ってある --
 * ジッターが一様な単一パッチだと、階調スナップが全部を 1 色へ潰していても
 * 緩い判定なら通ってしまう。
 */
const bandedImage = (size: number, bandCount: number): RawImage => {
	const data = new Uint8ClampedArray(size * size * 4);
	const bandHeight = Math.floor(size / bandCount);
	for (let y = 0; y < size; y++) {
		const band = Math.min(bandCount - 1, Math.floor(y / bandHeight));
		const base = 60 + band * (140 / (bandCount - 1 || 1));
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			const jitter = ((x * 7 + y * 13) % 5) - 2;
			data[i] = Math.round(base) + jitter;
			data[i + 1] = Math.round(base * 0.7) + jitter;
			data[i + 2] = Math.round(base * 0.5) + jitter;
			data[i + 3] = 255;
		}
	}
	return { width: size, height: size, data };
};

describe("applyCohesionStage with the real Node renderer", () => {
	it.each([2, 3])(
		"snaps a %i-band shaded area to exactly cohesionTones distinct colours",
		(tones) => {
			const result = applyCohesionStage(
				bandedImage(30, tones),
				{ width: 30, height: 30 },
				14,
				tones,
				nodeCohesionRenderer,
			);
			const colours = new Set<string>();
			for (let i = 0; i < result.data.length; i += 4) {
				if (result.data[i + 3] === 0) continue;
				colours.add(
					`${result.data[i]},${result.data[i + 1]},${result.data[i + 2]}`,
				);
			}
			expect(colours.size).toBe(tones);
		},
	);

	it("with cohesion and cleanup off, matches the golden; with cohesion on (real renderer), it differs", async () => {
		const golden = await readPngAsRawImage(
			getExpectPath("cohesion-off-forced"),
		);
		const off = processImage(mkCohesionInput(), {
			forcePixelsW: 8,
			forcePixelsH: 8,
			cohesion: false,
		});
		expect(Buffer.from(off.result.data)).toEqual(Buffer.from(golden.data));

		const on = processImage(mkCohesionInput(), {
			forcePixelsW: 8,
			forcePixelsH: 8,
			cohesion: true,
			cohesionFamilies: 14,
			cohesionTones: 2,
			cohesionRenderer: nodeCohesionRenderer,
		});
		expect(Buffer.from(on.result.data)).not.toEqual(Buffer.from(golden.data));
	});
});
