import {
	CELL_COLOR_CORE_LIMITS,
	SOFT_ALPHA_CELL_LIMITS,
} from "../shared/config";
import type { CellSamplingMode, PixelGrid, RawImage } from "../shared/types";

// [Intended] shared 層が全 union を列挙できるよう、型の定義自体は shared/types.ts へ移した。
// 既存の import 元（image-operations.ts など）を壊さないよう、ここでは再エクスポートする。
export type { CellSamplingMode } from "../shared/types";

type RGBA = [number, number, number, number];

export type CellSamplerOptions = {
	mode: Exclude<CellSamplingMode, "legacy-median">;
	sampleWindow: number;
	maxSamplesPerCell: number;
	alphaThreshold: number;
	preserveThinFeatures: boolean;
};

type CellBounds = {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
};

type CellSamplingContext = {
	cellX: number;
	cellY: number;
	grid: PixelGrid;
};

export interface CellSampler {
	sample(
		image: RawImage,
		cellBounds: CellBounds,
		context: CellSamplingContext,
	): RGBA;
	sampleInto(
		image: RawImage,
		cellBounds: CellBounds,
		context: CellSamplingContext,
		output: Uint8ClampedArray,
		outputOffset: number,
	): void;
}

type Workspace = {
	r: Uint8Array;
	g: Uint8Array;
	b: Uint8Array;
	a: Uint8Array;
	x: Int32Array;
	y: Int32Array;
	weight: Float64Array;
	labL: Float64Array;
	labA: Float64Array;
	labB: Float64Array;
	thinContinuity: Uint8Array;
	/** セル中心寄りの領域（コア）に入るサンプルなら 1。代表色の候補と距離計算に使う。 */
	inCore: Uint8Array;
};

const createWorkspace = (size: number): Workspace => ({
	r: new Uint8Array(size),
	g: new Uint8Array(size),
	b: new Uint8Array(size),
	a: new Uint8Array(size),
	x: new Int32Array(size),
	y: new Int32Array(size),
	weight: new Float64Array(size),
	labL: new Float64Array(size),
	labA: new Float64Array(size),
	labB: new Float64Array(size),
	thinContinuity: new Uint8Array(size),
	inCore: new Uint8Array(size),
});

/**
 * サンプル色の平滑化に使う、サンプラー生成時に 1 回だけ確保する再利用バッファ。
 * `out` はチャンネルごとの中央値 [r, g, b] を書き戻す長さ 3 の使い回し領域。
 */
type SmoothingBuffers = {
	neighborR: Uint8Array;
	neighborG: Uint8Array;
	neighborB: Uint8Array;
	out: Int32Array;
};

/**
 * サンプル色を平滑化する正方近傍の半径（中心から片側への広さ）を求める。
 * 0 以下なら平滑化しない。
 *
 * [Intended] sampleWindow が 3 以下のときは half <= 0 になり、平滑化しない。デフォルト値 3 で
 * 呼び出す既存経路（かんたん設定の既定、ブラウザの詳細設定パネルが常に送る値、
 * test/quality/cases.json が固定する 3・1 のケース）の出力をこの機能追加で変えない、という
 * ハード制約を守るための境界線がここにある。偶数の sampleWindow は floor(sampleWindow/2) により
 * 1 つ上の奇数値と同じ half になる（legacy-median が偶数窓を half = floor(sampleWindow/2) で
 * 扱うのに合わせた）。結果として sampleWindow=4 は 5 と、6 は 7 と、8 は 9 と同じ近傍になり、
 * 4・5→半径1(3x3)、6・7→半径2(5x5)、8・9→半径3(7x7) となる。近傍はつねに
 * x-half..x+half（画像境界でクランプ）の正方形で、中心はずれない。
 */
const colorSmoothingHalf = (sampleWindow: number): number =>
	Math.floor(sampleWindow / 2) - 1;

/** 再利用バッファの中で [0, count) の範囲だけを挿入ソートする（要素数が小さいため十分速い）。 */
const sortRange = (buffer: Uint8Array, count: number): void => {
	for (let i = 1; i < count; i += 1) {
		const value = buffer[i];
		let j = i - 1;
		while (j >= 0 && buffer[j] > value) {
			buffer[j + 1] = buffer[j];
			j -= 1;
		}
		buffer[j + 1] = value;
	}
};

const medianOfBuffer = (buffer: Uint8Array, count: number): number => {
	sortRange(buffer, count);
	const mid = Math.floor(count / 2);
	if (count % 2 === 0) {
		return Math.round((buffer[mid - 1] + buffer[mid]) / 2);
	}
	return buffer[mid];
};

/**
 * サンプル画素 (x, y) の色を、しきい値以上のアルファを持つ近傍だけから
 * チャンネルごとの中央値で平滑化する。結果は `buffers.out` に書き込み、
 * 資格を持つ近傍が1つも無ければ false を返して呼び出し側に元の色を残させる。
 * アルファ自体はここでは扱わない（被覆判定や境界判定を動かさないため）。
 */
const smoothSampleColor = (
	image: RawImage,
	x: number,
	y: number,
	half: number,
	alphaThreshold: number,
	buffers: SmoothingBuffers,
): boolean => {
	const x0 = Math.max(0, x - half);
	const x1 = Math.min(image.width - 1, x + half);
	const y0 = Math.max(0, y - half);
	const y1 = Math.min(image.height - 1, y + half);
	const data = image.data;
	const imgW = image.width;
	let count = 0;
	for (let ny = y0; ny <= y1; ny += 1) {
		const rowOffset = ny * imgW;
		for (let nx = x0; nx <= x1; nx += 1) {
			const offset = (rowOffset + nx) * 4;
			if (data[offset + 3] < alphaThreshold) continue;
			buffers.neighborR[count] = data[offset];
			buffers.neighborG[count] = data[offset + 1];
			buffers.neighborB[count] = data[offset + 2];
			count += 1;
		}
	}
	if (count === 0) return false;
	buffers.out[0] = medianOfBuffer(buffers.neighborR, count);
	buffers.out[1] = medianOfBuffer(buffers.neighborG, count);
	buffers.out[2] = medianOfBuffer(buffers.neighborB, count);
	return true;
};

const srgbToLinear = (value: number): number => {
	const normalized = value / 255;
	return normalized <= 0.04045
		? normalized / 12.92
		: ((normalized + 0.055) / 1.055) ** 2.4;
};

const writePremultipliedOklab = (
	r: number,
	g: number,
	b: number,
	alpha: number,
	workspace: Workspace,
	index: number,
): void => {
	const multiplier = alpha / 255;
	const linearR = srgbToLinear(r) * multiplier;
	const linearG = srgbToLinear(g) * multiplier;
	const linearB = srgbToLinear(b) * multiplier;
	const l =
		0.4122214708 * linearR + 0.5363325363 * linearG + 0.0514459929 * linearB;
	const m =
		0.2119034982 * linearR + 0.6806995451 * linearG + 0.1073969566 * linearB;
	const s =
		0.0883024619 * linearR + 0.2817188501 * linearG + 0.6299787005 * linearB;
	const lRoot = Math.cbrt(l);
	const mRoot = Math.cbrt(m);
	const sRoot = Math.cbrt(s);
	workspace.labL[index] =
		0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
	workspace.labA[index] =
		1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
	workspace.labB[index] =
		0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
};

const colorDistanceSquared = (
	workspace: Workspace,
	left: number,
	right: number,
): number => {
	const deltaL = workspace.labL[left] - workspace.labL[right];
	const deltaA = workspace.labA[left] - workspace.labA[right];
	const deltaB = workspace.labB[left] - workspace.labB[right];
	return deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
};

const pixelOverlap = (start: number, end: number, pixel: number): number =>
	Math.max(0, Math.min(end, pixel + 1) - Math.max(start, pixel));

/**
 * セル内のアルファが、セル自身の被覆ではなく隣接セルからにじんだ裾だけで
 * できているかを判定する。true ならそのセルは透明として扱う。
 *
 * [Intended] 次の条件をすべて満たすことを要求して、ハード境界と一様な半透明を守る。
 * - ランプ状にばらついている（一様な半透明セルは minRampSpan と最大値／最小値の比で除外）
 * - 最大値が不透明に届かない（背景除去由来のハード境界は最大値 255 で除外）
 * - 被覆が半分未満（ブラーは面積を保つので、真に塗られたセルは半分を超える）
 * セル辺長が minCellSize 未満のときは、勾配が元画像の表現である可能性が高いので判定しない。
 */
export const isAlphaBleedOnlyCell = (
	peakAlpha: number,
	floorAlpha: number,
	coverage: number,
	cellWidth: number,
	cellHeight: number,
): boolean =>
	cellWidth >= SOFT_ALPHA_CELL_LIMITS.minCellSize &&
	cellHeight >= SOFT_ALPHA_CELL_LIMITS.minCellSize &&
	peakAlpha - floorAlpha >= SOFT_ALPHA_CELL_LIMITS.minRampSpan &&
	floorAlpha * SOFT_ALPHA_CELL_LIMITS.rampPeakToFloorRatio < peakAlpha &&
	peakAlpha < SOFT_ALPHA_CELL_LIMITS.maxBleedPeak &&
	coverage < SOFT_ALPHA_CELL_LIMITS.maxBleedCoverage;

/** セルの片側から代表色の候補を除外する幅（px）を求める。 */
const coreMargin = (span: number): number =>
	Math.min(
		span * CELL_COLOR_CORE_LIMITS.marginRatio,
		CELL_COLOR_CORE_LIMITS.maxMarginPixels,
		Math.max(0, (span - CELL_COLOR_CORE_LIMITS.minCoreSpan) / 2),
	);

const collectSamples = (
	image: RawImage,
	bounds: CellBounds,
	workspace: Workspace,
	limit: number,
	smoothingHalf: number,
	alphaThreshold: number,
	smoothingBuffers: SmoothingBuffers | null,
): number => {
	const startX = Math.max(0, Math.floor(bounds.x0));
	const startY = Math.max(0, Math.floor(bounds.y0));
	const endX = Math.min(image.width, Math.ceil(bounds.x1));
	const endY = Math.min(image.height, Math.ceil(bounds.y1));
	const width = Math.max(0, endX - startX);
	const height = Math.max(0, endY - startY);
	const total = width * height;
	if (total === 0) return 0;

	const count = Math.min(total, limit);
	const rows = Math.min(
		height,
		Math.max(1, Math.floor(Math.sqrt((count * height) / width))),
	);
	const columns = Math.min(width, Math.max(1, Math.floor(count / rows)));
	const sampledCount = rows * columns;
	const data = image.data;
	// [Intended] セル中心寄りのコアを求め、境界の混色画素を代表色の候補から外す。
	// 中心はつねに含まれるため、どのセルでもコアに 1 サンプル以上が入る。
	const marginX = coreMargin(bounds.x1 - bounds.x0);
	const marginY = coreMargin(bounds.y1 - bounds.y0);
	const coreX0 = bounds.x0 + marginX;
	const coreX1 = bounds.x1 - marginX;
	const coreY0 = bounds.y0 + marginY;
	const coreY1 = bounds.y1 - marginY;
	let sampleIndex = 0;
	for (let row = 0; row < rows; row += 1) {
		const stratumY0 = startY + (row * height) / rows;
		const stratumY1 = startY + ((row + 1) * height) / rows;
		const y = Math.min(endY - 1, Math.floor((stratumY0 + stratumY1) / 2));
		const insideCoreY = y + 0.5 >= coreY0 && y + 0.5 <= coreY1;
		for (let column = 0; column < columns; column += 1) {
			// [Intended] 大セルでも全面を覆うため、2次元格子の各領域から中央点を選ぶ。
			const stratumX0 = startX + (column * width) / columns;
			const stratumX1 = startX + ((column + 1) * width) / columns;
			const x = Math.min(endX - 1, Math.floor((stratumX0 + stratumX1) / 2));
			const sourceOffset = (y * image.width + x) * 4;
			let r = data[sourceOffset];
			let g = data[sourceOffset + 1];
			let b = data[sourceOffset + 2];
			const a = data[sourceOffset + 3];
			// [Intended] 平滑化はこのサンプルの色（Oklab を含め、以降の代表色計算が見る値）
			// だけを置き換える。アルファはここでは触れない — 被覆率やハードアルファの
			// 0/255 判定、にじみ判定を平滑化で動かさないため。
			// [Intended] 細線の連続性判定（hasThinContinuity）は候補の色を隣接セルの生の
			// 元画素と比較するため、平滑化された候補は一致しにくくなり、1px の線を優先
			// しなくなることがある。これは許容する — オプションの説明が「細部がぼやけうる」
			// と warn しているのはこのため。
			if (
				smoothingHalf > 0 &&
				smoothingBuffers &&
				smoothSampleColor(
					image,
					x,
					y,
					smoothingHalf,
					alphaThreshold,
					smoothingBuffers,
				)
			) {
				r = smoothingBuffers.out[0];
				g = smoothingBuffers.out[1];
				b = smoothingBuffers.out[2];
			}
			workspace.r[sampleIndex] = r;
			workspace.g[sampleIndex] = g;
			workspace.b[sampleIndex] = b;
			workspace.a[sampleIndex] = a;
			workspace.x[sampleIndex] = x;
			workspace.y[sampleIndex] = y;
			workspace.inCore[sampleIndex] =
				insideCoreY && x + 0.5 >= coreX0 && x + 0.5 <= coreX1 ? 1 : 0;
			workspace.weight[sampleIndex] =
				total <= limit
					? pixelOverlap(bounds.x0, bounds.x1, x) *
						pixelOverlap(bounds.y0, bounds.y1, y)
					: Math.max(
							0,
							Math.min(bounds.x1, image.width, stratumX1) -
								Math.max(bounds.x0, 0, stratumX0),
						) *
						Math.max(
							0,
							Math.min(bounds.y1, image.height, stratumY1) -
								Math.max(bounds.y0, 0, stratumY0),
						);
			writePremultipliedOklab(r, g, b, a, workspace, sampleIndex);
			sampleIndex += 1;
		}
	}
	return sampledCount;
};

const coverageAlpha = (workspace: Workspace, count: number): number => {
	let weightedAlpha = 0;
	let totalWeight = 0;
	for (let index = 0; index < count; index += 1) {
		const weight = workspace.weight[index];
		weightedAlpha += workspace.a[index] * weight;
		totalWeight += weight;
	}
	return totalWeight > 0 ? Math.round(weightedAlpha / totalWeight) : 0;
};

const writeAreaWeighted = (
	workspace: Workspace,
	count: number,
	output: Uint8ClampedArray,
	offset: number,
): void => {
	let premultipliedR = 0;
	let premultipliedG = 0;
	let premultipliedB = 0;
	let alphaWeight = 0;
	let totalWeight = 0;
	for (let index = 0; index < count; index += 1) {
		const weight = workspace.weight[index];
		const alpha = workspace.a[index] / 255;
		premultipliedR += workspace.r[index] * alpha * weight;
		premultipliedG += workspace.g[index] * alpha * weight;
		premultipliedB += workspace.b[index] * alpha * weight;
		alphaWeight += alpha * weight;
		totalWeight += weight;
	}
	output[offset] = alphaWeight > 0 ? premultipliedR / alphaWeight : 0;
	output[offset + 1] = alphaWeight > 0 ? premultipliedG / alphaWeight : 0;
	output[offset + 2] = alphaWeight > 0 ? premultipliedB / alphaWeight : 0;
	output[offset + 3] =
		totalWeight > 0 ? Math.round((alphaWeight / totalWeight) * 255) : 0;
};

const sourcePixelMatches = (
	image: RawImage,
	x: number,
	y: number,
	workspace: Workspace,
	candidate: number,
	alphaThreshold: number,
): boolean => {
	if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
	const offset = (y * image.width + x) * 4;
	if (image.data[offset + 3] < alphaThreshold) return false;
	const deltaR = image.data[offset] - workspace.r[candidate];
	const deltaG = image.data[offset + 1] - workspace.g[candidate];
	const deltaB = image.data[offset + 2] - workspace.b[candidate];
	return deltaR * deltaR + deltaG * deltaG + deltaB * deltaB <= 192;
};

const lineHasMatch = (
	image: RawImage,
	fixed: number,
	start: number,
	end: number,
	vertical: boolean,
	workspace: Workspace,
	candidate: number,
	alphaThreshold: number,
): boolean => {
	const length = Math.max(1, end - start + 1);
	const probeCount = Math.min(8, length);
	for (let probe = 0; probe < probeCount; probe += 1) {
		const position = start + Math.floor(((probe + 0.5) * length) / probeCount);
		const x = vertical ? fixed : position;
		const y = vertical ? position : fixed;
		if (sourcePixelMatches(image, x, y, workspace, candidate, alphaThreshold)) {
			return true;
		}
	}
	return false;
};

const continuesInNeighborCell = (
	image: RawImage,
	workspace: Workspace,
	candidate: number,
	bounds: CellBounds,
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	horizontal: boolean,
	vertical: boolean,
	alphaThreshold: number,
): boolean => {
	const left = Math.floor(bounds.x0) - 1;
	const right = Math.ceil(bounds.x1);
	const top = Math.floor(bounds.y0) - 1;
	const bottom = Math.ceil(bounds.y1);
	if (
		horizontal &&
		(lineHasMatch(
			image,
			left,
			minY,
			maxY,
			true,
			workspace,
			candidate,
			alphaThreshold,
		) ||
			lineHasMatch(
				image,
				right,
				minY,
				maxY,
				true,
				workspace,
				candidate,
				alphaThreshold,
			))
	) {
		return true;
	}
	if (
		vertical &&
		(lineHasMatch(
			image,
			top,
			minX,
			maxX,
			false,
			workspace,
			candidate,
			alphaThreshold,
		) ||
			lineHasMatch(
				image,
				bottom,
				minX,
				maxX,
				false,
				workspace,
				candidate,
				alphaThreshold,
			))
	) {
		return true;
	}
	if (!horizontal || !vertical) return false;
	return (
		sourcePixelMatches(
			image,
			left,
			top,
			workspace,
			candidate,
			alphaThreshold,
		) ||
		sourcePixelMatches(
			image,
			right,
			top,
			workspace,
			candidate,
			alphaThreshold,
		) ||
		sourcePixelMatches(
			image,
			left,
			bottom,
			workspace,
			candidate,
			alphaThreshold,
		) ||
		sourcePixelMatches(
			image,
			right,
			bottom,
			workspace,
			candidate,
			alphaThreshold,
		)
	);
};

const hasThinContinuity = (
	image: RawImage,
	workspace: Workspace,
	count: number,
	candidate: number,
	bounds: CellBounds,
	alphaThreshold: number,
): boolean => {
	let matching = 0;
	let eligible = 0;
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < count; index += 1) {
		if (workspace.a[index] < alphaThreshold) continue;
		eligible += 1;
		const deltaR = workspace.r[index] - workspace.r[candidate];
		const deltaG = workspace.g[index] - workspace.g[candidate];
		const deltaB = workspace.b[index] - workspace.b[candidate];
		if (deltaR * deltaR + deltaG * deltaG + deltaB * deltaB > 192) continue;
		matching += 1;
		const x = workspace.x[index];
		const y = workspace.y[index];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	if (matching < 2 || eligible === 0 || matching / eligible > 0.45)
		return false;
	const width = Math.max(1, bounds.x1 - bounds.x0);
	const height = Math.max(1, bounds.y1 - bounds.y0);
	const horizontal = (maxX - minX + 1) / width >= 0.65;
	const vertical = (maxY - minY + 1) / height >= 0.65;
	return (
		(horizontal || vertical) &&
		continuesInNeighborCell(
			image,
			workspace,
			candidate,
			bounds,
			minX,
			maxX,
			minY,
			maxY,
			horizontal,
			vertical,
			alphaThreshold,
		)
	);
};

const findMedoid = (
	image: RawImage,
	workspace: Workspace,
	count: number,
	bounds: CellBounds,
	options: CellSamplerOptions,
): number => {
	let eligibleCount = 0;
	for (let index = 0; index < count; index += 1) {
		if (workspace.a[index] >= options.alphaThreshold) eligibleCount += 1;
	}
	const allowAll = eligibleCount === 0;
	// [Intended] コアに使えるサンプルがあるときは、代表色の候補と距離の母集団を
	// そこだけに絞る。境界画素は隣接セルの色と混ざっているため、含めると medoid が
	// 混色へ引き寄せられる。コアが空（画像外へはみ出したセルなど）のときは全域へ戻す。
	let coreCount = 0;
	for (let index = 0; index < count; index += 1) {
		if (
			workspace.inCore[index] !== 0 &&
			(allowAll || workspace.a[index] >= options.alphaThreshold)
		) {
			coreCount += 1;
		}
	}
	const coreOnly = coreCount > 0;
	let bestIndex = 0;
	let bestScore = Number.POSITIVE_INFINITY;
	workspace.thinContinuity.fill(0, 0, count);
	for (let candidate = 0; candidate < count; candidate += 1) {
		if (!allowAll && workspace.a[candidate] < options.alphaThreshold) continue;
		if (coreOnly && workspace.inCore[candidate] === 0) continue;
		let score = 0;
		for (let other = 0; other < count; other += 1) {
			if (!allowAll && workspace.a[other] < options.alphaThreshold) continue;
			if (coreOnly && workspace.inCore[other] === 0) continue;
			const alphaWeight = allowAll ? 1 : workspace.a[other] / 255;
			score +=
				colorDistanceSquared(workspace, candidate, other) *
				workspace.weight[other] *
				alphaWeight;
		}
		const thinScoreFactor = options.mode === "edge-aware" ? 0.1 : 0.2;
		let hasContinuity = false;
		if (options.preserveThinFeatures && score * thinScoreFactor < bestScore) {
			for (let previous = 0; previous < candidate; previous += 1) {
				if (
					workspace.thinContinuity[previous] !== 0 &&
					workspace.r[previous] === workspace.r[candidate] &&
					workspace.g[previous] === workspace.g[candidate] &&
					workspace.b[previous] === workspace.b[candidate]
				) {
					workspace.thinContinuity[candidate] =
						workspace.thinContinuity[previous];
					break;
				}
			}
			if (workspace.thinContinuity[candidate] === 0) {
				workspace.thinContinuity[candidate] = hasThinContinuity(
					image,
					workspace,
					count,
					candidate,
					bounds,
					options.alphaThreshold,
				)
					? 2
					: 1;
			}
			hasContinuity = workspace.thinContinuity[candidate] === 2;
		}
		if (hasContinuity) {
			// [Intended] セルを横断する少数色はノイズではなく線・輪郭として優先する。
			score *= thinScoreFactor;
		}
		if (score < bestScore) {
			bestScore = score;
			bestIndex = candidate;
		}
	}
	return bestIndex;
};

export const createCellSampler = (options: CellSamplerOptions): CellSampler => {
	const sampleLimit = Math.max(1, Math.floor(options.maxSamplesPerCell));
	const workspace = createWorkspace(sampleLimit);
	const smoothingHalf = colorSmoothingHalf(options.sampleWindow);
	const smoothingSide = smoothingHalf > 0 ? smoothingHalf * 2 + 1 : 0;
	// [Intended] 平滑化用バッファはサンプラー生成時に 1 回だけ確保し、セルごと・
	// サンプルごとには確保しない。無効時（half<=0）は null のままにして分岐で外す。
	const smoothingBuffers: SmoothingBuffers | null =
		smoothingSide > 0
			? {
					neighborR: new Uint8Array(smoothingSide * smoothingSide),
					neighborG: new Uint8Array(smoothingSide * smoothingSide),
					neighborB: new Uint8Array(smoothingSide * smoothingSide),
					out: new Int32Array(3),
				}
			: null;
	const sampleInto: CellSampler["sampleInto"] = (
		image,
		bounds,
		_context,
		output,
		offset,
	) => {
		const count = collectSamples(
			image,
			bounds,
			workspace,
			sampleLimit,
			smoothingHalf,
			options.alphaThreshold,
			smoothingBuffers,
		);
		if (count === 0) {
			output.fill(0, offset, offset + 4);
			return;
		}
		const coverage = coverageAlpha(workspace, count);
		let peakAlpha = 0;
		let floorAlpha = 255;
		for (let index = 0; index < count; index += 1) {
			const alpha = workspace.a[index];
			if (alpha > peakAlpha) peakAlpha = alpha;
			if (alpha < floorAlpha) floorAlpha = alpha;
		}
		if (
			isAlphaBleedOnlyCell(
				peakAlpha,
				floorAlpha,
				coverage,
				bounds.x1 - bounds.x0,
				bounds.y1 - bounds.y0,
			)
		) {
			// [Intended] にじみだけのセルは色も採用しない。透明画素のRGBを残すと
			// 後段の背景判定や色抽出へ、元画像に無い色が混入する。
			output.fill(0, offset, offset + 4);
			return;
		}
		if (options.mode === "area-weighted") {
			writeAreaWeighted(workspace, count, output, offset);
			return;
		}
		const medoid = findMedoid(image, workspace, count, bounds, options);
		output[offset] = workspace.r[medoid];
		output[offset + 1] = workspace.g[medoid];
		output[offset + 2] = workspace.b[medoid];
		output[offset + 3] =
			options.mode === "hard-alpha-medoid"
				? coverage >= SOFT_ALPHA_CELL_LIMITS.hardEdgeCoverageThreshold
					? 255
					: 0
				: coverage;
	};
	return {
		sample(image, bounds, context) {
			const output = new Uint8ClampedArray(4);
			sampleInto(image, bounds, context, output, 0);
			return [output[0], output[1], output[2], output[3]];
		},
		sampleInto,
	};
};

export const sampleImageCells = (
	image: RawImage,
	grid: PixelGrid,
	options: CellSamplerOptions,
): RawImage => {
	const cropX = grid.cropX ?? grid.offsetX;
	const cropY = grid.cropY ?? grid.offsetY;
	const outW =
		grid.outW ?? Math.max(1, Math.floor((image.width - cropX) / grid.cellW));
	const outH =
		grid.outH ?? Math.max(1, Math.floor((image.height - cropY) / grid.cellH));
	const output = new Uint8ClampedArray(outW * outH * 4);
	const sampler = createCellSampler(options);
	const bounds: CellBounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
	const context: CellSamplingContext = { cellX: 0, cellY: 0, grid };
	for (let y = 0; y < outH; y += 1) {
		bounds.y0 = cropY + y * grid.cellH;
		bounds.y1 = bounds.y0 + grid.cellH;
		context.cellY = y;
		for (let x = 0; x < outW; x += 1) {
			bounds.x0 = cropX + x * grid.cellW;
			bounds.x1 = bounds.x0 + grid.cellW;
			context.cellX = x;
			sampler.sampleInto(image, bounds, context, output, (y * outW + x) * 4);
		}
	}
	return { width: outW, height: outH, data: output };
};
