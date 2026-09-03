import { createEngine } from "../engine/engine";
import { createLogger } from "../log";
import type { OperationDeps } from "../operations/shared";
import { PIXEL_REFINER_MCP_VERSION } from "../version";
import { type ParsedCommand, parseCliArgs } from "./args";
import {
	analyzeCommand,
	batchCommand,
	type CommandOutcome,
	EXIT_OK,
	optionsCommand,
	refineCommand,
	serveCommand,
	usageOutcome,
} from "./commands";

/**
 * CLI が触る外の世界。
 * [Intended] テストが同じプロセスで main を動かし、stdout と stderr を捕まえられるように
 * 差し替え口にしてある。既定は本物のストリームと process.cwd()。
 */
export type CliIo = {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	cwd: string;
};

const processIo = (): CliIo => ({
	stdout: (text) => void process.stdout.write(text),
	stderr: (text) => void process.stderr.write(text),
	cwd: process.cwd(),
});

const USAGE = [
	"Usage: pixel-refiner <verb> [options]",
	"",
	"Verbs:",
	"  refine <input>            Refine one image and write the result as a PNG.",
	"  analyze <input>           Report route, grid candidates and warnings; writes nothing.",
	"  batch <inputs...>         Refine several images, optionally against one shared palette.",
	"  options                   Print the settings vocabulary as JSON.",
	"  serve                     Run the MCP server on stdio.",
	"",
	"Settings flags (refine, analyze, batch):",
	"  --preset <id>             Named quick-settings combination; see `pixel-refiner options --section presets`.",
	"  --quick <key=value>       One quick knob, repeatable. Quick values are always strings.",
	"  --advanced <key=value>    One advanced option, repeatable. `null` unsets a key.",
	"  --settings <file.json>    {preset, quick, advanced, gridDetection}; the flags above win key by key.",
	"  --grid <spec>             off | auto | hint:WxH | force:WxH.",
	"",
	"refine:",
	"  --output <path>           Result PNG (default <stem>.refined.png next to the input).",
	"  --candidate <id>          Grid candidate id taken from `analyze`.",
	"  --scale <n>               Nearest-neighbour export scale, 1..32 (default 1).",
	"  --overwrite               Replace an existing output file.",
	"  --no-preview              Leave the base64 PNG preview out of the JSON.",
	"  --detail summary|full     `full` adds effectiveOptions and candidate subscores.",
	"",
	"batch (also takes --scale, --overwrite, --detail):",
	"  --output-dir <dir>        Where to write results (default next to each input).",
	"  --suffix <s>              Default-name suffix (default .refined).",
	"  --shared-palette          Quantise every image against one palette.",
	"  --palette-colors <n>      Colours in the shared palette.",
	"  --palette-dither <mode>   Dither mode for the shared palette.",
	"  --palette-dither-strength <n>",
	"  --preview                 Include previews (honoured for 4 inputs or fewer).",
	"",
	"options:",
	"  --section <name>          all | presets | palettes | quick | advanced (default all).",
	"",
	"serve:",
	"  --compat <mode>           full | minimal; minimal drops structuredContent, outputSchema and annotations.",
	"",
	"Global:",
	"  --compact                 Print the JSON on one line.",
	"  --verbose                 Log at info level to stderr.",
	"  --help, --version",
	"",
	"Exit codes: 0 ok, 1 engine failure (batch: one or more items failed), 2 usage or invalid settings, 3 refused I/O.",
].join("\n");

/**
 * 結果の JSON を組み立てる。
 * [Policy] stdout に載るのは JSON だけ。ログは必ず stderr へ出す（log.ts）。パイプの
 * 相手はここに書かれた 1 つの値だけを読めばよい、という約束を崩さない。
 */
const stringify = (value: unknown, compact: boolean): string =>
	compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);

type Dispatchable = Exclude<
	ParsedCommand,
	{ kind: "help" } | { kind: "version" }
>;

const dispatch = (
	command: Dispatchable,
	io: CliIo,
): Promise<CommandOutcome> => {
	const log = createLogger(
		command.global.verbose ? "info" : undefined,
		io.stderr,
	);
	if (command.kind === "serve") {
		return serveCommand(command.args, {
			cwd: io.cwd,
			logLevel: command.global.verbose ? "info" : undefined,
		});
	}
	if (command.kind === "options") return optionsCommand(command.args);
	// [Policy] CLI の cwd は人が打った場所そのものなので、相対パスを解決してよい。
	// MCP サーバー側だけが絶対パスを要求する（paths.ts の PathPolicy）。
	const deps: OperationDeps = {
		engine: createEngine(),
		policy: { mode: "cli", cwd: io.cwd },
		log,
	};
	if (command.kind === "refine") return refineCommand(deps, command.args);
	if (command.kind === "analyze") return analyzeCommand(deps, command.args);
	return batchCommand(deps, command.args);
};

/**
 * CLI の入口。bin/pixel-refiner.mjs が終了コードとして使う値を返す。
 * [Intended] process.exit は呼ばない。書き出し途中の stdout を切り捨てないためで、
 * bin 側が process.exitCode へ入れて自然に終わらせる。
 */
export const main = async (
	argv: readonly string[],
	io: CliIo = processIo(),
): Promise<number> => {
	const parsed = parseCliArgs(argv);
	if (parsed.kind === "help") {
		io.stdout(`${USAGE}\n`);
		return EXIT_OK;
	}
	if (parsed.kind === "version") {
		io.stdout(`${PIXEL_REFINER_MCP_VERSION}\n`);
		return EXIT_OK;
	}
	if (parsed.kind === "usage") {
		const outcome = usageOutcome(parsed.message);
		io.stderr(`${USAGE}\n\n[pixel-refiner] error ${parsed.message}\n`);
		io.stdout(`${stringify(outcome.output, false)}\n`);
		return outcome.exitCode;
	}
	const outcome = await dispatch(parsed, io);
	if (outcome.output !== undefined) {
		io.stdout(`${stringify(outcome.output, parsed.global.compact)}\n`);
	}
	return outcome.exitCode;
};
