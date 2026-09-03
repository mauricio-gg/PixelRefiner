import type { AnalysisReport } from "../engine/analysis-report";
import type { FailureValue } from "../failure";
import type { BatchItemValue, BatchValue } from "../operations/batch";
import type { RefineValue } from "../operations/refine";
import type { OutputInfo } from "../operations/shared";
import type { PreviewResult } from "../preview";

/**
 * テキストブロックへ載せるプレビューの説明。base64 は含まない。
 * [Intended] 画像のバイト列を運ぶのは画像ブロックだけにする。同じ base64 をテキスト
 * ブロックと structuredContent にも入れると、1 回の応答に同じものが 2〜3 回載る。
 * PREVIEW_MAX_BASE64（256 KiB）で上限を置いた意味が消えるうえ、「画像ブロックを
 * テキストとして数えるホストでも収まるように」という前提そのものが崩れる。
 * included / scale / width / height / bytes と、載らなかったときの reason は残すので、
 * 呼び出し側は「プレビューが来たか、来なかったならなぜか」を JSON だけで判断できる。
 */
type PreviewMetadata =
	| {
			included: true;
			scale: number;
			width: number;
			height: number;
			bytes: number;
	  }
	| { included: false; reason: string };

export type RefineMetadata = {
	output: OutputInfo;
	report: AnalysisReport;
	preview?: PreviewMetadata;
};

type BatchItemDoneMetadata = {
	id: string;
	status: "done";
	output: OutputInfo;
	report: AnalysisReport;
	needsAttention: boolean;
	preview?: PreviewMetadata;
};

type BatchItemMetadata =
	| BatchItemDoneMetadata
	| { id: string; status: "error"; error: FailureValue };

export type BatchMetadata = {
	items: BatchItemMetadata[];
	sharedPalette?: string[];
	summary: { done: number; failed: number };
};

const previewMetadata = (preview: PreviewResult): PreviewMetadata =>
	preview.included
		? {
				included: true,
				scale: preview.scale,
				width: preview.width,
				height: preview.height,
				bytes: preview.bytes,
			}
		: preview;

/** refine の結果からテキストブロック用の形を作る。 */
export const refineMetadata = (value: RefineValue): RefineMetadata => {
	const base: RefineMetadata = { output: value.output, report: value.report };
	return value.preview === undefined
		? base
		: { ...base, preview: previewMetadata(value.preview) };
};

const batchItemMetadata = (item: BatchItemValue): BatchItemMetadata => {
	if (item.status === "error") return item;
	const base: BatchItemDoneMetadata = {
		id: item.id,
		status: "done",
		output: item.output,
		report: item.report,
		needsAttention: item.needsAttention,
	};
	return item.preview === undefined
		? base
		: { ...base, preview: previewMetadata(item.preview) };
};

/** batch の結果からテキストブロック用の形を作る。 */
export const batchMetadata = (value: BatchValue): BatchMetadata => {
	const base: BatchMetadata = {
		items: value.items.map(batchItemMetadata),
		summary: value.summary,
	};
	return value.sharedPalette === undefined
		? base
		: { ...base, sharedPalette: value.sharedPalette };
};
