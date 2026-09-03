import { describe, expect, it } from "vitest";
import type {
	CandidateSelection,
	ProcessedImageResult,
} from "../../../../src/shared/types";
import {
	type AnalysisReport,
	buildAnalysisReport,
	summarizeReport,
} from "./analysis-report";

const processed = (): ProcessedImageResult => ({
	result: { width: 2, height: 1, data: new Uint8ClampedArray(8) },
	grid: { cellW: 4, cellH: 4, offsetX: 1, offsetY: 2, score: 0.5 },
	extractedPalette: [
		{ r: 15, g: 56, b: 15 },
		{ r: 255, g: 0, b: 171 },
	],
	analysis: {
		classification: "scaled-pixel",
		classificationConfidence: 0.75,
		classificationReasons: ["INTEGER_GRID_STRUCTURE"],
		classificationFeatures: {
			uniqueColorRatio: 0.1,
			flatNeighborRatio: 0.9,
			smoothGradientRatio: 0.2,
			visiblePixelRatio: 0.8,
			gridConfidence: 0.6,
			gridScale: 4,
		},
		route: "refine",
		confidence: 0.62,
		warnings: ["LOW_GRID_CONFIDENCE"],
		gridCandidates: [
			{
				grid: { cellW: 4, cellH: 4, offsetX: 1, offsetY: 2, score: 0.5 },
				outW: 16,
				outH: 16,
				cropX: 0,
				cropY: 0,
				cropW: 64,
				cropH: 64,
				method: "reconstruction",
				totalScore: 12.5,
				confidence: 0.62,
				subscores: { colorBoundary: 0.4, coverage: 0.9 },
			},
		],
		selectedCandidateIndex: 0,
		autoResultCandidateIndex: 0,
		foregroundRatioBefore: 0.5,
		contentLossRatio: 0.01,
		backgroundConfidence: 0.83,
		smallComponentRemoval: {
			mode: "auto",
			applied: true,
			removedComponents: 2,
			removedPixels: 7,
			pixelBasis: "logical",
		},
	},
});

const candidates = (): CandidateSelection[] => [
	{
		id: "auto-result:16x16",
		kind: "auto-result",
		recommended: true,
		processingMode: "auto",
		outW: 16,
		outH: 16,
	},
	{
		id: "cell-scale:half",
		kind: "cell-scale",
		recommended: false,
		processingMode: "refine",
		cellScale: "half",
	},
];

const report = (): AnalysisReport =>
	buildAnalysisReport({
		input: { width: 64, height: 64, format: "png" },
		processed: processed(),
		candidates: candidates(),
		effectiveOptions: { processingMode: "auto", colorCount: 24 },
		resolved: { processingMode: "auto", colorCount: 24, reduceColors: true },
		adjustments: [{ key: "colorCount", requested: 999, applied: 256 }],
	});

describe("buildAnalysisReport", () => {
	it("JSON へ往復しても同じ内容になる", () => {
		const built = report();
		expect(JSON.parse(JSON.stringify(built))).toStrictEqual(built);
	});

	it("入力・経路・警告をそのまま載せる", () => {
		const built = report();
		expect(built.input).toStrictEqual({ width: 64, height: 64, format: "png" });
		expect(built.route).toBe("refine");
		expect(built.confidence).toBeCloseTo(0.62);
		expect(built.warnings).toStrictEqual(["LOW_GRID_CONFIDENCE"]);
		expect(built.selectedCandidateIndex).toBe(0);
		expect(built.autoResultCandidateIndex).toBe(0);
		expect(built.background).toStrictEqual({ confidence: 0.83 });
		expect(built.smallComponentRemoval?.removedComponents).toBe(2);
		expect(built.candidates).toStrictEqual(candidates());
	});

	it("分類の 4 項目を classification へまとめる", () => {
		const built = report();
		expect(built.classification?.kind).toBe("scaled-pixel");
		expect(built.classification?.confidence).toBeCloseTo(0.75);
		expect(built.classification?.reasons).toStrictEqual([
			"INTEGER_GRID_STRUCTURE",
		]);
		expect(built.classification?.features?.gridScale).toBe(4);
	});

	it("グリッド候補を寸法・セル・オフセットへ写す", () => {
		const [candidate] = report().gridCandidates;
		expect(candidate.outW).toBe(16);
		expect(candidate.outH).toBe(16);
		expect(candidate.cellW).toBe(4);
		expect(candidate.cellH).toBe(4);
		expect(candidate.offset).toStrictEqual({ x: 1, y: 2 });
		expect(candidate.method).toBe("reconstruction");
		expect(candidate.totalScore).toBeCloseTo(12.5);
	});

	it("パレットを #rrggbb へ整形する", () => {
		const built = report();
		expect(built.output).toStrictEqual({
			width: 2,
			height: 1,
			colorCount: 2,
			palette: ["#0f380f", "#ff00ab"],
		});
	});

	it("未設定の内容欠落率はキーごと落とす", () => {
		const built = report();
		expect(built.contentLoss).toStrictEqual({
			foregroundRatioBefore: 0.5,
			contentLossRatio: 0.01,
		});
	});

	it("summary では実効設定と候補の内訳スコアを載せない", () => {
		const built = buildAnalysisReport({
			input: { width: 64, height: 64, format: "png" },
			processed: processed(),
			candidates: candidates(),
			effectiveOptions: { processingMode: "auto" },
			resolved: { processingMode: "auto" },
			adjustments: [],
			detail: "summary",
		});
		expect(built.effectiveOptions).toBeUndefined();
		expect(built.resolved).toBeUndefined();
		expect(built.gridCandidates[0].subscores).toBeUndefined();
		expect(JSON.parse(JSON.stringify(built))).toStrictEqual(built);
	});
});

describe("summarizeReport", () => {
	it("full のレポートから full 専用の項目だけを落とす", () => {
		const full = report();
		const summary = summarizeReport(full);
		expect(summary.effectiveOptions).toBeUndefined();
		expect(summary.resolved).toBeUndefined();
		expect(summary.gridCandidates[0].subscores).toBeUndefined();
		expect(summary.adjustments).toStrictEqual(full.adjustments);
		expect(summary.candidates).toStrictEqual(full.candidates);
		// [Intended] 元のレポートは書き換えない。呼び出し側が full を持ち続けられる。
		expect(full.effectiveOptions).toBeDefined();
		expect(full.gridCandidates[0].subscores).toBeDefined();
	});
});
