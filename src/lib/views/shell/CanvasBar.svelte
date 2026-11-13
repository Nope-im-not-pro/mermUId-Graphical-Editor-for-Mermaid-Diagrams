<!--
	Befehlsleiste über dem Canvas (Entwurf A): Rückgängig/Wiederholen, Alles auswählen, Layout
	Auto/Manuell, Richtung TD/LR, Ausrichten/Verteilen (T126 C2, F-04: dieselben Einträge und
	Commands wie das Kontextmenü), Raster/Einrasten, Zoom mit Zoomwert und Einpassen. Icon-Buttons mit aria-label,
	Kürzel im Tooltip. Eigene Zeile über der Canvas-Fläche (feste Zone, V-15), bricht bei
	schmaler Fläche um statt Knöpfe zu verdecken.
-->
<script lang="ts">
	import type { LayoutMeta } from '../../model/types';
	import { ALIGN_MIN, DISTRIBUTE_MIN } from '../canvas/common/align';
	import { menuItems } from '../canvas/common/contextMenu';
	import ContextMenu from '../canvas/graph/ContextMenu.svelte';
	import { t } from './i18n.svelte';
	import Icon from './Icon.svelte';

	let {
		canUndo,
		canRedo,
		canZoom,
		canSelectAll,
		layout,
		zoom,
		grid,
		arrangeable,
		direction,
		onlayout,
		onundo,
		onredo,
		onselectall,
		onzoomout,
		onzoomin,
		onfit,
		ongrid,
		onsnap,
		onarrange,
		ondirection
	}: {
		canUndo: boolean;
		canRedo: boolean;
		canZoom: boolean;
		canSelectAll: boolean;
		/** Layout-Modus; `null` außerhalb der Layout-Klasse Graph. */
		layout: LayoutMeta['mode'] | null;
		/** Zoomanzeige ("100 %"); `null` ohne zoombaren Canvas. */
		zoom: string | null;
		/** Raster sichtbar / Einrasten (T126 C1); `null` ohne Raster-Canvas. */
		grid: { shown: boolean; snap: boolean } | null;
		/** Ausrichtbare ausgewählte Knoten (T126 C2); `null` ohne Graph-Canvas. */
		arrangeable: number | null;
		/** Diagrammrichtung der Deklaration (`TD`, `LR`, ..., leer); `null` ohne Flowchart. */
		direction: string | null;
		onlayout: (mode: LayoutMeta['mode']) => void;
		onundo: () => void;
		onredo: () => void;
		onselectall: () => void;
		onzoomout: () => void;
		onzoomin: () => void;
		onfit: () => void;
		ongrid: () => void;
		onsnap: () => void;
		/** Gewählter Eintrag (`align-*`, `distribute-*`) wie im Kontextmenü. */
		onarrange: (item: string) => void;
		ondirection: (direction: 'TD' | 'LR') => void;
	} = $props();

	type Pop = 'align' | 'distribute';
	const DIRECTIONS = ['TD', 'LR'] as const;
	const canAlign = $derived((arrangeable ?? 0) >= ALIGN_MIN);
	const canDistribute = $derived((arrangeable ?? 0) >= DISTRIBUTE_MIN);
	/** Ohne Angabe gilt TB (mermaid-Standard), TB und TD zeigen beide "TD". */
	const shownDirection = $derived(
		direction === null ? null : ['', 'TB', 'TD'].includes(direction) ? 'TD' : direction
	);
	/** Menü-Einträge aus dem Kontextmenü (gleiche IDs, gleiche Commands im Canvas). */
	const entries = (pop: Pop) =>
		menuItems(DISTRIBUTE_MIN).filter((item) => item.id.startsWith(`${pop}-`));

	let open = $state<Pop | null>(null);
	/** Offen nur, solange die Auswahl die Schwelle erfüllt. */
	const shown = $derived(
		open === 'align' && canAlign ? open : open === 'distribute' && canDistribute ? open : null
	);
	$effect(() => {
		if (open !== null && shown === null) open = null;
	});
	const triggers: Partial<Record<Pop, HTMLButtonElement>> = {};
	let pos = $state({ x: 0, y: 0 });
	/** Esc/Tab im Menü: Fokus zurück auf den Knopf; Fokuswechsel nach außen lässt ihn dort. */
	let refocus = false;
	/**
	 * Menü war beim pointerdown auf seinen Knopf offen: focusout schließt es vor dem click, der
	 * click darf es dann nicht wieder öffnen (zweiter Klick schließt). Ohne Timer gelöscht (der
	 * click kann auf Touch in einem späteren Task folgen): jedes pointerdown (Capture, vor dem
	 * Setzen am Knopf), jeder click (nach dem Knopf), Tasten, pointercancel und pointerup außerhalb
	 * des Knopfs (Zeiger weggezogen: kein click auf den Knopf). Trefferprüfung über die Koordinaten,
	 * nicht `e.target`: Touch hält Pointer-Capture, das Ziel bleibt dann der Knopf.
	 */
	let wasOpen: Pop | null = null;
	const clearMark = () => (wasOpen = null);
	function onpointerup(e: PointerEvent) {
		if (wasOpen === null) return;
		const r = triggers[wasOpen]?.getBoundingClientRect();
		const hit =
			r !== undefined &&
			e.clientX >= r.left &&
			e.clientX <= r.right &&
			e.clientY >= r.top &&
			e.clientY <= r.bottom;
		if (!hit) wasOpen = null;
	}

	function toggle(pop: Pop) {
		const reopen = wasOpen !== pop;
		wasOpen = null;
		if (!reopen) {
			open = null;
			return;
		}
		const el = triggers[pop]!;
		pos = { x: el.offsetLeft, y: el.offsetTop + el.offsetHeight + 4 };
		refocus = false;
		open = pop;
	}

	function close() {
		const pop = shown;
		open = null;
		if (pop && refocus) triggers[pop]?.focus();
	}

	function choose(item: string) {
		refocus = true;
		close();
		onarrange(item);
	}
</script>

<svelte:window
	onpointerdowncapture={clearMark}
	{onpointerup}
	onpointercancel={clearMark}
	onclick={clearMark}
/>

<div class="cmdbar" role="toolbar" aria-label={t('app.canvasBar.label')}>
	<button
		type="button"
		aria-label={t('app.canvasBar.undo')}
		title={t('app.canvasBar.undoTitle')}
		disabled={!canUndo}
		onclick={onundo}><Icon name="undo" /></button
	>
	<button
		type="button"
		aria-label={t('app.canvasBar.redo')}
		title={t('app.canvasBar.redoTitle')}
		disabled={!canRedo}
		onclick={onredo}><Icon name="redo" /></button
	>
	<span class="sep" aria-hidden="true"></span>
	<button
		type="button"
		aria-label={t('app.canvasBar.selectAll')}
		title={t('app.canvasBar.selectAllTitle')}
		disabled={!canSelectAll}
		onclick={onselectall}><Icon name="select" /></button
	>
	<span class="sep" aria-hidden="true"></span>
	<div class="seg" role="group" aria-label={t('app.canvasBar.layout')}>
		<button
			type="button"
			disabled={layout === null}
			aria-pressed={layout === 'auto'}
			onclick={() => onlayout('auto')}>{t('app.canvasBar.auto')}</button
		>
		<button
			type="button"
			disabled={layout === null}
			aria-pressed={layout === 'manual'}
			onclick={() => onlayout('manual')}>{t('app.canvasBar.manual')}</button
		>
	</div>
	<span class="sep" aria-hidden="true"></span>
	<div class="seg" role="group" aria-label={t('canvasBar.direction')}>
		{#each DIRECTIONS as dir (dir)}
			<button
				type="button"
				title={shownDirection === null
					? t('canvasBar.flowchartOnly')
					: t(`canvasBar.direction${dir}`)}
				disabled={shownDirection === null}
				aria-pressed={shownDirection === dir}
				onclick={() => shownDirection !== dir && ondirection(dir)}>{dir}</button
			>
		{/each}
	</div>
	<span class="sep" aria-hidden="true"></span>
	<span
		class="arrange"
		onkeydowncapture={(e) => {
			refocus = e.key === 'Escape' || e.key === 'Tab';
			wasOpen = null;
		}}
	>
		<button
			type="button"
			class="text"
			bind:this={triggers.align}
			aria-label={t('canvasBar.align')}
			title={arrangeable === null
				? t('canvasBar.flowchartOnly')
				: canAlign
					? t('canvasBar.alignTitle')
					: t('canvasBar.alignNeeds', { count: ALIGN_MIN })}
			aria-haspopup="menu"
			aria-expanded={shown === 'align'}
			disabled={!canAlign}
			onpointerdown={() => (wasOpen = shown === 'align' ? 'align' : null)}
			onclick={() => toggle('align')}>{t('canvasBar.align')}</button
		>
		<button
			type="button"
			class="text"
			bind:this={triggers.distribute}
			aria-label={t('canvasBar.distribute')}
			title={arrangeable === null
				? t('canvasBar.flowchartOnly')
				: canDistribute
					? t('canvasBar.distributeTitle')
					: t('canvasBar.distributeNeeds', { count: DISTRIBUTE_MIN })}
			aria-haspopup="menu"
			aria-expanded={shown === 'distribute'}
			disabled={!canDistribute}
			onpointerdown={() => (wasOpen = shown === 'distribute' ? 'distribute' : null)}
			onclick={() => toggle('distribute')}>{t('canvasBar.distribute')}</button
		>
		{#if shown}
			<ContextMenu items={entries(shown)} x={pos.x} y={pos.y} onselect={choose} onclose={close} />
		{/if}
	</span>
	<span class="sep" aria-hidden="true"></span>
	<div class="seg" role="group" aria-label={t('canvasBar.grid')}>
		<button
			type="button"
			title={t('canvasBar.gridTitle')}
			disabled={grid === null}
			aria-pressed={grid?.shown ?? false}
			onclick={ongrid}>{t('canvasBar.grid')}</button
		>
		<button
			type="button"
			title={t('canvasBar.snapTitle')}
			disabled={grid === null}
			aria-pressed={grid?.snap ?? false}
			onclick={onsnap}>{t('canvasBar.snap')}</button
		>
	</div>
	<span class="sep" aria-hidden="true"></span>
	<button
		type="button"
		aria-label={t('app.canvasBar.zoomOut')}
		title={t('app.canvasBar.zoomOutTitle')}
		disabled={!canZoom}
		onclick={onzoomout}><Icon name="minus" /></button
	>
	{#if zoom !== null}<span class="zoom-val" data-testid="zoom">{zoom}</span>{/if}
	<button
		type="button"
		aria-label={t('app.canvasBar.zoomIn')}
		title={t('app.canvasBar.zoomInTitle')}
		disabled={!canZoom}
		onclick={onzoomin}><Icon name="plus" /></button
	>
	<button
		type="button"
		aria-label={t('app.canvasBar.fit')}
		title={t('app.canvasBar.fitTitle')}
		disabled={!canZoom}
		onclick={onfit}><Icon name="fit" /></button
	>
</div>

<style>
	/* Eigene Rasterzeile in `.center` (Workspace), mittig; Umbruch statt Überlagerung. */
	.cmdbar {
		position: relative;
		justify-self: center;
		max-width: calc(100% - 16px);
		margin: 8px 8px 6px;
		z-index: 6;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 2px;
		padding: 4px;
		background: color-mix(in srgb, var(--surface) 88%, transparent);
		backdrop-filter: blur(12px);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow);
	}
	.cmdbar > button {
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		background: transparent;
		display: grid;
		place-items: center;
	}
	.cmdbar > button:hover:not(:disabled) {
		background: var(--surface-3);
	}
	/* Ausrichten/Verteilen: Textknöpfe; das Menü liegt absolut unter dem Knopf (Bezug: .cmdbar). */
	.arrange {
		display: contents;
	}
	.arrange .text {
		border: 0;
		background: transparent;
		height: 32px;
		padding: 0 8px;
		border-radius: 6px;
		font-size: 12.5px;
		white-space: nowrap;
	}
	.arrange .text:hover:not(:disabled) {
		background: var(--surface-3);
	}
	.seg {
		display: inline-flex;
		background: var(--surface-3);
		border-radius: 8px;
		padding: 2px;
	}
	.seg button {
		border: 0;
		background: transparent;
		height: 28px;
		padding: 0 10px;
		border-radius: 6px;
		font-size: 12.5px;
		white-space: nowrap;
	}
	.seg button[aria-pressed='true'] {
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		box-shadow: 0 1px 3px #0004;
	}
	.zoom-val {
		font: 12px var(--mono);
		color: var(--text-2);
		width: 44px;
		text-align: center;
	}
	.sep {
		width: 1px;
		height: 20px;
		margin: 0 4px;
		background: var(--line);
	}
</style>
