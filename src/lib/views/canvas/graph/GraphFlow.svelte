<script lang="ts" module>
	import { canvasClipboard, clipboardReadable } from './interaction';

	/** Steuerung für die Shell-Toolbar (T21, additiv). */
	export type CanvasControl = {
		zoomIn(): void;
		zoomOut(): void;
		fit(): void;
		viewport(): { x: number; y: number; zoom: number };
		/** Auswahl setzen; `center` zentriert das erste Element bei gleichem Zoom. */
		select(ids: string[], center?: boolean): void;
		selection(): string[];
		geometry(): Record<string, Rect>;
		toggleGrid(): void;
		focus(): void;
		/** Knoten bei gleichem Zoom ins Sichtfeld schieben; sichtbar oder unbekannt: keine Änderung. */
		reveal(id: string): void;
		/** Auswahl ausrichten/verteilen (`align-*`, `distribute-*` wie im Kontextmenü, T126 C2). */
		arrange(item: string): void;
	};
	/** Rückfrage vor dem Löschen; `force` = Shift-Entf. `false` bricht ab. */
	export type BeforeDelete = (ids: string[], force: boolean) => boolean | Promise<boolean>;

	/**
	 * Eine Zwischenablage je Fenster (T133 C3): der Puffer überlebt Neuaufbau des Canvas
	 * (Datei-/Ansichtswechsel). Lesen nur über die Kürzel-Geste, keine copy/paste-Events: so kein
	 * doppeltes Einfügen.
	 */
	const clipboard = canvasClipboard(
		() => globalThis.navigator?.clipboard,
		() => clipboardReadable(globalThis.navigator?.permissions)
	);
</script>

<script lang="ts">
	import '@xyflow/svelte/dist/style.css';
	import { tick, untrack } from 'svelte';
	import {
		Background,
		ConnectionMode,
		Controls,
		Panel,
		SelectionMode,
		SvelteFlow,
		ViewportPortal,
		useSvelteFlow,
		useViewport,
		type Connection
	} from '@xyflow/svelte';
	import type { Command } from '../../../controllers/commands/history';
	import type { SyncController } from '../../../controllers/sync';
	import {
		fragmentText,
		readFragment,
		type FragmentFailure
	} from '../../../controllers/sync/fragment';
	import { validateModel, type ModelIssue } from '../../../services/validator';
	import { alignRects, distributeRects, type AlignMode, type Axis } from '../common/align';
	import { isMenuKey, menuItems, type MenuItem } from '../common/contextMenu';
	import { gridSettings, snapGridOf, snapIf, type Rect } from '../common/grid';
	import { clipboardShortcut, resolveShortcut } from '../common/shortcuts';
	import { FLOW_INPUT, MAX_ZOOM, MIN_ZOOM, zoomPercent } from '../common/viewport';
	import { fitPadding, presetMeasured, type Reserve } from './fit';
	import { t } from '../../shell/i18n.svelte';
	import {
		carryRenames,
		connectNodes,
		containerRenames,
		createNode,
		cutElements,
		deleteElements,
		duplicateNodes,
		groupIntoSubgraph,
		moveElements,
		pasteFragment,
		reconnectEdge,
		renameElement
	} from './commands';
	import type { EdgeEndType } from './edges';
	import ContainerNode from './ContainerNode.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import InlineEditor from './InlineEditor.svelte';
	import {
		dragGuides,
		dragMoves,
		editTarget,
		nudgeMoves,
		revealViewport,
		type EditTarget
	} from './interaction';
	import {
		canvasMeasure,
		labelFromEditor,
		toFlow,
		VISIBLE_ONLY_FROM,
		type FlowEdge,
		type FlowNode,
		type Measure
	} from './mapping';
	import ShapeNode from './ShapeNode.svelte';
	import TypedEdge from './TypedEdge.svelte';

	let {
		sync,
		measure = canvasMeasure(),
		onselect,
		oncontrol,
		onzoom,
		beforedelete,
		issues,
		reserve,
		ongrid
	}: {
		sync: SyncController;
		measure?: Measure;
		onselect?: (ids: string[]) => void;
		oncontrol?: (control: CanvasControl) => void;
		/** Zoomanzeige als Text (z. B. "100 %"); die Shell zeigt sie in der Befehlsleiste. */
		onzoom?: (percent: string) => void;
		beforedelete?: BeforeDelete;
		/**
		 * Modell-Befunde zum aktuellen Dokument (T123 C4): die Shell reicht ihren Cache durch, damit
		 * validateModel je Stand einmal läuft; ohne Angabe (Canvas allein) validiert der Canvas.
		 */
		issues?: readonly ModelIssue[];
		/** Rand der Vorschau-Karte, beim Einpassen ausgespart (M-12). */
		reserve?: Reserve | null;
		/** Raster-Sichtbarkeit (Ansichtszustand) für die Schalter der Shell (CanvasBar, T126 C1). */
		ongrid?: (shown: boolean) => void;
	} = $props();

	const commands = $derived(sync.commands);
	const nodeTypes = { shape: ShapeNode, container: ContainerNode };
	const edgeTypes = { typed: TypedEdge };

	// Getrennt abgeleitet (V-28): `editCode` veröffentlicht je Tastendruck einen neuen
	// SyncState; `flow` läuft nur, wenn sich Dokument, Richtung oder Fehlerliste ändern.
	const doc = $derived($commands.doc);
	const direction = $derived($sync.direction);
	const errors = $derived($sync.errors);
	const found = $derived(issues ?? validateModel(doc));
	const flow = $derived(toFlow(doc, { direction, errors, issues: found }, measure));
	/**
	 * Virtualisierung (V-29) ab `VISIBLE_ONLY_FROM` Knoten: kleine Diagramme rendern vollständig
	 * (Tab-Reihenfolge, Elemente außerhalb des Sichtbereichs bleiben im DOM).
	 */
	const visibleOnly = $derived(flow.nodes.length >= VISIBLE_ONLY_FROM);

	/** Raster/Snap aus doc.layout; Raster-Sichtbarkeit ist reiner Ansichtszustand. */
	const grid = $derived(gridSettings($commands.doc.layout));
	let showGrid = $state(true);
	$effect(() => ongrid?.(showGrid));

	let frameWidth = $state(0);
	let frameHeight = $state(0);
	const padding = $derived(fitPadding(reserve, { width: frameWidth, height: frameHeight }));
	/** Padding mit den Flächenmaßen zum Aufrufzeitpunkt (die Bindung folgt erst nach dem Messen). */
	const framePadding = () =>
		fitPadding(reserve, { width: wrapper.clientWidth, height: wrapper.clientHeight });

	let nodes = $state.raw<FlowNode[]>([]);
	let edges = $state.raw<FlowEdge[]>([]);

	type Point = { x: number; y: number };
	type Menu = { x: number; y: number; items: MenuItem[]; ids: string[]; at: Point };

	const api = useSvelteFlow();
	const viewport = useViewport();
	let wrapper: HTMLDivElement;
	let editing = $state<EditTarget | null>(null);
	let menu = $state<Menu | null>(null);
	let guides = $state<{ vertical: number[]; horizontal: number[] }>({
		vertical: [],
		horizontal: []
	});
	let status = $state('');

	$effect(() => onzoom?.(zoomPercent(viewport.current.zoom)));

	/**
	 * Das Initial-Einpassen kann vor der ersten Rand-Meldung laufen (Karte rendert später): bei
	 * geänderter Meldung nachpassen, nur in der Anfangsphase. `settled` beendet sie endgültig:
	 * sobald der Nutzer die Ansicht bewegt (Pan/Zoom, Controls per Maus oder Tastatur, Einpassen,
	 * Auswahl mit Zentrieren, Reveal) oder sich Modell bzw. Fehlerliste erstmals ändern (Tippen,
	 * Palette, Undo, Fehler-Render-Wechsel). Danach passt eine Rand-Meldung nie mehr ein (O-143).
	 */
	let settled = false;
	let fitted = '';
	let initial = true;
	$effect(() => {
		void doc;
		void errors;
		if (initial) initial = false;
		else settled = true;
	});
	$effect(() => {
		const key = reserve ? `${reserve.right}x${reserve.bottom}` : '';
		if (!key || key === fitted || settled) return;
		fitted = key;
		untrack(() => void api.fitView({ maxZoom: 1, padding: framePadding() }));
	});

	const selectedIds = () => [...nodes, ...edges].filter((el) => el.selected).map((el) => el.id);

	/**
	 * Zoom-Schritt über `setZoom`: `api.zoomIn/zoomOut` sind in @xyflow/svelte 1.7 beim Aufruf
	 * von `useSvelteFlow` an den Platzhalter-Store ohne panZoom gebunden und wirkungslos.
	 */
	function zoomBy(factor: number) {
		settled = true;
		const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, api.getZoom() * factor));
		void api.setZoom(zoom, { duration: 0 });
	}

	untrack(() =>
		oncontrol?.({
			zoomIn: () => zoomBy(1.2),
			zoomOut: () => zoomBy(1 / 1.2),
			fit: () => ((settled = true), void api.fitView({ padding: framePadding() })),
			viewport: () => api.getViewport(),
			select,
			selection: selectedIds,
			geometry: () => flow.geometry,
			toggleGrid: () => (showGrid = !showGrid),
			focus: () => wrapper.focus(),
			reveal,
			arrange: (item) => arrange(item, selectedIds())
		})
	);

	function select(ids: string[], center = true) {
		const picked = new Set(ids);
		nodes = nodes.map((n) => ({ ...n, selected: picked.has(n.id) }));
		edges = edges.map((e) => ({ ...e, selected: picked.has(e.id) }));
		const box = center ? flow.geometry[ids[0]] : undefined;
		if (box) {
			settled = true;
			const { zoom } = api.getViewport();
			void api.setCenter(box.x + box.w / 2, box.y + box.h / 2, { zoom, duration: 0 });
		}
	}

	/** Löschen mit optionaler Rückfrage der Shell (D-10). */
	async function remove(ids: string[], force: boolean) {
		if (beforedelete && !(await beforedelete(ids, force))) return;
		if (await run(deleteElements(ids))) keepFocus();
	}

	/**
	 * Fokus im Canvas halten, wenn das fokussierte Element entfernt wurde (Löschen, Ausschneiden):
	 * sonst fällt er auf `body`, und Folge-Kürzel (Strg+V, Entf) greifen nicht.
	 */
	function keepFocus() {
		if (!wrapper.contains(document.activeElement)) wrapper.focus();
	}

	/** Auswahl an die Shell melden, nur bei echter Änderung. */
	let reported = '';
	$effect(() => {
		const ids = selectedIds();
		const key = ids.join('\n');
		if (key === reported) return;
		reported = key;
		if (onselect) untrack(() => onselect(ids));
	});

	/**
	 * Modell -> Flow; die lokale Auswahl bleibt über Modell-Änderungen erhalten. Die DOM-Messung
	 * (`measured`) wird übernommen: ohne sie bleibt `nodesInitialized` false, solange sich die
	 * Knotengröße nicht ändert, und `fitView` läuft nie (T26 E1).
	 * Ab `VISIBLE_ONLY_FROM` Knoten werden Knoten außerhalb des Sichtbereichs nie gemessen; dort
	 * gilt die berechnete Größe als `measured` (sonst kein `nodesInitialized`, kein Einpassen).
	 * Eine abweichende DOM-Messung hat Vorrang (`presetMeasured`): der ResizeObserver meldet sie
	 * nicht erneut, sonst lägen Handles/Kanten auf der berechneten Größe.
	 */
	function resync(next = flow) {
		const picked = new Set(selectedIds());
		const preset = next.nodes.length >= VISIBLE_ONLY_FROM;
		const measured = new Map(nodes.map((n) => [n.id, n]));
		nodes = next.nodes.map((n) => {
			const prev = measured.get(n.id);
			const size = preset ? presetMeasured(n, prev) : prev?.measured;
			const keep = size ? { ...n, measured: size } : n;
			return picked.has(n.id) ? { ...keep, selected: true } : keep;
		});
		edges = next.edges.map((e) => (picked.has(e.id) ? { ...e, selected: true } : e));
	}

	$effect.pre(() => {
		const next = flow;
		untrack(() => resync(next));
	});

	/**
	 * Jede Änderung läuft als Command über den Sync-Controller (O-27). Umbenannte Container
	 * (V-13) behalten Auswahl und DOM-Messung (O-111 (5)). `true`, wenn das Dokument sich
	 * geändert hat (kein Schreibfehler, kein No-op).
	 */
	async function run(command: Command): Promise<boolean> {
		const before = doc.containers;
		const prev = nodes;
		const was = doc;
		try {
			await sync.execute(command);
			status = '';
			const renames = containerRenames(before, doc.containers);
			if (renames.size > 0) nodes = carryRenames(nodes, prev, renames);
			return doc !== was;
		} catch (err) {
			status = t('canvas.commandFailed', {
				label: command.label,
				error: err instanceof Error ? err.message : String(err)
			});
			resync();
			return false;
		}
	}

	/** Kopieren: Fragment-Text der Auswahl (nur Knoten zählen, T133). */
	function copy(ids: string[]) {
		const text = fragmentText(doc, ids);
		if (text !== null) clipboard.write(text);
	}

	/** Ausschneiden: Zwischenablage erst nach erfolgreichem Commit (sonst bliebe die Auswahl stehen). */
	async function cut(ids: string[]) {
		const command = cutElements(ids);
		if (!(await run(command))) return;
		if (command.text !== null) clipboard.write(command.text);
		keepFocus();
	}

	const PASTE_FAILED: Record<FragmentFailure, Parameters<typeof t>[0]> = {
		'too-large': 'canvas.paste.tooLarge',
		'not-flowchart': 'canvas.paste.notFlowchart',
		invalid: 'canvas.paste.invalid',
		empty: 'canvas.paste.empty',
		unsupported: 'canvas.paste.unsupported'
	};

	/**
	 * Einfügen: Text über die Prüfpfade des Datei-Öffnens (`readFragment`); ungültig -> nichts
	 * ändern, Grund melden. Nach erfolgreichem Commit die eingefügten Knoten auswählen.
	 */
	async function paste() {
		if (doc.diagramType !== 'flowchart') return;
		const text = await clipboard.read();
		if (!text) return;
		const read = await readFragment(text);
		if (!read.ok) {
			status = t(PASTE_FAILED[read.reason]);
			return;
		}
		const command = pasteFragment(read.fragment);
		if (!(await run(command))) return;
		await tick();
		select([...command.pasted], false);
		reveal(command.pasted[0]);
		if (read.dropped > 0) status = t('canvas.paste.dropped', { count: read.dropped });
	}

	/**
	 * Knoten anlegen. Im Auto-Layout platziert dagre ihn; liegt er danach nicht vollständig im
	 * Sichtbereich, wird die Ansicht bei gleichem Zoom verschoben (V-21, M-08).
	 */
	async function create(at: Point) {
		const known = new Set(doc.nodes.map((n) => n.id));
		await run(createNode(at));
		if (doc.layout.mode === 'manual') return;
		const added = doc.nodes.find((n) => !known.has(n.id));
		if (added) reveal(added.id);
	}

	/** Element (Flow-Koordinaten) bei gleichem Zoom in den Sichtbereich holen (V-21, O-123). */
	function reveal(id: string) {
		const box = flow.geometry[id];
		if (!box) return;
		const size = { width: wrapper.clientWidth, height: wrapper.clientHeight };
		const view = revealViewport(box, api.getViewport(), size);
		if (!view) return;
		settled = true;
		void api.setViewport(view, { duration: 0 });
	}

	function focusedId(): string | null {
		const el = document.activeElement?.closest('.svelte-flow__node, .svelte-flow__edge');
		return el?.getAttribute('data-id') ?? null;
	}

	function targets(): string[] {
		const picked = selectedIds();
		if (picked.length > 0) return picked;
		const id = focusedId();
		return id ? [id] : [];
	}

	function startEdit(id: string) {
		editing = editTarget(flow, id);
	}

	function endEdit(text: string | null) {
		const target = editing;
		editing = null;
		wrapper.focus();
		if (target && text !== null) run(renameElement(target.id, labelFromEditor(text)));
	}

	/** Auswahl auf genau dieses Element setzen, falls es noch nicht ausgewählt ist. */
	function selectOnly(id: string) {
		if (selectedIds().includes(id)) return;
		nodes = nodes.map((n) => ({ ...n, selected: n.id === id }));
		edges = edges.map((e) => ({ ...e, selected: e.id === id }));
	}

	function openMenu(client: Point, ids: string[]) {
		const box = wrapper.getBoundingClientRect();
		menu = {
			x: client.x - box.left,
			y: client.y - box.top,
			items: menuItems(ids.length),
			ids,
			at: snapIf(api.screenToFlowPosition(client), grid)
		};
	}

	function closeMenu() {
		menu = null;
		wrapper.focus();
	}

	function oncontext(event: MouseEvent, id?: string) {
		event.preventDefault();
		if (id) selectOnly(id);
		openMenu({ x: event.clientX, y: event.clientY }, selectedIds());
	}

	function choose(item: string) {
		const { ids, at } = menu!;
		closeMenu();
		const g = flow.geometry;
		if (item === 'create') void create(at);
		else if (item === 'edit') startEdit(ids[0]);
		else if (item === 'duplicate') run(duplicateNodes(ids, g));
		else if (item === 'delete') void remove(ids, false);
		else if (item === 'group') run(groupIntoSubgraph(ids));
		else arrange(item, ids);
	}

	/** Ausrichten/Verteilen als ein Command; Kontextmenü und CanvasBar teilen diesen Pfad. */
	function arrange(item: string, ids: string[]) {
		const g = flow.geometry;
		if (item.startsWith('align-')) {
			run(moveElements(alignRects(ids, g, item.slice(6) as AlignMode), g));
		} else if (item.startsWith('distribute-')) {
			run(moveElements(distributeRects(ids, g, item.slice(11) as Axis), g));
		}
	}

	function onkeydown(e: KeyboardEvent) {
		const canvasFocused = wrapper.contains(document.activeElement);
		if (canvasFocused && !editing && isMenuKey(e)) {
			e.preventDefault();
			const el = document.activeElement!.closest('.svelte-flow__node, .svelte-flow__edge');
			const box = (el ?? wrapper).getBoundingClientRect();
			openMenu({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, targets());
			return;
		}
		const ctx = { canvasFocused, editing: editing !== null, step: grid.size };
		const clip = clipboardShortcut(e, ctx);
		if (clip === 'paste') {
			e.preventDefault();
			void paste();
			return;
		}
		if (clip) {
			const picked = targets();
			if (picked.length === 0) return;
			e.preventDefault();
			if (clip === 'copy') copy(picked);
			else void cut(picked);
			return;
		}
		const action = resolveShortcut(e, ctx);
		const ids = action ? targets() : [];
		if (!action || ids.length === 0) return;
		e.preventDefault();
		const g = flow.geometry;
		if (action.type === 'edit') startEdit(ids[0]);
		else if (action.type === 'delete') void remove(ids, e.shiftKey);
		else if (action.type === 'duplicate') run(duplicateNodes(ids, g));
		else run(moveElements(nudgeMoves(ids, g, action.dx, action.dy), g));
	}

	function ondblclick(e: MouseEvent) {
		const el = e.target as Element;
		if (el.closest('.inline-editor')) return;
		const hit = el.closest('.svelte-flow__node, .svelte-flow__edge');
		if (hit) {
			const id = hit.getAttribute('data-id');
			if (id) startEdit(id);
		} else if (el.closest('.svelte-flow__pane')) {
			void create(snapIf(api.screenToFlowPosition({ x: e.clientX, y: e.clientY }), grid));
		}
	}

	/** Maus, Touch und Klick-Verbinden: Kante nur über das Command, nicht lokal. */
	function onbeforeconnect(c: Connection) {
		run(connectNodes(c.source, c.target));
		return false as const;
	}

	/**
	 * Kante umhängen (F-03): gezogenes Ende aus `onreconnectstart`. Ablage an einem Handle läuft
	 * über `onbeforereconnect`, Ablage auf der Knotenfläche über `onreconnectend`; beides nur als
	 * Command (`false` verhindert die lokale Änderung). Ins Leere: kein Command.
	 */
	let reconnecting: { id: string; end: EdgeEndType; done: boolean } | null = null;

	function reconnectTo(nodeId: string) {
		if (!reconnecting || reconnecting.done) return;
		reconnecting.done = true;
		run(reconnectEdge(reconnecting.id, reconnecting.end, nodeId));
	}

	function onbeforereconnect(next: FlowEdge) {
		if (reconnecting) reconnectTo(reconnecting.end === 'source' ? next.source : next.target);
		return false as const;
	}

	/** Knoten (oder Container) unter dem Zeiger beim Loslassen. */
	function nodeAt(event: MouseEvent | TouchEvent): string | null {
		const p = 'changedTouches' in event ? event.changedTouches[0] : event;
		if (!p) return null;
		for (const el of document.elementsFromPoint(p.clientX, p.clientY)) {
			const node = el.closest('.svelte-flow__node');
			if (node && wrapper.contains(node)) return node.getAttribute('data-id');
		}
		return null;
	}

	function onreconnectend(event: MouseEvent | TouchEvent) {
		if (reconnecting && !reconnecting.done) {
			const id = nodeAt(event);
			if (id) reconnectTo(id);
		}
		reconnecting = null;
	}
</script>

<!-- Fokusierbarer Canvas-Container: Einzeltasten greifen nur bei Fokus darin. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="graph-canvas"
	role="application"
	aria-label={t('canvas.graph.label')}
	tabindex="0"
	bind:this={wrapper}
	bind:clientWidth={frameWidth}
	bind:clientHeight={frameHeight}
	{onkeydown}
	{ondblclick}
	onclickcapture={(e) => {
		// xyflow-Controls (+/-/Einpassen) melden ihre Bewegung ohne sourceEvent; `click` deckt
		// Maus und Tastatur (Enter/Leertaste) ab.
		if ((e.target as Element).closest('.svelte-flow__controls')) settled = true;
	}}
>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{edgeTypes}
		connectionMode={ConnectionMode.Loose}
		deleteKey={null}
		disableKeyboardA11y
		zoomOnDoubleClick={false}
		minZoom={MIN_ZOOM}
		maxZoom={MAX_ZOOM}
		snapGrid={snapGridOf(grid)}
		{...FLOW_INPUT}
		selectionMode={SelectionMode.Partial}
		{onbeforeconnect}
		onreconnectstart={(_, edge, end) => (reconnecting = { id: edge.id, end, done: false })}
		{onbeforereconnect}
		{onreconnectend}
		onnodedrag={({ targetNode, nodes: dragged }) => {
			if (targetNode) {
				guides = dragGuides(
					targetNode,
					dragged.map((n) => n.id),
					flow
				);
			}
		}}
		onnodedragstop={({ nodes: dragged }) => {
			guides = { vertical: [], horizontal: [] };
			run(moveElements(dragMoves(dragged, flow.geometry), flow.geometry));
		}}
		onnodecontextmenu={({ event, node }) => oncontext(event, node.id)}
		onedgecontextmenu={({ event, edge }) => oncontext(event, edge.id)}
		onselectioncontextmenu={({ event }) => oncontext(event)}
		onpanecontextmenu={({ event }) => {
			event.preventDefault();
			openMenu({ x: event.clientX, y: event.clientY }, []);
		}}
		onmovestart={(event) => {
			if (event) settled = true;
		}}
		fitView
		fitViewOptions={{ maxZoom: 1, padding }}
		onlyRenderVisibleElements={visibleOnly}
	>
		{#if showGrid}
			<Background gap={grid.size} />
		{/if}
		<ViewportPortal target="front">
			{#each guides.vertical as x (x)}
				<div class="guide v" style:left="{x}px"></div>
			{/each}
			{#each guides.horizontal as y (y)}
				<div class="guide h" style:top="{y}px"></div>
			{/each}
		</ViewportPortal>
		{#if editing}
			{#key editing.id}
				<ViewportPortal target="front">
					<InlineEditor
						target={editing}
						oncommit={(text) => endEdit(text)}
						oncancel={() => endEdit(null)}
					/>
				</ViewportPortal>
			{/key}
		{/if}
		<Controls showLock={false} />
		<!-- Befunde und Rohblöcke oben links gestapelt: unten links liegen die xyflow-Controls (O-141). -->
		{#if flow.canvasIssues.length > 0 || flow.rawBlocks.length > 0}
			<Panel position="top-left">
				<div class="notes">
					{#if flow.canvasIssues.length > 0}
						<ul class="issues" data-testid="canvas-issues" role="status">
							{#each flow.canvasIssues as issue, i (i)}
								<li class={issue.severity}>{issue.icon} {issue.text}</li>
							{/each}
						</ul>
					{/if}
					{#if flow.rawBlocks.length > 0}
						<ul class="raw" data-testid="raw-blocks">
							{#each flow.rawBlocks as block (block.id)}
								<li><code>{block.text}</code> <em>{block.note}</em></li>
							{/each}
						</ul>
					{/if}
				</div>
			</Panel>
		{/if}
	</SvelteFlow>
	{#if menu}
		<ContextMenu items={menu.items} x={menu.x} y={menu.y} onselect={choose} onclose={closeMenu} />
	{/if}
	<p class="status" role="status" aria-live="polite">{status}</p>
</div>

<style>
	.graph-canvas {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 300px;
	}
	ul {
		margin: 0;
		padding: 4px 8px;
		list-style: none;
		background: var(--panel-bg, #fff);
		color: var(--text, inherit);
		border: 1px solid var(--line, transparent);
		border-radius: 8px;
		font-size: 12px;
	}
	.notes {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
	}
	/* Lange Parser-Meldungen und Rohblöcke umbrechen (CanvasBar liegt seit T126 C1 über der Fläche). */
	.issues,
	.raw {
		max-width: min(32rem, 50vw);
		overflow-wrap: anywhere;
	}
	.guide {
		position: absolute;
		pointer-events: none;
		border: 0 dashed var(--focus, #1c5fd1);
	}
	.guide.v {
		top: -100000px;
		height: 200000px;
		border-left-width: 1px;
	}
	.guide.h {
		left: -100000px;
		width: 200000px;
		border-top-width: 1px;
	}
	.status {
		position: absolute;
		bottom: 0;
		right: 0;
		margin: 0;
		font-size: 12px;
	}
	.error {
		color: var(--err, #a51d2d);
	}
</style>
