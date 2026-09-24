/**
 * cohesion 段階のステップ 4（VTracer によるトレース + resvg によるレンダリング）の
 * Node 実装。`src/core/cohesion.ts` の `applyCohesionStage` へ `CohesionRenderer` として
 * 注入する -- `src/core/` はどちらのパッケージも import しない（Global Constraints）。
 * これがブラウザ Web Worker のビルドをこのチケットの影響から守っている。
 * トレースの 2 つのパラメータ（speckle filter、colour precision）はここに固定で置き、
 * `ADVANCED_OPTION_SPECS` には絶対に現れない（spec locked decision 7）。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { convertPixels } from "@visioncortex/vtracer";
import type { CohesionRenderer } from "../../../../src/core/cohesion";

/**
 * [Policy] VTracer のトレース設定はスパイクが測定して固定した値そのもの。
 * `mode`/`hierarchical`/`filterSpeckle`/`colorPrecision` のどれも設定として公開しない
 * （spec locked decision 7, Review Focus item 2）。`@visioncortex/vtracer` の `Options`
 * 型には Python 版の `colormode="color"` に相当するフィールドが無く、代わりの
 * `clustering` は既定が `'color-cluster'` で、Python 版の「色ごとにクラスタリングする」
 * 挙動と同等と見なして省略時の既定へ委ねる（未検証の複雑な画像で崩れないかは今後の
 * 実素材での検証待ち -- PR 参照）。
 */
const VTRACER_OPTIONS = {
	mode: "spline" as const,
	hierarchical: "stacked" as const,
	filterSpeckle: 1,
	colorPrecision: 8,
};

const SVG_ROOT_RE =
	/<svg([^>]*?)width="([\d.]+)"([^>]*?)height="([\d.]+)"([^>]*?)>/s;

/**
 * SVG が自己申告する width/height を、target のちょうどのサイズへ書き換える
 * （`pipeline.py` の `_restretch_svg_to_target` の移植）。`@resvg/resvg-wasm` の
 * `fitTo` には縦横を独立に伸縮する「target の WxH ちょうどへ引き伸ばす」モードが無く
 * （`original`/`width`/`height`/`zoom` のみ）、代わりに元の width/height を
 * `viewBox` へ移し `preserveAspectRatio="none"` を付けたうえで、SVG 自身の
 * width/height を target へ書き換える。そうすれば `fitTo: { mode: "original" }` の
 * レンダリングがそのまま target ちょうどの出力になる。
 */
const restretchSvgToTarget = (
	svg: string,
	width: number,
	height: number,
): string => {
	const match = SVG_ROOT_RE.exec(svg);
	if (!match) {
		throw new Error(
			"cohesion: traced SVG has no <svg width=.. height=..> root tag",
		);
	}
	const [full, pre, origW, mid, origH, post] = match;
	const index = match.index;
	return (
		svg.slice(0, index) +
		`<svg${pre}width="${width}"${mid}height="${height}"${post}` +
		` viewBox="0 0 ${origW} ${origH}" preserveAspectRatio="none">` +
		svg.slice(index + full.length)
	);
};

let ready: Promise<void> | null = null;

/**
 * resvg の wasm を一度だけ読み込む。すでにある非同期の地点から呼ぶこと --
 * `packages/mcp/src/engine/engine.ts` の `refine`/`refineWithOptions`、および
 * `engine-batch.ts`（`refineBatchWith`）はすでに `await decodeInput(input)` の周りで
 * async であり、`service.process(...)` を呼ぶ前にここへ来る。`@resvg/resvg-wasm` 自身が
 * 公開している `exports["./index_bg.wasm"]` サブパス（その `package.json` で確認済み）を
 * `createRequire` で解決する。tsdown がこのファイルを `dist/cli.js` へバンドルした後でも
 * この解決は正しく効く -- `import.meta.url` からの相対 `new URL(...)` はソースファイルの
 * 位置をハードコードしてしまい、バンドル後には効かなくなる。
 */
export const ensureCohesionRendererReady = (): Promise<void> => {
	if (!ready) {
		ready = (async () => {
			const wasmPath = createRequire(import.meta.url).resolve(
				"@resvg/resvg-wasm/index_bg.wasm",
			);
			await initWasm(readFileSync(wasmPath));
		})();
	}
	return ready;
};

/**
 * 本番用の `CohesionRenderer`。`ensureCohesionRendererReady()` が解決した後は
 * 純粋に同期の関数になる -- これより下流には何も async にする必要がない。
 * `shapeRendering: 1`（crispEdges）でアンチエイリアスを切る（spec locked decision 2
 * ステップ 4、スパイクの `shape_rendering="crisp_edges"` と同じ）。
 */
export const nodeCohesionRenderer: CohesionRenderer = (
	rgba,
	sourceWidth,
	sourceHeight,
	target,
) => {
	const svg = convertPixels(rgba, sourceWidth, sourceHeight, VTRACER_OPTIONS);
	const restretched = restretchSvgToTarget(svg, target.width, target.height);
	const renderer = new Resvg(restretched, {
		fitTo: { mode: "original" },
		shapeRendering: 1,
	});
	const rendered = renderer.render();
	return {
		width: rendered.width,
		height: rendered.height,
		data: new Uint8ClampedArray(rendered.pixels),
	};
};
