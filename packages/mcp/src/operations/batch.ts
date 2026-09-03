import type { AnalysisReport, ReportDetail } from "../engine/analysis-report";
import type {
	BatchItemResult,
	BatchItemSuccess,
	BatchSharedPaletteRequest,
} from "../engine/engine-batch";
import type { RefineSettings } from "../engine/types";
import {
	type FailureValue,
	failureValue,
	type OperationResult,
	ToolFailure,
	toToolFailure,
} from "../failure";
import { resolveOutputPath } from "../paths";
import type { PreviewResult } from "../preview";
import {
	DEFAULT_SUFFIX,
	normalizeScale,
	type OperationDeps,
	type OutputInfo,
	previewOf,
	readInputFile,
	reportAt,
	runOperation,
	writeResultImage,
} from "./shared";

const MAX_INPUTS = 64;

/**
 * プレビューを付ける上限枚数。
 * [Policy] 5 枚以上でプレビューを載せると、1 枚あたり 256 KiB の base64 が積み上がって
 * ホストの応答上限を確実に超える。枚数が多いときは output.path から読んでもらう。
 */
const PREVIEW_ITEM_LIMIT = 4;

export type BatchArgs = {
	inputs: readonly string[];
	/** 未指定なら各入力と同じディレクトリへ書く。 */
	outputDir?: string;
	/** 既定名の接尾辞（既定 ".refined"）。 */
	suffix?: string;
	sharedPalette?: BatchSharedPaletteRequest;
	settings?: RefineSettings;
	scale?: number;
	overwrite?: boolean;
	/** 既定 false。4 枚以下のときだけ効く。 */
	preview?: boolean;
	detail?: ReportDetail;
};

export type BatchItemValueSuccess = {
	id: string;
	status: "done";
	output: OutputInfo;
	report: AnalysisReport;
	needsAttention: boolean;
	preview?: PreviewResult;
};

export type BatchItemValueFailure = {
	id: string;
	status: "error";
	error: FailureValue;
};

export type BatchItemValue = BatchItemValueSuccess | BatchItemValueFailure;

export type BatchValue = {
	items: BatchItemValue[];
	/** 共通パレットを使ったときの実際のパレット。#rrggbb の小文字表記。 */
	sharedPalette?: string[];
	summary: { done: number; failed: number };
};

/** パス検査まで通り、エンジンへ渡せる 1 件。 */
type PreparedInput = {
	index: number;
	id: string;
	output: string;
	bytes: Uint8Array;
};

type PrepareContext = {
	deps: OperationDeps;
	outputDir: string | undefined;
	suffix: string;
	overwrite: boolean;
	/** 既にこの呼び出しの中で確保した出力パス。 */
	claimed: Set<string>;
};

/**
 * 1 件分のパス検査。
 * [Intended] 同じ呼び出しの中で出力先がぶつかった 2 件目は OUTPUT_EXISTS にする。
 * 先に書いた結果を後の 1 件が黙って上書きすると、成功したはずの枚数と残ったファイルが合わない。
 */
const prepareInput = async (
	context: PrepareContext,
	input: string,
	index: number,
): Promise<PreparedInput> => {
	const read = await readInputFile(context.deps.policy, input);
	const output = await resolveOutputPath(context.deps.policy, {
		input: read.path,
		outputDir: context.outputDir,
		overwrite: context.overwrite,
		defaultSuffix: context.suffix,
	});
	if (context.claimed.has(output)) {
		throw new ToolFailure(
			"OUTPUT_EXISTS",
			`${output} is already the output of an earlier input in this batch.`,
			"Give the inputs different names, or split them into separate calls.",
		);
	}
	context.claimed.add(output);
	return { index, id: read.path, bytes: read.bytes, output };
};

/** 書き出しの段で 1 件ごとに要る材料。 */
type SettleContext = {
	deps: OperationDeps;
	detail: ReportDetail | undefined;
	scale: number;
	previewEnabled: boolean;
};

const doneItem = async (
	context: SettleContext,
	prepared: PreparedInput,
	result: BatchItemSuccess,
): Promise<BatchItemValueSuccess> => {
	const output = await writeResultImage(
		prepared.output,
		result.image,
		result.png,
		context.scale,
	);
	const preview = await previewOf(
		context.deps,
		result.image,
		context.previewEnabled,
	);
	const value: BatchItemValueSuccess = {
		id: prepared.id,
		status: "done",
		output,
		report: reportAt(result.report, context.detail),
		needsAttention: result.needsAttention,
	};
	return preview === undefined ? value : { ...value, preview };
};

/**
 * エンジンの結果 1 件を、書き出しまで済ませた項目へ変える。
 * [Intended] 書き出しの失敗（EACCES や ENOSPC など）はその 1 枚の事情なので、ここで
 * 項目の失敗へ写す。外へ投げると呼び出し全体が失敗になり、既に書き終えた他の枚数の
 * 結果まで捨ててしまう（ファイルはディスクに残るのに、どれが書けたか伝わらない）。
 */
const settleItem = async (
	context: SettleContext,
	prepared: PreparedInput,
	result: BatchItemResult,
): Promise<BatchItemValue> => {
	if (result.status !== "done") {
		return { id: result.id, status: "error", error: result.error };
	}
	try {
		return await doneItem(context, prepared, result);
	} catch (error) {
		const failure = toToolFailure(error);
		context.deps.log.warn(
			`${prepared.id}: ${failure.code}: ${failure.message}`,
		);
		return {
			id: prepared.id,
			status: "error",
			error: failureValue(failure),
		};
	}
};

/**
 * 複数枚をまとめて仕上げる。
 * [Policy] パスの失敗はその 1 枚だけの事情なので項目の失敗として残し、残りは処理を続ける。
 * 共通設定と共通パレットの誤りは全項目に効くので、呼び出し全体の失敗にする（エンジンが投げる）。
 */
export const runBatch = (
	deps: OperationDeps,
	args: BatchArgs,
): Promise<OperationResult<BatchValue>> =>
	runOperation(deps.log, async () => {
		const scale = normalizeScale(args.scale);
		const { inputs } = args;
		if (inputs.length < 1 || inputs.length > MAX_INPUTS) {
			throw new ToolFailure(
				"INVALID_SETTINGS",
				`inputs must hold between 1 and ${MAX_INPUTS} paths, but received ${inputs.length}.`,
			);
		}
		const previewEnabled =
			args.preview === true && inputs.length <= PREVIEW_ITEM_LIMIT;
		const context: PrepareContext = {
			deps,
			outputDir: args.outputDir,
			suffix: args.suffix ?? DEFAULT_SUFFIX,
			overwrite: args.overwrite === true,
			claimed: new Set<string>(),
		};

		const items = new Map<number, BatchItemValue>();
		const ready: PreparedInput[] = [];
		for (let index = 0; index < inputs.length; index += 1) {
			try {
				ready.push(await prepareInput(context, inputs[index], index));
			} catch (error) {
				items.set(index, {
					id: inputs[index],
					status: "error",
					error: failureValue(toToolFailure(error)),
				});
			}
		}
		deps.log.info(`batch ${ready.length}/${inputs.length} inputs ready`);

		const batch =
			ready.length === 0
				? { items: [], sharedPalette: undefined }
				: await deps.engine.refineBatch({
						items: ready.map((entry) => ({
							id: entry.id,
							input: entry.bytes,
						})),
						settings: args.settings,
						sharedPalette: args.sharedPalette,
					});
		const settleContext: SettleContext = {
			deps,
			detail: args.detail,
			scale,
			previewEnabled,
		};
		for (let index = 0; index < batch.items.length; index += 1) {
			const prepared = ready[index];
			items.set(
				prepared.index,
				await settleItem(settleContext, prepared, batch.items[index]),
			);
		}

		const ordered: BatchItemValue[] = [];
		let done = 0;
		for (let index = 0; index < inputs.length; index += 1) {
			const entry = items.get(index);
			if (entry === undefined) {
				throw new ToolFailure(
					"ENGINE_ERROR",
					`batch item ${index} produced no result.`,
				);
			}
			if (entry.status === "done") done += 1;
			ordered.push(entry);
		}
		const value: BatchValue = {
			items: ordered,
			summary: { done, failed: ordered.length - done },
		};
		return batch.sharedPalette === undefined
			? value
			: { ...value, sharedPalette: batch.sharedPalette };
	});
