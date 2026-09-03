import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readHtmlWithIncludes } from "../../scripts/html-includes";
import {
	AUTO_BEHAVIOR_SETTING_VALUES,
	BACKGROUND_REMOVAL_SCOPE_VALUES,
	BG_EXTRACTION_METHOD_VALUES,
	CELL_SAMPLING_MODE_VALUES,
	CELL_SCALE_VALUES,
	CONNECTIVITY_VALUES,
	DETAIL_LEVEL_VALUES,
	DITHER_MODE_VALUES,
	GEMINI_WATERMARK_REMOVAL_MODE_VALUES,
	OUTLINE_STYLE_VALUES,
	PROCESSING_MODE_VALUES,
	REDUCE_COLOR_MODE_VALUES,
	SMALL_COMPONENT_REMOVAL_MODE_VALUES,
} from "../shared/option-values";
import type { AdvancedConvertSizeMode } from "./advanced-processing-controls";
import {
	QUICK_BACKGROUND_VALUES,
	QUICK_DITHERING_VALUES,
	QUICK_REDUCTION_MODE_VALUES,
} from "./quick-settings";
import type { GridDetectionMode } from "./settings-options";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

// [Intended] index.html は partials/ へ分割されているので、ビルドと同じ取り込みを
// 済ませてから走査する。どのパーシャルにある select も検査対象に残すため。
const html = readHtmlWithIncludes(REPO_ROOT, "index.html");

// 型の値集合をそのまま列挙する。値の増減が型エラーになるので取りこぼさない。
const valuesOf = <T extends string>(values: Record<T, true>): string[] =>
	Object.keys(values);

type SelectSpec = {
	/** option 値の突き合わせ先になる値集合 */
	source: readonly string[];
	/** source にはあるが select では公開しない値。理由は各定義のコメントに書く */
	withheld: readonly string[];
};

/**
 * union 型の値集合から突き合わせ先を作る。
 * [Intended] withheld を `readonly T[]` にしているので、型から値が消えると
 * 非公開の指定だけが残ることはなく、その場で型エラーになる。
 * shared 側に実行時配列が無い、この test ファイルにしか出てこないブラウザ専用の union
 * （GridDetectionMode, AdvancedConvertSizeMode）にだけ使う。
 */
const fromType = <T extends string>(
	values: Record<T, true>,
	withheld: readonly T[] = [],
): SelectSpec => ({ source: valuesOf<T>(values), withheld });

/**
 * shared/option-values.ts や quick-settings.ts の実行時配列を突き合わせ先にする。
 * [Intended] これらの配列は元が `Record<T, true>`（valuesOf 経由）で作られているため、
 * union の値が増減すれば定義元で型エラーになる。ここではその配列をそのまま使い回すだけで、
 * ローカルに値を再列挙しない。
 */
const fromValues = (
	source: readonly string[],
	withheld: readonly string[] = [],
): SelectSpec => ({ source, withheld });

const PROCESSING_MODES = fromValues(PROCESSING_MODE_VALUES);

const DETAIL_LEVELS = fromValues(DETAIL_LEVEL_VALUES);

const CELL_SCALES = fromValues(CELL_SCALE_VALUES);

const DITHER_MODES = fromValues(DITHER_MODE_VALUES);

/**
 * 色削減モードの選択肢。レトロパレットの一覧に、パレットを使わない 3 択を足したもの。
 * [Intended] REDUCE_COLOR_MODE_VALUES は shared/config.ts の RETRO_PALETTES から
 * 組み立てているので、パレットの追加を取りこぼさない。
 */
const REDUCE_COLOR_MODES = fromValues(REDUCE_COLOR_MODE_VALUES);

/**
 * 検証対象の select と、option 値の突き合わせ先。
 * [Policy] index.html の select は必ずここか EXCLUDED_SELECTS のどちらかに載せる。
 */
const SELECT_SPECS: Record<string, SelectSpec> = {
	// バッチ設定は共通パレット向けの簡易 UI なので、ベイヤーの各サイズは出さない
	"batch-dither-mode": fromValues(DITHER_MODE_VALUES, [
		"bayer-2x2",
		"bayer-4x4",
		"bayer-8x8",
	]),
	"quick-processing-mode": PROCESSING_MODES,
	"quick-detail-level": DETAIL_LEVELS,
	"quick-cell-scale": CELL_SCALES,
	"quick-reduction-mode": fromValues(QUICK_REDUCTION_MODE_VALUES),
	"quick-background": fromValues(QUICK_BACKGROUND_VALUES),
	"quick-dithering": fromValues(QUICK_DITHERING_VALUES),
	"advanced-processing-mode": PROCESSING_MODES,
	"advanced-convert-size-mode": fromType<AdvancedConvertSizeMode>({
		smallest: true,
		small: true,
		coarse: true,
		balanced: true,
		detailed: true,
		"custom-width": true,
		"custom-height": true,
		"custom-both": true,
	}),
	"reduce-color-mode": REDUCE_COLOR_MODES,
	"dither-mode": DITHER_MODES,
	"outline-style": fromValues(OUTLINE_STYLE_VALUES),
	"grid-detection-mode": fromType<GridDetectionMode>({
		auto: true,
		hint: true,
		force: true,
		off: true,
	}),
	"advanced-cell-scale": CELL_SCALES,
	// area-weighted と edge-aware は内部専用。詳細設定は 3 択として公開している
	"cell-sampling-mode": fromValues(CELL_SAMPLING_MODE_VALUES, [
		"area-weighted",
		"edge-aware",
	]),
	// auto は保存済み設定との互換用で on と同義。選ばせる意味が無いので出さない
	"small-aspect-grid-alignment": fromValues(AUTO_BEHAVIOR_SETTING_VALUES, [
		"auto",
	]),
	"bg-extraction-method": fromValues(BG_EXTRACTION_METHOD_VALUES),
	// off は出さない。背景除去の有無は背景抽出方式の none が持ち、
	// settings-options.ts はそのとき scope を "off" に読み替える
	"advanced-bg-removal-scope": fromValues(BACKGROUND_REMOVAL_SCOPE_VALUES, [
		"off",
	]),
	"bg-connectivity": fromValues(CONNECTIVITY_VALUES),
	"gemini-watermark-removal": fromValues(GEMINI_WATERMARK_REMOVAL_MODE_VALUES),
	"small-component-mode": fromValues(SMALL_COMPONENT_REMOVAL_MODE_VALUES),
	// auto は保存済み設定との互換用で on と同義。選ばせる意味が無いので出さない
	"watermark-sampling-compat": fromValues(AUTO_BEHAVIOR_SETTING_VALUES, [
		"auto",
	]),
};

type ExcludedSelect = {
	/** 突き合わせ先を用意しない理由 */
	reason: string;
};

/**
 * option 値を突き合わせない select と、その理由。
 * [Policy] 検証対象から外すときは必ずここへ理由付きで書く。未対応のまま素通りしている
 * select と区別できなくなるため、「一覧に載っていない select」は常にテストで落とす。
 * [Intended] 除外できるのは index.html に静的な option を持たない select だけ。
 * 静的 option があるなら値を突き合わせられるはずなので、理由を書けば検証を丸ごと
 * 外せる、という抜け道を作らないようテスト側で 0 件であることを確かめる。
 */
const EXCLUDED_SELECTS: Record<string, ExcludedSelect> = {
	"built-in-preset": {
		reason:
			"index.html は空の select だけを置き、preset-controls.ts が BUILT_IN_PRESETS から option を生成する",
	},
};

type HtmlSelect = {
	id: string;
	/** value 属性を持たない option の数。0 でなければ抽出が信用できない */
	optionsWithoutValue: number;
	optionValues: string[];
};

/**
 * [Intended] 属性名の手前は `\b` ではなく空白かタグ先頭で区切る。`\b` は
 * `data-legacy-id` や `data-value` のハイフンの直後でも境界として成立するため、
 * 別の属性の値を id や value として拾ってしまう。
 */
const collectSelects = (source: string): HtmlSelect[] => {
	const selects: HtmlSelect[] = [];
	for (const [, attributes, body] of source.matchAll(
		/<select\b([^>]*)>([\s\S]*?)<\/select>/g,
	)) {
		const values: string[] = [];
		let optionsWithoutValue = 0;
		for (const [tag] of body.matchAll(/<option\b[^>]*>/g)) {
			const value = /(?:^|\s)value="([^"]*)"/.exec(tag)?.[1];
			if (value === undefined) optionsWithoutValue += 1;
			else values.push(value);
		}
		selects.push({
			id: /(?:^|\s)id="([^"]*)"/.exec(attributes)?.[1] ?? "",
			optionsWithoutValue,
			optionValues: values,
		});
	}
	return selects;
};

const selects = collectSelects(html);

const coveredIds = new Set([
	...Object.keys(SELECT_SPECS),
	...Object.keys(EXCLUDED_SELECTS),
]);

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe("index.html の select", () => {
	it("すべて id を持ち、id が重複しない", () => {
		const ids = selects.map((select) => select.id);
		expect(ids.filter((id) => id === "")).toEqual([]);
		expect(sorted(ids)).toEqual(sorted([...new Set(ids)]));
	});

	it("すべての option が value を持ち、select 内で重複しない", () => {
		for (const select of selects) {
			expect(select.optionsWithoutValue, select.id).toBe(0);
			expect(sorted(select.optionValues), select.id).toEqual(
				sorted([...new Set(select.optionValues)]),
			);
		}
	});

	it("すべてが検証対象か明示的な除外のどちらかに属する", () => {
		const uncovered = selects
			.map((select) => select.id)
			.filter((id) => !coveredIds.has(id));
		expect(uncovered).toEqual([]);
	});

	it("一覧に index.html から消えた select が残っていない", () => {
		const ids = new Set(selects.map((select) => select.id));
		expect([...coveredIds].filter((id) => !ids.has(id))).toEqual([]);
	});

	it("option 値が型・定数の値集合と過不足なく一致する", () => {
		for (const select of selects) {
			const spec = SELECT_SPECS[select.id];
			if (!spec) continue;
			const withheld = new Set(spec.withheld);
			const expected = spec.source.filter((value) => !withheld.has(value));
			expect(sorted(select.optionValues), select.id).toEqual(sorted(expected));
		}
	});

	it("非公開に指定した値を型・定数の側が持っている", () => {
		for (const [id, spec] of Object.entries(SELECT_SPECS)) {
			const source = new Set(spec.source);
			expect(
				spec.withheld.filter((value) => !source.has(value)),
				id,
			).toEqual([]);
		}
	});

	it("除外した select が静的な option を持たない", () => {
		for (const select of selects) {
			const excluded = EXCLUDED_SELECTS[select.id];
			if (!excluded) continue;
			expect(excluded.reason, select.id).not.toBe("");
			expect(select.optionValues.length, select.id).toBe(0);
		}
	});
});
