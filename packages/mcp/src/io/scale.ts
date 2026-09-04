import { resizeRawImageNearest } from "../../../../src/core/image-operations";
import type { RawImage } from "../../../../src/shared/types";

// [Policy] プレビューは長辺を 512px 以内に収めつつ、拡大は最近傍法の性質上
// 整数倍率でのみブロックが崩れずに再現できるため、512 に収まる最大の整数倍率を選ぶ。
const PREVIEW_MAX_EDGE_PIXELS = 512;

/**
 * 長辺が 512px を超えない範囲で使える最大の整数拡大倍率を返す。
 */
export const choosePreviewScale = (width: number, height: number): number =>
	Math.max(1, Math.floor(PREVIEW_MAX_EDGE_PIXELS / Math.max(width, height)));

/**
 * 画像全体を最近傍法で factor 倍に拡大する。core の resizeRawImageNearest を
 * クロップ=全体・出力=width*factor / height*factor で呼び出すだけの薄いラッパー。
 * [Intended] factor が 1 の場合はコピーを作らず同じオブジェクトをそのまま返す。
 * 呼び出し側はこの戻り値を書き換えてはならない。
 */
export const scaleNearest = (image: RawImage, factor: number): RawImage => {
	if (factor === 1) {
		return image;
	}
	return resizeRawImageNearest(
		image,
		0,
		0,
		image.width,
		image.height,
		image.width * factor,
		image.height * factor,
	);
};
