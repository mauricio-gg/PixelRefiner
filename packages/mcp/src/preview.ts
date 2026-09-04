import type { RawImage } from "../../../src/shared/types";
import { encodePng } from "./io/image-io";
import { choosePreviewScale, scaleNearest } from "./io/scale";

/**
 * プレビューの base64 文字数の上限。
 * [Policy] 1 MB ではなく 256 KiB にする。画像ブロックをテキストとして数えるホストが
 * あると、その時点で Claude Code の既定の MCP 出力上限（25K トークン）を超えてしまい、
 * 応答ごと落とされる。倍率を下げてでも載せ切るほうが、AI が結果を確かめられる。
 */
export const PREVIEW_MAX_BASE64 = 256 * 1024;

export type PreviewResult =
	| {
			included: true;
			scale: number;
			width: number;
			height: number;
			base64: string;
			bytes: number;
	  }
	| { included: false; reason: string };

/**
 * 結果画像から、そのまま画像ブロックに載せられるプレビューを作る。
 * [Intended] 上限を超えたら倍率を半分ずつ下げて作り直す。等倍でも超えるなら載せず、
 * 理由だけを返す（呼び出し側は output.path のファイルを読めば実物を確認できる）。
 */
export const buildPreview = async (image: RawImage): Promise<PreviewResult> => {
	let factor = choosePreviewScale(image.width, image.height);
	for (;;) {
		const scaled = scaleNearest(image, factor);
		const png = await encodePng(scaled);
		const base64 = Buffer.from(
			png.buffer,
			png.byteOffset,
			png.byteLength,
		).toString("base64");
		if (base64.length <= PREVIEW_MAX_BASE64) {
			return {
				included: true,
				scale: factor,
				width: scaled.width,
				height: scaled.height,
				base64,
				bytes: png.byteLength,
			};
		}
		if (factor === 1) {
			return {
				included: false,
				reason:
					`The preview PNG is ${png.byteLength} bytes (${base64.length} base64 characters) ` +
					`even at 1x, over the ${PREVIEW_MAX_BASE64} character cap.`,
			};
		}
		factor = Math.max(1, Math.floor(factor / 2));
	}
};
