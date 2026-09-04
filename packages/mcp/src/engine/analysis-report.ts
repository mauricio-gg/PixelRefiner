import type {
	CandidateSelection,
	ClassificationFeatures,
	GridCandidateReport,
	GridCandidateSubscores,
	InputClassification,
	ProcessedImageResult,
	ProcessingRoute,
	ProcessingWarningCode,
	RGB,
	SmallComponentRemovalDiagnostic,
} from "../../../../src/shared/types";
import type { EffectiveOptions, SettingsAdjustment } from "./types";

/**
 * レポートの詳細度。
 * [Policy] エンジンは常に "full" を組み立て、応答量を削るかどうかは transport が決める。
 * 削る側を summarizeReport に閉じ込めておけば、削った項目が増えても呼び出し側は変わらない。
 */
export type ReportDetail = "summary" | "full";

export type ReportInput = {
	width: number;
	height: number;
	/** decodeImage が返した入力形式（"png" など）。 */
	format: string;
};

export type ReportClassification = {
	kind: InputClassification;
	confidence?: number;
	reasons?: readonly string[];
	features?: ClassificationFeatures;
};

/**
 * グリッド候補 1 件。
 * [Intended] core の GridCandidateReport から、選び直しの判断に要る値だけを写す。
 * cropX/cropY/cropW/cropH は入力座標系の内部値なので載せない。
 */
export type ReportGridCandidate = {
	outW: number;
	outH: number;
	cellW: number;
	cellH: number;
	offset: { x: number; y: number };
	method: string;
	totalScore: number;
	confidence: number;
	/** detail が "full" のときだけ載る内訳スコア。 */
	subscores?: Partial<GridCandidateSubscores>;
};

export type ReportContentLoss = {
	foregroundRatioBefore?: number;
	foregroundRatioAfter?: number;
	contentLossRatio?: number;
};

export type ReportOutput = {
	width: number;
	height: number;
	colorCount: number;
	/** 抽出パレット。#rrggbb の小文字表記。 */
	palette: string[];
};

/** JSON にそのまま載せられる解析結果。数値配列や関数は含まない。 */
export type AnalysisReport = {
	input: ReportInput;
	classification?: ReportClassification;
	route: ProcessingRoute;
	confidence: number;
	warnings: ProcessingWarningCode[];
	gridCandidates: ReportGridCandidate[];
	selectedCandidateIndex?: number;
	autoResultCandidateIndex?: number;
	/** 自動背景モデルの信頼度。手動背景指定では未設定。 */
	background?: { confidence: number };
	smallComponentRemoval?: SmallComponentRemovalDiagnostic;
	contentLoss: ReportContentLoss;
	output: ReportOutput;
	/** 選び直せる候補。refine の candidateId にそのまま渡せる id を持つ。 */
	candidates: CandidateSelection[];
	/** detail が "full" のときだけ載る実効設定。 */
	effectiveOptions?: EffectiveOptions;
	/** detail が "full" のときだけ載る正規化済み設定。 */
	resolved?: Record<string, unknown>;
	adjustments: SettingsAdjustment[];
};

export type AnalysisReportInput = {
	input: ReportInput;
	processed: ProcessedImageResult;
	candidates: readonly CandidateSelection[];
	effectiveOptions: EffectiveOptions;
	resolved: Record<string, unknown>;
	adjustments: readonly SettingsAdjustment[];
	/** 省略時は "full"。 */
	detail?: ReportDetail;
};

/**
 * undefined の項目を落とす。
 * [Intended] JSON へ往復しても同じ内容に戻ることがレポートの契約なので、値が無いキーは
 * undefined で残さず消す。JSON.stringify がキーごと落とすため、残すと往復で形が変わる。
 */
const withoutUndefined = <T extends object>(value: T): T => {
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== undefined) output[key] = entry;
	}
	return output as T;
};

const hexComponent = (value: number): string =>
	Math.max(0, Math.min(255, Math.round(value)))
		.toString(16)
		.padStart(2, "0");

/** RGB を "#rrggbb"（小文字）へ整形する。 */
export const rgbToHex = (color: RGB): string =>
	`#${hexComponent(color.r)}${hexComponent(color.g)}${hexComponent(color.b)}`;

const toReportCandidate = (
	candidate: GridCandidateReport,
	detail: ReportDetail,
): ReportGridCandidate =>
	withoutUndefined({
		outW: candidate.outW,
		outH: candidate.outH,
		cellW: candidate.grid.cellW,
		cellH: candidate.grid.cellH,
		offset: { x: candidate.grid.offsetX, y: candidate.grid.offsetY },
		method: candidate.method,
		totalScore: candidate.totalScore,
		confidence: candidate.confidence,
		subscores: detail === "full" ? candidate.subscores : undefined,
	});

const toReportClassification = (
	processed: ProcessedImageResult,
): ReportClassification | undefined => {
	const { analysis } = processed;
	if (analysis.classification === undefined) return undefined;
	return withoutUndefined({
		kind: analysis.classification,
		confidence: analysis.classificationConfidence,
		reasons: analysis.classificationReasons,
		features: analysis.classificationFeatures,
	});
};

/**
 * 選び直し用の候補を JSON へそのまま載る形に整える。
 * [Intended] core の CandidateSelection は省略可能なキーを持つので、値が無いキーが
 * undefined のまま残らないように写し替える。
 */
const toReportSelection = (selection: CandidateSelection): CandidateSelection =>
	withoutUndefined({ ...selection });

/**
 * 処理結果と設定から、AI へ返す解析レポートを組み立てる。
 * [Policy] 入力は core の結果と解決済み設定だけにし、ファイルや transport の都合は持ち込まない。
 */
export const buildAnalysisReport = (
	input: AnalysisReportInput,
): AnalysisReport => {
	const detail = input.detail ?? "full";
	const { analysis, result, extractedPalette } = input.processed;
	return withoutUndefined({
		input: input.input,
		classification: toReportClassification(input.processed),
		route: analysis.route,
		confidence: analysis.confidence,
		warnings: [...analysis.warnings],
		gridCandidates: analysis.gridCandidates.map((candidate) =>
			toReportCandidate(candidate, detail),
		),
		selectedCandidateIndex: analysis.selectedCandidateIndex,
		autoResultCandidateIndex: analysis.autoResultCandidateIndex,
		background:
			analysis.backgroundConfidence === undefined
				? undefined
				: { confidence: analysis.backgroundConfidence },
		smallComponentRemoval:
			analysis.smallComponentRemoval === undefined
				? undefined
				: withoutUndefined<SmallComponentRemovalDiagnostic>({
						...analysis.smallComponentRemoval,
					}),
		contentLoss: withoutUndefined<ReportContentLoss>({
			foregroundRatioBefore: analysis.foregroundRatioBefore,
			foregroundRatioAfter: analysis.foregroundRatioAfter,
			contentLossRatio: analysis.contentLossRatio,
		}),
		output: {
			width: result.width,
			height: result.height,
			colorCount: extractedPalette.length,
			palette: extractedPalette.map(rgbToHex),
		},
		candidates: input.candidates.map(toReportSelection),
		effectiveOptions: detail === "full" ? input.effectiveOptions : undefined,
		resolved: detail === "full" ? input.resolved : undefined,
		adjustments: [...input.adjustments],
	});
};

/**
 * full のレポートから full 専用の項目だけを落とす。元のレポートは書き換えない。
 */
export const summarizeReport = (report: AnalysisReport): AnalysisReport =>
	withoutUndefined({
		...report,
		gridCandidates: report.gridCandidates.map((candidate) =>
			withoutUndefined({ ...candidate, subscores: undefined }),
		),
		effectiveOptions: undefined,
		resolved: undefined,
	});
