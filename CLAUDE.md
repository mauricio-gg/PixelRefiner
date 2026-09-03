# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The project rules (architecture boundaries, settings consistency, HTML partials, localization, intent comments,
work files, verification) live in `AGENTS.md` above and are the contract. This file adds the commands and the
big-picture map.

## What this is

Pixel Refiner (pixel-refiner.app) is a browser-only tool that cleans up AI-generated pixel art: it removes
anti-aliasing, detects the pixel grid and resamples to logical resolution, makes backgrounds transparent, reduces
colours to retro palettes, and exports at x2..x32. Vanilla TypeScript + Vite, no UI framework, Node 24.x, pnpm.
The fork lives at `github.com/mauricio-gg/PixelRefiner`; upstream is `HappyOnigiri/PixelRefiner` (keep root
files mergeable). A Node engine, an MCP server and a `pixel-refiner` CLI live under `packages/mcp/` (published
as `pixel-refiner-mcp`; see `docs/superpowers/specs/2026-09-03-ai-interface-mcp-design.md`).

## Commands

```sh
make setup            # corepack + pnpm install --frozen-lockfile
pnpm dev              # Vite dev server on :5173
make ci               # the full local CI (scripts/run_ci.py runs every check below in parallel); run after any change
make fix              # biome --write on changed .ts, prettier --write on changed .html
make quality          # full image-quality cases; required after touching src/core, config ranges/defaults, presets,
                      # quick-settings mapping, test/quality, or fixture images (make ci does not include these)
make report           # quality comparison report into tmp/quality-report/latest/index.html
pnpm test:quality     # smoke profile of the quality cases (fast local check)
pnpm test:quality:update   # intentionally replace the stored quality baseline
```

Individual checks that `make ci` bundles: `make type-check`, `make test-unit`, `make build`,
`make check-architecture` (layer imports, DOM-free core), `make check-ts-rules` (no `any`, no `@ts-ignore`),
`make check-dead-code` (knip), `make check-unused-members` (fallow), `make check-duplicates` (jscpd, 20 lines /
60 tokens), `make check-empty-blocks`, `make check-ts-line-length` (160 cols), `make check-file-line-count`
(warn 600 / fail 1000 lines, applies to `.html` too), `make ts-check-diff` (biome on changed files),
`make html-check-diff` (prettier on changed files).

Single test file or test name:

```sh
pnpm exec vitest run src/browser/quick-settings.test.ts
pnpm exec vitest run src/core/processor.test.ts -t "keeps forced cells aligned"
PIXELATE_DEBUG_IMAGES=1 pnpm exec vitest run <file>    # dumps intermediate images to tmp/debug
```

Vitest runs in the `node` environment for everything, including `src/browser` tests, so browser modules must
stay testable without a DOM or be tested through their pure parts.

## Architecture

Three layers under `src/`, enforced by `scripts/check_architecture.py`:

- `src/shared/` — types and config only. `config.ts` owns every range, default, tuning constant and the retro
  palettes (`PROCESS_RANGES`, `PROCESS_DEFAULTS`, `CONVERT_DEFAULTS`, `RETRO_PALETTES`). May import nothing
  from `core` or `browser`.
- `src/core/` — the pure image pipeline. Entry point `processImage(rawImage, options)` in `processor.ts` takes
  `{width, height, data: Uint8ClampedArray}` and returns the result image plus `ProcessingAnalysis` (route,
  confidence, grid candidates, warning codes). `processing-service.ts` wraps it with caching and the candidate
  re-selection flow; `batch.ts` adds shared-palette batch processing. `worker.ts` is the Web Worker entry and
  calls comlink `expose()` at load, so never import it from a non-worker context. No DOM, Canvas, `File`,
  `Blob` or `import.meta.env` allowed here; only plain buffers.
- `src/browser/` — DOM wiring. `main.ts` boots `app.ts`; `io.ts` decodes via `createImageBitmap` and encodes via
  canvas (PNG only); `processor-worker.ts` talks to the worker through comlink. Settings flow is
  `settings-options.ts` (`createProcessOptions`: preset → quick → advanced dispatch) and
  `quick-settings.ts` (pure, Node-safe: `BUILT_IN_PRESETS`, `createQuickProcessOptions`), which is why the
  quality harness can import it from Node.

Processing routes: `processingMode: "auto"` runs `classifier.ts` and picks `refine` (restore an upscaled sprite
to its grid), `convert` (pixelate continuous-tone art) or `preserve` (leave native pixels) with a fallback to
preserve under low grid confidence. Every "auto" value (`reduceColorMode`, `bgExtractionMethod`,
`bgRemovalScope`, `smallComponentMode`, ...) is resolved inside core, and the quick-settings layer expresses
"auto" by omitting the key so core's per-route defaults apply. This is what the AGENTS.md rule "presets ⊆ quick
⊆ advanced, and auto only picks published options" protects.

HTML: `index.html` and `guide.html` are skeletons; sections live in `partials/index/` and `partials/guide/` and
are stitched by `scripts/html-includes.ts` at build and test time. `src/browser/select-options.test.ts` asserts
every `<select>` in the partials matches the corresponding TypeScript union, so adding an enum value means
updating both.

i18n: three languages (`ja`, `en`, `zh-CN`) in `src/browser/i18n/messages/`, one module per key prefix, all
three translations in one entry; tests fail on a missing language.

Quality harness (`test/quality/`): `cases.json` is the single registry of image cases; `benchmark.ts` runs core
under Node with pngjs (`image.ts`), sharded across `shards/` for parallelism, compared against fixed target
images and the stored baseline. Guide recipes in `partials/guide/section-recipes.html` each need a case here.
Read `test/quality/README.md` before changing cases, baselines, or targets.

## Conventions worth knowing before the first edit

- Code comments are written in Japanese; keep `[Intended]`, `[Policy]`, `[Workaround]` tags and their
  reasoning when touching tagged code.
- Commit messages: Conventional Commits with a Japanese description. Never commit to `main`; use
  `feature/`, `fix/`, `refactor/`, `docs/` branches and PRs.
- Working notes go under `tmp/<YYYYMMDD>/` at the repo root (git-ignored), not in the worktree. `.gitignore`
  also drops `dist`, `lib/`, `out`, `/.claude` and `/.cursor`, so don't name a source directory `lib` and don't
  expect `.claude/` settings to be committed.
- Biome formats TypeScript (tabs, double quotes), Prettier formats HTML; run `make fix` rather than formatting
  by hand.
