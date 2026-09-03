import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RefineSettings } from "../engine/types";
import { decodeImage } from "../io/image-io";
import { fixtureBytes, operationDeps, tempDirs } from "../test-fixtures";
import { runBatch } from "./batch";
import type { OperationDeps } from "./shared";

const TARGET = "test/fixtures/quality_prf420_shared_palette_target.png";
const COMPANION = "test/fixtures/quality_prf420_shared_palette_companion.png";

// [Intended] 一括処理の検証は「並べたときの挙動」なので、格子検出と背景処理を止めて
// 入力の解像度がそのまま出る設定にし、共通パレットの効き方だけを見る。
const BATCH_SETTINGS: RefineSettings = {
	quick: { processingMode: "preserve", background: "keep" },
	gridDetection: { mode: "off" },
};

const directories = tempDirs();

afterEach(() => {
	directories.cleanup();
});

const workspace = () => {
	const directory = directories.create();
	const copy = (fixture: string, name: string): string => {
		const target = path.join(directory, name);
		writeFileSync(target, fixtureBytes(fixture));
		return target;
	};
	return { directory, copy, deps: operationDeps(directory) };
};

const decodeFile = (filePath: string) =>
	decodeImage(new Uint8Array(readFileSync(filePath)));

describe("runBatch", () => {
	it("共通パレットで 2 枚を書き出し、読めない 1 枚は項目の失敗として残す", async () => {
		const { directory, copy, deps } = workspace();
		const target = copy(TARGET, "target.png");
		const companion = copy(COMPANION, "companion.png");
		const missing = path.join(directory, "missing.png");
		const outputDir = path.join(directory, "out");

		const result = await runBatch(deps, {
			inputs: [target, companion, missing],
			outputDir,
			settings: BATCH_SETTINGS,
			sharedPalette: {
				enabled: true,
				colorCount: 4,
				ditherMode: "none",
				ditherStrength: 0,
			},
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.summary).toStrictEqual({ done: 2, failed: 1 });
		expect(result.value.items.map((item) => item.status)).toStrictEqual([
			"done",
			"done",
			"error",
		]);
		expect(result.value.sharedPalette).toHaveLength(4);

		const [first, second, third] = result.value.items;
		if (first.status !== "done" || second.status !== "done") {
			throw new Error("先頭 2 件は成功しているはず");
		}
		expect(first.output.path).toBe(path.join(outputDir, "target.refined.png"));
		expect(second.output.path).toBe(
			path.join(outputDir, "companion.refined.png"),
		);
		expect((await decodeFile(first.output.path)).image.width).toBe(16);
		expect((await decodeFile(second.output.path)).image.width).toBe(96);
		expect(first.needsAttention).toBe(false);

		if (third.status !== "error") throw new Error("3 件目は失敗のはず");
		expect(third.id).toBe(missing);
		expect(third.error.code).toBe("INPUT_NOT_FOUND");
	});

	it("suffix と scale を出力名と拡大に反映する", async () => {
		const { directory, copy, deps } = workspace();
		const target = copy(TARGET, "target.png");

		const result = await runBatch(deps, {
			inputs: [target],
			suffix: ".pixel",
			scale: 2,
			settings: BATCH_SETTINGS,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [item] = result.value.items;
		if (item.status !== "done") throw new Error("成功しているはず");
		expect(item.output.path).toBe(path.join(directory, "target.pixel.png"));
		expect(item.output.scale).toBe(2);
		expect(item.output.width).toBe(32);
		expect((await decodeFile(item.output.path)).image.width).toBe(32);
	});

	it("プレビューは既定で付けず、4 枚以下で preview を頼まれたときだけ付ける", async () => {
		const { copy, deps } = workspace();
		const target = copy(TARGET, "target.png");
		const companion = copy(COMPANION, "companion.png");

		const quiet = await runBatch(deps, {
			inputs: [target, companion],
			settings: BATCH_SETTINGS,
		});
		expect(quiet.ok).toBe(true);
		if (!quiet.ok) return;
		expect(
			quiet.value.items.every(
				(item) => item.status === "error" || item.preview === undefined,
			),
		).toBe(true);

		const loud = await runBatch(deps, {
			inputs: [target, companion],
			suffix: ".preview",
			preview: true,
			settings: BATCH_SETTINGS,
		});
		expect(loud.ok).toBe(true);
		if (!loud.ok) return;
		const [first] = loud.value.items;
		if (first.status !== "done") throw new Error("成功しているはず");
		expect(first.preview?.included).toBe(true);
	});

	it("5 枚以上では preview を頼まれても付けない", async () => {
		const { copy, deps } = workspace();
		const inputs = ["a", "b", "c", "d", "e"].map((name) =>
			copy(TARGET, `${name}.png`),
		);

		const result = await runBatch(deps, {
			inputs,
			preview: true,
			settings: BATCH_SETTINGS,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.summary.done).toBe(5);
		expect(
			result.value.items.every(
				(item) => item.status === "error" || item.preview === undefined,
			),
		).toBe(true);
	});

	it("出力先がぶつかる 2 件目は OUTPUT_EXISTS の項目失敗にする", async () => {
		const { copy, deps } = workspace();
		const target = copy(TARGET, "target.png");

		const result = await runBatch(deps, {
			inputs: [target, target],
			settings: BATCH_SETTINGS,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.summary).toStrictEqual({ done: 1, failed: 1 });
		const [, second] = result.value.items;
		if (second.status !== "error") throw new Error("2 件目は失敗のはず");
		expect(second.error.code).toBe("OUTPUT_EXISTS");
	});

	it("1 件の書き出しが失敗しても、他の件の結果とファイルは残す", async () => {
		if (process.getuid?.() === 0) return; // root は書き込み権限を無視する
		const { directory, copy, deps } = workspace();
		const writable = copy(TARGET, "writable.png");
		const lockedDirectory = path.join(directory, "locked");
		mkdirSync(lockedDirectory);
		const locked = path.join(lockedDirectory, "locked.png");
		writeFileSync(locked, fixtureBytes(TARGET));
		chmodSync(lockedDirectory, 0o500);

		const result = await runBatch(deps, {
			inputs: [writable, locked],
			settings: BATCH_SETTINGS,
		});
		chmodSync(lockedDirectory, 0o700);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.summary).toStrictEqual({ done: 1, failed: 1 });
		const [first, second] = result.value.items;
		if (first.status !== "done") throw new Error("1 件目は成功しているはず");
		expect(existsSync(first.output.path)).toBe(true);
		if (second.status !== "error") throw new Error("2 件目は失敗のはず");
		expect(second.id).toBe(locked);
		expect(second.error.code).toBe("ENGINE_ERROR");
		expect(existsSync(path.join(lockedDirectory, "locked.refined.png"))).toBe(
			false,
		);
	});

	it("入力が 0 枚、または 64 枚を超えると INVALID_SETTINGS", async () => {
		const { copy, deps } = workspace();
		const target = copy(TARGET, "target.png");

		const empty = await runBatch(deps, { inputs: [] });
		expect(empty.ok).toBe(false);
		if (!empty.ok) expect(empty.failure.code).toBe("INVALID_SETTINGS");

		const tooMany = await runBatch(deps, {
			inputs: new Array(65).fill(target),
		});
		expect(tooMany.ok).toBe(false);
		if (!tooMany.ok) expect(tooMany.failure.code).toBe("INVALID_SETTINGS");
	});

	it("CLI モードでは成功も失敗も同じ絶対パスを ID にする", async () => {
		const { directory, copy } = workspace();
		copy(TARGET, "target.png");
		// [Intended] CLI は相対パスを cwd から解決するので、指定はファイル名のまま渡す。
		const deps: OperationDeps = {
			...operationDeps(directory),
			policy: { mode: "cli", cwd: directory },
		};

		const result = await runBatch(deps, {
			inputs: ["target.png", "missing.png"],
			outputDir: path.join(directory, "out"),
			settings: BATCH_SETTINGS,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.items.map((item) => item.status)).toStrictEqual([
			"done",
			"error",
		]);
		expect(result.value.items.map((item) => item.id)).toStrictEqual([
			path.join(directory, "target.png"),
			path.join(directory, "missing.png"),
		]);
	});

	it("共通パレットが無効なのにつまみだけ渡されたら INVALID_SETTINGS", async () => {
		const { directory, copy, deps } = workspace();
		const target = copy(TARGET, "target.png");

		const result = await runBatch(deps, {
			inputs: [target],
			outputDir: path.join(directory, "out"),
			settings: BATCH_SETTINGS,
			sharedPalette: { enabled: false, colorCount: 4 },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("INVALID_SETTINGS");
		expect(result.failure.message).toContain("sharedPalette.enabled: true");
	});

	it("共通設定が不正なら呼び出し全体を INVALID_SETTINGS にする", async () => {
		const { copy, deps } = workspace();
		const target = copy(TARGET, "target.png");

		const result = await runBatch(deps, {
			inputs: [target],
			settings: { preset: "does-not-exist" },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("INVALID_SETTINGS");
	});
});
