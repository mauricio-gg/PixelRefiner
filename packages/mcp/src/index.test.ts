import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	ADVANCED_OPTION_SPECS,
	buildPreview,
	createEngine,
	createLogger,
	listOptions,
	PIXEL_REFINER_MCP_VERSION,
	resolveSettings,
	runAnalyze,
	runBatch,
	runListOptions,
	runRefine,
	SettingsError,
	summarizeReport,
	ToolFailure,
	toToolFailure,
} from "./index";

/**
 * package.json の version。
 * [Intended] 定数側にリテラルを書き写して比べると、両方を直し忘れたときに気付けない。
 * 公開時に効くのは package.json なので、そちらを読んで突き合わせる。
 */
const packageVersion = (): string => {
	const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
	return (JSON.parse(raw) as { version: string }).version;
};

describe("公開エントリーポイント", () => {
	it("公開するバージョンが package.json と一致する", () => {
		expect(PIXEL_REFINER_MCP_VERSION).toBe(packageVersion());
	});

	it("設定解決をエントリーポイントから呼べる", () => {
		const resolved = resolveSettings({});
		expect(resolved.presetId).toBe("auto");
		expect(resolved.adjustments).toEqual([]);
	});

	it("オプションカタログと語彙一覧をエントリーポイントから呼べる", () => {
		expect(ADVANCED_OPTION_SPECS.length).toBeGreaterThan(0);
		expect(listOptions("presets").presets?.length).toBeGreaterThan(0);
	});

	it("設定エラーの型をエントリーポイントから参照できる", () => {
		expect(() => resolveSettings({ preset: "nope" })).toThrow(SettingsError);
	});

	it("エンジンをエントリーポイントから作れる", () => {
		const engine = createEngine();
		expect(typeof engine.refine).toBe("function");
		expect(typeof engine.analyze).toBe("function");
		expect(typeof engine.refineBatch).toBe("function");
		expect(typeof summarizeReport).toBe("function");
	});
});

describe("操作層の公開", () => {
	it("4 つの操作とパス・ログ・プレビューの入口を公開する", () => {
		expect(typeof runRefine).toBe("function");
		expect(typeof runAnalyze).toBe("function");
		expect(typeof runBatch).toBe("function");
		expect(typeof runListOptions).toBe("function");
		expect(typeof buildPreview).toBe("function");
		expect(createLogger("silent").level).toBe("silent");
	});

	it("失敗の型を公開し、エンジンの失敗をそのまま写せる", () => {
		const failure = toToolFailure(new SettingsError("bad preset"));
		expect(failure).toBeInstanceOf(ToolFailure);
		expect(failure.code).toBe("INVALID_SETTINGS");
	});
});
