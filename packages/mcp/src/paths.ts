import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ToolFailure } from "./failure";
import { MAX_INPUT_PIXELS, SUPPORTED_INPUT_EXTENSIONS } from "./io/image-io";

/**
 * パスの解釈の仕方。
 * [Policy] MCP サーバーの cwd は「サーバーを起動したプロセスの cwd」で、AI が見ている
 * 作業ディレクトリとは限らない。相対パスを黙って解決すると別のファイルを読み書きし得るため、
 * mcp モードでは絶対パスだけを受け付ける。CLI は人が打った cwd がそのまま基準なので解決する。
 */
export type PathPolicy = {
	mode: "mcp" | "cli";
	cwd: string;
};

export type OutputRequest = {
	/** 解決済みの入力パス。既定の出力名とディレクトリの基準になる。 */
	input: string;
	/** 明示された出力パス。未指定なら既定名を組み立てる。 */
	output?: string;
	/** 既定名の置き場所。output を指定したときは使わない。 */
	outputDir?: string;
	overwrite: boolean;
	/** 既定名の語幹に足す接尾辞（".refined" など）。 */
	defaultSuffix: string;
};

/** 拡張子の判定用。読み取り専用の string[] として比較する。 */
const INPUT_EXTENSIONS: readonly string[] = SUPPORTED_INPUT_EXTENSIONS;

/** stat().size の上限。デコード前にサイズだけで弾くための閾値。 */
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** シグネチャ 8 + チャンク長 4 + "IHDR" 4 + 幅 4 + 高さ 4。 */
const PNG_HEADER_BYTES = 24;

const requireAbsolute = (
	policy: PathPolicy,
	value: string,
	label: string,
): string => {
	if (path.isAbsolute(value)) return path.resolve(value);
	if (policy.mode === "cli") return path.resolve(policy.cwd, value);
	throw new ToolFailure(
		"INVALID_SETTINGS",
		`${label} must be an absolute path, but received "${value}". ` +
			`Relative paths would resolve against this process's working directory (${policy.cwd}), ` +
			"which is not the directory you are working in.",
		`Pass a full path, for example ${path.join(policy.cwd, value)}.`,
	);
};

/**
 * PNG の IHDR から画素数を読む。
 * [Intended] 拡張子が .png でも中身が PNG とは限らないので、シグネチャが合わないときと
 * ヘッダを読み切れないときは undefined を返し、判断をデコーダ（sharp の limitInputPixels）へ譲る。
 */
const pngPixelCount = async (filePath: string): Promise<number | undefined> => {
	const handle = await open(filePath, "r");
	try {
		const header = Buffer.alloc(PNG_HEADER_BYTES);
		const { bytesRead } = await handle.read(header, 0, PNG_HEADER_BYTES, 0);
		if (bytesRead < PNG_HEADER_BYTES) return undefined;
		if (!header.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
			return undefined;
		}
		return header.readUInt32BE(16) * header.readUInt32BE(20);
	} finally {
		await handle.close();
	}
};

const assertReadableSize = async (filePath: string): Promise<void> => {
	const stats = await stat(filePath).catch(() => undefined);
	if (stats === undefined || !stats.isFile()) {
		throw new ToolFailure(
			"INPUT_NOT_FOUND",
			`No readable file at ${filePath}.`,
			"Check the path, or list the directory first.",
		);
	}
	if (stats.size > MAX_INPUT_BYTES) {
		throw new ToolFailure(
			"INPUT_TOO_LARGE",
			`${filePath} is ${stats.size} bytes, over the ${MAX_INPUT_BYTES} byte limit.`,
		);
	}
};

/**
 * 入力パスを検査して絶対パスへ解決する。デコードは呼び出し側の仕事で、ここでは
 * バイト列を読み込む前に弾けるものだけを弾く。
 */
export const resolveInputPath = async (
	policy: PathPolicy,
	input: string,
): Promise<string> => {
	const resolved = requireAbsolute(policy, input, "input");
	const extension = path.extname(resolved).toLowerCase();
	if (!INPUT_EXTENSIONS.includes(extension)) {
		throw new ToolFailure(
			"UNSUPPORTED_INPUT",
			`${resolved} has an unsupported extension (${extension || "none"}).`,
			`Supported input extensions: ${INPUT_EXTENSIONS.join(" ")}.`,
		);
	}
	await assertReadableSize(resolved);
	if (extension !== ".png") return resolved;
	const pixels = await pngPixelCount(resolved);
	if (pixels !== undefined && pixels > MAX_INPUT_PIXELS) {
		throw new ToolFailure(
			"INPUT_TOO_LARGE",
			`${resolved} declares ${pixels} pixels, over the ${MAX_INPUT_PIXELS} pixel limit.`,
			"Crop or downscale the image before refining it.",
		);
	}
	return resolved;
};

const defaultOutputPath = (
	policy: PathPolicy,
	request: OutputRequest,
): string => {
	const directory =
		request.outputDir === undefined
			? path.dirname(request.input)
			: requireAbsolute(policy, request.outputDir, "outputDir");
	const stem = path.basename(request.input, path.extname(request.input));
	return path.join(directory, `${stem}${request.defaultSuffix}.png`);
};

/**
 * 出力パスを決めて、書ける状態かを確かめる。
 * [Policy] デコードより先に呼ぶ。出力が既にあるだけの失敗に、重い処理を通す価値はない。
 */
export const resolveOutputPath = async (
	policy: PathPolicy,
	request: OutputRequest,
): Promise<string> => {
	const resolved =
		request.output === undefined
			? defaultOutputPath(policy, request)
			: requireAbsolute(policy, request.output, "output");
	if (path.extname(resolved).toLowerCase() !== ".png") {
		throw new ToolFailure(
			"INVALID_SETTINGS",
			`output must be a .png path, but received "${resolved}".`,
			"The engine only encodes PNG, so the extension has to match the contents.",
		);
	}
	// [Intended] 入力への上書きは overwrite があっても拒む。書き出すのは論理解像度へ
	// 落とした結果なので、入力を潰すと元の画素へは二度と戻れない。
	if (resolved === path.resolve(request.input)) {
		throw new ToolFailure(
			"OUTPUT_EXISTS",
			`output would overwrite the input file ${resolved}.`,
			"Refining is lossy, so the input is never used as the output; pick another path even with overwrite.",
		);
	}
	if (request.overwrite) return resolved;
	const exists = await stat(resolved).then(
		() => true,
		() => false,
	);
	if (exists) {
		throw new ToolFailure(
			"OUTPUT_EXISTS",
			`${resolved} already exists.`,
			"Pass overwrite: true, or choose another output path.",
		);
	}
	return resolved;
};

/**
 * 同じディレクトリの一時ファイルへ書いてから rename で置き換える。
 * [Intended] rename は同一ファイルシステム内では不可分なので、途中で落ちても
 * 出力先に切り詰められた PNG が残らない。失敗したら一時ファイルは消す。
 */
export const writeFileAtomic = async (
	filePath: string,
	bytes: Uint8Array,
): Promise<void> => {
	await mkdir(path.dirname(filePath), { recursive: true });
	const temporary = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temporary, bytes);
		await rename(temporary, filePath);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
};
