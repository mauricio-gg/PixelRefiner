import type { AnalysisReport, ReportDetail } from "../engine/analysis-report";
import type { RefineSettings } from "../engine/types";
import type { OperationResult } from "../failure";
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

export type RefineArgs = {
	input: string;
	output?: string;
	settings?: RefineSettings;
	/** 直前の analyze が返した候補の id。 */
	candidateId?: string;
	/** 書き出し倍率（1..32、既定 1）。 */
	scale?: number;
	overwrite?: boolean;
	/** 既定 true。結果を AI がその場で確かめられるようにする。 */
	preview?: boolean;
	detail?: ReportDetail;
};

export type RefineValue = {
	output: OutputInfo;
	report: AnalysisReport;
	preview?: PreviewResult;
};

/**
 * 1 枚を仕上げてファイルへ書く。
 * [Intended] 出力パスの検査はデコードより前に済ませる。出力が既にあるだけの失敗に
 * 処理 1 回分の時間を使わせない。
 */
export const runRefine = (
	deps: OperationDeps,
	args: RefineArgs,
): Promise<OperationResult<RefineValue>> =>
	runOperation(deps.log, async () => {
		const scale = normalizeScale(args.scale);
		const input = await readInputFile(deps.policy, args.input);
		const target = await resolveOutputPath(deps.policy, {
			input: input.path,
			output: args.output,
			overwrite: args.overwrite === true,
			defaultSuffix: DEFAULT_SUFFIX,
		});
		deps.log.info(`refine ${input.path} -> ${target}`);
		const result = await deps.engine.refine(input.bytes, {
			settings: args.settings,
			candidateId: args.candidateId,
		});
		const output = await writeResultImage(
			target,
			result.image,
			result.png,
			scale,
		);
		const preview = await previewOf(result.image, args.preview !== false);
		const value: RefineValue = {
			output,
			report: reportAt(result.report, args.detail),
		};
		return preview === undefined ? value : { ...value, preview };
	});
