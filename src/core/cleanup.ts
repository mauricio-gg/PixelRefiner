/**
 * 仕上げ段階の後処理ステージ（PixelMagic M4 仕様のロック済み決定 3）。
 *
 * パレット反映済みの完成画像に対して、ドット絵職人の手直しに相当する 4 つの
 * 小さな整形ルールを、この順番で 1 回ずつ適用する:
 *   1. 孤立ピクセルを近傍の多数色に戻す（色が近い場合のみ）
 *   2. 一本線上でのみ発生する「二重コーナー」を均す
 *   3. 平らな境界線上の 1 ピクセルの凹凸を戻す
 *   4. 単調な階段状境界線の中の不揃いな 1 段を均す
 *
 * どのルールも、すでに不透明なピクセルを、画像中にすでに存在する色に
 * 置き換えるだけであり、アルファ値は一切変更しない（新しい色を持ち込まない
 * ことが、このルール集合を安全にしている一番の理由）。cohesion スパイクの
 * `cleanup.py` をそのまま移植したもので、しきい値・定数もそちらに合わせて
 * いる。各ルールは直前のルールの結果を入力として受け取り、自分のパスの中では
 * 常に「そのパスの開始時点の配列」だけを読み、書き込みは別の配列に対して行う
 * （`cleanup.py` の各 `_fix_*` 関数が `codes` を読んで `out` に書くのと同じ
 * 構造）。
 *
 * [Policy] 近傍を走査する順序（NEI_DY/NEI_DX は8近傍、ORTHO_DY/ORTHO_DX は
 * 直交4方向）は、`cleanup.py` の `_neighbours8` / `orthogonal` の生成順と
 * 完全に一致させている。複数の近傍色が同数で並んだときにどれを多数色として
 * 選ぶかは、この走査順によって決まる（Python 側の `Counter.most_common` が
 * 挿入順でタイブレークするのと同じ結果になるようにするため）。順序を変える
 * 移植ミスはテストでは気づきにくいので、触るときは `cleanup.py` と突き合わせて
 * 確認すること。
 */
import type { RawImage, RGB } from "../shared/types";
import { rgbToOklab } from "./colorUtils";

/** ルール1（孤立ピクセル）で近傍色に戻す際の Oklab 距離のしきい値。 */
const LONE_PIXEL_THRESHOLD = 0.06;

/** ルール2（二重コーナー）で「線」とみなすために必要な同色連結成分の最小ピクセル数。 */
const MIN_LINE_GROUP_SIZE = 5;

/** アルファがこの値未満のピクセルは、これらのルールでは「不透明」に数えない。 */
const ALPHA_OPAQUE_THRESHOLD = 128;

/** 透明ピクセルを表す色コードの番兵値。有効な RGB コードは 0 以上にしかならない。 */
const TRANSPARENT_CODE = -1;

/** 8近傍のオフセット。`cleanup.py` の `_neighbours8` と同じ順序（北西, 北, 北東, 西, 東, 南西, 南, 南東）。 */
const NEI_DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const NEI_DX = [-1, 0, 1, -1, 1, -1, 0, 1];

/** 直交4方向のオフセット。`cleanup.py` の `orthogonal` と同じ順序（北, 南, 西, 東）。 */
const ORTHO_DY = [-1, 1, 0, 0];
const ORTHO_DX = [0, 0, -1, 1];

/** ルール3で「平ら」を確認する、基準列から見た左右のオフセット。 */
const FLAT_CHECK_OFFSETS = [-2, -1, 1, 2];

/** ルール4で境界の連なりを追跡し始めるために必要な最小の連なりの長さ。 */
const MIN_CURVE_LENGTH = 5;

const inBounds = (y: number, x: number, width: number, height: number): boolean =>
	y >= 0 && y < height && x >= 0 && x < width;

/** R,G,B（各 0〜255 の整数）を 1 個の整数「色コード」に詰める。 */
const encodeColour = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

/** 色コードを RGB に戻す。`encodeColour` の逆写像。 */
const decodeColour = (code: number): RGB => ({
	r: (code >> 16) & 255,
	g: (code >> 8) & 255,
	b: code & 255,
});

/**
 * `RawImage` を色コードの平面配列（行優先、`width * height` 要素）に変換する。
 * アルファが `ALPHA_OPAQUE_THRESHOLD` 未満のピクセルは `TRANSPARENT_CODE` になる。
 * `cleanup.py` の `_encode` に対応する。
 */
const encodeImage = (image: RawImage): Int32Array => {
	const { width, height, data } = image;
	const codes = new Int32Array(width * height);
	for (let i = 0; i < codes.length; i++) {
		const base = i * 4;
		const alpha = data[base + 3];
		codes[i] =
			alpha < ALPHA_OPAQUE_THRESHOLD
				? TRANSPARENT_CODE
				: encodeColour(data[base], data[base + 1], data[base + 2]);
	}
	return codes;
};

const oklabDistance = (a: RGB, b: RGB): number => {
	const la = rgbToOklab(a);
	const lb = rgbToOklab(b);
	return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b);
};

/**
 * `buf` の先頭 `count` 件のうち最頻値を返す。同数のときは先に現れた値を
 * 優先する（Python の `Counter.most_common` と同じタイブレーク）。
 * 近傍は最大でも8件なので、O(count^2) の総当たりで十分であり、
 * ピクセルごとに `Map` を確保する必要がない。
 */
const majorityOf = (buf: Int32Array, count: number): number => {
	let bestValue = buf[0];
	let bestCount = 0;
	for (let i = 0; i < count; i++) {
		let occurrences = 0;
		for (let j = 0; j < count; j++) {
			if (buf[j] === buf[i]) occurrences++;
		}
		if (occurrences > bestCount) {
			bestCount = occurrences;
			bestValue = buf[i];
		}
	}
	return bestValue;
};

// ルール1で使い回す近傍バッファ。ピクセルごとに新しい配列を確保しないための
// モジュールスコープの作業領域（このモジュールは同期・単一スレッドでしか
// 呼ばれないので使い回して問題ない）。
const loneNeighbourBuffer = new Int32Array(8);

/**
 * ルール1: 内側のピクセル（8近傍すべてが盤面内にある）のうち、8近傍すべてが
 * 不透明で、かつそのどれも自分と同じ色を持たないものを「孤立ピクセル」とみなし、
 * 8近傍の多数色に置き換える。ただし置き換え先の色との Oklab 距離が
 * `LONE_PIXEL_THRESHOLD` 未満のときだけ（離れた色は意図した細部とみなして
 * 触らない）。`cleanup.py` の `_fix_lone_pixels` に対応する。
 */
const fixLonePixels = (codes: Int32Array, width: number, height: number): Int32Array => {
	const out = codes.slice();
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const idx = y * width + x;
			const centre = codes[idx];
			if (centre === TRANSPARENT_CODE) continue;

			let allOpaque = true;
			let hasOwnColour = false;
			for (let k = 0; k < 8; k++) {
				const code = codes[(y + NEI_DY[k]) * width + (x + NEI_DX[k])];
				if (code === TRANSPARENT_CODE) {
					allOpaque = false;
					break;
				}
				loneNeighbourBuffer[k] = code;
				if (code === centre) hasOwnColour = true;
			}
			// 8近傍全部が不透明で、かつ自分と同じ色が1つも無いピクセルだけを判定する。
			if (!allOpaque || hasOwnColour) continue;

			const majority = majorityOf(loneNeighbourBuffer, 8);
			if (majority === centre) continue;
			if (oklabDistance(decodeColour(centre), decodeColour(majority)) < LONE_PIXEL_THRESHOLD) {
				out[idx] = majority;
			}
		}
	}
	return out;
};

type LineComponents = {
	compId: Int32Array;
	sizes: number[];
	has2x2: boolean[];
};

/**
 * 同色の8連結成分を求める。`compId` は各ピクセルの成分番号（透明ピクセルは
 * -1）、`sizes` は成分ごとのピクセル数、`has2x2` は成分内に同色の 2x2 ブロックが
 * 存在するか（＝どこかで幅2ピクセル以上ある＝一本線ではない）を表す。
 * `cleanup.py` の `_line_components` に対応する。成分に番号を振る走査順は
 * Python 版（色ごとに numpy でラベリングする）とは異なるが、どのピクセルが
 * 同じ成分に属するかと、その成分の sizes/has2x2 の対応関係は同じなので、
 * ルール2の判定結果には影響しない。
 */
const lineComponents = (codes: Int32Array, width: number, height: number): LineComponents => {
	const compId = new Int32Array(codes.length).fill(-1);
	const sizes: number[] = [];
	const stack: number[] = [];
	for (let start = 0; start < codes.length; start++) {
		if (codes[start] === TRANSPARENT_CODE || compId[start] !== -1) continue;
		const colour = codes[start];
		const id = sizes.length;
		compId[start] = id;
		let size = 1;
		stack.length = 0;
		stack.push(start);
		while (stack.length > 0) {
			const idx = stack.pop() as number;
			const y = Math.floor(idx / width);
			const x = idx % width;
			for (let k = 0; k < 8; k++) {
				const ny = y + NEI_DY[k];
				const nx = x + NEI_DX[k];
				if (!inBounds(ny, nx, width, height)) continue;
				const nIdx = ny * width + nx;
				if (codes[nIdx] === colour && compId[nIdx] === -1) {
					compId[nIdx] = id;
					size++;
					stack.push(nIdx);
				}
			}
		}
		sizes.push(size);
	}

	const has2x2 = new Array<boolean>(sizes.length).fill(false);
	for (let y = 0; y < height - 1; y++) {
		for (let x = 0; x < width - 1; x++) {
			const idx = y * width + x;
			const v = codes[idx];
			if (v === TRANSPARENT_CODE) continue;
			if (codes[idx + 1] === v && codes[idx + width] === v && codes[idx + width + 1] === v) {
				has2x2[compId[idx]] = true;
			}
		}
	}
	return { compId, sizes, has2x2 };
};

// ルール2で「その他の近傍」の色を集めるための使い回しバッファ（8近傍から
// コーナーを作る2方向を除いた最大6件が入れば足りるが、余裕を見て8件確保する）。
const cornerOtherBuffer = new Int32Array(8);

/**
 * ルール2: 一本線上にだけ現れる「二重コーナー」の折れ角ピクセルを、その線の
 * 残り近傍の多数色に均す。`cleanup.py` の `_fix_doubled_corners` に対応する。
 *
 * 折れ角と認めるのは、中心ピクセルの直交4方向のうちちょうど2方向が同じ色で、
 * かつその2方向が向かい合わせ（北・南、または西・東）ではない（＝直角に
 * 曲がっている）ときだけ。さらに、単なる模様の偶然の L 字と区別するため、
 * 中心ピクセルが属する同色の連結成分が5ピクセル以上あり、どこにも同色の
 * 2x2 ブロックを含まない（＝どこも幅1ピクセルの線である）ことを確認し、
 * かつ2つの同色近傍それぞれが、中心ピクセルともう一方の近傍を除いて
 * さらに同色の近傍を持つ（＝線が折れ角の先で両方向に続いている）ことを
 * 確認する。すべて満たしたときだけ、中心ピクセルを残り近傍の多数色に置き
 * 換える。
 */
const fixDoubledCorners = (codes: Int32Array, width: number, height: number): Int32Array => {
	const out = codes.slice();
	const { compId, sizes, has2x2 } = lineComponents(codes, width, height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			const centre = codes[idx];
			if (centre === TRANSPARENT_CODE) continue;

			let sameCount = 0;
			let firstDir = -1;
			let secondDir = -1;
			for (let k = 0; k < 4; k++) {
				const ny = y + ORTHO_DY[k];
				const nx = x + ORTHO_DX[k];
				if (!inBounds(ny, nx, width, height)) continue;
				if (codes[ny * width + nx] === centre) {
					sameCount++;
					if (firstDir === -1) firstDir = k;
					else secondDir = k;
				}
			}
			if (sameCount !== 2) continue;
			// ORTHO の並びは 北(0), 南(1), 西(2), 東(3)。(北,南) や (西,東) は
			// 向かい合わせで、C がまっすぐ突き抜けているだけであり折れ角ではない。
			if ((firstDir === 0 && secondDir === 1) || (firstDir === 2 && secondDir === 3)) continue;

			const comp = compId[idx];
			if (sizes[comp] < MIN_LINE_GROUP_SIZE || has2x2[comp]) continue;

			let lineContinues = true;
			for (let i = 0; i < 2 && lineContinues; i++) {
				const dir = i === 0 ? firstDir : secondDir;
				const otherDir = i === 0 ? secondDir : firstDir;
				const ny = y + ORTHO_DY[dir];
				const nx = x + ORTHO_DX[dir];
				const otherY = y + ORTHO_DY[otherDir];
				const otherX = x + ORTHO_DX[otherDir];
				let hasExtra = false;
				for (let k = 0; k < 8; k++) {
					const ey = ny + NEI_DY[k];
					const ex = nx + NEI_DX[k];
					if (!inBounds(ey, ex, width, height)) continue;
					if (ey === y && ex === x) continue;
					if (ey === otherY && ex === otherX) continue;
					if (codes[ey * width + ex] === centre) {
						hasExtra = true;
						break;
					}
				}
				if (!hasExtra) lineContinues = false;
			}
			if (!lineContinues) continue;

			const excludeDy1 = ORTHO_DY[firstDir];
			const excludeDx1 = ORTHO_DX[firstDir];
			const excludeDy2 = ORTHO_DY[secondDir];
			const excludeDx2 = ORTHO_DX[secondDir];
			let otherCount = 0;
			for (let k = 0; k < 8; k++) {
				const dy = NEI_DY[k];
				const dx = NEI_DX[k];
				if ((dy === excludeDy1 && dx === excludeDx1) || (dy === excludeDy2 && dx === excludeDx2)) continue;
				const ny = y + dy;
				const nx = x + dx;
				if (!inBounds(ny, nx, width, height)) continue;
				const code = codes[ny * width + nx];
				if (code === TRANSPARENT_CODE) continue;
				cornerOtherBuffer[otherCount] = code;
				otherCount++;
			}
			if (otherCount === 0) continue;
			const majority = majorityOf(cornerOtherBuffer, otherCount);
			if (majority === centre) continue;
			out[idx] = majority;
		}
	}
	return out;
};

/**
 * ルール3、片方の軸: 基準列の1つ左を挟んで左右2列ずつ（合計4列）で
 * 上段=U・下段=L の境界が平らに続いているとき、その基準の1列だけが
 * 上段側または下段側にはみ出していれば、平らな位置に戻す。
 * `cleanup.py` の `_fix_bumps_dents_rows` に対応する。行方向にこの関数を
 * 1回、転置した盤面にもう1回かけることで、縦の境界も同じロジックで扱う
 * （`fixBumpsDents` を参照）。
 */
const fixBumpsDentsRows = (codes: Int32Array, width: number, height: number): Int32Array => {
	const out = codes.slice();
	for (let y = 1; y < height - 1; y++) {
		for (let x = 2; x < width - 2; x++) {
			const refX = x - 1;
			const uRef = codes[(y - 1) * width + refX];
			const lRef = codes[y * width + refX];
			if (uRef === TRANSPARENT_CODE || lRef === TRANSPARENT_CODE || uRef === lRef) continue;

			let flat = true;
			for (let k = 0; k < 4; k++) {
				const cc = x + FLAT_CHECK_OFFSETS[k];
				if (codes[(y - 1) * width + cc] !== uRef || codes[y * width + cc] !== lRef) {
					flat = false;
					break;
				}
			}
			if (!flat) continue;

			const top = codes[(y - 1) * width + x];
			const bot = codes[y * width + x];
			if (top === TRANSPARENT_CODE || bot === TRANSPARENT_CODE) continue;
			if (top === uRef && bot === uRef) {
				out[y * width + x] = lRef; // でっぱり: U が1行はみ出している
			} else if (top === lRef && bot === lRef) {
				out[(y - 1) * width + x] = uRef; // へこみ: L が1行はみ出している
			}
			// それ以外の組み合わせは本物の第三の色であり、1ピクセルの凹凸ではない
			// ので触らない（`cleanup.py` と同じ）。
		}
	}
	return out;
};

/** `codes`（`width` x `height`）を転置した新しい配列を返す。 */
const transposeCodes = (
	codes: Int32Array,
	width: number,
	height: number,
): { codes: Int32Array; width: number; height: number } => {
	const out = new Int32Array(codes.length);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			out[x * height + y] = codes[y * width + x];
		}
	}
	return { codes: out, width: height, height: width };
};

/** ルール3、両方の軸: 行方向のパスをかけ、転置してもう一度かけ、転置を戻す。 */
const fixBumpsDents = (codes: Int32Array, width: number, height: number): Int32Array => {
	const rows = fixBumpsDentsRows(codes, width, height);
	const transposed = transposeCodes(rows, width, height);
	const cols = fixBumpsDentsRows(transposed.codes, transposed.width, transposed.height);
	return transposeCodes(cols, transposed.width, transposed.height).codes;
};

/**
 * ルール4、片方の軸: `c0` 列目の (r0, r0+1) から始まる U/L の境界を、列を
 * 1つずつ右へたどりながら追跡する（境界の行は1列進むごとに高々1しか
 * 動かないとみなす）。`cleanup.py` の `_trace_curves` に対応する。
 * 追跡済みの (行, 列) は `visited` に記録し、二重に追跡しない。
 */
const traceCurve = (
	codes: Int32Array,
	width: number,
	height: number,
	visited: Uint8Array,
	r0: number,
	c0: number,
	u0: number,
	l0: number,
): { cols: number[]; rows: number[] } => {
	const cols = [c0];
	const rows = [r0];
	visited[r0 * width + c0] = 1;
	let r = r0;
	let c = c0 + 1;
	while (c < width) {
		// dr の探索順は cleanup.py の (0, -1, 1) と同じ:
		// まっすぐ、次に1行上、それでもだめなら1行下。
		let found = -1;
		if (r < height - 1 && codes[r * width + c] === u0 && codes[(r + 1) * width + c] === l0) {
			found = r;
		} else if (r - 1 >= 0 && r - 1 < height - 1 && codes[(r - 1) * width + c] === u0 && codes[r * width + c] === l0) {
			found = r - 1;
		} else if (
			r + 1 >= 0 &&
			r + 1 < height - 1 &&
			codes[(r + 1) * width + c] === u0 &&
			codes[(r + 2) * width + c] === l0
		) {
			found = r + 1;
		}
		if (found === -1) break;
		cols.push(c);
		rows.push(found);
		visited[found * width + c] = 1;
		r = found;
		c += 1;
	}
	return { cols, rows };
};

/**
 * ルール4、片方の軸: 単調に動く境界の中で、長さ2以上の段に挟まれた長さ1の
 * 段（かつ前後との差がちょうど1）を、手前の段に併合する。
 * `cleanup.py` の `_fix_uneven_steps_rows` に対応する。
 */
const fixUnevenStepsRows = (codes: Int32Array, width: number, height: number): Int32Array => {
	const out = codes.slice();
	const visited = new Uint8Array(width * height);

	for (let c0 = 0; c0 < width; c0++) {
		for (let r0 = 0; r0 < height - 1; r0++) {
			if (visited[r0 * width + c0]) continue;
			const u0 = codes[r0 * width + c0];
			const l0 = codes[(r0 + 1) * width + c0];
			if (u0 === TRANSPARENT_CODE || l0 === TRANSPARENT_CODE || u0 === l0) continue;

			const { cols, rows } = traceCurve(codes, width, height, visited, r0, c0, u0, l0);
			if (cols.length < MIN_CURVE_LENGTH) continue;

			let allFlat = true;
			let increasing = true; // 差が全部 0 以上
			let decreasing = true; // 差が全部 0 以下
			const diffs: number[] = [];
			for (let i = 1; i < rows.length; i++) {
				const diff = rows[i] - rows[i - 1];
				diffs.push(diff);
				if (diff !== 0) allFlat = false;
				if (diff < 0) increasing = false;
				if (diff > 0) decreasing = false;
			}
			if (allFlat) continue; // 完全に平ら: 均すものが無い
			if (!increasing && !decreasing) continue; // 全体として単調でない: 意図した形とみなす

			const runLengths: number[] = [];
			let curLen = 1;
			for (const diff of diffs) {
				if (diff === 0) curLen++;
				else {
					runLengths.push(curLen);
					curLen = 1;
				}
			}
			runLengths.push(curLen);

			const starts: number[] = [];
			let acc = 0;
			for (const len of runLengths) {
				starts.push(acc);
				acc += len;
			}

			for (let i = 1; i < runLengths.length - 1; i++) {
				if (!(runLengths[i] === 1 && runLengths[i - 1] >= 2 && runLengths[i + 1] >= 2)) continue;
				const col = cols[starts[i]];
				const row = rows[starts[i]];
				const prevRow = rows[starts[i - 1]];
				if (Math.abs(prevRow - row) !== 1) continue; // 本物の1行の段だけを併合する
				if (prevRow > row) {
					// 境界が1行下に動く: 古い境界のすぐ下 (row+1, col) は L だったので U にする
					if (codes[(row + 1) * width + col] === l0) out[(row + 1) * width + col] = u0;
				} else {
					// 境界が1行上に動く: 古い境界の位置 (row, col) は U だったので L にする
					if (codes[row * width + col] === u0) out[row * width + col] = l0;
				}
			}
		}
	}
	return out;
};

/** ルール4、両方の軸: 行方向のパスをかけ、転置してもう一度かけ、転置を戻す。 */
const fixUnevenSteps = (codes: Int32Array, width: number, height: number): Int32Array => {
	const rows = fixUnevenStepsRows(codes, width, height);
	const transposed = transposeCodes(rows, width, height);
	const cols = fixUnevenStepsRows(transposed.codes, transposed.width, transposed.height);
	return transposeCodes(cols, transposed.width, transposed.height).codes;
};

/**
 * 4つのルールをこの順番で1回ずつ適用する。入力画像は変更せず、新しい
 * `RawImage` を返す。変化するのは、いずれかのルールが実際に書き換えた
 * ピクセルの RGB だけで、アルファはすべて元のまま残る。
 */
export const applyCleanupStage = (image: RawImage): RawImage => {
	const { width, height } = image;
	const originalCodes = encodeImage(image);

	let codes = fixLonePixels(originalCodes, width, height);
	codes = fixDoubledCorners(codes, width, height);
	codes = fixBumpsDents(codes, width, height);
	codes = fixUnevenSteps(codes, width, height);

	const out = new Uint8ClampedArray(image.data);
	for (let i = 0; i < codes.length; i++) {
		if (codes[i] === originalCodes[i]) continue;
		const { r, g, b } = decodeColour(codes[i]);
		const base = i * 4;
		out[base] = r;
		out[base + 1] = g;
		out[base + 2] = b;
		// アルファ (out[base + 3]) は image.data のコピーのまま変更しない。
	}
	return { width, height, data: out };
};
