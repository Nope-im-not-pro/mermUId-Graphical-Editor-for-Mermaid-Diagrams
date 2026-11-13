<!--
	Arbeitsfläche der Shell (T123 C4, V-24): Befehlsleiste, Canvas-Fläche mit Fehlerhinweis
	(Abstand zu den Bedienelementen, O-58), Graph- bzw. Sequenz-Canvas, Palette-Einfügen per Klick
	und Drop, Vorschau-Streifen. Befehle laufen über `run` der Shell (Meldungen dort).
	Feste Zonen (T126 C1, V-15): CanvasBar als eigene Rasterzeile über der Fläche (flowchart und
	sequence gleich), Vorschau-Karte unten rechts mit reserviertem Rand (M-12 a): Graph spart ihn
	beim Einpassen aus, Sequenz rückt Outline und Status links davon ein.
	Zoom der CanvasBar auch im Sequenz-Canvas (T126 C3): Knöpfe wirken auf das aktive Control,
	Sequenz-Einpassen spart die Karte ebenfalls aus.
	Ausrichten/Verteilen/Richtung (T126 C2, F-04): Ausrichten über den Canvas-Pfad des Kontextmenüs,
	Richtung über den Command des Eigenschaften-Panels.
-->
<script lang="ts" module>
	import type { Reserve } from '../canvas/graph/fit';

	type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
	/** Lücke zwischen Karte und Inhalt. */
	const RESERVE_GAP = 8;

	/**
	 * Von der Vorschau-Karte belegter Rand der Canvas-Fläche: Abstand der Kartenkante zum rechten
	 * bzw. unteren Flächenrand plus Lücke; ohne Karte, ohne Maße oder außerhalb: `null`.
	 */
	export function reserveOf(canvas: Box, card: Box | null): Reserve | null {
		if (!card || card.width <= 0 || card.height <= 0) return null;
		const right = canvas.right - card.left;
		const bottom = canvas.bottom - card.top;
		if (right <= 0 || bottom <= 0) return null;
		return { right: right + RESERVE_GAP, bottom: bottom + RESERVE_GAP };
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import type { Command } from '../../controllers/commands/history';
	import type { SyncController } from '../../controllers/sync';
	import type { LayoutMeta } from '../../model/types';
	import type { RenderResult } from '../../services/render';
	import type { ModelIssue } from '../../services/validator';
	import { arrangeable } from '../canvas/common/align';
	import { gridSettings } from '../canvas/common/grid';
	import GraphCanvas from '../canvas/graph/GraphCanvas.svelte';
	import { setLayoutOption } from '../canvas/graph/commands';
	import type { BeforeDelete, CanvasControl } from '../canvas/graph/GraphFlow.svelte';
	import { documentOrder, type Measure } from '../canvas/graph/mapping';
	import SequenceCanvas, { type SequenceControl } from '../canvas/sequence/SequenceCanvas.svelte';
	import type { JumpTarget } from '../panels/errors';
	import { commandFor } from '../panels/properties';
	import Banner, { type BannerInset } from './Banner.svelte';
	import CanvasBar from './CanvasBar.svelte';
	import { watchInset, type Banner as BannerState, type BannerAction } from './banner';
	import { t } from './i18n.svelte';
	import {
		canvasPoint,
		centerClient,
		DRAG_TYPE,
		layoutModeCommand,
		placeQueue,
		toolById
	} from './palette';
	import Preview from './Preview.svelte';

	let {
		sync,
		render,
		measure,
		locked,
		previewOpen,
		banner,
		issues,
		armed = $bindable(),
		control = $bindable(),
		run,
		onundo,
		onredo,
		ontogglepreview,
		onseqcontrol,
		onbanneraction,
		onjump,
		onselect,
		beforedelete
	}: {
		sync: SyncController;
		render: (code: string) => Promise<RenderResult>;
		measure?: Measure;
		locked: string | null;
		previewOpen: boolean;
		banner: BannerState | null;
		issues: readonly ModelIssue[];
		armed: string | null;
		control: CanvasControl | null;
		run: (command: Command) => Promise<void>;
		onundo: () => void;
		onredo: () => void;
		ontogglepreview: () => void;
		onseqcontrol: (control: SequenceControl) => void;
		onbanneraction: (id: BannerAction) => void;
		onjump: (target: JumpTarget) => void;
		onselect: (ids: string[]) => void;
		beforedelete: BeforeDelete;
	} = $props();

	const commands = $derived(sync.commands);
	const graph = $derived($sync.mode === 'flowchart');
	const gc = $derived(graph ? control : null);
	/** Sequenz-Control (O-124); CanvasBar-Zoom wählt das aktive Control (T126 C3). */
	let seqControl = $state<SequenceControl | null>(null);
	const zc = $derived(gc ?? ($sync.mode === 'sequence' ? seqControl : null));
	let zoom = $state<string | null>(null);
	let canvasBox = $state<HTMLDivElement>();
	let layoutBusy = false;
	/** Raster-Sichtbarkeit meldet der Graph-Canvas; Einrasten steht im Modell. */
	let gridShown = $state(true);
	const grid = $derived(
		gc !== null ? { shown: gridShown, snap: gridSettings($commands.doc.layout).snap } : null
	);

	/** Auswahl des Graph-Canvas; ausrichtbar sind nur Elemente mit Geometrie (keine Kanten). */
	let selection = $state<string[]>([]);
	// Ein neu eingehängter Graph-Canvas meldet seine leere Anfangsauswahl nicht.
	$effect.pre(() => {
		if (!graph) selection = [];
	});
	const arrange = $derived(gc !== null ? arrangeable(selection, gc.geometry()) : null);
	const direction = $derived(graph ? $sync.direction : null);

	/** Richtung über den Command des Eigenschaften-Panels; gleicher Wert: kein Command. */
	function setDirection(dir: 'TD' | 'LR') {
		const command = commandFor($commands.doc, null, 'docDirection', dir);
		if (command) void run(command);
	}

	/** Rand der Vorschau-Karte (M-12 a), nachgeführt bei Größenänderung von Fläche oder Karte. */
	let reserve = $state<Reserve | null>(null);
	$effect(() => {
		const box = canvasBox;
		const card = box?.parentElement?.querySelector<HTMLElement>(':scope > .preview');
		if (!box || !card || locked !== null) {
			reserve = null;
			return;
		}
		const update = () =>
			(reserve = reserveOf(box.getBoundingClientRect(), card.getBoundingClientRect()));
		update();
		const observer = new ResizeObserver(update);
		observer.observe(box);
		observer.observe(card);
		return () => observer.disconnect();
	});

	/** Abstände des Fehlerhinweises zu den Bedienelementen der Fläche (O-58, T101 C3). */
	let bannerInset = $state<BannerInset>({});
	$effect(() => {
		const box = canvasBox;
		if (banner?.kind !== 'error' || !box) return;
		return watchInset(box, graph, (inset) => (bannerInset = inset));
	});

	/** Palette-Einfügen; danach den eigenen neuen Knoten ins Sichtfeld holen (O-118, O-123). */
	const placing = placeQueue(
		() => $commands.doc.nodes.map((n) => n.id),
		(id) => control?.reveal(id)
	);

	function place(
		id: string,
		client: { x: number; y: number },
		onadded?: (id: string) => Promise<void>
	) {
		const tool = toolById(id);
		if (!tool || !gc || !canvasBox) return;
		const at = canvasPoint(
			client,
			canvasBox.getBoundingClientRect(),
			gc.viewport(),
			gridSettings($commands.doc.layout)
		);
		void placing(() => run(tool.command(at)), onadded);
	}

	/**
	 * Enter auf dem bewaffneten Paletten-Werkzeug (T129 C2, V-32): Mitte des sichtbaren
	 * Ausschnitts, ein Undo-Schritt. Danach Auswahl und Fokus auf dem neuen Knoten; im
	 * Auto-Layout (dagre platziert) zentriert die Auswahl die Ansicht auf ihn.
	 */
	export function placeCentered(id: string) {
		if (!gc || !canvasBox) return;
		const client = centerClient(canvasBox.getBoundingClientRect(), gc.viewport().zoom);
		place(id, client, async (added) => {
			// Erst nach dem Flush kennt der Canvas den neuen Knoten (Auswahl setzt Flow-Knoten).
			await tick();
			control?.select([added], $commands.doc.layout.mode !== 'manual');
			control?.focus();
		});
	}

	function canvasClick(e: MouseEvent) {
		const el = e.target as Element;
		if (!armed || !el.closest('.svelte-flow__pane') || el.closest('.svelte-flow__node')) return;
		place(armed, { x: e.clientX, y: e.clientY });
		armed = null;
	}

	function dragover(e: DragEvent) {
		if (!graph || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}

	function drop(e: DragEvent) {
		const id = e.dataTransfer?.getData(DRAG_TYPE);
		if (!graph || !id) return;
		e.preventDefault();
		place(id, { x: e.clientX, y: e.clientY });
	}

	/**
	 * Layout-Umschalter: gleicher Modus erzeugt keinen (leeren) Undo-Schritt; solange ein
	 * Wechsel läuft, wird ein zweiter Klick ignoriert (In-Flight-Flag).
	 */
	async function setLayout(mode: LayoutMeta['mode']) {
		if (layoutBusy || mode === $commands.doc.layout.mode) return;
		layoutBusy = true;
		try {
			await run(layoutModeCommand(mode));
		} finally {
			layoutBusy = false;
		}
	}

	const jumpLine = (l: { line: number; column: number }) =>
		onjump({ type: 'line', line: l.line, column: l.column });
</script>

<div class="center">
	<CanvasBar
		canUndo={$commands.canUndo}
		canRedo={$commands.canRedo}
		canZoom={zc !== null}
		canSelectAll={gc !== null}
		layout={graph ? $commands.doc.layout.mode : null}
		zoom={zc !== null ? zoom : null}
		{grid}
		arrangeable={arrange}
		{direction}
		onlayout={setLayout}
		{onundo}
		{onredo}
		onselectall={() => gc?.select(documentOrder($commands.doc), false)}
		onzoomout={() => zc?.zoomOut()}
		onzoomin={() => zc?.zoomIn()}
		onfit={() => zc?.fit()}
		ongrid={() => gc?.toggleGrid()}
		onsnap={() => {
			if (grid) void run(setLayoutOption({ snap: !grid.snap }));
		}}
		onarrange={(item) => gc?.arrange(item)}
		ondirection={setDirection}
	/>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="shell-canvas"
		class:armed={armed !== null}
		style:--reserve-right={reserve ? `${reserve.right}px` : null}
		bind:this={canvasBox}
		onclick={canvasClick}
		ondragover={dragover}
		ondrop={drop}
	>
		<!-- Fehler-Hinweis in der Fläche, gegenüber der CanvasBar (O-58/O-50). -->
		{#if banner?.kind === 'error'}
			<Banner
				{banner}
				placement={graph ? 'bottom' : 'top'}
				inset={bannerInset}
				onaction={onbanneraction}
				onjump={jumpLine}
			/>
		{/if}
		{#if graph}
			<GraphCanvas
				{sync}
				{measure}
				onselect={(ids: string[]) => ((selection = ids), onselect(ids))}
				oncontrol={(c: CanvasControl) => (control = c)}
				onzoom={(z: string) => (zoom = z)}
				{beforedelete}
				{issues}
				{reserve}
				ongrid={(shown: boolean) => (gridShown = shown)}
			/>
		{:else if $sync.mode === 'sequence'}
			<SequenceCanvas
				{sync}
				{onselect}
				oncontrol={(c: SequenceControl) => ((seqControl = c), onseqcontrol(c))}
				onzoom={(z: string) => (zoom = z)}
				{reserve}
				{beforedelete}
			/>
		{:else}
			<p class="placeholder">
				{t('app.shell.codeOnly')}
			</p>
		{/if}
	</div>
	<Preview code={$sync.code} open={previewOpen} {render} {locked} ontoggle={ontogglepreview} />
</div>

<style>
	/* Zonen: Zeile 1 CanvasBar, Zeile 2 Fläche; die Vorschau-Karte liegt in der Fläche unten rechts. */
	.center {
		position: relative;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		/* Spalte explizit: die implizite `auto`-Spur wüchse auf die min-content-Breite der Fläche
		   (Sequenz-SVG bei hohem Zoom) und schöbe sie aus dem Fenster, statt zu scrollen. */
		grid-template-columns: minmax(0, 1fr);
		min-height: 0;
		min-width: 0;
		background: var(--bg);
	}
	.shell-canvas {
		position: relative;
		min-height: 0;
	}
	/* Vorschau-Karte in der Zone der Fläche (Zeile 2): unten rechts bzw. gesperrt flächenfüllend. */
	.center > :global(.preview) {
		grid-row: 2;
		grid-column: 1;
	}
	.shell-canvas.armed {
		cursor: crosshair;
	}
	.placeholder {
		margin: 0;
		padding: 72px 1rem 1rem;
		color: var(--text-2);
	}
</style>
