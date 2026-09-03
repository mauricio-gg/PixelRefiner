# Pixel Refiner: AI-facing interface (MCP server + CLI on a shared Node engine)

## Context

Pixel Refiner is a browser-only tool that cleans up (mostly AI-generated) pixel art. Mauricio forked it to
`github.com/mauricio-gg/PixelRefiner` and wants AI agents to be able to run the same pipeline and control every
setting, so an agent can generate art, refine it, look at the result, and iterate without a human in the loop.
This spec designs a `packages/mcp/` sub-package that exposes the existing `src/core` pipeline to agents through
a stdio MCP server and a CLI, both thin transports over one transport-agnostic Node engine.

## Locked decisions

Brainstorm outcome:

| Decision | Choice |
|---|---|
| First consumer | Local coding agents (Claude Code, Codex, Cursor) |
| Interface now | **stdio MCP server + CLI**, both thin transports over one transport-agnostic Node engine |
| Interface later | HTTP API and remote MCP (Streamable HTTP) for a hosted SaaS, added on the same engine without changing it |
| Control depth | All three layers: `preset` → `quick` → `advanced` (full `ProcessOptions`), validated against `PROCESS_RANGES` |
| Feedback | Metadata (size, route, confidence, grid candidates, warnings, palette, effective options) **and** result image as MCP image block |
| Packaging | pnpm workspace sub-package `packages/mcp/`, published to npm as `pixel-refiner-mcp`, bundling `src/core` with tsdown |
| Codec | `sharp` (decode PNG/JPEG/WebP/GIF/AVIF, encode PNG, nearest-neighbour scaling) |
| Tools v1 | `refine_image`, `analyze_image`, `refine_batch`, `list_options`; CLI mirrors them |

The image block in the Feedback row lets a vision-capable model inspect the refined result directly, without a
separate file-read step.

Additional decisions the orchestrator ruled on during pre-flight, binding on implementation:

- **Package layout follows the plan's "Final file layout" section** (`src/tools`, `src/server.ts`, `src/mcp.ts`,
  `src/cli/`), not the `src/transport/` line that appeared in an earlier draft of the architecture sketch. The
  Architecture section below has been corrected to match the final layout so the two do not disagree.
- **`refine_image` and the CLI `refine` verb accept an optional `candidateId`** from `analyze_image` output, so
  the analyze → pick candidate → apply loop described under Part D ("Analyze") is actually reachable from both
  transports, not just from the engine's internal API.

Why MCP and not only an HTTP API: the consumer is an agent running on the same machine with files on disk. A
stdio MCP server needs no hosting, auth, or upload story, and MCP is the native way for Claude Code / Cursor /
Codex to discover tools and receive images. The HTTP API is not rejected, it is deferred: the engine boundary is
designed so a hosted transport is a second thin adapter.

Why the engine is separate: `src/core` is already DOM-free (enforced by `scripts/check_architecture.py`) and
takes plain RGBA buffers, and `test/quality/benchmark.ts` + `test/quality/image.ts` already run it under Node.
What is missing is codec I/O, settings layering/validation with a machine-readable schema, and transports.

## Step 0: repoint the clone to the fork — DONE

```bash
git remote rename origin upstream
git remote add origin git@github.com:mauricio-gg/PixelRefiner.git
git fetch origin
git branch --set-upstream-to=origin/main main   # after first push
```

Keep `upstream` pointing at HappyOnigiri so upstream changes can be merged; minimise churn in root files for
that reason. Verified done: `origin` points at `mauricio-gg/PixelRefiner`, `upstream` at `HappyOnigiri/PixelRefiner`.

## Architecture

```
packages/mcp/
  src/engine/     transport-agnostic: settings resolve/validate, analysis report, engine (refine/analyze/batch/listOptions)
  src/io/         sharp decode/encode, nearest-neighbour scale + preview rule
  src/operations/ transport-independent use cases (refine/analyze/batch/options) shared by the MCP tools and the CLI
  src/tools/      MCP tool definitions and schemas
  src/server.ts   createPixelRefinerServer(engine, options): McpServer
  src/mcp.ts      startStdioServer, SIGINT → close
  src/cli/        CLI entry, argument parsing, verb dispatch
  dist/           tsdown bundle of src/** + ../../src/core + ../../src/shared + ../../src/browser/quick-settings.ts
```

Root repo edits are limited to small, upstream-mergeable pieces: a shared runtime-enum module, two type moves,
three arrays in `quick-settings.ts`, and tooling wiring (workspace file, knip, vitest exclude, Makefile, two
check scripts). No image-processing code changes, so `make quality` is not required for this work.

## Part A: shared runtime enums (root `src/`, upstream-friendly)

Problem: the settings unions in `src/shared/types.ts` cannot be enumerated at runtime, and the only existing
runtime enumeration is the `Record<T, true>` trick inside `src/browser/select-options.test.ts:35-53`. The API
needs real arrays for schema generation, and the UI test should consume the same arrays so the two can't drift.

- New `src/shared/option-values.ts` (~90 lines): `valuesOf<T>(record: Record<T, true>)` arrays for
  `ProcessingMode`, `DitherMode`, `OutlineStyle`, `BackgroundRemovalScope`, `Connectivity`,
  `SmallComponentRemovalMode`, `GeminiWatermarkRemovalMode`, `AutoBehaviorSetting`, `CellSamplingMode`,
  `BgExtractionMethod`; `DETAIL_LEVEL_VALUES = Object.keys(CONVERT_DETAIL_SCALES)` and
  `CELL_SCALE_VALUES = Object.keys(CELL_SCALE_FACTORS)` (already exhaustive `satisfies Record<...>` in
  `src/shared/config.ts:258,271`); `RETRO_PALETTE_IDS = Object.keys(RETRO_PALETTES)`;
  `REDUCE_COLOR_MODE_VALUES = ["none","auto",...RETRO_PALETTE_IDS]` (no `"fixed"`: core keys on `fixedPalette`,
  see `src/core/color-reduction.ts:39-63`); `GRID_SIGNAL_NAMES = Object.keys(GRID_SIGNAL_DEFAULTS)`.
  Imports only `./types` and `./config`, so the `shared → core/browser` ban holds.
- Type moves so `shared` can name every union: add `CellSamplingMode` and `BgExtractionMethod` to
  `src/shared/types.ts`; `src/core/cell-sampler.ts:9-14` becomes a re-export; `src/core/processor-options.ts:210-217`
  and `:368-375` use `BgExtractionMethod`. Zero behaviour change.
- `src/browser/quick-settings.ts`: add runtime arrays `QUICK_REDUCTION_MODE_VALUES`, `QUICK_BACKGROUND_VALUES`,
  `QUICK_DITHERING_VALUES` next to the types (additive, ~25 lines). Keep the file where it is; `packages/mcp`
  imports it relatively, as `test/quality/benchmark.ts:4-8` already does from Node. Moving it would touch ~9
  files and drop the `labelKey: ResourceKey` typing, for no runtime gain.
- `src/browser/select-options.test.ts`: build `SELECT_SPECS` from the arrays (`fromValues(...)`,
  `withheld(...)`) instead of re-listing values; keep the `withheld` lists and the browser-only specs as they are.
- Descriptions (AI-facing prose) do **not** go in `src/shared`; they live in the package's option catalog, typed
  as `Record<Value, string>` against the shared unions so a missing description is a compile error.

## Part B: workspace and tooling wiring (root)

- `pnpm-workspace.yaml`: `packages: ["packages/*"]`.
- `vitest.config.ts`: `exclude: [...configDefaults.exclude, "packages/**"]` so root unit tests don't need sharp.
- `knip.json`: convert to a `workspaces` map; `packages/mcp` entries `src/index.ts`, `src/cli.ts`,
  `src/**/*.test.ts`, `tsdown.config.ts`, `vitest.config.ts`. If knip misattributes the relative `../../src`
  imports, narrow `ignoreIssues` to `src/shared/option-values.ts`, don't widen globs.
- `Makefile`: fold into existing targets so `scripts/run_ci.py` and `.github/workflows/ci.yml` stay untouched.
  `type-check` also runs `pnpm --filter pixel-refiner-mcp run type-check`; `test-unit` also runs
  `pnpm --filter pixel-refiner-mcp test`; `build` also builds the package and then guards
  `! grep -q comlink packages/mcp/dist/index.js` (proves `src/core/worker.ts` was not bundled).
- `scripts/check_architecture.py` (additive, ~25 lines): second scan over `packages/*/src/**/*.ts`; any relative
  import resolving into `src/browser/` must be in `{"quick-settings"}`; importing `src/core/worker` is an error.
  `scripts/check_ts_rules.py:26` also scans `packages/*/src`. Line-length and line-count scripts already cover
  `packages/**` via `git ls-files`.

## Part C: package scaffold (`packages/mcp/`)

- `package.json`: `name: pixel-refiner-mcp`, `version: 0.1.0`, `type: module`, `engines.node: ">=24"`,
  **two bins**: `"pixel-refiner-mcp": "bin/pixel-refiner-mcp.mjs"` (server, no args) and
  `"pixel-refiner": "bin/pixel-refiner.mjs"` (CLI). Two bins are required, not style: `npx <pkg>` runs the bin
  whose name equals the package name, so `npx -y pixel-refiner-mcp` must be the server for `claude mcp add`.
  Bins are shebang wrappers that `import "../dist/mcp.js"` / `"../dist/cli.js"`. `exports["."]` → `dist/index.js`
  + `.d.ts` (engine API, so a future `packages/http` can depend on it), `files: [bin, dist, README.md, LICENSE]`,
  `publishConfig.access: public`.
  Runtime deps (verified on the registry 2026-09-03): `@modelcontextprotocol/server ^2.0.0` (v2 SDK; zod 4
  required, v3 schemas fail at runtime), `zod ^4.2`, `sharp ^0.35` (0.35.4, node >=20.9). devDeps:
  `@modelcontextprotocol/client ^2.0.0` (tests), `tsdown ^0.22`, `typescript 7.0.2`, `vitest 4.1.10`,
  `@types/node 24.13.3` (root versions so pnpm links one copy). Scripts: `build: tsdown`, `type-check`, `test`,
  `prepack: pnpm run build`. Do not reuse the v1 `@modelcontextprotocol/sdk` that sits in the lock via repomix.
- `tsconfig.json`: extends root; `lib: ["ES2022","DOM"]` (DOM only because quick-settings has a type-only import
  of `ResourceKey` whose module references `localStorage`), `types: ["node"]`, `moduleResolution: Bundler`.
- `tsdown.config.ts`: entries `index`, `mcp`, `cli`; `format: esm`, `platform: node`, `target: node24`,
  `dts: true` for `index` only, `external: ["sharp", /^@modelcontextprotocol\//, "zod"]`.
- `vitest.config.ts`: node env, `testTimeout` 60s (120s on CI) because e2e cases use 2048px guide inputs.
- sharp ships prebuilt `@img/sharp-*` binaries with no install script, so pnpm 10's build-script blocking needs
  no `onlyBuiltDependencies` entry. Works on Node 24 (CI) and the local Node 26. Call `sharp.cache(false)` once.

## Part D: engine (`packages/mcp/src/engine`, `src/io`)

**Settings resolution** (`settings-resolve.ts`, `settings-validate.ts`). Input:

```ts
RefineSettings = {
  preset?: PresetId;                  // BUILT_IN_PRESETS id, default "auto"
  quick?: Partial<QuickSettingsState>;
  advanced?: AdvancedOverrides;       // JSON-safe Partial<ProcessOptions>; null = unset (let route default decide)
  gridDetection?: { mode: "auto"|"hint"|"force"|"off"; width?: number; height?: number };
}
```

Merge, mirroring the UI exactly:

1. `quickState = { ...preset.quickSettings, ...quick }`; unknown preset → error listing ids; `background:"pick"`
   without `backgroundColor` → error.
2. `options = createQuickProcessOptions(quickState)` (already includes defaults and the auto-deletion for
   `reductionMode:"auto"`, `src/browser/quick-settings.ts:81-86`).
3. `advanced` key by key: `null` deletes; the two Advanced-tab derived rules are kept
   (`reduceColorMode` without `reduceColors` → `reduceColors = mode !== "none"`, `src/browser/settings-options.ts:161`;
   `bgExtractionMethod:"none"` → pre/post false + scope off, `settings-options.ts:62-64,89-92`). Keys `debug`,
   `debugHook`, `onDetectedGrid`, `detectedGrid`, `debugLabel` rejected; `debug` forced false.
4. `gridDetection` maps like `settings-options.ts:83-86,160`; `hint`/`force` require both dimensions (error, the
   UI silently ignores); conflict error if `advanced` also sets any of the five grid keys.
5. Validation: ints via `clampInt`/`clampOptionalInt` from `src/shared/config.ts:920-931` against
   `PROCESS_RANGES`, recorded as `adjustments: [{key, requested, applied}]` rather than errors; enums against the
   shared arrays, error lists allowed values; `fixedPalette`/`outlineColor`/`bgRgb` accept `#rrggbb`; unknown key
   → error naming the nearest valid key.
6. Output: `{ options, effectiveOptions, resolved, quick, presetId, adjustments }`. `effectiveOptions` is the
   merged options minus functions/undefined and must be idempotent (`resolve({advanced: effectiveOptions})`
   deep-equals). `resolved` = `normalizeProcessOptions(options)` flattened, so the AI also sees post-default
   values such as the convert route's colour count.

**Analyze** (`engine.ts`, `analysis-report.ts`): runs `processImage` with `onDetectedGrid` and skips PNG
encoding. Grid detection runs on the background-processed geometry (`src/core/processor.ts:363-371`) and
classification only in auto mode, so calling `detectGrid` on the raw input would not match what refine does.
Uses `createProcessingService` (`src/core/processing-service.ts:98`) so a follow-up `refine` with `candidateId`
reuses the detection cache and `processCandidate` / `candidateProcessOptions`
(`src/core/candidate-previews.ts:121-160`), the same analyze → pick candidate → apply loop the UI has.
`refine_image` and the CLI `refine` verb expose this `candidateId` parameter directly (see Locked decisions),
so this loop is reachable end to end, not only through the engine's internal API.

Report shape (JSON-safe): `input{width,height,format}`, `classification?{kind,confidence,reasons,features}`,
`route`, `confidence`, `warnings[]` (stable codes from `src/shared/types.ts:179-187`), `gridCandidates[]`
(`outW,outH,cellW,cellH,offset,method,totalScore,confidence`), `selectedCandidateIndex?`,
`autoResultCandidateIndex?`, `background?`, `smallComponentRemoval?`, content-loss ratios,
`output{width,height,colorCount,palette: hex[]}`, `candidates: CandidateSelection[]` via `selectCandidatePlans`,
`effectiveOptions`, `resolved`, `adjustments`.

**Batch**: per-item settings layered over common settings, decode failures become `{status:"error"}` items,
then `service.processBatch` → `processBatchImages` (`src/core/batch.ts:63-128`) with
`{sharedPalette, colorCount, ditherMode, ditherStrength}` clamped to `PROCESS_RANGES`. Result includes
`needsAttention: needsBatchAttention(analysis)` and the shared palette as hex. Document that shared palette
overrides per-item colour options and drops outlines on the palette pass.

**Image I/O** (`io/image-io.ts`, `io/scale.ts`):

- Decode: `sharp(bytes,{animated:false, limitInputPixels: 64MP}).rotate().ensureAlpha().raw()` → `RawImage`.
  `.rotate()` matches the browser's `createImageBitmap` orientation handling. First frame only for GIF/WebP.
- Encode: `sharp(raw RGBA).png({compressionLevel: 9, palette: false})`. `palette:false` is essential (palette
  PNG re-quantises).
- Scaling (export x2..x32 and preview): reuse `resizeRawImageNearest` from `src/core/image-operations.ts:191`,
  not sharp's resize, because sharp premultiplies alpha around resize and can perturb semi-transparent pixels.
  sharp is codec-only.
- Engine `refine` returns the logical-resolution `result: RawImage` alongside the encoded PNG, so the transport
  can build the preview and step the factor down under a byte cap without re-running the engine.

## Part E: transports (`packages/mcp/src/operations`, `src/tools`, `src/server.ts`, `src/mcp.ts`, `src/cli`)

**Layering**: `operations/{refine,analyze,batch,options}.ts` are transport-independent use cases
(validated args → path policy → engine → atomic file write → metadata). Both the MCP tools and the CLI call
them, which keeps jscpd quiet and is the layer a future HTTP API calls too.

**Server factory**: `createPixelRefinerServer(engine, { compat, log }): McpServer` in `server.ts`. v2's stdio
(`serveStdio(factory)` from `@modelcontextprotocol/server/stdio`) and HTTP (`createMcpHandler(factory)` +
`toNodeHandler` from `@modelcontextprotocol/node`) both take a `() => McpServer` factory, so remote MCP later is
one file with zero engine changes. Pass `instructions` to `McpServer` with the 5-line workflow
(analyze → refine → inspect preview → adjust cellScale/preset); Claude Code injects server instructions into the
system prompt, which is a stronger lever than resources. No MCP resources in v1 (Cursor/Codex don't surface them
to the model; `list_options` is the path all three hosts use).

**Tool schemas** (`tools/schemas.ts`, zod 4, `z.strictObject`):

- Shared settings block: `preset` (enum of `BUILT_IN_PRESETS` ids), `quick` (7 knobs, enums from the shared
  arrays), `advanced` (strict object generated in `tools/advanced-schema.ts` from an `ADVANCED_OPTION_SPECS`
  table exported by the engine's option catalog: `{key, kind: int|boolean|enum|color, min/max/default or
  values, description}`; internal keys are absent from the table so they can't be injected), `gridDetection`.
- `refine_image`: `input` (absolute path; relative rejected with a message that includes `process.cwd()`),
  `output?` (default `<stem>.refined.png` next to input), settings, `candidateId?` (from a prior `analyze_image`
  call, per the Locked decisions above), `scale` 1..32 (default 1), `overwrite` (default false), `preview`
  (default true), `detail: summary|full` (full adds `effectiveOptions` and candidate subscores).
- `analyze_image`: `input`, settings, `detail`.
- `refine_batch`: `inputs[]` (1..64), `outputDir?`, `suffix` (default `.refined`), `sharedPalette`, settings,
  `scale`, `overwrite`, `preview` (default false, honoured only when `inputs.length <= 4`).
- `list_options`: `section: all|presets|palettes|quick|advanced`.
- Descriptions are written for an LLM reader and explain the layering, that `analyze_image` is cheap, and that
  `list_options` has the full vocabulary. Long descriptions live in `list_options` output, one-liners in the
  schema; snapshot-test the generated JSON schema size (budget ≈2.5K tokens for `refine_image`).
- Annotations: `analyze_image`/`list_options` `readOnlyHint`; `refine_*` non-destructive unless `overwrite`.

**Results**: text block always carries the full JSON metadata; `structuredContent` mirrors it; image block
`{type:"image", mimeType:"image/png", data: base64}` for the preview; `output.path` in metadata is the fallback
any host can `Read`. Errors are values (`ToolFailure {code, message, hint}` with codes `INPUT_NOT_FOUND`,
`UNSUPPORTED_INPUT`, `INPUT_TOO_LARGE`, `OUTPUT_EXISTS`, `INVALID_SETTINGS`, `ENGINE_ERROR`) returned as
`isError: true`, never thrown.

**Host compatibility** (verified issues): Codex drops `content[]` when `structuredContent` is present
(openai/codex#10334); Claude Code rejects non-2020-12 `outputSchema` (#86142, zod 4 emits 2020-12 so fine) and
has a report of image blocks arriving as base64 text (#31208, contradicts Playwright-MCP experience, verify by
smoke test). One switch `PIXEL_REFINER_MCP_COMPAT=minimal` / `--compat minimal` omits `outputSchema`, `title`,
annotations and `structuredContent`; nothing is lost because the text block has everything.

**Preview** (`preview.ts`): `choosePreviewScale = max(1, floor(512 / max(w,h)))`, upscale with
`resizeRawImageNearest`, encode via the sharp adapter; if base64 exceeds 256 KiB halve the factor down to 1x,
then omit with `preview: {included:false, reason}`. 256 KiB rather than 1 MB because if a host ever counts the
block as text it already exceeds Claude Code's default 25K-token MCP output cap.

**Path safety** (`paths.ts`): absolute paths required in MCP mode (CLI resolves against cwd); extension
allow-list from the engine (`.png .jpg .jpeg .webp .gif .avif`), output must be `.png`; `stat().size <= 64 MiB`
and `<= 64 MP` (read PNG IHDR before decode, pattern from `test/quality/image.ts` `pngPixelCount`, otherwise
sharp's `limitInputPixels`); refuse existing output without `overwrite` (also when `output === input`); mkdir -p
and write `tmp + rename` so a crash never leaves a truncated PNG.

**Logging** (`log.ts`): stdout is protocol (server) or JSON (CLI); everything else to stderr as
`[pixel-refiner] level message`. `PIXEL_REFINER_LOG=silent|error|warn|info|debug` (default warn), `--verbose`.
Don't use `ctx.mcpReq.log` (MCP logging deprecated in the 2026-07-28 spec).

**CLI** (`cli/{main,args,commands}.ts`, bin `pixel-refiner`): parser is Node's built-in `util.parseArgs` (stable,
`allowNegative` for `--no-preview`), verbs dispatched by hand. Verbs: `refine <input> [--output] [--preset]
[--quick k=v]... [--advanced k=v]... [--settings file.json] [--candidate-id] [--scale] [--overwrite]`
(`--candidate-id` mirrors `refine_image`'s `candidateId`, per the Locked decisions above), `analyze <input>`,
`batch <inputs...> [--output-dir] [--shared-palette]`, `options [--section]`, `serve [--verbose] [--compat]`.
JSON on stdout (pretty; `--compact`). Exit codes: 0 ok, 1 engine failure (batch: any item failed), 2 usage,
3 refused I/O.

**Registration docs** (README, verified syntax):

```bash
claude mcp add --transport stdio --scope project pixel-refiner -- npx -y pixel-refiner-mcp
```

```json
{ "mcpServers": { "pixel-refiner": { "type": "stdio", "command": "npx", "args": ["-y", "pixel-refiner-mcp"] } } }
```

Cursor `.cursor/mcp.json` uses the same `command`/`args`; Codex:
`codex mcp add pixel-refiner --env PIXEL_REFINER_MCP_COMPAT=minimal -- npx -y pixel-refiner-mcp`, with
`startup_timeout_sec = 60` because the default 10s doesn't cover the first `npx` download. Mention Claude Code's
`MCP_TIMEOUT` and the global-install alternative.

## Final file layout (`packages/mcp/`), every file under ~300 lines

```
bin/pixel-refiner-mcp.mjs, bin/pixel-refiner.mjs
src/index.ts                      engine public API re-exports
src/engine/types.ts, option-catalog.ts (descriptions + ADVANCED_OPTION_SPECS + listOptions),
           settings-validate.ts, settings-resolve.ts, analysis-report.ts, engine.ts
src/io/image-io.ts (sharp decode/encode), io/scale.ts (nearest upscale via core)
src/log.ts, src/paths.ts, src/preview.ts
src/operations/refine.ts, analyze.ts, batch.ts, options.ts
src/tools/define.ts (result/error helpers, compat filter), schemas.ts, advanced-schema.ts,
          refine-image.ts, analyze-image.ts, refine-batch.ts, list-options.ts
src/server.ts (createPixelRefinerServer), src/mcp.ts (startStdioServer, SIGINT → close)
src/cli.ts → src/cli/main.ts, args.ts, commands.ts
src/**/*.test.ts, tsconfig.json, tsdown.config.ts, vitest.config.ts, README.md, LICENSE
```

## Tests

- Root: `src/browser/select-options.test.ts` refactored to consume the shared arrays (drift guard).
- `engine/settings-resolve.test.ts`: for every built-in preset, `resolve({preset})`, `resolve({quick:
  preset.quickSettings})` and `resolve({advanced: effectiveOptions})` give identical `effectiveOptions` and
  identical `normalizeProcessOptions` output (the AGENTS.md reproducibility rule at the API layer);
  `reductionMode:"auto"` leaves colour keys absent; `null` deletes; `gridDetection` modes and conflict error;
  enum/range/unknown-key validation messages.
- `engine/option-catalog.test.ts`: catalog keys equal shared arrays both ways; every int key has
  `PROCESS_RANGES` min/max/default; JSON-schema snapshot + size budget.
- `io/image-io.test.ts`: decode `test/fixtures/quality_nearest_4x.png` equals pngjs `readPng` from
  `test/quality/image.ts`; encode→decode exact; JPEG from `public/guide/` decodes with alpha 255; scale table
  (22→23x, 60x85→6x, 600→1x); exact pixel replication.
- `engine/engine.test.ts`: e2e vs quality harness. Explicit case `remove-background-trim-auto-grid` from
  `test/quality/cases.json` via `effectiveCaseOptions` (`test/quality/benchmark.ts`) through a raw-options entry
  `refineWithOptions`, assert `imagesEqual` against the expected fixture, twice for determinism; preset case
  `guide-recipe1-*` through `refine(bytes,{preset:"auto"})` exact; `analyze` then `refine` with `candidateId`
  equals plain refine; `refineBatch` with `sharedPalette` on the two `quality_prf420_*` fixtures.
- `server.test.ts`: in-process client via `createMcpHandler` + `StreamableHTTPClientTransport` with a custom
  `fetch` (documented v2 test pattern; also proves the HTTP boundary), fallback `InMemoryTransport`. Asserts the
  4 tool names, `list_options` structure, `analyze_image` on the 32px fixture reports 8px output, `refine_image`
  into `mkdtemp` writes the file and returns text + image (512x512, `choosePreviewScale(8,8) === 64`), second
  call without `overwrite` is `isError`, relative path is `isError`, compat minimal has no `structuredContent`.
- `paths.test.ts`, `preview.test.ts` (cap step-down on a noisy synthetic image), `cli/args.test.ts`,
  `cli.test.ts` (in-process `runCli`, plus `spawnSync` on `dist/` and a `StdioClientTransport` smoke, both
  skipped when `dist/` is absent so the parallel CI stays deterministic).

## Task order (each task is a PR-sized commit on a `feature/` branch; Conventional Commits, Japanese body)

1. Step 0 remote switch. Write the spec to `docs/superpowers/specs/2026-09-03-ai-interface-mcp-design.md`
   (this plan's content, with a "Locked decisions" section), commit.
2. Part A shared enums + type moves + `select-options.test.ts` refactor → `make ci`.
3. Part B/C workspace scaffold with an empty `src/index.ts`; `pnpm install` updates the lock; `make ci` green.
4. `io/` + tests.
5. `engine/types`, `settings-validate`, `settings-resolve`, `option-catalog` + tests.
6. `analysis-report`, `engine` + e2e tests.
7. `log`, `paths`, `preview`, `operations/*` + tests.
8. `tools/*`, `server.ts`, in-process server tests, compat test.
9. `mcp.ts` + bins + stdio smoke; tsdown build + comlink guard; manual smoke with
   `npx @modelcontextprotocol/inspector` and a real `claude mcp add` where Claude describes the preview
   (this decides whether `preview` stays default true).
10. CLI + tests; README with registration snippets; `make ci`, `make build`; `git diff --exit-code`.
11. Publish `pixel-refiner-mcp@0.1.0` (`pnpm --filter pixel-refiner-mcp publish`), needs an npm login.

Each code task goes to a subagent (orchestrator rule); `code-guardian` reviews before each merge.

## Verification

- `make ci` at the root must stay green after every task (it now covers the package's type-check, tests, build).
- `make quality` is not required (no processing, defaults, ranges, presets or quick-settings mapping change).
  The e2e engine tests compare against the same fixtures the quality harness uses, which is the proof that the
  API output equals the web app output for identical settings.
- Manual: `pnpm --filter pixel-refiner-mcp build`, then
  `node packages/mcp/bin/pixel-refiner.mjs refine test/fixtures/quality_nearest_4x.png --output /tmp/x.png`
  prints JSON with an 8x8 result; `claude mcp add ... -- node <abs>/packages/mcp/bin/pixel-refiner-mcp.mjs`
  in a scratch project and ask Claude to refine an image and describe what it sees.

## Deferred (explicitly out of v1)

- Hosted HTTP API / remote MCP for SaaS: one new package over `createPixelRefinerServer` + `toNodeHandler`,
  plus auth, upload, rate limits, hosting. Engine and operations layers are reused unchanged.
- MCP resources (`pixel-refiner://options`), animated GIF/WebP, saved user presets (browser localStorage only).
