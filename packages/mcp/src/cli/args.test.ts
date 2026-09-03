import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args";

const GLOBAL = { compact: false, verbose: false };

/** --settings を読む口。実ファイルを作らずに中身だけ差し替える。 */
const settingsFile = (json: string) => () => json;

describe("parseCliArgs", () => {
	it("verb が無ければ使い方エラー", () => {
		expect(parseCliArgs([])).toEqual({
			kind: "usage",
			message: expect.stringContaining("verb"),
		});
	});

	it("未知の verb は使い方エラー", () => {
		expect(parseCliArgs(["sharpen", "a.png"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("sharpen"),
		});
	});

	it("--help と --version は verb より先に効く", () => {
		expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
		expect(parseCliArgs(["refine", "a.png", "--help"])).toEqual({
			kind: "help",
		});
		expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
	});

	it("refine の入力・出力・倍率を読む", () => {
		expect(
			parseCliArgs([
				"refine",
				"in.png",
				"--output",
				"out.png",
				"--scale",
				"4",
				"--overwrite",
			]),
		).toEqual({
			kind: "refine",
			global: GLOBAL,
			args: {
				input: "in.png",
				output: "out.png",
				scale: 4,
				overwrite: true,
			},
		});
	});

	it("refine の入力が無ければ使い方エラー", () => {
		expect(parseCliArgs(["refine"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("input"),
		});
	});

	it("refine と analyze は 2 枚目以降を黙って捨てず batch へ誘導する", () => {
		expect(parseCliArgs(["refine", "a.png", "b.png"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("batch"),
		});
		expect(parseCliArgs(["analyze", "a.png", "b.png"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("batch"),
		});
	});

	it("位置引数を取らない verb は余りを断る", () => {
		expect(parseCliArgs(["options", "extra"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("no positional"),
		});
		expect(parseCliArgs(["serve", "extra"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("no positional"),
		});
	});

	it("--no-preview は preview を false にする", () => {
		const parsed = parseCliArgs(["refine", "in.png", "--no-preview"]);

		expect(parsed).toEqual({
			kind: "refine",
			global: GLOBAL,
			args: { input: "in.png", preview: false },
		});
	});

	it("未知のフラグは使い方エラー", () => {
		expect(parseCliArgs(["refine", "in.png", "--sharpen"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("sharpen"),
		});
	});

	it("グローバルフラグを読む", () => {
		const parsed = parseCliArgs(["options", "--compact", "--verbose"]);

		expect(parsed).toEqual({
			kind: "options",
			global: { compact: true, verbose: true },
			args: { section: "all" },
		});
	});

	it("options は節を受け取る", () => {
		expect(parseCliArgs(["options", "--section", "presets"])).toEqual({
			kind: "options",
			global: GLOBAL,
			args: { section: "presets" },
		});
	});

	it("設定フラグを 3 層へ振り分ける", () => {
		const parsed = parseCliArgs([
			"refine",
			"in.png",
			"--preset",
			"crisp-sprite",
			"--quick",
			"cellScale=2",
			"--quick",
			"reductionMode=16",
			"--advanced",
			"colorCount=16",
			"--advanced",
			"reduceColors=true",
			"--grid",
			"force:32x24",
			"--candidate",
			"grid-1",
			"--detail",
			"full",
		]);

		expect(parsed).toEqual({
			kind: "refine",
			global: GLOBAL,
			args: {
				input: "in.png",
				candidateId: "grid-1",
				detail: "full",
				settings: {
					preset: "crisp-sprite",
					// [Intended] かんたん設定の語彙はすべて文字列。"16" を数値にすると弾かれる。
					quick: { cellScale: "2", reductionMode: "16" },
					advanced: { colorCount: 16, reduceColors: true },
					gridDetection: { mode: "force", width: 32, height: 24 },
				},
			},
		});
	});

	it("詳細設定の値をキーの種別に合わせて解釈する", () => {
		const parsed = parseCliArgs([
			"analyze",
			"in.png",
			"--advanced",
			"bgConnectivity=8",
			"--advanced",
			"bgRgb=#112233",
			"--advanced",
			"colorCount=null",
			"--advanced",
			'fixedPalette=["#000000","#ffffff"]',
			"--advanced",
			"unknownKey=42",
		]);

		expect(parsed).toEqual({
			kind: "analyze",
			global: GLOBAL,
			args: {
				input: "in.png",
				settings: {
					advanced: {
						bgConnectivity: "8",
						bgRgb: "#112233",
						colorCount: null,
						fixedPalette: ["#000000", "#ffffff"],
						unknownKey: 42,
					},
				},
			},
		});
	});

	it("key=value の形でなければ使い方エラー", () => {
		expect(parseCliArgs(["refine", "in.png", "--quick", "cellScale"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("key=value"),
		});
	});

	it("--grid の書式を検査する", () => {
		expect(parseCliArgs(["refine", "in.png", "--grid", "off"])).toEqual({
			kind: "refine",
			global: GLOBAL,
			args: { input: "in.png", settings: { gridDetection: { mode: "off" } } },
		});
		expect(parseCliArgs(["refine", "in.png", "--grid", "hint"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("WxH"),
		});
		expect(parseCliArgs(["refine", "in.png", "--grid", "sideways"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("sideways"),
		});
	});

	it("--settings のファイルをフラグが上書きする", () => {
		const parsed = parseCliArgs(
			[
				"refine",
				"in.png",
				"--settings",
				"job.json",
				"--preset",
				"crisp-sprite",
				"--quick",
				"dithering=strong",
			],
			settingsFile(
				'{"preset":"photo-to-pixel","quick":{"dithering":"subtle","cellScale":"2"}}',
			),
		);

		expect(parsed).toEqual({
			kind: "refine",
			global: GLOBAL,
			args: {
				input: "in.png",
				settings: {
					preset: "crisp-sprite",
					quick: { dithering: "strong", cellScale: "2" },
				},
			},
		});
	});

	it("--settings が JSON オブジェクトでなければ使い方エラー", () => {
		expect(
			parseCliArgs(
				["refine", "in.png", "--settings", "job.json"],
				settingsFile("[1,2]"),
			),
		).toEqual({ kind: "usage", message: expect.stringContaining("job.json") });
	});

	it("batch は複数の入力と共通パレットを読む", () => {
		const parsed = parseCliArgs([
			"batch",
			"a.png",
			"b.png",
			"--output-dir",
			"out",
			"--suffix",
			".px",
			"--shared-palette",
			"--palette-colors",
			"4",
			"--palette-dither",
			"bayer-4x4",
			"--palette-dither-strength",
			"30",
			"--scale",
			"2",
			"--preview",
		]);

		expect(parsed).toEqual({
			kind: "batch",
			global: GLOBAL,
			args: {
				inputs: ["a.png", "b.png"],
				outputDir: "out",
				suffix: ".px",
				sharedPalette: {
					enabled: true,
					colorCount: 4,
					ditherMode: "bayer-4x4",
					ditherStrength: 30,
				},
				scale: 2,
				preview: true,
			},
		});
	});

	it("パレット指定だけで --shared-palette が無ければ使い方エラー", () => {
		expect(parseCliArgs(["batch", "a.png", "--palette-colors", "4"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("--shared-palette"),
		});
	});

	it("batch の入力が無ければ使い方エラー", () => {
		expect(parseCliArgs(["batch"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("inputs"),
		});
	});

	it("数値フラグと列挙フラグを検査する", () => {
		expect(parseCliArgs(["refine", "in.png", "--scale", "x2"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("--scale"),
		});
		expect(parseCliArgs(["refine", "in.png", "--detail", "verbose"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("--detail"),
		});
		expect(parseCliArgs(["serve", "--compat", "loose"])).toEqual({
			kind: "usage",
			message: expect.stringContaining("--compat"),
		});
	});

	it("serve は互換モードと詳細ログを読む", () => {
		expect(parseCliArgs(["serve", "--compat", "minimal", "--verbose"])).toEqual(
			{
				kind: "serve",
				global: { compact: false, verbose: true },
				args: { compat: "minimal" },
			},
		);
		expect(parseCliArgs(["serve"])).toEqual({
			kind: "serve",
			global: GLOBAL,
			args: {},
		});
	});
});
