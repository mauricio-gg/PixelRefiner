import type { AnalysisReport, ReportDetail } from "../engine/analysis-report";
import type { RefineSettings } from "../engine/types";
import type { OperationResult } from "../failure";
import {
	type OperationDeps,
	readInputFile,
	reportAt,
	runOperation,
} from "./shared";

export type AnalyzeArgs = {
	input: string;
	settings?: RefineSettings;
	detail?: ReportDetail;
};

export type AnalyzeValue = {
	input: { path: string };
	report: AnalysisReport;
};

/**
 * 1 枚を解析するだけで、ファイルは書かない。
 * [Policy] refine より軽く、格子候補と分類だけを先に見たいときの入口。書き出しが無いので
 * 出力パスの検査もしない。
 */
export const runAnalyze = (
	deps: OperationDeps,
	args: AnalyzeArgs,
): Promise<OperationResult<AnalyzeValue>> =>
	runOperation(deps.log, async () => {
		const input = await readInputFile(deps.policy, args.input);
		deps.log.info(`analyze ${input.path}`);
		const result = await deps.engine.analyze(input.bytes, {
			settings: args.settings,
		});
		return {
			input: { path: input.path },
			report: reportAt(result.report, args.detail),
		};
	});
