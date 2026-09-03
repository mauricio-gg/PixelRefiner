# pixel-refiner-mcp

[Pixel Refiner](https://pixel-refiner.app) cleans up AI-generated pixel art: it strips anti-aliasing, detects the
pixel grid and resamples the image back to its logical resolution, makes the background transparent, reduces
colours to retro palettes and exports at 1x..32x. This package runs that same pipeline outside the browser and
publishes it to AI agents twice over: as a stdio **MCP server** (`pixel-refiner-mcp`) and as a **CLI**
(`pixel-refiner`) that prints JSON. Both are thin transports over one Node engine, so a tool call and a shell
command with the same settings produce the same PNG. Source: <https://github.com/mauricio-gg/PixelRefiner>.

## Install

```bash
npx -y pixel-refiner-mcp                                   # run the MCP server (stdio)
npx -y --package pixel-refiner-mcp pixel-refiner options    # run the CLI once
npm install -g pixel-refiner-mcp                            # then: pixel-refiner refine sprite.png
```

Node 24 or newer. The image codec is [sharp](https://sharp.pixelplumbing.com/), which ships prebuilt binaries.

## Register the MCP server

**Claude Code**

```bash
claude mcp add --transport stdio --scope project pixel-refiner -- npx -y pixel-refiner-mcp
```

or, as `.mcp.json` in the project root:

```json
{ "mcpServers": { "pixel-refiner": { "type": "stdio", "command": "npx", "args": ["-y", "pixel-refiner-mcp"] } } }
```

**Cursor** — `.cursor/mcp.json` takes the same `command` and `args`:

```json
{ "mcpServers": { "pixel-refiner": { "command": "npx", "args": ["-y", "pixel-refiner-mcp"] } } }
```

**Codex**

```bash
codex mcp add pixel-refiner --env PIXEL_REFINER_MCP_COMPAT=minimal -- npx -y pixel-refiner-mcp
```

Then raise the startup timeout in `~/.codex/config.toml`, because the default 10 seconds does not cover the first
`npx` download:

```toml
[mcp_servers.pixel-refiner]
startup_timeout_sec = 60
```

Claude Code has the same first-run problem and reads `MCP_TIMEOUT` (milliseconds) for it, e.g.
`MCP_TIMEOUT=60000 claude`. The steadier alternative for every host is a global install plus a command that needs
no download: `npm install -g pixel-refiner-mcp`, then register `pixel-refiner-mcp` with no arguments.

`PIXEL_REFINER_MCP_COMPAT=minimal` is recommended for Codex only: Codex drops `content[]` when a result carries
`structuredContent`, so `minimal` omits `structuredContent`, `outputSchema`, titles and annotations. Nothing is
lost — the text block always carries the whole JSON result.

## Tools

| Tool | What it does |
| --- | --- |
| `analyze_image` | Reports route, detected grid, rival grid candidates and warnings. Writes nothing; call it first. |
| `refine_image` | Refines one image, writes the PNG, returns the report and a preview image block. |
| `refine_batch` | Refines up to 64 images, optionally quantising all of them against one shared palette. |
| `list_options` | The whole settings vocabulary: preset ids, retro palettes, quick knobs, advanced options. |

Settings layer as **preset → quick → advanced**, and later layers win. A preset is a named quick-settings
combination; `quick` is seven knobs that cover most work; `advanced` exposes each pipeline option on its own, where
`null` unsets a key so the engine's per-route default applies again. Every `"auto"` value is resolved inside the
engine, and `detail: "full"` reports the `effectiveOptions` it settled on — pass those back as `advanced` to
reproduce a result exactly. `list_options` is the vocabulary for all three layers; `analyze_image` returns
`candidates[].id` values that `refine_image` accepts as `candidateId` when the automatic grid choice is wrong.

## CLI

```bash
pixel-refiner analyze sprite.png
pixel-refiner refine sprite.png --output sprite.px.png --preset crisp-sprite --scale 4
pixel-refiner batch art/*.png --output-dir out --shared-palette --palette-colors 16
pixel-refiner options --section quick --compact
pixel-refiner serve                       # the same MCP server, over stdio
```

Every verb prints one JSON document on stdout — the operation's value on success, `{"failure": {...}}` on failure —
and nothing else; logs go to stderr. The JSON field names are the MCP result's field names (`output.path`, `route`,
`confidence`, `warnings`, `gridCandidates`, `effectiveOptions`), so a script can switch transports without
re-reading the output.

| Flag | Verbs | Meaning |
| --- | --- | --- |
| `--preset <id>` | refine, analyze, batch | Named quick-settings combination. |
| `--quick <key=value>` | refine, analyze, batch | One quick knob, repeatable. Values stay strings (`--quick reductionMode=16`). |
| `--advanced <key=value>` | refine, analyze, batch | One advanced option, repeatable. `null` unsets it; the value is read per the option's type. |
| `--settings <file.json>` | refine, analyze, batch | `{preset, quick, advanced, gridDetection}` from a file; the flags above override it key by key. |
| `--grid <spec>` | refine, analyze, batch | `off`, `auto`, `hint:WxH` or `force:WxH`. |
| `--output <path>` | refine | Result PNG; default is `<stem>.refined.png` next to the input. |
| `--candidate <id>` | refine | A grid candidate id from `analyze`. |
| `--scale <n>` | refine, batch | Nearest-neighbour export scale, 1..32 (default 1). |
| `--overwrite` | refine, batch | Replace an existing output file. |
| `--no-preview` / `--preview` | refine / batch | Previews are on for `refine`, off for `batch` (and only honoured for 4 inputs or fewer). |
| `--detail summary\|full` | refine, analyze, batch | `full` adds `effectiveOptions` and per-candidate subscores. |
| `--output-dir <dir>`, `--suffix <s>` | batch | Where results go and the default-name suffix (default `.refined`). |
| `--shared-palette` | batch | One palette for every image; tune it with `--palette-colors`, `--palette-dither`, `--palette-dither-strength`. |
| `--section <name>` | options | `all`, `presets`, `palettes`, `quick` or `advanced` (default `all`). |
| `--compat <mode>` | serve | `full` or `minimal` (see Codex above). |
| `--compact`, `--verbose` | all | One-line JSON; info-level logging to stderr. |

A preview is a base64 PNG at about 512px inside the JSON (`preview.base64`); `--no-preview` leaves it out, and the
written file at `output.path` is always the real result.

| Exit code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | The engine failed (for `batch`: at least one item failed; `items[]` says which). |
| `2` | Usage error — an unknown flag, a missing argument, or settings outside the published vocabulary. |
| `3` | Refused I/O — `INPUT_NOT_FOUND`, `UNSUPPORTED_INPUT`, `INPUT_TOO_LARGE` or `OUTPUT_EXISTS`. |

## Environment variables

| Variable | Effect |
| --- | --- |
| `PIXEL_REFINER_LOG` | `silent`, `error`, `warn` (default), `info` or `debug`. Logs always go to stderr. |
| `PIXEL_REFINER_MCP_COMPAT` | `minimal` drops `structuredContent`, `outputSchema`, titles and annotations. |

## Limits

- Inputs: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`, at most 64 MiB and 64 megapixels.
- Output: PNG only; the output path must end in `.png`, and an existing file is refused without `overwrite`.
- Previews: at most 256 KiB of base64 (about 512px); larger ones step down and are then omitted with a reason.
- Batches: at most 64 inputs per call.
- MCP paths must be absolute — the server's working directory is not the agent's. The CLI resolves against its own
  working directory.

## Development

From this package:

```bash
pnpm --filter pixel-refiner-mcp build
pnpm --filter pixel-refiner-mcp test
```

From the repository root, `make ci` runs the whole check suite (type-check, unit tests, build, architecture and
dead-code checks) for the web app and this package together.

## License

MIT. See [LICENSE](./LICENSE).
