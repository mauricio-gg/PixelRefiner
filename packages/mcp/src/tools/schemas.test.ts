import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ADVANCED_OPTION_SPECS } from "../engine/option-catalog";
import { advancedSchema } from "./advanced-schema";
import { refineImageInputSchema, settingsSchema } from "./schemas";

/**
 * トークン数の概算。
 * [Policy] 正確なトークナイザは持ち込まず「JSON 4 文字 ≒ 1 トークン」で見積もる。
 * 目的は絶対値の正確さではなく、スキーマが膨らんだことに気付くことなので、
 * 実測より少し多めに出るこの見積もりで十分に働く。
 */
const CHARS_PER_TOKEN = 4;

/**
 * refine_image の入力スキーマの上限。
 * [Policy] ツール一覧は会話ごとに毎回送られるので、ここが膨らむと利用者の文脈を直接削る。
 */
const REFINE_IMAGE_TOKEN_BUDGET = 2500;

const refineImageJsonSchema = () => z.toJSONSchema(refineImageInputSchema);

describe("refineImageInputSchema", () => {
	it("生成される JSON Schema が変わっていない", () => {
		expect(refineImageJsonSchema()).toMatchSnapshot();
	});

	it("トークン予算に収まる", () => {
		const characters = JSON.stringify(refineImageJsonSchema()).length;

		expect(Math.ceil(characters / CHARS_PER_TOKEN)).toBeLessThanOrEqual(
			REFINE_IMAGE_TOKEN_BUDGET,
		);
	});

	it("入力パス以外は省略でき、未知のキーは拒む", () => {
		expect(
			refineImageInputSchema.safeParse({ input: "/tmp/a.png" }).success,
		).toBe(true);
		expect(
			refineImageInputSchema.safeParse({ input: "/tmp/a.png", nope: 1 })
				.success,
		).toBe(false);
	});

	it("既定値を埋める", () => {
		const parsed = refineImageInputSchema.parse({ input: "/tmp/a.png" });

		expect(parsed.scale).toBe(1);
		expect(parsed.overwrite).toBe(false);
		expect(parsed.preview).toBe(true);
		expect(parsed.detail).toBe("summary");
	});
});

describe("advancedSchema", () => {
	it("ADVANCED_OPTION_SPECS と同じキー集合を公開する", () => {
		expect(Object.keys(advancedSchema.shape).sort()).toEqual(
			ADVANCED_OPTION_SPECS.map((spec) => spec.key).sort(),
		);
	});

	it("null は未設定として受け付け、範囲外と未知のキーは拒む", () => {
		expect(advancedSchema.safeParse({ colorCount: null }).success).toBe(true);
		expect(advancedSchema.safeParse({ colorCount: 16 }).success).toBe(true);
		expect(advancedSchema.safeParse({ colorCount: 0 }).success).toBe(false);
		expect(advancedSchema.safeParse({ processingMode: "nope" }).success).toBe(
			false,
		);
		expect(advancedSchema.safeParse({ debugLabel: "x" }).success).toBe(false);
	});
});

describe("settingsSchema", () => {
	it("プリセット・かんたん設定・詳細設定・格子指定を受け付ける", () => {
		const result = settingsSchema.safeParse({
			preset: "crisp-sprite",
			quick: { cellScale: "same", backgroundColor: "#ff00ff" },
			advanced: { colorCount: 16 },
			gridDetection: { mode: "force", width: 32, height: 32 },
		});

		expect(result.success).toBe(true);
	});

	it("未登録のプリセットと不正な色を拒む", () => {
		expect(settingsSchema.safeParse({ preset: "nope" }).success).toBe(false);
		expect(
			settingsSchema.safeParse({ quick: { backgroundColor: "ff00ff" } })
				.success,
		).toBe(false);
	});
});
