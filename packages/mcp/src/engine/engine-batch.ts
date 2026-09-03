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
	error: { code: EngineErrorCode; message: string };
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

const prepareItem = async (
	item: BatchItemRequest,
	settings: ResolvedSettings,
): Promise<PreparedItem> => {
	try {
		return {
			status: "ready",
			decoded: await decodeInput(item.input),
			settings,
		};
	} catch (error) {
		if (!(error instanceof EngineInputError)) throw error;
		return {
			status: "failed",
			failure: {
				id: item.id,
				status: "error",
				error: { code: error.code, message: error.message },
			},
		};
	}
};

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
 * [Intended] 設定の解決は 1 枚も処理する前に全項目分を済ませる。設定の指定ミスは呼び出し側の
 * 誤りで、途中まで処理してから伝えても直す手間が増えるだけだから。反対にデコードの失敗は
 * その 1 枚の事情なので、失敗として並びに残し、残りの処理は続ける。
 */
export const refineBatchWith = async (
	service: ProcessingService,
	request: BatchRequest,
): Promise<BatchResult> => {
	const batchOptions = sharedPaletteOptions(request.sharedPalette);
	const resolvedSettings = request.items.map((item) =>
		resolveSettings(mergeSettings(request.settings, item.settings)),
	);
	const prepared: PreparedItem[] = [];
	for (let index = 0; index < request.items.length; index += 1) {
		prepared.push(
			await prepareItem(request.items[index], resolvedSettings[index]),
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
