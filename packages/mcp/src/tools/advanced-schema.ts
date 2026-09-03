import { z } from "zod";
import {
	ADVANCED_OPTION_SPECS,
	type AdvancedOptionSpec,
} from "../engine/option-catalog";

/** 色の表記。#rrggbb のみ受け取り、大文字小文字は問わない。 */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * 種別ごとの値の形。
 * [Intended] 表に無い種別を足したときにここで型エラーになるよう、既定の分岐は置かない。
 */
const valueSchema = (spec: AdvancedOptionSpec): z.ZodType => {
	switch (spec.kind) {
		case "int": {
			const base = z.number().int();
			const lower = spec.min === undefined ? base : base.min(spec.min);
			return spec.max === undefined ? lower : lower.max(spec.max);
		}
		case "boolean":
			return z.boolean();
		case "enum":
			return spec.values === undefined ? z.string() : z.enum([...spec.values]);
		case "color":
			return z.string().regex(HEX_COLOR_PATTERN);
		case "palette":
			return z.array(z.string().regex(HEX_COLOR_PATTERN));
		case "string":
			return z.string();
	}
};

const buildShape = (): Record<string, z.ZodType> => {
	const shape: Record<string, z.ZodType> = {};
	for (const spec of ADVANCED_OPTION_SPECS) {
		// [Intended] null は「そのキーを未設定へ戻す」指定。JSON では undefined を
		// 表せず、キーの有無だけでは「触れていない」と区別できないため null を使う。
		// [Policy] キーごとの説明はここには載せない。ツール定義は 4 ツール分が会話ごとに
		// 毎回送られるので、56 個分の散文を入れるとそれだけで数千トークンを占める。名前・
		// 種別・範囲・選択肢はスキーマに残り、説明の全文は list_options が返す。
		shape[spec.key] = valueSchema(spec).nullable().optional();
	}
	return shape;
};

/**
 * 詳細設定のスキーマ。
 * [Policy] ADVANCED_OPTION_SPECS だけから作る。内部専用キー（INTERNAL_OPTION_KEYS）は
 * 表に載っていないので、そのままスキーマにも現れず、AI からは指定できない。
 */
export const advancedSchema = z.strictObject(buildShape());
