# mermUId

Offline-capable, browser-based editor for direct graphical editing of Mermaid diagrams
(graphics-first). Diagrams are created, moved, connected, labeled, styled, and deleted on the
canvas with mouse, touch, and keyboard. The Mermaid code remains visible but is secondary.
Graphical changes produce stable code with minimal diffs. No cloud requirement, no telemetry.

Updated: 2026-11-13, version 0.5.0 (canvas bar, edge reconnect, narrow-window drawers, keyboard
and screen reader support). Scope: `flowchart` and `sequence`.

## Features

- Flowchart canvas: create, move, connect, reconnect, label, style and delete nodes, edges and
  subgraphs; auto layout (`dagre`) or manual positions stored in a `%% @mermuid` line.
- Sequence canvas: participants, actors, messages, notes, blocks and activations; zoom, pan and fit.
- Code and canvas stay in sync; parser errors in plain words with line, column and details.
- Styles from `style`, `classDef`/`class` and `linkStyle` through one allow list.
- Files: `.mmd` and `.md`, File System Access, unsaved-changes guard, external-change check,
  "New diagram" dialog with templates.
- Export: Mermaid SVG, editor SVG, PNG, copy as Markdown, clipboard; margin, background, theme
  colors, selection only.
- Canvas bar: zoom, fit, layout, direction, align and distribute.
- Undo/redo (200 steps), keyboard operation, accessible names, light and dark theme, DE/EN UI and
  help.
- Offline: one-folder package with local static server, or Docker image. No telemetry.

Implemented on this branch, not yet released (phase P4):

- Draft recovery and "recently opened" list.
- Copy, cut and paste of diagram parts.
- Selectable Mermaid theme.
- Sequence: `autonumber`, `break`, `box`, `create`/`destroy`.
- Share a diagram as a link (diagram in the URL fragment).
- Style editor with color palette and class list.
- Five flowchart shapes in `@{ shape: ... }` syntax (`delay`, `doc`, `h-cyl`, `lin-cyl`,
  `sl-rect`).

## Setup

Prerequisites:

- Node.js `>=22.23.4 <23` (`engines` in `package.json`).
- npm (ships with Node).

Install the pinned dependencies:

```
npm ci
```

Browser for E2E tests (one-time, user cache, no sudo):

```
npx playwright install chromium
```

On LMDE 7, Playwright misdetects the system (ubuntu20.04) and aborts; there, use
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=debian13-x64 npx playwright install chromium`.
`npm run test:e2e` needs no override.

## Installation

One-folder package (no Node, no installation): extract the ZIP for Linux or Windows and start
the program in the folder `mermuid-<version>-<os>-amd64/` (`./mermuid` or `mermuid.exe`).
It serves the adjacent `dist/` folder on `127.0.0.1` and opens the default browser;
`--no-open` suppresses opening it. The Windows binary is unsigned (U-02), so SmartScreen may
warn on first start.

Build the packages (runs `npm run build` itself, rebuilds the binaries via Docker with the
Go image pinned by digest; Linux only):

```
node scripts/package-onefolder.mjs
```

Result: `release/mermuid-<version>-linux-amd64.zip`, `-windows-amd64.zip` and `release/SHA256SUMS`.
Verify the downloads with `sha256sum -c SHA256SUMS` in the folder of the ZIPs. The version comes
from the first version heading in `CHANGELOG.md`. If the Go image
exists only in the Docker context `default` (not in Docker Desktop), run
`DOCKER_CONTEXT=default node scripts/package-onefolder.mjs`.

## Usage

### npm scripts

| Script                  | Purpose                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `npm run dev`           | Development server (Vite)                                       |
| `npm run check`         | Type check with `svelte-check` (target: 0 errors)               |
| `npm run lint`          | Lint (ESLint, Prettier)                                         |
| `npm run test`          | Unit and roundtrip tests (Vitest)                               |
| `npm run test:e2e`      | E2E tests (Playwright, Chromium and Firefox)                    |
| `npm run build`         | Static build to `build/` (`adapter-static`)                     |
| `npm run preview`       | Local preview of the build                                      |
| `npm run license:check` | License check of all production dependencies against allow list |
| `npm run size`          | Measures initial JS size against 5 MB budget                    |
| `npm run verify`        | check, lint, test, build, license:check, size; stops on error   |

### Static server binary (T07, packaging T25)

Go binary in `server/` (Linux, Windows amd64). `scripts/package-onefolder.mjs` builds the
one-folder package from the binary and the built app folder `dist/` (section "Installation"). The binary binds only `127.0.0.1`, prints the URL, and
opens the default browser; the flag `--no-open` suppresses opening it.

### Docker (T08, packaging T25)

Image based on `nginx:alpine` (pure static hosting, port 8080, non-root, CSP as
HTTP header). Usage:

```
docker build -f docker/Dockerfile -t mermuid:test .
docker run -d -p 8080:8080 mermuid:test
```

## Structure

```
package.json, package-lock.json, vite.config.ts, tsconfig.json,
eslint.config.js, .prettierrc, playwright.config.ts
src/app.html, src/app.d.ts
src/routes/+layout.ts, src/routes/+page.svelte
src/lib/model/                       Model (incl. share link encoding)
src/lib/controllers/commands/        Controller: command stack
src/lib/controllers/sync/            Controller: sync orchestrator
src/lib/services/adapters/flowchart/ Service: parser adapter + serializer flowchart
src/lib/services/adapters/sequence/  Service: parser adapter + serializer sequence
src/lib/services/meta/               Service: %% @mermuid line
src/lib/services/layout/             Service: dagre + sequence layouter
src/lib/services/shapes/             Service: geometry module for node shapes (D-04)
src/lib/services/validator/          Service: validator
src/lib/services/file/               Service: .mmd/.md, line endings, File System Access
src/lib/services/render/             Service: Mermaid wrapper (strict, limits, allow list)
src/lib/services/security/           Service: DOMPurify, URL scheme check
src/lib/services/export/             Service: SVG/PNG, editor SVG, copy as Markdown
src/lib/services/i18n/               Service: DE/EN dictionaries, msg()
src/lib/stubs/                       Build stub elkjs (license, N-01)
src/lib/views/canvas/common/         View: zoom/pan/grid/snap/align/lasso
src/lib/views/canvas/graph/          View: flowchart canvas
src/lib/views/canvas/sequence/       View: sequence canvas
src/lib/views/panels/                View: Properties, code, error list
src/lib/views/shell/                 View: toolbar, CanvasBar, palette, status bar, banner, preview, shortcuts
src/lib/views/help/, static/help/    View: help
tests/unit/<mirrors src/lib>/, tests/fixtures/<area>/
e2e/mvp/, e2e/v1/                    E2E specs (MVP, V1: a11y, keyboard, touch, pan/zoom)
server/                              Static server (Go, D-05)
docker/                              Dockerfile, nginx.conf
scripts/                             license-check.mjs, bundle-size.mjs, package-onefolder.mjs,
                                     version.mjs (version from CHANGELOG.md)
```

## License

mermUId is released under the MIT License, see `LICENSE`. Every release package contains a copy
of `LICENSE`.

## Dependency licenses

The default bundle contains only permissive licenses (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
ISC, 0BSD). ELK is excluded; layout is always `dagre`. DOMPurify is used under the
Apache-2.0 option.

## Further documents

- `CHANGELOG.md`: version history.
