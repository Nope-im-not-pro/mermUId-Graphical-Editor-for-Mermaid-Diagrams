# Changelog

All notable changes to mermUId. Format: Semantic Versioning, dates in ISO 8601.
Sections per entry: Added, Changed, Fixed, Removed, Verified.

## 0.5.0 - 2026-11-12

Phase P3 of the improvement plan (operation and architecture).

### Added

- Canvas bar inside the canvas: zoom, fit, layout, direction, align and distribute; fit leaves
  room for the open preview card. Sequence diagrams get zoom, pan, fit and Ctrl-+/-/0 (not
  while typing in the editor).
- Reconnect an edge by dragging its source or target handle to another node (flowchart); one
  undo step.
- Export dialog: margin and background options; copy the export to the clipboard.
- Narrow windows: palette and inspector collapse by button; below 900 px they open as drawers
  (Esc closes, focus returns); below 640 px the app shows a hint and global shortcuts are off.
- Keyboard: arrow keys, Home and End switch the side panel tabs; Enter on an armed palette tool
  places the element in the middle of the visible canvas.
- Accessible names: nodes are announced as "<shape>: <label>", handles by direction, the code
  field has a label; visible focus ring on the sequence canvas.
- Help (DE/EN): tabs, zoom, pan and grid, canvas bar, export details and clipboard.

### Changed

- `Shell.svelte` is split into modules for file session, dialogs, export, shortcuts, messages
  and the workspace (929 to 512 lines).
- Sequence grammar lives only in the adapter; the canvas reaches it through the sync
  controller. Model errors carry codes and are translated in the controller.
- Undo history shares unchanged model parts; code entries keep only the full text and rebuild
  the model on undo (heap for 200 steps below 50 MB).

### Fixed

- Wide sequence diagrams no longer push the canvas wider than the window.

### Verified

- `npm run check` 0 errors (1128 files), lint clean, unit 159 files / 2688 tests, e2e 254/254
  (Chromium and Firefox), `npm run build` ok.

## 0.4.0 - 2026-11-12

Phase P2 of the improvement plan (adapters, typing performance, messages, accessibility, release).

### Added

- Parser errors in plain words: a short message without token names, a finite line and column,
  and a "Details" toggle with Mermaid's original text where Mermaid provides one. Switching the
  language translates the shown errors without a new check.
- Properties panel: color fields with text input and color picker (flowchart accepts hex only),
  a dash pattern choice with a custom pattern, labels bound to their fields; setting the same
  value again produces no message.
- The help header shows the app version. The version has one source: the first version heading
  in `CHANGELOG.md` (`scripts/version.mjs`), used by `package.json`, the build and the package
  script.
- Status messages: two permanent live regions (alert, polite); success messages disappear after
  4 s; the message line has a fixed height, so the canvas no longer jumps.
- New nodes created by double-click or context menu scroll into view if needed (24 px margin,
  zoom unchanged).
- Release: `scripts/package-onefolder.mjs` runs `npm run build` itself, uses the Go image pinned
  by digest and writes `release/SHA256SUMS`; `package.json` declares `engines.node`
  `>=22.23.4 <23`.
- Heap test for the undo history (`tests/unit/controllers/commands/heap.test.ts`).
- Help (DE/EN): multi-line labels, `#` and `;` in sequence messages, error details, color formats,
  subgraph IDs and layout freezing, node creation in "Auto" layout.

### Changed

- Flowchart: multi-line labels are kept; editing a node in a chain line or a single-node line
  changes that line in place; labels are trimmed; a subgraph without its own ID gets a fixed ID
  (`subgraph c<N> [Title]`) when a command first stores its position, including its `style`,
  `class` and `click` lines.
- Sequence: `#` and `;` in messages and notes round-trip correctly; LF and CRLF files round-trip
  byte-identical.
- Typing in large diagrams is decoupled from layout and serialization (body and layout caches),
  and the serializer and parser scale linearly.
- Contrast: text, line, node line, status and comment colors raised; primary buttons use a
  darker accent fill (white text at least 4.5:1 in both themes).
- In "Auto" layout, creating a node stores no position and therefore writes no `%% @mermuid` line.

### Removed

- `.run/` logs and the prebuilt binaries in `server/bin/` are no longer tracked; both paths are
  in `.gitignore`.

### Verified

- `npm run check` 0 errors (1082 files), `npm run lint` clean, unit 2283 passed plus 1 expected
  fail, e2e 202/202 (Chromium, Firefox).
- Known limit: in the code path the undo history holds 341.5 MB after 200 edits of a
  200000-character diagram (limit 100 MB, graphics path 81.3 MB). The rebuild is planned as T142.

## 0.3.0 - 2026-11-10

Phase P1 of the improvement plan (data safety, sync robustness, styles, hardening).

### Added

- "New" opens a "New diagram" dialog: diagram type (flowchart, sequence) and three templates
  each; Enter creates the current selection (default: empty flowchart), Esc cancels.
- Unsaved-changes guard for New, Open and file drop: Save (default), Discard, Cancel; the
  action continues after Save only if saving succeeded. `beforeunload` warning while dirty.
- Save prompt when the file changed outside the app since it was opened or last saved: Save as
  (default), Overwrite, Cancel. A moved, deleted or read-only file goes straight to Save as or
  download, with the reason shown in the status line.
- Node and edge styles from `style`, `classDef`/`class` and `linkStyle` on the canvas and in the
  editor SVG, through one allow list (`src/lib/services/shapes/style.ts`: hex, strict
  `rgb()`/`rgba()`, stroke width 0.5-20, dash pattern digits). Without `color`, the label color
  follows the fill brightness.
- Theme follows `prefers-color-scheme` until a choice is stored; browser tab title
  `<file name>[*] - mermUId`.
- Async Mermaid validation of every code write from a diagram command; the result is a warning,
  never an error, and stale results are dropped.
- Server and nginx: `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin`, `Cache-Control` (immutable assets, no-cache HTML),
  nginx gzip, Docker `HEALTHCHECK`. ESLint forbids `{@html}` and `innerHTML`/`outerHTML` in
  `src/`.
- `npm run verify`: check, lint, test, build, license:check, size; stops at the first error.
- Help (DE/EN): file and view, code and diagram, styles, `#`/`;` in sequence messages, corrected
  shortcut table (flowchart-only functions, connecting by dragging the handle).

### Changed

- Invalid code no longer causes a conflict by itself: an error notice overlays the canvas and the
  diagram follows once the code is valid again. A conflict only arises when the diagram is
  changed while the code is invalid.
- `%% @mermuid` line: the last one applies wherever it stands; unchanged layout keeps the file
  byte-identical, a layout change writes exactly one line at the end of the diagram (a line
  inside an unsupported block stays untouched).
- Empty labels become the ID (flowchart nodes and subgraphs).
- File service: strict UTF-8 (BOM kept on save), 1 MB limit, own error codes.
- Sequence canvas: arrowheads use the theme color, localized toolbar options.
- One-folder offline E2E is skipped when the package is missing.

### Fixed

- Deleting a subgraph leaves no orphaned comments or blank lines.
- A command without effect creates no undo step and no conflict.
- A throwing adapter (`parse`/`serialize`) ends in an error state instead of an unhandled
  exception.
- Editor SVG no longer draws a node over a subgraph with the same ID.

### Verified

- `npm run verify` green: check 0 errors/0 warnings, lint green, test 111 files 1911 tests, build
  OK, license check OK, initial JS 968757 bytes (budget 5 MB). E2E 198 of 198 green (Chromium,
  Firefox) with one-folder packages 0.2.0 rebuilt; without packages the offline spec is skipped.

## 0.2.0 - 2026-11-10

### Added

- Editor SVG for `sequence`: `src/lib/services/export/sequence.ts` (`sequenceSvg`) draws the
  scene of the sequence canvas (participants, actors, lifelines, activation bars, messages with
  inline markers, notes, blocks, sections). Same output rules as the flowchart editor SVG: fixed
  elements, no references, escaped text. The shell builds the scene with `toSequence`.
- Export option "Colors of the active theme" (editor SVG): colors from the shell CSS variables
  (`themePalette`), checked by an allow list (`safePalette`: hex, `rgb()`/`rgba()`), with a
  background rect over the whole viewBox. Also applies to PNG from editor SVG.
- Export option "Selection only" (editor SVG, flowchart): selected nodes and containers
  including their content; edges only when both ends are exported.
- Help (DE/EN): export dialog options.
- Tests: Vitest for `sequenceSvg`, palette, selection, theme palette; Playwright case for
  sequence editor SVG, theme colors, and selection export.

### Changed

- Export dialog: editor SVG selectable in the sequence canvas; label "Editor SVG (canvas
  layout)" instead of "(manual layout)".

### Fixed

- Error list: the icon of an entry (`!`/`i`, CSS `::before`) was part of the button's
  accessible name ("! Fehler Zeile ..."); now empty alt text (`content: '!' / ''`).
- E2E `positions.spec.ts`: layout buttons `Auto`/`Manuell` are searched in the toolbar
  "Bearbeiten und Ansicht" (moved there with design A "Studio").
- E2E golden `tests/fixtures/golden/actions/01-flow-knoten-anlegen.mmd`: node position after
  double click adjusted to the canvas size of design A (`[-216,-136,80,42]`).

### Verified

- check 0 errors/0 warnings, lint green, test 98 files 1599 tests, build OK, one-folder
  packages 0.2.0 built. E2E 158 of 158 green (Chromium, Firefox), including AK-M13 offline.

## 0.1.0 - 2026-11-02

### Added

- MIT license: `LICENSE` in the project root, `"license": "MIT"` in `package.json`.
  `scripts/package-onefolder.mjs` copies `LICENSE` into every release package and aborts if
  it is missing. "License" section in `README.md`, license note in the in-app help (DE/EN).
- Language switcher DE/EN in the header (left of the color scheme button). The button shows
  the target language, with translated `aria-label` and `aria-pressed`.
  - Own i18n without new dependency: `src/lib/services/i18n/` with typed dictionaries per
    area (`messages/`), 440 keys per language; the English type is derived from the German
    one, missing keys fail the type check. `msg()` for services, reactive `t()` for views
    (`src/lib/views/shell/i18n.svelte.ts`), placeholders `{name}`.
  - Locale held in `Shell` and passed down as `locale`/`onlocale` props. Initial locale:
    stored value (localStorage), otherwise `navigator.language` (`de*` -> de, else en);
    sets `<html lang>`.
  - All UI strings translated, including `aria-label`, `title`, `placeholder`, status and
    error messages of parsers, validators, sync, render, export, and file services.
  - English help `static/help/help.md`, loaded by locale.
  - Tests: Vitest for i18n, locale detection, and the switcher; Playwright spec for
    switching, persistence, and `lang`.

### Changed

- `README.md` and `CHANGELOG.md` translated to English; project `CLAUDE.md` sets English as
  documentation language.
- `.gitignore`: `!static/help/*.md`, so the help files are tracked (the build imports them).
- E2E `help-diagrams.spec.ts` counts the Mermaid blocks of `static/help/hilfe.md` only
  (locale de-DE).
- `scripts/package-onefolder.mjs`: console messages in English.

### Verified

- check 0 errors/0 warnings, lint green, test 97 files 1587 tests, license:check 158
  packages 0 violations, build OK.
- Package run: both ZIPs contain `LICENSE`.
- e2e: language and help specs green; remaining failures (actions position offset,
  invalid-code button name, positions toolbar lookup, offline port 47110 in use) exist
  unchanged at the previous commit.

## 0.0.8 - 2026-11-02

### Added

- Playwright project `firefox` (O-34); e2e runs in Chromium and Firefox.
- Shell design per draft A "Studio" (`design/entwurf-a-studio.html`): header with
  centered logo "mermUId" ("UI" in accent color #7c8cff), floating command bar above the
  canvas (Undo/Redo, Select all, Zoom, Fit), palette as tiles,
  preview as floating card, status bar as pills.
- Color scheme dark (default) and light, switchable in the header, stored in
  localStorage (`mermuid.theme`); design tokens in `src/lib/views/shell/theme.css`.
- Direct dependency `@lezer/highlight` 1.2.5 (previously transitive) for code colors.
- Element-by-element alignment with draft A (checklist in `PROCESS_STEPS.md`):
  - Palette with search field (`filterTools` in `palette.ts`, empty state "No shape found."),
    groups Shapes/Structure/Templates, 3-column tiles, cards with description line.
  - Command bar above the canvas with layout toggle Auto/Manual and zoom value
    (`data-testid="zoom"`); zoom reports GraphFlow to the shell via `onzoom`.
  - Header: search with keyboard shortcut hint `Strg F`.
  - Preview card 220px with status "rendered"/"error".
  - Error list as cards with severity icon and counter "Problems n".
  - Selected node with 2px accent outline and glow.
  - Properties with stacked labels, 34px fields, and focus ring.
  - Context menu in the style of the mockup menus, "Export" in the export dialog as primary button.

### Changed

- Golden `actions/01-flow-knoten-anlegen.mmd`: position of the node created by double-click
  follows the new canvas size (again after columns 232px / 1fr / 340px).
- Layout toggle moved from the header to the command bar.
- Dot grid opacity `--grid` and inspector width 340px per draft A.
- Supplementary texts (keyboard shortcuts, card description, error counter) via CSS `attr()`: accessible
  names and text content of the buttons remain unchanged.
- e2e Undo/Redo: free click points exclude floating controls.

### Fixed

- "Fit" no longer worked after code input with unchanged node IDs (nodes without
  `measured` after `resync`).
- `npm run lint` failed on built files under `release/stage`.
- Parser hint at the top left of the canvas overlapped the command bar; long messages now wrap.
- Long tool names in palette tiles overflowed (hyphenation).

### Verified

- test 95 files 1577 tests (new: 3 tests `palette-filter.test.ts`), check 0/0, lint green,
  e2e 152 passed (Chromium + Firefox).
- Browser comparison against `design/entwurf-a-studio.html` in Chrome, dark and light.

## 0.0.7 - 2026-11-02

### Added

- E2E suite `e2e/mvp/` (T23, T24): graphics-first flowchart/sequence and zoom (AK-M01-M03),
  sync actions, open/save, roundtrip, comments, positions, invalid code,
  Undo/Redo 100 steps (AK-M04-M10), file/export (AK-M11/M12), offline one-folder (AK-M13),
  XSS in labels (AK-M14), help diagrams (AK-M16); golden files under `tests/fixtures/golden/`,
  intentionally invalid fixtures under `tests/fixtures/sync/invalid/`.
- One-folder ZIP Linux/Windows `scripts/package-onefolder.mjs` (T25, O-38), version from
  `CHANGELOG.md`, output `release/`.
- Banner link "Line X, column Y" jumps into the code (KONZEPT 6.1, AK-M09).

### Changed

- Zoom via toolbar and keyboard; initial fit at most 100 %; new nodes with
  default size.

### Fixed

- Render SVG with `xmlns:xlink` (valid export).
- Flowchart syntax decodes `#quot;` in quoted labels (roundtrip).
- Error list jump with closed code tab works on the first click.

### Verified

- lint, check 0/0, test 92 files 1568 tests, build, license 158 packages 0 violations,
  size initial JS 868315 bytes, e2e 75 passed (chromium; Firefox pending, O-34).

## 0.0.6 - 2026-11-02

### Added

- Sequence canvas `src/lib/views/canvas/sequence/` (T18): participants, messages, lifelines,
  commands via `sync.execute`, gate against non-round-trippable input.
- App shell `src/lib/views/shell/` (T21 C1-C3): toolbar, panels, open/save file,
  export dialog, shortcuts, connect mode, error list jump with canvas selection.
- In-app help `src/lib/views/help/` and `static/help/hilfe.md` (T22).

### Changed

- Multiple self-edges on the same node: staggered offset (`selfLoopPath` with index),
  labels to the right of the loop; editor SVG draws paths, then labels, then nodes.
- Help: "Mermaid SVG export", shortcuts "flowchart only", gap `()`/`@{}` in the sequence canvas.
- Sequence canvas rejects source/target IDs containing `(`, `)`, or `#`.

### Fixed

- Sync `resolve('code')` keeps `snap`/`gridSize` changed during a conflict.
- Sequence serializer: spaces around `-` markers (`B-->>- X`, `B/|- -A`), lexer aligned.
- Shell: mode switch resets tool/connect/search; file drop and confirmation prompt ignored while
  a dialog is open; canvas focus only on wrapper/nodes/edges; connect mode only with
  canvas focus; save retains the target file; connect status shows label.
- E2E smoke test on app shell (title, toolbar, CSP).

### Verified

- lint, check 0/0, test 91 files 1558 tests, build, license 158 packages 0 violations,
  size initial JS 867331 bytes, e2e 1 passed.

## 0.0.5 - 2026-11-02

### Added

- Shapes service `src/lib/services/shapes/` (V1): single source for node shapes, edge paths,
  label dimensions (O-24); grapheme-safe label splitting, self-edge loop `selfLoopPath`.
- Export service `src/lib/services/export/` (T20): `editorSvg`, `exportSvg`, `defaultSource`,
  `exportPng` with `canvasRasterizer` (limit 32767 px per edge, 268435456 px total),
  `copyAsMarkdown`; exports without metadata line (O-28).
- Graph canvas `src/lib/views/canvas/` (T17): Svelte Flow canvas with shape and edge nodes,
  container, inline editor, context menu, align, shortcuts, viewport; multi-selection via
  Shift/Ctrl/Meta-click, lasso via left-drag, pan via space bar/middle button/scroll;
  toggles grid and snap (undoable via `sync.execute`); freeze auto -> manual with
  minimum frame for containers and precedence of existing positions.
- Panels `src/lib/views/panels/` (T19): code panel (CodeMirror, custom line diff, O-25),
  error list, Properties panel with structured `click` editor.

### Changed

- Vitest resolves packages with condition `browser` (only under VITEST).
- Default grid 8 px (previously 10) in both parsers and in the empty document (KONZEPT 6.1).
- Sync carries over `snap` and `gridSize` from the previous model on re-parse.

### Fixed

- `click` normalization rejects `;`, `%%`, line breaks, unbalanced quotes, empty and
  backtick texts, and mermaid keywords as callback name (also with `$` suffix).
- Duplicate no longer copies a `click` line or the statement binding of edges.
- Export: removed ineffective `url(` masking in `source.ts`, corrected comment.

### Verified

- lint, check, 1228 tests (70 files), build, size (initial JS 80374 bytes), license:check:
  exit 0. Open P3 in `z_dispatch/OFFENE_P3_W05.md`.

## 0.0.4 - 2026-11-02

### Added

- Sync orchestrator `src/lib/controllers/sync/` (T13): `createSync` (graphic->code with
  metadata line, code->graphic with 500 ms debounce, conflict keepGraphic/keepCode/diff,
  model and candidate mode, `settle`); `codeApply` with counter lower bound (O-22).
- File service `src/lib/services/file/` (T14): `text.ts` (line endings, BOM), `markdown.ts`
  (CommonMark fences, byte-identical replacement, fence extension on collision), `browser.ts`
  (File System Access, download fallback, drag and drop).
- Validator `src/lib/services/validator/` (T15): `validateModel` -> `ModelIssue[]`
  (duplicate-id, unknown-id, invalid-container-ref, dangling-edge, hint node-container-id).
- Render service `src/lib/services/render/` (T16): `renderSvg`, `renderConfig`, dynamic
  `import('mermaid')`, one-time `initialize`, line back-mapping `lines.ts`; output check
  `hasExternalResource` (no external URLs, no foreignObject).
- SUBSET.md for flowchart, sequence, and file service in the repo; fixture
  `tests/fixtures/file/three-blocks.md`.

### Changed

- `filterMermaidConfig`: `secure` additionally includes `htmlLabels`, `themeCSS`, `fontFamily`,
  `altFontFamily`; `startOnLoad: false`. Render-local addition remains as a redundant safeguard.
- Render `isLocalCss`: CSS comments are no longer stripped (fail-closed, a real
  comment with `url()` is rejected); url targets via linear scan instead of regex.
- Runtime tests (flowchart, sequence, meta, validator) measure the ratio of small to large
  input instead of absolute time (load-independent).

### Fixed

- File service: open block without trailing line break keeps the final blank line of the
  new code.
- Render: `/*` in the unquoted url token and escape comments (`\2f\2a`) no longer hide an
  external `url()`; fixed quadratic runtime with many `url(`; non-CSS whitespace
  (U+00A0, U+3000) before `#` is rejected.

### Verified

- `check`, `lint`, `test` (879/879), `build`, `test:e2e` (1/1), `license:check`
  (158 production packages, 0 violations), `size` (initial JS 80374 bytes): all exit 0.
- `.prettierignore` excludes `tests/fixtures/` (byte-exact test inputs).

## 0.0.3 - 2026-11-01

### Added

- Command stack `src/lib/controllers/commands/` (T09): `history.ts` (Undo/Redo, 200
  steps), `store.ts` (transactions, code adoption, deep freezing, monotonic counters).
- Flowchart adapter `src/lib/services/adapters/flowchart/` (T10): parser with line mapper,
  serializer preserving source text of unchanged units, container ID nodes (subgraph exactly
  once), dangling edges as `%%` comment.
- Sequence adapter `src/lib/services/adapters/sequence/` (T11): participants, alias, messages,
  notes, RawBlocks with initial participant creation.
- Layout service `src/lib/services/layout/` and metadata line `src/lib/services/meta/` (T12):
  `layoutGraph` (dagre), `layoutSequence`, `MetaSplit`/`joinMeta`.
- `DiagramAdapter.getDirection` (optional), provided by the flowchart adapter (seam T13).

### Changed

- Sequence: `participant`/`actor` mentions in RawBlocks (`box`, `break`, `create`,
  `link`/`links`/`properties`/`details`, `;`-separated statements) create participants like
  mermaid; type/label from RawBlock declaration (`props.base`).
- Layout `layoutSequence`: participant order via Set, iterative container traversal.
- Command store: deep freezing skips only objects frozen by the store (WeakSet).
- Vitest coverage only `src/**/*.{ts,svelte}`.

### Fixed

- Sequence: alias after names with `#` (`participant B#k as Bob`) and `as` at end of line
  (`participant B as`) like mermaid.
- `removeNode` "cascade": notes lose deleted participants and are dropped when none remain.
- Flowchart (T10 E3/E4): nodes with a subgraph ID no longer create a duplicate subgraph or
  growing `style`/`class`/`click` lines; `subgraph T` mentioning `T` inside itself
  without stack overflow. Repeated saving is stable (fixed point).

### Verified

- `npm ci`, `check`, `lint`, `test` (516/516), `build`, `test:e2e` (1/1), `license:check`
  (158 production packages, 0 violations), `size` (initial JS 80374 bytes): all exit 0.
- Limit node ID = subgraph ID (one entity in mermaid): `moveToContainer` takes the
  shared `order` entry along; documented, no disambiguation.

## 0.0.2 - 2026-11-01

### Added

- Diagram model `src/lib/model/` (T05): types, monotonic ID counter (D-03), pure
  operations incl. `removeContainer`, `removeElements`, `danglingEdges`, endpoint check;
  `order` references ClassDefs as `classDef:<name>` (O-12).
- Security service `src/lib/services/security/` (T06): `sanitizeLabel` (DOMPurify),
  `isAllowedLinkScheme`, `filterMermaidConfig` (site config only, O-13), `layout: "dagre"`
  enforced, `securityLevel` strict.
- Static server binary `server/` (T07, Go): read-only via `os.Root`, only `127.0.0.1`,
  port sequence 47110-47119 with instance detection (D-06), only GET/HEAD, header CSP from the
  meta CSP of `index.html` (O-11), port 0 warning on stderr (O-14); Linux/Windows
  amd64 builds reproducible.
- Docker image `docker/` (T08): two-stage Node/nginx with digest pins, non-root (uid 101),
  port 8080, header CSP = meta CSP, SPA fallback.

### Changed

- `eslint.config.js`: `coverage/` in ignores (W02 completion).

### Verified

- `npm ci`, `check` (0 errors), `lint`, `test` (97/97, statements 99.53 %, branches
  96.61 %), `build`, `test:e2e` (1/1), `license:check` (158 packages, 0 violations, no elkjs),
  `size` (initial JS 80374 bytes), `go vet`, `go test`, `docker build` + smoke test (image 62.4 MB,
  header CSP = meta CSP in the image): all exit 0.

## 0.0.1 - 2026-11-01

### Added

- SvelteKit project scaffold (Svelte 5, `adapter-static`) with pinned dependencies,
  configuration, npm scripts (`check`, `lint`, `test`, `test:e2e`, `build`, `preview`,
  `license:check`, `size`), elkjs stub, and smoke tests (T03). SvelteKit configuration in `vite.config.ts`
  (SvelteKit 3 does not allow `svelte.config.js`).
- Mandatory docs: `README.md`, `CHANGELOG.md`, `INFRA.md`, `MVC.md`, `ERKLAERUNG.md` (T04).
- `.gitignore` with mandatory entries and build/test output folders (T04).

### Verified

- `npm ci`, `check`, `lint`, `test` (2/2), `build`, `test:e2e` (1/1), `license:check`
  (158 production packages, 0 violations, no elkjs content in `build/`), `size`
  (initial JS 80374 bytes, budget 5 MB): all exit 0.
