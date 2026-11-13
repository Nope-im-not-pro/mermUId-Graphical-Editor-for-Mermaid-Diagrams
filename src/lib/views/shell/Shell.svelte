<!--
	App-Shell (KONZEPT §5): Toolbar oben, Palette links, Canvas Mitte mit Vorschau-Streifen,
	rechts Tabs Eigenschaften/Code und Fehlerliste, Statuszeile unten. Modell-Änderungen
	laufen nur über den Sync-Controller. T21 C3: globale Kürzel (KONZEPT §5), Datei Neu/Öffnen/
	Speichern inkl. Drag-and-Drop, Export-Dialog, Löschen-Rückfrage (D-10), Canvas-Weiche.
-->
<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import type { Command } from '../../controllers/commands/history';
	import { createSync, type SyncController } from '../../controllers/sync';
	import { canvasRasterizer, type Rasterizer } from '../../services/export';
	import {
		browserEnv,
		createRecent,
		hasFileSystemAccess,
		isShareFragment,
		type FileEnv,
		type RecentEntry,
		type RecentStore
	} from '../../services/file';
	import { renderSvg, type RenderResult } from '../../services/render';
	import { gridSettings } from '../canvas/common/grid';
	import { connectNodes, moveElements, setLayoutOption } from '../canvas/graph/commands';
	import type { CanvasControl } from '../canvas/graph/GraphFlow.svelte';
	import { nudgeMoves } from '../canvas/graph/interaction';
	import { canvasMeasure, documentOrder, type Measure } from '../canvas/graph/mapping';
	import type { SequenceControl } from '../canvas/sequence/SequenceCanvas.svelte';
	import HelpPanel from '../help/HelpPanel.svelte';
	import type { JumpTarget } from '../panels/errors';
	import Banner from './Banner.svelte';
	import { bannerFor, type BannerAction } from './banner';
	import {
		browserStorage,
		confirmEnabled,
		disableConfirm,
		needsConfirm,
		type StorageAccess
	} from './confirm';
	import Dialog from './Dialog.svelte';
	import { createDialogs } from './dialogs.svelte';
	import { createDraftKeeper, readDraft } from './draft';
	import ExportDialog from './ExportDialog.svelte';
	import NewDialog from './NewDialog.svelte';
	import {
		createExporter,
		editorAvailable,
		initialExport,
		selectionAvailable,
		themePalette
	} from './exporting';
	import { tabTitle } from './file';
	import { browserShare, createFileSession, type ShareAccess } from './fileSession.svelte';
	import { createConnectMode } from './connectMode';
	import { createIssues } from './issues';
	import { cycleTarget, keyHandler } from './keymap';
	import MessageBar from './MessageBar.svelte';
	import { createMessages } from './messages.svelte';
	import Palette from './Palette.svelte';
	import RecentList from './RecentList.svelte';
	import { armTool } from './palette';
	import {
		afterJump,
		closeDrawer,
		dockOpen,
		forMode,
		initialDocks,
		initialPanels,
		MIN_QUERY,
		MIN_WIDTH,
		toggleDock,
		watchNarrow,
		type Dock,
		lockedReason,
		panelsLocked,
		selectTab,
		toggleCode,
		togglePreview
	} from './panels';
	import SearchBar from './SearchBar.svelte';
	import SidePanel from './SidePanel.svelte';
	import StatusBar from './StatusBar.svelte';
	import {
		cursorStatus,
		errorPart,
		fail,
		known,
		layoutStatus,
		liveStatus as liveItems,
		typeLabel,
		type Cursor,
		type MessagePart
	} from './status';
	import { currentLocale, t } from './i18n.svelte';
	import { createLocale } from './locale';
	import { applyColorScheme, createTheme, type MediaAccess } from './theme';
	import './theme.css';
	import Toolbar from './Toolbar.svelte';
	import Workspace from './Workspace.svelte';

	let {
		sync,
		render = renderSvg,
		measure,
		create = (text: string) => createSync(text),
		fileEnv,
		rasterize,
		storage = browserStorage,
		recent = createRecent(),
		language = globalThis.navigator?.language,
		media = globalThis.matchMedia?.bind(globalThis),
		share = browserShare()
	}: {
		sync: SyncController;
		render?: (code: string) => Promise<RenderResult>;
		measure?: Measure;
		/** Neuer Sync-Controller für Neu/Öffnen (Tests injizieren Fake-Adapter). */
		create?: (text: string) => Promise<SyncController>;
		fileEnv?: FileEnv;
		rasterize?: Rasterizer;
		storage?: StorageAccess;
		/** "Zuletzt geöffnet" (T132 C2); Standard IndexedDB, Tests injizieren eine Ablage. */
		recent?: RecentStore;
		/** Browsersprache für die Erstwahl ohne gespeicherte Sprache (Tests setzen sie fest). */
		language?: string;
		/** `matchMedia` für `prefers-color-scheme` (T105 C2; Tests setzen eine Attrappe). */
		media?: MediaAccess;
		/** Adresse und Zwischenablage für Teilen per Link (T136 C2; Tests setzen eine Attrappe). */
		share?: ShareAccess;
	} = $props();

	let panelState = $state(initialPanels());
	/** Leisten (T129 C1, M-09 a): ab 900 px einklappbar, darunter Schublade. */
	let docks = $state(initialDocks());
	let narrow = $state(false);
	/** Hinweis-Modus unter 640 px (M-09 b): globale Kürzel ruhen (T129 C2). */
	let tooNarrow = $state(false);
	/** Farbschema und Sprache (T123 C4: theme.ts/locale.ts; Storage-Prop ist danach fest). */
	const appearance = untrack(() => createTheme(storage, media));
	const theme = appearance.theme;
	const languages = untrack(() => createLocale(storage, language));
	const locale = languages.locale;
	let armed = $state<string | null>(null);
	let selected = $state<string | null>(null);
	let control = $state<CanvasControl | null>(null);
	let cursor = $state<Cursor | null>(null);
	/** Statusmeldung als Schlüssel (T114, V-19; T123 C4 messages.svelte.ts). */
	const messages = createMessages(() => $active.code);
	const say = messages.say;
	let side = $state<ReturnType<typeof SidePanel>>();
	let workspace = $state<ReturnType<typeof Workspace>>();
	let root = $state<HTMLDivElement>();
	let seqControl = $state<SequenceControl | null>(null);
	let helpOpen = $state(false);
	let searchOpen = $state(false);
	/** Rückfrage-Dialog (T123 C2): höchstens eine offene Rückfrage. */
	const dialogs = createDialogs();
	const fallbackMeasure = canvasMeasure();

	const initialCode = () => get(sync).code;
	/** Datei-Sitzung (T123 C1): nach Neu/Öffnen ersetzt ihr Controller den übergebenen. */
	const session = createFileSession({
		code: () => $active.code,
		initial: initialCode(),
		create: (text) => create(text),
		env: () => fileEnv ?? browserEnv(),
		ask: dialogs.ask,
		say,
		reset: () => {
			control = null;
			seqControl = null;
			selected = null;
			armed = null;
			connect.reset();
			searchOpen = false;
			cursor = { line: 1, column: 1 };
		}
	});
	const active = $derived(session.controller ?? sync);
	const commands = $derived(active.commands);
	const graph = $derived($active.mode === 'flowchart');
	/** Steuerungen nur, solange der jeweilige Canvas angezeigt wird. */
	const gc = $derived(graph ? control : null);
	const sc = $derived($active.mode === 'sequence' ? seqControl : null);
	/** Zoom-Kürzel wirken auf das aktive Control (T126 C3, O-124: gleiche Zoom-Glieder). */
	const zc = $derived(gc ?? sc);
	const dirty = $derived(session.dirty);
	/** Modell-Befunde für die Fehlerliste, je Modellstand und Sprache einmal (T123 C3). */
	const issuesOf = createIssues();
	const issues = $derived(issuesOf($commands.doc, currentLocale()));
	const panels = $derived(forMode(panelState, $active.mode));
	const banner = $derived(bannerFor($active));
	const locked = $derived(panelsLocked($active.mode) ? lockedReason() : null);
	/** Parser/Sync als Live-Region; Layout und Cursor ohne Ansage (V-32). */
	const liveStatus = $derived(liveItems($active));
	const status = $derived([
		layoutStatus($active.mode, $commands.doc.layout.mode),
		cursorStatus(cursor)
	]);

	/** Export-Ablauf (T123 C2): Dialog offen/zu, Ausführung und Meldungen. */
	const exporter = createExporter({
		doc: () => $commands.doc,
		code: () => $active.code,
		mode: () => $active.mode,
		fileName: () => session.file.name,
		env: () => fileEnv ?? browserEnv(),
		canvas: () => gc,
		palette: () => (root ? themePalette(getComputedStyle(root)) : undefined),
		render: (code) => render(code),
		measure: () => measure ?? fallbackMeasure,
		rasterize: () => rasterize ?? canvasRasterizer(),
		say
	});
	const exportOpen = exporter.open;

	/** Entwurfs-Sicherung (T132 C1, F-13): erst nach der Start-Rückfrage aktiv. */
	const drafts = untrack(() => createDraftKeeper(storage));
	let drafting = $state(false);

	/**
	 * Start mit Entwurf: Wiederherstellen (primär) lädt ihn, Verwerfen löscht ihn. Esc behält den
	 * Entwurf bis zur nächsten Änderung (diese überschreibt ihn; ein sauberer Stand löscht ihn nicht).
	 * `true`, wenn der Entwurf so behalten wurde.
	 */
	async function offerDraft(): Promise<boolean> {
		const draft = readDraft(storage);
		let kept = false;
		if (draft) {
			const reply = await dialogs.ask({
				title: t('app.shell.draftTitle'),
				text: t('app.shell.draftText', { name: draft.name }),
				actions: [
					{ label: t('app.shell.draftRestore'), value: 'restore', primary: true },
					{ label: t('app.shell.discard'), value: 'discard' }
				]
			});
			if (reply.value === 'restore') await session.restore(draft);
			else if (reply.value === 'discard') drafts.clear();
			else kept = true;
		}
		drafting = true;
		return kept;
	}

	/**
	 * Start (T136 C2): Teilen-Fragment sofort merken und aus der Adresszeile entfernen (noch vor
	 * jeder Rückfrage: Reload fragt nicht erneut). `replaceState` ersetzt nur den Eintrag im
	 * Sitzungsverlauf (Zurück/Vor); der globale Browser-Verlauf und die Autovervollständigung
	 * behalten die aufgerufene URL samt Fragment, der Link selbst bleibt an seiner Quelle. Dann
	 * erst der Entwurf, danach der Link: der Entwurf ist die einzige Kopie früherer Arbeit, der
	 * Link ist wiederholbar. Wiederhergestellter Entwurf: die Ungespeichert-Rückfrage des Links
	 * schützt ihn. Per Esc behaltener Entwurf: der Startstand ist sauber (keine Ungespeichert-
	 * Rückfrage), Laden würde ihn über die Entwurfs-Sicherung ersetzen; die Link-Rückfrage sagt
	 * das ausdrücklich, Abbrechen lässt ihn stehen. Umgekehrt (Link zuerst) würde Wiederherstellen
	 * ohne Rückfrage den Link-Inhalt ersetzen.
	 */
	async function start() {
		const hash = share.hash();
		const shared = isShareFragment(hash);
		if (shared) share.clear();
		const kept = await offerDraft();
		if (shared) await session.openShared(hash, kept);
	}

	onMount(() => void start());

	/** "Zuletzt geöffnet" (T132 C2, M-15 a): nur mit File System Access, sonst nicht gerendert. */
	const recentOn = untrack(() => hasFileSystemAccess(fileEnv ?? browserEnv()));
	let recentFiles = $state.raw<RecentEntry[]>([]);
	const showRecent = (list: RecentEntry[]) => (recentFiles = list);
	/** Letzter Eintrag entfernt: Liste verschwindet, Fokus auf den Öffnen-Knopf statt auf body. */
	async function removedRecent(list: RecentEntry[]) {
		showRecent(list);
		if (list.length > 0) return;
		await tick();
		const label = t('toolbar.open');
		[...(root?.querySelectorAll('button') ?? [])]
			.find((b) => b.getAttribute('aria-label') === label)
			?.focus();
	}
	onMount(() => {
		if (recentOn) void recent.list().then(showRecent);
	});
	/** Jede Datei mit Handle (Öffnen, Speichern unter, aus der Liste) rückt nach vorn. */
	$effect(() => {
		const handle = session.file.handle;
		if (recentOn && handle) untrack(() => void recent.add(handle).then(showRecent));
	});
	onDestroy(() => {
		session.dispose();
		drafts.dispose();
	});

	$effect(() => {
		const state = { code: $active.code, name: session.file.name, dirty };
		if (drafting) untrack(() => drafts.update(state));
	});
	/** Tab schließen innerhalb der Verzögerung: letzten Stand noch sichern. */
	$effect(() => {
		const flush = () => drafts.flush();
		window.addEventListener('pagehide', flush);
		return () => window.removeEventListener('pagehide', flush);
	});

	$effect(() => appearance.watch());
	$effect(() =>
		watchNarrow(media, (value) =>
			untrack(() => {
				narrow = value;
				docks = closeDrawer(docks);
			})
		)
	);
	$effect(() => watchNarrow(media, (value) => (tooNarrow = value), MIN_QUERY));
	/** Neue Sitzung (Neu/Öffnen): offene Schublade schließen (T129 C2). */
	$effect(() => {
		void active;
		untrack(() => (docks = closeDrawer(docks)));
	});
	/** Ohne Graph keine Palette: deren Schublade schließen; die Seitenleiste bleibt (Code-Eingabe). */
	$effect(() => {
		if (!graph) untrack(() => (docks = closeDrawer(docks, 'palette')));
	});
	$effect.pre(() => applyColorScheme($theme));

	/** V-02: Tab schließen/neu laden warnt, solange ungespeicherte Änderungen vorliegen. */
	$effect(() => {
		if (!dirty) return;
		const warn = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = true;
		};
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});

	/** Typwechsel (z. B. über den Code): Werkzeug, Verbinden-Modus und Suche zurücksetzen. */
	let shownMode: string | null = null;
	$effect(() => {
		const mode = $active.mode;
		if (mode === shownMode) return;
		shownMode = mode;
		armed = null;
		connect.reset();
		searchOpen = false;
	});

	/** Führt eine Sync-Aktion aus; Ablehnungen erscheinen als Meldung (O-27). */
	async function attempt(label: MessagePart | string, action: () => Promise<void>) {
		try {
			await action();
			say(null);
		} catch (err) {
			const part = typeof label === 'string' ? known(label) : label;
			say(fail({ key: 'app.shell.failed', params: { label: part, reason: errorPart(err) } }));
		}
	}

	/** Befehlslabel erst im Fehlerfall auf seinen Schlüssel zurückführen (`attempt`). */
	const run = (command: Command) => attempt(command.label, () => active.execute(command));

	const undo = () => attempt({ key: 'app.canvasBar.undo' }, () => active.undo());
	const redo = () => attempt({ key: 'app.canvasBar.redo' }, () => active.redo());

	/** Löschen-Rückfrage D-10: Knoten mit Kanten, einmalig, dauerhaft abschaltbar. */
	async function beforeDelete(ids: string[], force: boolean): Promise<boolean> {
		const enabled = confirmEnabled(storage);
		if (!needsConfirm($commands.doc, ids, { force, enabled })) return true;
		const reply = await dialogs.ask({
			title: t('app.shell.deleteTitle'),
			text: t('app.shell.deleteText'),
			actions: [
				{ label: t('app.shell.delete'), value: 'delete' },
				{ label: t('app.shell.cancel'), value: 'cancel' }
			],
			remember: t('app.shell.remember')
		});
		if (reply.value !== 'delete') return false;
		if (reply.remember && !disableConfirm(storage)) {
			say(fail({ key: 'app.shell.rememberFailed' }));
		}
		return true;
	}

	const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;

	function fileDragover(e: DragEvent) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'copy';
	}

	/** Drop einer .mmd/.md-Datei auf die App; Dateiliste vor der Rückfrage lesen. */
	async function fileDrop(e: DragEvent) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		if (dialogs.current || session.picking || $exportOpen) return;
		await session.openDropped(e.dataTransfer);
	}

	/** Suchtreffer: Auswahl setzen und in den Blick holen, Fokus bleibt im Suchfeld. */
	function pick(id: string) {
		selected = id;
		gc?.select([id]);
		sc?.select(id, false);
	}

	function closeSearch() {
		searchOpen = false;
		(gc ?? sc)?.focus();
	}

	const nodeIds = () => $commands.doc.nodes.map((n) => n.id);

	/** Ziel-IDs für Tastaturaktionen: Auswahl, sonst fokussierter Knoten. */
	function targets(): string[] {
		const ids = gc?.selection() ?? [];
		if (ids.length > 0) return ids;
		const id = document.activeElement?.closest('.svelte-flow__node')?.getAttribute('data-id');
		return id ? [id] : [];
	}

	function nudge(dx: number, dy: number): boolean {
		const ids = targets();
		if (!gc || ids.length === 0) return false;
		const g = gc.geometry();
		const step = gridSettings($commands.doc.layout).size;
		void run(moveElements(nudgeMoves(ids, g, dx * step, dy * step), g));
		return true;
	}

	/** Tab/Shift-Tab: am Rand `false`, damit Tab den Canvas verlässt. */
	function cycle(dir: 1 | -1): boolean {
		const next = cycleTarget(documentOrder($commands.doc), gc?.selection()[0] ?? null, dir);
		if (!gc || next === null) return false;
		gc.select([next]);
		return true;
	}

	/** Verbinden-Modus (T123 C3): Zustandsautomat, Kanten über `run`. */
	const connect = createConnectMode({
		targets,
		nodeIds,
		geometry: () => gc?.geometry() ?? null,
		label: (id) => $commands.doc.nodes.find((n) => n.id === id)?.label,
		select: (ids) => gc?.select(ids, false),
		connect: (source, target) => void run(connectNodes(source, target)),
		say
	});

	async function openSearch() {
		searchOpen = true;
		await tick();
		root?.querySelector<HTMLInputElement>('[role="search"] input')?.focus();
	}

	/** Globale Kürzel (T123 C3: Zuordnung und Ablauf in keymap.ts). */
	const onkey = keyHandler({
		root: () => root,
		dialogOpen: () => helpOpen || $exportOpen || dialogs.current !== null || session.picking,
		graph: () => graph,
		zoomable: () => zc !== null,
		canvasReady: () => gc !== null,
		connect,
		// Nur ein explizites `false` reicht die Taste weiter; `void` verwirft Rückgabewerte
		// wie den neuen Rasterzustand von toggleGrid.
		actions: {
			save: () => void session.save(),
			undo: () => void undo(),
			redo: () => void redo(),
			zoomIn: () => void zc?.zoomIn(),
			zoomOut: () => void zc?.zoomOut(),
			fit: () => void zc?.fit(),
			toggleCode: () => {
				if (locked === null) panelState = toggleCode(panelState);
			},
			search: () => {
				if ($active.mode === 'code') return false;
				void openSearch();
			},
			help: () => {
				helpOpen = true;
			},
			selectAll: () => void gc?.select(documentOrder($commands.doc), false),
			toggleGrid: () => void gc?.toggleGrid(),
			toggleSnap: () =>
				void run(setLayoutOption({ snap: !gridSettings($commands.doc.layout).snap })),
			nudge: (a) => nudge(a.dx, a.dy),
			cycle: (a) => cycle(a.dir),
			connectStart: () => void connect.start(),
			connectNeighbor: (a) => void connect.neighbor(a.dir)
		}
	});

	const paletteOpen = $derived(graph && dockOpen(docks, 'palette', narrow));
	const inspectorOpen = $derived(dockOpen(docks, 'inspector', narrow));

	/** Einklapp-Knopf; als Schublade (< 900 px) wandert der Fokus in die Leiste (D6). */
	async function toggle(dock: Dock) {
		docks = toggleDock(docks, dock, narrow);
		if (!narrow || docks.drawer !== dock) return;
		await tick();
		document
			.getElementById(`shell-${dock}`)
			?.querySelector<HTMLElement>(
				'input, button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]'
			)
			?.focus();
	}

	/** Enter auf bewaffnetem Werkzeug (T129 C2): Schublade zu, Anlegen in der Canvas-Mitte. */
	function placeArmed(id: string) {
		armed = null;
		if (narrow) docks = closeDrawer(docks);
		workspace?.placeCentered(id);
	}

	/** Esc in der Schublade: schließen, Fokus zurück zum Auslöser (D6). */
	function drawerKey(e: KeyboardEvent) {
		const dock = docks.drawer;
		if (e.key !== 'Escape' || e.defaultPrevented || !narrow || dock === null) return;
		if (!(e.target as Element).closest(`#shell-${dock}`)) return;
		docks = closeDrawer(docks);
		document.getElementById(`shell-toggle-${dock}`)?.focus();
	}

	/** "Diff ansehen": Code-Tab öffnen, Fokus auf die Diff-Region (sonst das Code-Panel). */
	async function showDiff() {
		panelState = selectTab(panelState, 'code');
		await tick();
		side?.focusDiff();
	}

	function bannerAction(id: BannerAction) {
		if (id === 'keepGraphic')
			void attempt({ key: 'app.banner.keepGraphic' }, () => active.keepGraphic());
		else if (id === 'keepCode')
			void attempt({ key: 'app.banner.keepCode' }, () => active.keepCode());
		else void showDiff();
	}

	/**
	 * Fehlerlisten-/Banner-Sprung: Code-Zeile oder Canvas-Auswahl samt Viewport (beide Canvas).
	 * Bei geschlossenem Code-Tab erst rendern lassen, sonst greift der Fokus nicht.
	 */
	async function jump(target: JumpTarget) {
		panelState = afterJump(panelState, target);
		if (target.type === 'line') {
			await tick();
			side?.reveal(target.line, target.column);
		} else {
			selected = target.id;
			gc?.select([target.id]);
			sc?.select(target.id);
		}
	}
</script>

<svelte:window onkeydowncapture={(e) => tooNarrow || onkey(e)} />

<svelte:head>
	<title>{tabTitle(session.file, dirty)}</title>
</svelte:head>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="shell" data-theme={$theme} bind:this={root} ondragover={fileDragover} ondrop={fileDrop}>
	<Toolbar
		typeLabel={typeLabel($active.mode, $active.code)}
		codeOpen={panels.tab === 'code'}
		{locked}
		fileName={session.file.name}
		{dirty}
		canSearch={$active.mode !== 'code'}
		theme={$theme}
		locale={$locale}
		ontogglecode={() => (panelState = toggleCode(panelState))}
		onnew={session.newDiagram}
		onopen={session.open}
		onsave={session.save}
		onexport={exporter.show}
		onshare={() => void session.copyLink(share.base(), share.copy)}
		onsearch={openSearch}
		onhelp={() => (helpOpen = true)}
		ontheme={appearance.toggle}
		onlocale={languages.toggle}
		docks={{ palette: graph ? paletteOpen : null, inspector: inspectorOpen }}
		ondock={(dock) => void toggle(dock)}
	/>
	{#if recentOn && recentFiles.length > 0}
		<RecentList
			entries={recentFiles}
			onopen={(entry) => void session.openRecent(entry)}
			onremove={(entry) => recent.remove(entry.handle).then(removedRecent)}
		/>
	{/if}
	{#if banner?.kind === 'conflict'}
		<Banner
			{banner}
			onaction={bannerAction}
			onjump={(l) => void jump({ type: 'line', line: l.line, column: l.column })}
		/>
	{/if}
	{#if searchOpen}
		<SearchBar doc={$commands.doc} onpick={pick} onclose={closeSearch} />
	{/if}
	{#key active}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="main"
			class:with-palette={paletteOpen && !narrow}
			class:no-side={!inspectorOpen && !narrow}
			class:narrow
			onkeydown={drawerKey}
		>
			{#if graph}
				<Palette
					id="shell-palette"
					open={paletteOpen}
					{armed}
					onarm={(id: string) => (armed = armTool(armed, id))}
					onrelease={() => (armed = null)}
					onplace={placeArmed}
				/>
			{/if}
			<Workspace
				bind:this={workspace}
				sync={active}
				{render}
				{measure}
				{locked}
				previewOpen={panels.previewOpen}
				{banner}
				{issues}
				bind:armed
				bind:control
				{run}
				onundo={undo}
				onredo={redo}
				ontogglepreview={() => (panelState = togglePreview(panelState))}
				onseqcontrol={(c) => (seqControl = c)}
				onbanneraction={bannerAction}
				onjump={jump}
				onselect={(ids: string[]) => (selected = ids[0] ?? null)}
				beforedelete={beforeDelete}
			/>
			<SidePanel
				id="shell-inspector"
				open={inspectorOpen}
				bind:this={side}
				sync={active}
				tab={panels.tab}
				{selected}
				{issues}
				onselecttab={(tab) => (panelState = selectTab(panelState, tab))}
				onjump={jump}
				oncursor={(c) => (cursor = c)}
			/>
		</div>
	{/key}
	<MessageBar message={messages.current} />
	<StatusBar live={liveStatus} items={status} />
	{#if $exportOpen}
		<ExportDialog
			initial={initialExport($commands.doc, $active.mode)}
			editor={editorAvailable($active.mode)}
			selection={selectionAvailable($active.mode, gc?.selection().length ?? 0)}
			onexport={exporter.run}
			oncancel={exporter.cancel}
		/>
	{/if}
	{#if session.picking}
		<NewDialog oncreate={session.closeNew} oncancel={() => session.closeNew(null)} />
	{/if}
	{#if dialogs.current}
		{#key dialogs.current}
			<Dialog request={dialogs.current.request} onanswer={dialogs.answer} />
		{/key}
	{/if}
	<HelpPanel open={helpOpen} onclose={() => (helpOpen = false)} />
	<!-- Mindestbreiten-Hinweis (M-09 b, D6): nur unter 640 px sichtbar (CSS). -->
	<div class="too-narrow">
		<h1>{t('narrow.title')}</h1>
		<p>{t('narrow.text', { width: MIN_WIDTH })}</p>
	</div>
</div>

<style>
	/* Raster Entwurf A: Kopfzeile, Hauptbereich (Palette | Canvas | Seitenleiste), Statuszeile. */
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}
	.main {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 340px;
		min-height: 0;
	}
	.main.with-palette {
		grid-template-columns: 232px 1fr 340px;
	}
	/* Eingeklappte Leisten (T129 C1): die Fläche übernimmt die frei gewordene Spalte. */
	.main.no-side {
		grid-template-columns: 1fr;
	}
	.main.with-palette.no-side {
		grid-template-columns: 232px 1fr;
	}
	@media (max-width: 1100px) {
		.main.with-palette {
			grid-template-columns: 180px 1fr minmax(16rem, 20rem);
		}
		.main.with-palette.no-side {
			grid-template-columns: 180px 1fr;
		}
	}
	/*
		Schublade (< 900 px, D6): `.center` gibt seine Zonen an dieses Raster ab (Zeile 1 CanvasBar,
		Zeile 2 Fläche und Vorschau-Karte); die Schublade überlagert nur Zeile 2 und deckt damit
		weder Kopfzeile, CanvasBar noch Statuszeile ab.
	*/
	.main.narrow {
		position: relative;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto minmax(0, 1fr);
		background: var(--bg);
	}
	.main.narrow > :global(.center) {
		display: contents;
	}
	.main.narrow > :global(.center > .cmdbar) {
		grid-row: 1;
		grid-column: 1;
	}
	.main.narrow > :global(.center > .shell-canvas) {
		grid-row: 2;
		grid-column: 1;
	}
	.main.narrow > :global(.palette),
	.main.narrow > :global(.side) {
		position: relative;
		z-index: 20;
		grid-row: 2;
		grid-column: 1;
		min-height: 0;
		box-shadow: var(--shadow);
	}
	.main.narrow > :global(.palette) {
		justify-self: start;
		width: min(232px, 100%);
	}
	.main.narrow > :global(.side) {
		justify-self: end;
		width: min(340px, 100%);
	}
	/* Mindestbreite (M-09 b): darunter nur der Hinweis, die App bleibt eingehängt, aber unsichtbar. */
	.too-narrow {
		display: none;
	}
	@media (max-width: 639.98px) {
		.shell > :global(:not(.too-narrow)) {
			visibility: hidden;
		}
		.too-narrow {
			position: fixed;
			inset: 0;
			z-index: 100;
			display: grid;
			place-content: center;
			gap: 8px;
			padding: 16px;
			text-align: center;
			background: var(--bg);
			color: var(--text);
		}
		.too-narrow h1 {
			margin: 0;
			font-size: 18px;
		}
		.too-narrow p {
			margin: 0;
			color: var(--text-2);
		}
	}
</style>
