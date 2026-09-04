import sharp from "sharp";
import type { RawImage } from "../../../../src/shared/types";

// [Policy] MCP サーバーはリクエストのたびに sharp を呼ぶ長寿命プロセスなので、
// キャッシュを有効にすると呼び出しをまたいでメモリが積み上がる。決定的な
// デコード/エンコード結果だけを求めるため、モジュール読み込み時に一度だけ無効化する。
sharp.cache(false);

/** decodeImage が受け付ける最大画素数（64 メガピクセル）。 */
export const MAX_INPUT_PIXELS = 64 * 1024 * 1024;

/** decodeImage が扱える入力拡張子。Task 7 のパスポリシーがこの一覧を消費する。 */
export const SUPPORTED_INPUT_EXTENSIONS = [
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".avif",
] as const;

export type DecodedImage = {
	image: RawImage;
	format: string;
};

/**
 * バイト列を RGBA の RawImage にデコードする。
 * [Intended] .rotate() は EXIF Orientation を焼き込む。ブラウザ版が
 * createImageBitmap に渡すときの向き解決と挙動を揃えるため。
 * [Intended] .ensureAlpha() で常に 4ch にし、GIF/WebP は先頭フレームのみを扱う
 * （animated: false）。
 */
export const decodeImage = async (bytes: Uint8Array): Promise<DecodedImage> => {
	try {
		const pipeline = sharp(bytes, {
			animated: false,
			limitInputPixels: MAX_INPUT_PIXELS,
		});
		const metadata = await pipeline.metadata();
		const { data, info } = await pipeline
			.rotate()
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		// [Intended] 呼び出し側が sharp の内部バッファを共有せず、プレーンなメモリを
		// 自分で所有できるように新しい Uint8ClampedArray へコピーする。
		const owned = new Uint8ClampedArray(data.byteLength);
		owned.set(data);
		return {
			image: { width: info.width, height: info.height, data: owned },
			format: metadata.format ?? "unknown",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Unsupported or corrupt image: ${message}`);
	}
};

/**
 * RawImage を PNG バイト列にエンコードする。
 * [Policy] palette: false は必須。sharp の PNG エンコードは既定でパレット化を
 * 試み、パレット PNG は色を再量子化してしまうため、忠実な往復ができなくなる。
 */
export const encodePng = async (image: RawImage): Promise<Uint8Array> => {
	const raw = Buffer.from(
		image.data.buffer,
		image.data.byteOffset,
		image.data.byteLength,
	);
	const encoded = await sharp(raw, {
		raw: { width: image.width, height: image.height, channels: 4 },
	})
		.png({ compressionLevel: 9, palette: false })
		.toBuffer();
	return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
};
