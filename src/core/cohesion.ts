/**
 * cohesion 段階のステップ 1〜3（PixelMagic M4 spec, locked decision 2 と 18）。
 * セルサンプリングが色を見る前に、Oklab で色域をグルーピングして、シェーディングの
 * グラデーションをほぼランダムなセル単位の拾い方から、少数の意図的な帯へ変える。
 * cohesion スパイクの Python 実装（`pipeline.py` の `make_v2` / `merge_small_areas` /
 * `_connected_areas`）の移植であり、一から設計し直したものではない。以下のしきい値は
 * すべてスパイク自身が測定した数値そのもの。
 *
 * ステップ 4（VTracer によるトレース + resvg によるレンダリング、「ターゲットの
 * グリッドサイズちょうどへ描き直す」）は意図的にここへ置かない: このモジュールは
 * `@visioncortex/vtracer` も `@resvg/resvg-wasm` も一切 import しないので、ブラウザの
 * バックグラウンドスレッド（`src/core/worker.ts`）のビルドへ安全に取り込める。
 * 呼び出し側が `CohesionRenderer` を渡す仕組みで、
 * `packages/mcp/src/engine/cohesion-renderer.ts` が実際の Node 専用実装を提供する。
 *
 * `working`（PixelRefiner 自身の原寸・事前背景除去済みのコピー）に対して、
 * `downsample()` の直前で走る。
 */
import type { Oklab, PixelData, RawImage, RGB } from "../shared/types";
import { rgbToOklab } from "./colorUtils";
import { OklabKMeans } from "./oklab-kmeans";

/**
 * この画素数（`working` の原寸ピクセル単位）未満の迷い領域は、最も色が近い隣接領域へ
 * 統合される。ただし MERGE_KEEP_THRESHOLD を超えるほど色が離れていれば「本物の細部」として
 * 残す。スパイク自身の MERGE_MIN_PX（`pipeline.py`）。
 */
const MERGE_MIN_PX = 20;

/**
 * この Oklab ユークリッド距離を超える隣接領域は、小さい領域でも「本物の細部」として
 * 統合せずに残す。スパイク自身の MERGE_KEEP_THRESHOLD（`pipeline.py`）。
 */
const MERGE_KEEP_THRESHOLD = 0.05;

/**
 * トレース＋レンダリング（VTracer + resvg、spec locked decision 2 のステップ 4）を、
 * 呼び出し側が注入する。`rgba` は `working` 自身の原寸解像度（`sourceWidth`/
 * `sourceHeight`）へフラット化した画素列。戻り値の `RawImage` はちょうど
 * `target.width x target.height` でなければならない。
 */
export type CohesionRenderer = (
	rgba: Uint8Array,
	sourceWidth: number,
	sourceHeight: number,
	target: { width: number; height: number },
) => RawImage;

const oklabDistance = (a: Oklab, b: Oklab): number =>
	Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);

/**
 * 画素ごとの色系統 id（完全透明なら -1）。`OklabKMeans` による量子化のうち、同じ結果色へ
 * マッピングされた画素同士が同じ系統になる。`OklabKMeans` は画素ごとの中心 id を公開せず
 * 量子化後の色（`quantize()`）しか返さないため、系統は結果 RGB をキーにして決める。
 * 2 つの異なる中心が偶然同じ RGB へ丸められた場合は 1 つの系統にまとめるが、それらは
 * すでに見た目上同一だったのだから正しい結果である。`pipeline.py` の
 * `KMeans(n_clusters=K_AREAS).fit_predict(opaque_oklab)` とは実装が異なるが、
 * `OklabKMeans` の隣に第二の k-means 実装を持たずに「系統」という概念を再現するための
 * 意図的な簡略化。
 */
const assignFamilies = (pixels: PixelData[], families: number): Int32Array => {
	const quantized = new OklabKMeans(families).quantize(pixels);
	const idByColourKey = new Map<number, number>();
	const ids = new Int32Array(pixels.length);
	for (let i = 0; i < pixels.length; i++) {
		if (pixels[i].alpha === 0) {
			ids[i] = -1;
			continue;
		}
		const p = quantized[i];
		const key = (p.r << 16) | (p.g << 8) | p.b;
		let id = idByColourKey.get(key);
		if (id === undefined) {
			id = idByColourKey.size;
			idByColourKey.set(key, id);
		}
		ids[i] = id;
	}
	return ids;
};

/**
 * `familyIds` の 8 近傍連結成分。すべての系統を 1 つの id 空間で共有する
 * （`skimage.measure.label(cluster_map, background=-1, connectivity=2)` と同じ）。
 * 画素ごとの領域 id を返す。0 は透明、1.. が連結した塊 1 つずつに対応する。
 */
const labelConnectedAreas = (
	familyIds: Int32Array,
	width: number,
	height: number,
): Int32Array => {
	const areaIds = new Int32Array(familyIds.length);
	let nextId = 1;
	const stack: number[] = [];
	for (let start = 0; start < familyIds.length; start++) {
		if (familyIds[start] < 0 || areaIds[start] !== 0) continue;
		const family = familyIds[start];
		const id = nextId++;
		areaIds[start] = id;
		stack.push(start);
		while (stack.length > 0) {
			const idx = stack.pop() as number;
			const x = idx % width;
			const y = Math.floor(idx / width);
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					if (dx === 0 && dy === 0) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
					const nIdx = ny * width + nx;
					if (familyIds[nIdx] !== family || areaIds[nIdx] !== 0) continue;
					areaIds[nIdx] = id;
					stack.push(nIdx);
				}
			}
		}
	}
	return areaIds;
};

/**
 * MERGE_MIN_PX 未満のすべての領域を、最も色が近い生存中の隣接領域へ統合する。ただし
 * その隣接領域が MERGE_KEEP_THRESHOLD より Oklab で遠ければ「本物の細部」として残す。
 * `pipeline.py` の `merge_small_areas` の直接移植 -- 「安定するまで繰り返す」ループも
 * 「最も色が近い生存中の隣接領域を探す」探索も同じ。ただし、小さい領域 1 つごとに画像
 * 全体を再走査する（Python の素直な移植そのままだと `O(小領域数 x 画素数)` になり、
 * スパイクの検証用の小さい素材では問題なくても、迷い領域が何千とある本番のデン素材では
 * 重すぎる）代わりに、1 パスごとに一度だけ「領域 -> 画素インデックス一覧」を作り直す
 * （`O(画素数)`）。[Intended] 同じパス内で先に統合された領域を後続の小領域が見えるよう、
 * 統合のたびにその一覧をその場で更新する。
 */
const mergeSmallAreas = (
	areaIds: Int32Array,
	oklabByPixel: readonly Oklab[],
	width: number,
	height: number,
): Int32Array => {
	const areas = areaIds.slice();
	for (;;) {
		const areaToPixels = new Map<number, number[]>();
		for (let idx = 0; idx < areas.length; idx++) {
			const id = areas[idx];
			if (id === 0) continue;
			const list = areaToPixels.get(id);
			if (list) list.push(idx);
			else areaToPixels.set(id, [idx]);
		}
		const small = [...areaToPixels.entries()]
			.filter(([, px]) => px.length < MERGE_MIN_PX)
			.sort((a, b) => a[1].length - b[1].length)
			.map(([id]) => id);
		if (small.length === 0) break;
		let mergedAny = false;
		for (const areaId of small) {
			const pixelIdxs = areaToPixels.get(areaId);
			if (!pixelIdxs) continue; // このパス内ですでに吸収済み
			const neighbourSums = new Map<number, { sum: Oklab; n: number }>();
			let sumHere: Oklab = { L: 0, a: 0, b: 0 };
			for (const idx of pixelIdxs) {
				const lab = oklabByPixel[idx];
				sumHere = {
					L: sumHere.L + lab.L,
					a: sumHere.a + lab.a,
					b: sumHere.b + lab.b,
				};
				const x = idx % width;
				const y = Math.floor(idx / width);
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
						const nId = areas[ny * width + nx];
						if (nId === 0 || nId === areaId) continue;
						const entry = neighbourSums.get(nId) ?? {
							sum: { L: 0, a: 0, b: 0 },
							n: 0,
						};
						const nLab = oklabByPixel[ny * width + nx];
						entry.sum = {
							L: entry.sum.L + nLab.L,
							a: entry.sum.a + nLab.a,
							b: entry.sum.b + nLab.b,
						};
						entry.n += 1;
						neighbourSums.set(nId, entry);
					}
				}
			}
			if (neighbourSums.size === 0) continue; // 孤立した領域: そのまま残す
			const meanHere = {
				L: sumHere.L / pixelIdxs.length,
				a: sumHere.a / pixelIdxs.length,
				b: sumHere.b / pixelIdxs.length,
			};
			let bestId: number | null = null;
			let bestDist = Number.POSITIVE_INFINITY;
			for (const [nId, { sum, n }] of neighbourSums) {
				const nMean = { L: sum.L / n, a: sum.a / n, b: sum.b / n };
				const dist = oklabDistance(meanHere, nMean);
				if (dist < bestDist) {
					bestDist = dist;
					bestId = nId;
				}
			}
			if (bestId !== null && bestDist <= MERGE_KEEP_THRESHOLD) {
				for (const idx of pixelIdxs) areas[idx] = bestId;
				const target = areaToPixels.get(bestId) ?? [];
				target.push(...pixelIdxs);
				areaToPixels.set(bestId, target);
				areaToPixels.delete(areaId);
				mergedAny = true;
			}
		}
		if (!mergedAny) break;
	}
	return areas;
};

/**
 * 小さく決定論的な 1 次元 k-means。中心の初期値はソート済みの値の等間隔な順序統計量
 * （scikit-learn の k-means++ 系 `random_state=0` によるシード選びとは異なる、意図的な
 * 相違点 -- PR の報告に明記する）。`Math.random` も `Map`/`Set` の反復順に依存する
 * タイブレークも使わないため決定論的。
 */
const kMeans1D = (
	values: number[],
	k: number,
	maxIterations = 20,
): number[] => {
	const sorted = [...values].sort((a, b) => a - b);
	let centroids = Array.from(
		{ length: k },
		(_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)],
	);
	const labels = new Array(values.length).fill(0);
	for (let iter = 0; iter < maxIterations; iter++) {
		let changed = false;
		for (let i = 0; i < values.length; i++) {
			let best = 0;
			let bestDist = Number.POSITIVE_INFINITY;
			for (let c = 0; c < k; c++) {
				const dist = Math.abs(values[i] - centroids[c]);
				if (dist < bestDist) {
					bestDist = dist;
					best = c;
				}
			}
			if (labels[i] !== best) changed = true;
			labels[i] = best;
		}
		const sums = new Array(k).fill(0);
		const counts = new Array(k).fill(0);
		for (let i = 0; i < values.length; i++) {
			sums[labels[i]] += values[i];
			counts[labels[i]] += 1;
		}
		centroids = centroids.map((c, i) =>
			counts[i] > 0 ? sums[i] / counts[i] : c,
		);
		if (!changed) break;
	}
	// 帯の番号を中心の明度順に並べ替え、帯 0 が常に最も暗くなるようにする
	// （見た目のためだけの並べ替えで、どの画素が同じ帯になるかは変えない。
	// `pipeline.py` と同じ）。
	const order = [...centroids.keys()].sort(
		(a, b) => centroids[a] - centroids[b],
	);
	const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
	return labels.map((l) => remap.get(l) as number);
};

/**
 * 領域ごとに: 明度だけで k-means（k = min(tones, 画素数)）、同じ領域・同じ帯の隣接画素
 * だけを数える 5x5 多数決フィルタ、そして各帯の画素は「量子化後の系統色」ではなく
 * 「元の RGB そのもの」の平均を取る -- 出力色が加工前のソース画素から来る点も含めて
 * `pipeline.py` の `make_v2` と一致させている。
 */
const snapTones = (
	rgb: readonly RGB[],
	oklabByPixel: readonly Oklab[],
	areaIds: Int32Array,
	tones: number,
	width: number,
	height: number,
): RGB[] => {
	const out = rgb.map((c) => ({ ...c }));
	const areaToPixels = new Map<number, number[]>();
	for (let idx = 0; idx < areaIds.length; idx++) {
		const id = areaIds[idx];
		if (id === 0) continue;
		const list = areaToPixels.get(id);
		if (list) list.push(idx);
		else areaToPixels.set(id, [idx]);
	}
	for (const [, pixelIdxs] of areaToPixels) {
		const k = Math.min(tones, pixelIdxs.length);
		const lightness = pixelIdxs.map((idx) => oklabByPixel[idx].L);
		const bands = k <= 1 ? pixelIdxs.map(() => 0) : kMeans1D(lightness, k);
		const bandByPixel = new Map<number, number>();
		for (let i = 0; i < pixelIdxs.length; i++) {
			bandByPixel.set(pixelIdxs[i], bands[i]);
		}
		const smoothed = new Map<number, number>();
		for (const idx of pixelIdxs) {
			const x = idx % width;
			const y = Math.floor(idx / width);
			const counts = new Map<number, number>();
			for (let dy = -2; dy <= 2; dy++) {
				for (let dx = -2; dx <= 2; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
					const nBand = bandByPixel.get(ny * width + nx);
					if (nBand === undefined) continue; // 別の領域か透明
					counts.set(nBand, (counts.get(nBand) ?? 0) + 1);
				}
			}
			let bestBand = bandByPixel.get(idx) as number;
			let bestCount = -1;
			for (const [band, count] of counts) {
				if (count > bestCount) {
					bestCount = count;
					bestBand = band;
				}
			}
			smoothed.set(idx, bestBand);
		}
		const bandSums = new Map<
			number,
			{ r: number; g: number; b: number; n: number }
		>();
		for (const idx of pixelIdxs) {
			const band = smoothed.get(idx) as number;
			const entry = bandSums.get(band) ?? { r: 0, g: 0, b: 0, n: 0 };
			entry.r += rgb[idx].r;
			entry.g += rgb[idx].g;
			entry.b += rgb[idx].b;
			entry.n += 1;
			bandSums.set(band, entry);
		}
		for (const idx of pixelIdxs) {
			const band = smoothed.get(idx) as number;
			const { r, g, b, n } = bandSums.get(band) as {
				r: number;
				g: number;
				b: number;
				n: number;
			};
			out[idx] = {
				r: Math.round(r / n),
				g: Math.round(g / n),
				b: Math.round(b / n),
			};
		}
	}
	return out;
};

/**
 * cohesion 段階（spec locked decision 2）: ステップ 1〜3 はここで行い、ステップ 4 は
 * `renderer` へ委譲する。`image` は `working`（またはその切り抜き）の原寸解像度、
 * `target` は cell サンプリングより前に PixelRefiner がすでに知っている出力グリッドの
 * サイズ（強制指定または検出済み）。すでに `target` のサイズになった新しい `RawImage`
 * を返す -- この後段の cell サンプリングは cellW=cellH=1 の素通しになり、スパイク自身の
 * 「1:1 のパレットスナップ」パスとまったく同じ扱いになる。
 *
 * `renderer` が関数でなければ、そのまま `Error` を投げる -- cohesion は黙って no-op に
 * ならない。有効にする呼び出し側は必ず本物のレンダラーを渡さなければならない
 * （locked decision 12）。
 */
export const applyCohesionStage = (
	image: RawImage,
	target: { width: number; height: number },
	families: number,
	tones: number,
	renderer: CohesionRenderer,
): RawImage => {
	if (typeof renderer !== "function") {
		throw new Error(
			"cohesion is enabled but no CohesionRenderer was supplied -- pass " +
				"ProcessOptions.cohesionRenderer (packages/mcp's nodeCohesionRenderer " +
				"in production, a test fake in a test) or set cohesion: false",
		);
	}
	const pixels: PixelData[] = [];
	for (let i = 0; i < image.data.length; i += 4) {
		pixels.push({
			r: image.data[i],
			g: image.data[i + 1],
			b: image.data[i + 2],
			alpha: image.data[i + 3],
		});
	}
	const rgb: RGB[] = pixels.map((p) => ({ r: p.r, g: p.g, b: p.b }));
	const oklabByPixel = rgb.map((c) => rgbToOklab(c));

	const familyIds = assignFamilies(pixels, families);
	const areaIds = labelConnectedAreas(familyIds, image.width, image.height);
	const mergedAreaIds = mergeSmallAreas(
		areaIds,
		oklabByPixel,
		image.width,
		image.height,
	);
	const flattenedRgb = snapTones(
		rgb,
		oklabByPixel,
		mergedAreaIds,
		tones,
		image.width,
		image.height,
	);

	const flattenedRgba = new Uint8Array(image.data.length);
	for (let i = 0; i < pixels.length; i++) {
		// [Policy] 完全透明な画素は RGB もゼロにする。スパイクの `restore_alpha` が
		// 「透明な画素の色をゼロで埋める」のと同じ扱い（`pipeline.py` 参照）。
		// トレーサーへ渡す前に透明部分の残留色を消しておかないと、量子化前の
		// 元画素が持っていた任意の色がそのまま漏れ出し、スパイクの出力と食い違う。
		const alpha = pixels[i].alpha;
		const { r, g, b } = alpha === 0 ? { r: 0, g: 0, b: 0 } : flattenedRgb[i];
		flattenedRgba[i * 4] = r;
		flattenedRgba[i * 4 + 1] = g;
		flattenedRgba[i * 4 + 2] = b;
		flattenedRgba[i * 4 + 3] = alpha;
	}
	return renderer(flattenedRgba, image.width, image.height, target);
};
