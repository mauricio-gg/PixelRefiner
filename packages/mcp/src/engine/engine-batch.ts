import type {
	BatchProcessInput,
	BatchProcessingOptions,
} from "../../../../src/core/batch";
import { needsBatchAttention } from "../../../../src/core/batch";
import type { ProcessingService } from "../../../../src/core/processing-service";
import {
	clampInt,
	PROCESS_DEFAULTS,
	PROCESS_RANGES,
} from "../../../../src/shared/config";
import { DITHER_MODE_VALUES } from "../../../../src/shared/option-values";
import type {
	DitherMode,
	ProcessedImageResult,
	RawImage,
} from "../../../../src/shared/types";
import { encodePng } from "../io/image-io";
import { type AnalysisReport, rgbToHex } from "./analysis-report";
import {
	candidatePlansOf,
	type DecodedInput,
	decodeInput,
	reportOf,
	runCore,
} from "./engine-support";
import { resolveSettings } from "./settings-resolve";
import type {
	EngineErrorCode,
	RefineSettings,
	ResolvedSettings,
} from "./types";
import { EngineInputError, SettingsError } from "./types";

/**
 * 一括処理の共通パレット指定。
 * [Policy] 共通パレットを有効にすると、項目ごとの減色指定（reduceColors / fixedPalette /
 * colorCount）とアウトラインはパレット決定のための下処理では無効になり、最後の減色だけが
 * 共通パレットで行われる（src/core/batch.ts）。並べたときに色が揃うことを優先する指定なので、
 * 1 枚ごとの色設定より強い。
 */
export type BatchSharedPaletteRequest = {
	enabled: boolean;
	colorCount?: number;
	ditherMode?: DitherMode;
	ditherStrength?: number;
};

export type BatchItemRequest = {
	id: string;
	input: Uint8Array;
	settings?: RefineSettings;
};

export type BatchRequest = {
	items: readonly BatchItemRequest[];
	settings?: RefineSettings;
	sharedPalette?: BatchSharedPaletteRequest;
};

export type BatchItemSuccess = {
	id: string;
	status: "done";
	image: RawImage;
	png: Uint8Array;
	report: AnalysisReport;
	/** 格子か分類の信頼度が低く、人が見て確かめたほうがよい結果か。 */
	needsAttention: boolean;
};

export type BatchItemFailure = {
	id: string;
	status: "error";
	error: { code: EngineErrorCode; message: string; hint?: string };
};

export type BatchItemResult = BatchItemSuccess | BatchItemFailure;

export type BatchResult = {
	items: BatchItemResult[];
	/** 共通パレットを使ったときの実際のパレット。#rrggbb の小文字表記。 */
	sharedPalette?: string[];
};

/**
 * 共通設定へ項目ごとの設定を重ねる。
 * [Policy] 重ねるのは RefineSettings の第 1 階層だけ。項目側が preset / quick / advanced /
 * gridDetection のどれかを持つと、その塊ごと共通側と入れ替わる。塊の中身まで混ぜると、
 * 共通設定と項目設定を別々に読んでも実効設定を説明できなくなるため。
 */
const mergeSettings = (
	common: RefineSettings | undefined,
	item: RefineSettings | undefined,
): RefineSettings => ({ ...common, ...item });

const sharedPaletteOptions = (
	spec: BatchSharedPaletteRequest | undefined,
): BatchProcessingOptions => {
	const ditherMode = spec?.ditherMode ?? PROCESS_DEFAULTS.ditherMode;
	if (!DITHER_MODE_VALUES.includes(ditherMode)) {
		throw new SettingsError(
			`sharedPalette.ditherMode must be one of: ${DITHER_MODE_VALUES.join(", ")}.`,
		);
	}
	return {
		sharedPalette: spec?.enabled === true,
		colorCount: clampInt(
			spec?.colorCount ?? PROCESS_DEFAULTS.colorCount,
			PROCESS_RANGES.colorCount,
		),
		ditherMode,
		ditherStrength: clampInt(
			spec?.ditherStrength ?? PROCESS_DEFAULTS.ditherStrength,
			PROCESS_RANGES.ditherStrength,
		),
	};
};

/** デコードまで進めた 1 件。デコードに失敗した項目は失敗のまま並びに残す。 */
type PreparedItem =
	| { status: "ready"; decoded: DecodedInput; settings: ResolvedSettings }
	| { status: "failed"; failure: BatchItemFailure };

/**
 * 1 件分の設定解決とデコードを行う。
 * [Intended] どちらの失敗もその 1 枚の事情なので、並びに失敗として残して残りの処理は続ける。
 * 項目ごとの設定を書き間違えただけで、正しく書けた他の枚数の処理まで捨てさせない。
 * 共通設定の誤りは全項目に効くので、こことは別に呼び出し全体の失敗として扱う。
 */
const prepareItem = async (
	item: BatchItemRequest,
	common: RefineSettings | undefined,
	commonSettings: ResolvedSettings,
): Promise<PreparedItem> => {
	try {
		const settings =
			item.settings === undefined
				? commonSettings
				: resolveSettings(mergeSettings(common, item.settings));
		return {
			status: "ready",
			decoded: await decodeInput(item.input),
			settings,
		};
	} catch (error) {
		if (
			!(error instanceof EngineInputError) &&
			!(error instanceof SettingsError)
		) {
			throw error;
		}
		return {
			status: "failed",
			failure: {
				id: item.id,
				status: "error",
				error: withoutUndefinedHint(error),
			},
		};
	}
};

/** 失敗を JSON にそのまま載る形へ写す。hint が無いときはキーごと落とす。 */
const withoutUndefinedHint = (
	error: EngineInputError | SettingsError,
): BatchItemFailure["error"] =>
	error.hint === undefined
		? { code: error.code, message: error.message }
		: { code: error.code, message: error.message, hint: error.hint };

const successItem = async (
	id: string,
	prepared: Extract<PreparedItem, { status: "ready" }>,
	processed: ProcessedImageResult,
): Promise<BatchItemSuccess> => {
	const candidates = runCore(() =>
		candidatePlansOf(
			prepared.decoded.image,
			processed,
			prepared.settings.options,
		),
	);
	return {
		id,
		status: "done",
		image: processed.result,
		png: await encodePng(processed.result),
		report: reportOf(
			prepared.decoded,
			processed,
			candidates,
			prepared.settings,
		),
		needsAttention: needsBatchAttention(processed.analysis),
	};
};

/**
 * 複数枚をまとめて処理する。
 * [Policy] 共通設定と共通パレットの誤りは呼び出し全体を失敗にする（全項目に効くため）。
 * 項目ごとの設定の誤りとデコードの失敗は、その項目だけを error にして残りは処理を続ける。
 */
export const refineBatchWith = async (
	service: ProcessingService,
	request: BatchRequest,
): Promise<BatchResult> => {
	const batchOptions = sharedPaletteOptions(request.sharedPalette);
	const commonSettings = resolveSettings(request.settings);
	const prepared: PreparedItem[] = [];
	for (let index = 0; index < request.items.length; index += 1) {
		prepared.push(
			await prepareItem(request.items[index], request.settings, commonSettings),
		);
	}

	const inputs: BatchProcessInput[] = [];
	for (let index = 0; index < prepared.length; index += 1) {
		const entry = prepared[index];
		if (entry.status !== "ready") continue;
		inputs.push({
			id: request.items[index].id,
			image: entry.decoded.image,
			options: entry.settings.options,
		});
	}

	const batch = runCore(() => service.processBatch(inputs, batchOptions));
	const items: BatchItemResult[] = [];
	let processedIndex = 0;
	for (let index = 0; index < prepared.length; index += 1) {
		const entry = prepared[index];
		if (entry.status === "failed") {
			items.push(entry.failure);
			continue;
		}
		const result = batch.items[processedIndex];
		processedIndex += 1;
		items.push(
			result.status === "done"
				? await successItem(result.id, entry, result.processResult)
				: {
						id: result.id,
						status: "error",
						error: { code: "ENGINE_ERROR", message: result.error },
					},
		);
	}

	if (batch.sharedPalette === undefined) return { items };
	return { items, sharedPalette: batch.sharedPalette.map(rgbToHex) };
};
