import { readFile } from "node:fs/promises";
import type { RawImage } from "../../../../src/shared/types";
import {
	type AnalysisReport,
	type ReportDetail,
	summarizeReport,
} from "../engine/analysis-report";
import type { PixelRefinerEngine } from "../engine/engine";
import {
	failureValue,
	type OperationResult,
	ToolFailure,
	toToolFailure,
} from "../failure";
import { encodePng } from "../io/image-io";
import { scaleNearest } from "../io/scale";
import type { Logger } from "../log";
import { type PathPolicy, resolveInputPath, writeFileAtomic } from "../paths";
import { buildPreview, type PreviewResult } from "../preview";

/**
 * 操作層の依存。transport（MCP サーバー / CLI）はこれを組み立てて渡すだけで、
 * パス解決と書き出しの作法はすべて操作層に閉じる。
 */
export type OperationDeps = {
	engine: PixelRefinerEngine;
	policy: PathPolicy;
	log: Logger;
	/**
	 * プレビューの作り方の差し替え口。既定は buildPreview。
	 * [Intended] テストが「書き出しは成功したのにプレビューだけ失敗した」状況を決定的に
	 * 作れるようにするための差し替え口で、transport は渡さない。
	 */
	preview?: (image: RawImage) => Promise<PreviewResult>;
};

/** 書き出した結果の説明。path は「AI がホスト側の Read で開ける」唯一の手掛かり。 */
export type OutputInfo = {
	path: string;
	width: number;
	height: number;
	scale: number;
	bytes: number;
};

/** 既定の出力名に足す接尾辞。refine と batch で共通。 */
export const DEFAULT_SUFFIX = ".refined";

const MIN_SCALE = 1;
const MAX_SCALE = 32;

/**
 * 書き出し倍率を確かめる。
 * [Policy] 範囲外は丸めずに拒む。丸めた倍率で書いてしまうと、呼び出し側は指定と違う
 * 大きさの PNG を受け取ったことに気付けない（設定値の丸めと違い、結果物が変わる）。
 */
export const normalizeScale = (scale: number | undefined): number => {
	if (scale === undefined) return MIN_SCALE;
	if (!Number.isInteger(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
		throw new ToolFailure(
			"INVALID_SETTINGS",
			`scale must be an integer between ${MIN_SCALE} and ${MAX_SCALE}, but received ${scale}.`,
		);
	}
	return scale;
};

/** 検査済みの入力パスとそのバイト列。 */
export const readInputFile = async (
	policy: PathPolicy,
	input: string,
): Promise<{ path: string; bytes: Uint8Array }> => {
	const resolved = await resolveInputPath(policy, input);
	return { path: resolved, bytes: new Uint8Array(await readFile(resolved)) };
};

/** detail に応じてレポートを削る。 */
export const reportAt = (
	report: AnalysisReport,
	detail: ReportDetail | undefined,
): AnalysisReport => (detail === "full" ? report : summarizeReport(report));

/**
 * 結果画像を書き出す。
 * [Intended] 等倍のときはエンジンが返した PNG をそのまま使い、再エンコードしない。
 * 拡大は最近傍法なので、論理解像度の画素はそのまま整数倍のブロックになる。
 */
export const writeResultImage = async (
	target: string,
	image: RawImage,
	png: Uint8Array,
	scale: number,
): Promise<OutputInfo> => {
	const scaled = scaleNearest(image, scale);
	const bytes = scale === MIN_SCALE ? png : await encodePng(scaled);
	await writeFileAtomic(target, bytes);
	return {
		path: target,
		width: scaled.width,
		height: scaled.height,
		scale,
		bytes: bytes.byteLength,
	};
};

/**
 * プレビューを作る（要らないときは undefined）。
 * [Policy] 元になるのは論理解像度の画像で、書き出した拡大後の画像ではない。プレビューは
 * 512px に収める都合で自前の倍率を選ぶので、拡大後を渡すと二重に拡大した分だけ粗くなる。
 * [Intended] プレビューの失敗は結果を失わせない。呼ぶのは書き出しが済んだ後なので、ここで
 * 例外を投げると「ファイルはあるのに失敗と伝わり、やり直すと OUTPUT_EXISTS になる」状態に
 * なる。載せられなかった理由だけを返し、実物は output.path から読んでもらう。
 */
export const previewOf = async (
	deps: OperationDeps,
	image: RawImage,
	enabled: boolean,
): Promise<PreviewResult | undefined> => {
	if (!enabled) return undefined;
	try {
		return await (deps.preview ?? buildPreview)(image);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		deps.log.warn(`preview failed: ${reason}`);
		return { included: false, reason: `Preview generation failed: ${reason}` };
	}
};

/**
 * 操作 1 回を包み、想定内の失敗を値へ写す。
 * [Policy] 例外は操作層の外に出さない。MCP は isError、CLI は終了コードへ写す必要があり、
 * どちらも「失敗を含む正常な応答」を組み立てるため。
 */
export const runOperation = async <T>(
	log: Logger,
	run: () => Promise<T>,
): Promise<OperationResult<T>> => {
	try {
		return { ok: true, value: await run() };
	} catch (error) {
		const failure = toToolFailure(error);
		log.warn(`${failure.code}: ${failure.message}`);
		return { ok: false, failure: failureValue(failure) };
	}
};
