import { createHash } from "node:crypto";
import { selectCandidatePlans } from "../../../../src/core/candidate-previews";
import { classifyInput } from "../../../../src/core/classifier";
import type { ProcessOptions } from "../../../../src/core/processor-options";
import type {
	CandidateSelection,
	ProcessedImageResult,
	RawImage,
} from "../../../../src/shared/types";
import { decodeImage } from "../io/image-io";
import { type AnalysisReport, buildAnalysisReport } from "./analysis-report";
import type { ResolvedSettings } from "./types";
import { EngineInputError, SettingsError } from "./types";

/** デコード済みの入力。レポートの input 欄はここから作る。 */
export type DecodedInput = {
	image: RawImage;
	format: string;
};

/** レポートへ載せる設定側の 3 項目。resolveSettings の出力から抜き出したもの。 */
export type ReportSettings = Pick<
	ResolvedSettings,
	"effectiveOptions" | "resolved" | "adjustments"
>;

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * バイト列をデコードし、失敗を transport が写せる失敗へ言い換える。
 */
export const decodeInput = async (bytes: Uint8Array): Promise<DecodedInput> => {
	try {
		return await decodeImage(bytes);
	} catch (error) {
		throw new EngineInputError(
			"UNSUPPORTED_INPUT",
			`Could not decode the input image: ${messageOf(error)}`,
			"Pass PNG, JPEG, WebP, GIF or AVIF bytes under 64 megapixels.",
		);
	}
};

/**
 * core の呼び出しで出た想定外の例外を ENGINE_ERROR へ包む。
 * [Policy] 呼び出し側が直せる失敗（設定・入力・候補 ID）はそのまま通す。包んでしまうと
 * 「何を直せばよいか」を伝える code と hint が失われる。
 */
export const runCore = <Value>(run: () => Value): Value => {
	try {
		return run();
	} catch (error) {
		if (error instanceof SettingsError || error instanceof EngineInputError) {
			throw error;
		}
		throw new EngineInputError(
			"ENGINE_ERROR",
			`Image processing failed: ${messageOf(error)}`,
		);
	}
};

/**
 * キー順に依存しない JSON 表記。キャッシュ鍵の材料にする。
 * [Intended] オプションは合成の順序でキーの並びが変わるので、そのまま JSON.stringify
 * すると同じ設定でも別の鍵になる。関数（onDetectedGrid など）は鍵に含めない。
 */
const stableJson = (value: unknown): string => {
	if (typeof value === "function") return "null";
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value)
			.filter(([, entry]) => entry !== undefined && typeof entry !== "function")
			.sort(([left], [right]) => (left < right ? -1 : 1));
		const body = entries
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(",");
		return `{${body}}`;
	}
	return JSON.stringify(value) ?? "null";
};

/**
 * 画素と処理オプションから決まるキャッシュ鍵。
 * [Policy] 同じ鍵なら同じ検出結果・同じ候補結果になることが ProcessingService の前提なので、
 * 鍵には出力を左右する材料（RGBA の中身・寸法・オプション）だけを入れる。ファイル名や
 * 呼び出し順は入れない。
 */
export const cacheKeyOf = (
	image: RawImage,
	options: ProcessOptions,
): string => {
	const hash = createHash("sha1");
	hash.update(`${image.width}x${image.height}`);
	hash.update(
		Buffer.from(
			image.data.buffer,
			image.data.byteOffset,
			image.data.byteLength,
		),
	);
	hash.update(stableJson(options));
	return hash.digest("hex");
};

/**
 * 選び直せる候補の一覧を、UI の候補リストと同じ手順で作る。
 * [Intended] auto 以外の経路では processImage が分類を行わないため、候補計画のためだけに
 * ここで分類を補う（processing-service.ts の previewCandidates と同じ扱い）。
 */
export const candidatePlansOf = (
	image: RawImage,
	processed: ProcessedImageResult,
	options: ProcessOptions,
): CandidateSelection[] => {
	const { analysis } = processed;
	const classification =
		analysis.classification ??
		classifyInput(image, analysis.gridCandidates).classification;
	return selectCandidatePlans(analysis, classification, options.cellScale);
};

/** 候補 ID から候補を引く。知らない ID は選べる ID を並べて突き返す。 */
export const pickCandidate = (
	candidates: readonly CandidateSelection[],
	candidateId: string,
): CandidateSelection => {
	const found = candidates.find((candidate) => candidate.id === candidateId);
	if (found !== undefined) return found;
	const ids = candidates.map((candidate) => candidate.id).join(", ");
	throw new EngineInputError(
		"INVALID_SETTINGS",
		`Unknown candidateId "${candidateId}". Available candidates: ${ids || "(none)"}.`,
		"Call analyze first and pass one of the ids it reports.",
	);
};

/** デコード結果・処理結果・設定から解析レポートを組み立てる。 */
export const reportOf = (
	decoded: DecodedInput,
	processed: ProcessedImageResult,
	candidates: readonly CandidateSelection[],
	settings: ReportSettings,
): AnalysisReport =>
	buildAnalysisReport({
		input: {
			width: decoded.image.width,
			height: decoded.image.height,
			format: decoded.format,
		},
		processed,
		candidates,
		effectiveOptions: settings.effectiveOptions,
		resolved: settings.resolved,
		adjustments: settings.adjustments,
	});
