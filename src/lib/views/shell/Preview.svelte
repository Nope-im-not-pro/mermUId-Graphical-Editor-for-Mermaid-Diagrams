<script lang="ts">
	import type { RenderResult } from '../../services/render';
	import { showMermaid, type MermaidView } from '../help/svg';
	import { currentLocale, t } from './i18n.svelte';

	let {
		code,
		open,
		render,
		locked,
		ontoggle
	}: {
		code: string;
		open: boolean;
		render: (code: string) => Promise<RenderResult>;
		/** Grund, falls die Vorschau fest offen ist (Modus "nur Code"), sonst `null`. */
		locked: string | null;
		ontoggle: () => void;
	} = $props();

	/** Verzögerung nach der letzten Code-Änderung, bevor neu gerendert wird (V-28). */
	const DEBOUNCE_MS = 300;

	let body = $state<HTMLDivElement>();
	/** Ergebnis der letzten Darstellung für die Kopfanzeige; `null` solange die erste läuft. */
	let rendered = $state<boolean | null>(null);
	/** Laufende Darstellung; Folgeaufträge warten darauf, damit nur der neueste rendert. */
	let busy: Promise<void> | null = null;

	/** Altes Ergebnis (SVG oder Fehlertext) im Streifen; der Ladetext zählt nicht (O-94). */
	const hasResult = (el: HTMLElement) => el.querySelector('svg, .help-error') !== null;

	/**
	 * Ohne altes Ergebnis: sofort mit Ladetext (O-31 über `showMermaid`), auch solange noch eine
	 * Darstellung läuft (Sprachwechsel, Edit, Schließen/Öffnen). Mit Ergebnis: erst nach
	 * `DEBOUNCE_MS` und in einen losen Container, der Streifen behält das alte bis zum neuen.
	 * Läuft noch eine Darstellung, wartet der Auftrag; überholte Aufträge (`live` false) rendern
	 * nie, das Ergebnis einer überholten laufenden Darstellung wird verworfen (`cancel`).
	 */
	$effect(() => {
		const el = body;
		const text = code;
		const fn = render;
		// Sprache synchron als Abhängigkeit: spätere Renders laufen aus Timer/`busy.then`.
		currentLocale();
		if (!el) return;
		let live = true;
		let view: MermaidView | null = null;
		const run = () => {
			if (!live) return;
			const fresh = !hasResult(el);
			if (fresh) {
				rendered = null;
				el.setAttribute('aria-busy', 'true');
				el.textContent = t('help.loading');
			}
			if (busy) {
				void busy.then(run);
				return;
			}
			const into = fresh ? el : document.createElement('div');
			if (!fresh) el.setAttribute('aria-busy', 'true');
			const current = showMermaid(into, text, fn);
			view = current;
			busy = current.done.then(() => {
				busy = null;
				if (!live) return;
				if (!fresh) {
					el.replaceChildren(...into.childNodes);
					el.setAttribute('aria-busy', 'false');
				}
				rendered = el.querySelector('svg') !== null;
			});
		};
		const timer = hasResult(el) ? setTimeout(run, DEBOUNCE_MS) : undefined;
		if (timer === undefined) run();
		return () => {
			live = false;
			clearTimeout(timer);
			view?.cancel();
		};
	});
</script>

<section
	class="preview"
	class:locked={locked !== null}
	class:open
	class:stated={open && rendered !== null}
	aria-label={t('app.preview.label')}
>
	<!-- Zugänglicher Name = sichtbarer Text (WCAG 2.5.3), Zustand über aria-expanded. -->
	<button
		type="button"
		aria-expanded={open}
		disabled={locked !== null}
		title={locked ?? undefined}
		aria-describedby={locked === null ? undefined : 'preview-locked'}
		onclick={ontoggle}>{open ? t('app.preview.collapse') : t('app.preview.expand')}</button
	>
	{#if open && rendered !== null}
		<span class="state" class:ok={rendered}
			>{rendered ? t('app.preview.rendered') : t('app.preview.error')}</span
		>
	{/if}
	{#if locked !== null}
		<span id="preview-locked" class="visually-hidden">{locked}</span>
	{/if}
	{#if open}
		<div class="preview-body" bind:this={body}></div>
	{/if}
</section>

<style>
	/* Entwurf A: schwebende Vorschau-Karte unten rechts über dem Canvas. */
	.preview {
		position: absolute;
		right: 14px;
		bottom: 14px;
		z-index: 6;
		width: min(220px, calc(100% - 28px));
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-rows: auto 1fr;
		background: color-mix(in srgb, var(--surface) 90%, transparent);
		backdrop-filter: blur(10px);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	/* Modus "nur Code": die Vorschau ist die Hauptansicht. */
	.preview.locked {
		top: 14px;
		left: 14px;
		width: auto;
	}
	button {
		grid-column: 1 / -1;
		grid-row: 1;
		border: 0;
		border-radius: 0;
		background: transparent;
		padding: 6px 10px;
		text-align: left;
		font-size: 11.5px;
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Platz für den Status rechts, Knopftext kürzt sich mit Auslassung. */
	.stated button {
		padding-right: 84px;
	}
	button:hover:not(:disabled) {
		color: var(--text);
	}
	.open button {
		border-bottom: 1px solid var(--line);
	}
	.state {
		grid-column: 2;
		grid-row: 1;
		align-self: center;
		margin-right: 10px;
		pointer-events: none;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		color: var(--err);
	}
	.state::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.state.ok {
		color: var(--ok);
	}
	.preview-body {
		grid-column: 1 / -1;
		max-height: min(28vh, 220px);
		overflow: auto;
		padding: 8px;
		/* Mermaid rendert mit hellem Standard-Theme: eigenes helles Blatt. */
		background: var(--paper);
		color: #151824;
	}
	.locked .preview-body {
		flex: 1;
		max-height: none;
	}
	.preview-body :global(svg) {
		display: block;
		max-width: 100%;
		height: auto;
		margin: 0 auto;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
