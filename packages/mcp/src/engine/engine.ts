import {
	createProcessingService,
	type ProcessingService,
} from "../../../../src/core/processing-service";
import type { ProcessOptions } from "../../../../src/core/processor-options";
import type {
	ProcessedImageResult,
	RawImage,
} from "../../../../src/shared/types";
import { encodePng } from "../io/image-io";
import type { AnalysisReport } from "./analysis-report";
import {
	type BatchRequest,
	type BatchResult,
	refineBatchWith,
} from "./engine-batch";
import {
	cacheKeyOf,
	candidatePlansOf,
	decodeInput,
	pickCandidate,
	reportOf,
	runCore,
} from "./engine-support";
import { describeOptions, resolveSettings } from "./settings-resolve";
import type { RefineSettings } from "./types";

export type RefineRequest = {
	settings?: RefineSettings;
	/** 直前の analyze が返した候補の id。指定するとその候補で仕上げる。 */
	candidateId?: string;
};

export type AnalyzeRequest = {
	settings?: RefineSettings;
};

export type RefineResult = {
	/** 論理解像度の結果画像。拡大や再エンコードは呼び出し側の仕事。 */
	image: RawImage;
	png: Uint8Array;
	report: AnalysisReport;
};

export type AnalyzeResult = {
	report: AnalysisReport;
};

/**
 * transport に依存しない画像処理エンジン。
 * [Policy] 入力は常にエンコード済みのバイト列で受け取り、ファイルパスは扱わない。
 * パスの検査と書き出しは operations 層（Task 7）の関心事。
 */
export type PixelRefinerEngine = {
	refine: (input: Uint8Array, request: RefineRequest) => Promise<RefineResult>;
	/**
	 * 設定解決を通さず ProcessOptions をそのまま使う入口。
	 * [Policy] 品質ケースの再現など「UI と同じ設定合成を挟まずに core を呼ぶ」用途だけに使う。
	 * AI へ公開する経路は refine で、こちらは公開しない。
	 */
	refineWithOptions: (
		input: Uint8Array,
		options: ProcessOptions,
	) => Promise<RefineResult>;
	analyze: (
		input: Uint8Array,
		request: AnalyzeRequest,
	) => Promise<AnalyzeResult>;
	refineBatch: (request: BatchRequest) => Promise<BatchResult>;
};

const finish = async (
	processed: ProcessedImageResult,
	report: AnalysisReport,
): Promise<RefineResult> => ({
	image: processed.result,
	png: await encodePng(processed.result),
	report,
});

/**
 * エンジンを 1 つ作る。
 * [Intended] ProcessingService をインスタンスごとに持つので、検出結果と候補結果の
 * キャッシュは同じエンジンを使い回す呼び出しの間だけ共有される。analyze → refine を
 * 同じエンジンで続けたときに、候補の処理をやり直さずに済むのがこの持ち方の目的。
 */
export const createEngine = (): PixelRefinerEngine => {
	const service: ProcessingService = createProcessingService();

	const refine = async (
		input: Uint8Array,
		request: RefineRequest,
	): Promise<RefineResult> => {
		const decoded = await decodeInput(input);
		const settings = resolveSettings(request.settings);
		const { options } = settings;
		const cacheKey = cacheKeyOf(decoded.image, options);
		const base = runCore(() =>
			service.process(decoded.image, options, cacheKey),
		);
		const candidates = runCore(() =>
			candidatePlansOf(decoded.image, base, options),
		);
		const { candidateId } = request;
		const processed =
			candidateId === undefined
				? base
				: runCore(() =>
						service.processCandidate(
							decoded.image,
							options,
							pickCandidate(candidates, candidateId),
							cacheKey,
						),
					);
		const report = reportOf(decoded, processed, candidates, settings);
		return finish(processed, report);
	};

	const refineWithOptions = async (
		input: Uint8Array,
		options: ProcessOptions,
	): Promise<RefineResult> => {
		const decoded = await decodeInput(input);
		// [Policy] debug は AI から指定できないのと同じ理由でここでも無効に固定する。
		const effective: ProcessOptions = { ...options, debug: false };
		const cacheKey = cacheKeyOf(decoded.image, effective);
		const processed = runCore(() =>
			service.process(decoded.image, effective, cacheKey),
		);
		const candidates = runCore(() =>
			candidatePlansOf(decoded.image, processed, effective),
		);
		const settings = { ...describeOptions(effective), adjustments: [] };
		const report = reportOf(decoded, processed, candidates, settings);
		return finish(processed, report);
	};

	const analyze = async (
		input: Uint8Array,
		request: AnalyzeRequest,
	): Promise<AnalyzeResult> => {
		const decoded = await decodeInput(input);
		const settings = resolveSettings(request.settings);
		const { options } = settings;
		const cacheKey = cacheKeyOf(decoded.image, options);
		// [Intended] detectGrid を直接呼ばずに通常の処理を 1 回通す。グリッド検出は背景処理を
		// 済ませた形状に対して走り、分類は auto 経路でしか行われないので、生の入力に対する
		// 検出結果は refine が実際に使う格子と一致しない。
		const processed = runCore(() =>
			service.process(decoded.image, options, cacheKey),
		);
		const candidates = runCore(() =>
			candidatePlansOf(decoded.image, processed, options),
		);
		// [Intended] 候補の実結果をここで作って ProcessingService に残す。直後の
		// refine(candidateId) が処理をやり直さずに済む。プレビュー画像そのものは
		// レポートには載せない（レポートは候補の計画だけを並べる）。
		runCore(() =>
			service.previewCandidates(
				decoded.image,
				options,
				processed.analysis,
				cacheKey,
				{
					result: processed.result,
					colorCount: processed.extractedPalette.length,
				},
			),
		);
		return {
			report: reportOf(decoded, processed, candidates, settings),
		};
	};

	return {
		refine,
		refineWithOptions,
		analyze,
		refineBatch: (request) => refineBatchWith(service, request),
	};
};
