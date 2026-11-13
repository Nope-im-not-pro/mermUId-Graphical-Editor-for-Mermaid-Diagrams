<!--
	Export-Dialog (T21 C3, KONZEPT §9, D-04): Quelle Mermaid-Render oder Editor-SVG (nur Layout-
	Klasse Graph), Format SVG, PNG 1x/2x/3x transparent oder mit Hintergrund (Theme-Farbe oder
	freier Wert), Rand px, Copy-as-Markdown mit Schalter "Layout einbetten" (nicht bei sequence,
	T127 C1). Das Erzeugen übernimmt die Shell über services/export.
	T127 C2 (F-08): "SVG kopieren"/"PNG kopieren"; ohne Unterstützung aria-disabled (fokussierbar,
	Klick ohne Wirkung) mit Hinweis per aria-describedby.
-->
<script lang="ts">
	import { canCopy, DEFAULT_MARGIN, MAX_MARGIN, type PngScale } from '../../services/export';
	import type { ExportOptions } from './exporting';
	import { focusTrap } from './focusTrap';
	import { t } from './i18n.svelte';

	let {
		initial,
		editor,
		selection = false,
		onexport,
		oncancel
	}: {
		initial: ExportOptions;
		/** Editor-SVG wählbar (Layout-Klasse Graph). */
		editor: boolean;
		/** Auswahl-Export wählbar (Graph mit Auswahl). */
		selection?: boolean;
		onexport: (options: ExportOptions) => void;
		oncancel: () => void;
	} = $props();

	const uid = $props.id();
	const start = () => ({ ...initial });
	let options = $state(start());
	let scale = $state(String(start().scale));
	/** Zahlenfeld: leer -> `null`; Prüfung (Ganzzahl 0..512) im Export. */
	let margin = $state<number | null>(start().margin ?? DEFAULT_MARGIN);
	const copyable = { svg: canCopy('svg'), png: canCopy('png') };

	function send(copy: boolean) {
		const editorSource = options.source === 'editor';
		onexport({
			...options,
			scale: Number(scale) as PngScale,
			margin: margin ?? Number.NaN,
			theme: editorSource && options.theme,
			selection: editorSource && selection && options.selection,
			copy
		});
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		send(false);
	}
</script>

<div class="dialog-backdrop" aria-hidden="true" onclick={oncancel}></div>
<div
	class="dialog"
	role="dialog"
	aria-modal="true"
	aria-labelledby="{uid}-title"
	tabindex="-1"
	{@attach focusTrap(oncancel)}
>
	<h2 id="{uid}-title">{t('app.export.title')}</h2>
	<form onsubmit={submit}>
		<fieldset>
			<legend>{t('app.export.format')}</legend>
			<label
				><input type="radio" name="{uid}-format" value="svg" bind:group={options.format} /> SVG</label
			>
			<label
				><input type="radio" name="{uid}-format" value="png" bind:group={options.format} /> PNG</label
			>
			<label
				><input type="radio" name="{uid}-format" value="markdown" bind:group={options.format} />
				{t('app.export.markdown')}</label
			>
		</fieldset>
		{#if options.format === 'markdown'}
			{#if options.embedLayout !== false}
				<label><input type="checkbox" bind:checked={options.embed} /> {t('app.export.embed')}</label
				>
			{/if}
		{:else}
			<fieldset>
				<legend>{t('app.export.source')}</legend>
				<label
					><input type="radio" name="{uid}-source" value="mermaid" bind:group={options.source} />
					{t('app.export.mermaid')}</label
				>
				<label
					><input
						type="radio"
						name="{uid}-source"
						value="editor"
						disabled={!editor}
						bind:group={options.source}
					/>
					{t('app.export.editor')}</label
				>
			</fieldset>
			{#if options.source === 'editor'}
				<label><input type="checkbox" bind:checked={options.theme} /> {t('app.export.theme')}</label
				>
				<label
					><input type="checkbox" disabled={!selection} bind:checked={options.selection} />
					{t('app.export.selection')}</label
				>
			{/if}
		{/if}
		{#if options.format === 'png'}
			<label
				>{t('app.export.scale')}
				<select bind:value={scale}>
					<option value="1">1x</option>
					<option value="2">2x</option>
					<option value="3">3x</option>
				</select>
			</label>
			<label
				><input type="checkbox" bind:checked={options.background} />
				{t('app.export.background')}</label
			>
			{#if options.background}
				<label
					>{t('app.export.color')}
					<input type="text" spellcheck="false" autocomplete="off" bind:value={options.color} />
				</label>
			{/if}
			<label
				>{t('app.export.margin')}
				<input type="number" min="0" max={MAX_MARGIN} step="1" bind:value={margin} />
			</label>
		{/if}
		<div class="actions">
			<button type="submit" class="primary">{t('app.export.submit')}</button>
			{#if options.format !== 'markdown'}
				{@const format = options.format}
				<button
					type="button"
					aria-disabled={copyable[format] ? undefined : 'true'}
					aria-describedby={copyable[format] ? undefined : `${uid}-copy-hint`}
					onclick={() => copyable[format] && send(true)}
					>{t(format === 'png' ? 'app.export.copyPng' : 'app.export.copySvg')}</button
				>
			{/if}
			<button type="button" onclick={oncancel}>{t('app.shell.cancel')}</button>
		</div>
		{#if options.format !== 'markdown' && !copyable[options.format]}
			<p id="{uid}-copy-hint" class="hint">{t('app.export.copyUnsupported')}</p>
		{/if}
	</form>
</div>

<style>
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 45%);
		backdrop-filter: blur(2px);
		z-index: 20;
	}
	.dialog {
		position: fixed;
		top: 15%;
		left: 50%;
		transform: translateX(-50%);
		max-width: 32rem;
		padding: 1.25rem;
		background: var(--surface, #fff);
		color: var(--text, #000);
		border: 1px solid var(--line, #000);
		border-radius: var(--radius, 0);
		box-shadow: var(--shadow, none);
		z-index: 21;
	}
	form {
		display: grid;
		gap: 0.5rem;
	}
	fieldset {
		display: grid;
		gap: 0.25rem;
		border: 1px solid var(--line, #888);
		border-radius: 8px;
	}
	legend {
		padding: 0 4px;
		color: var(--text-2, inherit);
		font-size: 12px;
	}
	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.1rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	button[aria-disabled='true'] {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.hint {
		margin: 0;
		color: var(--text-2, inherit);
		font-size: 12px;
	}
	.primary {
		border: 0;
		color: #fff;
		font-weight: 600;
		background: linear-gradient(135deg, var(--accent-fill), var(--accent-fill-2));
		box-shadow: 0 6px 16px -8px var(--accent-fill);
	}
	/* Hover ohne Farbänderung (kein Aufhellen): Grund bleibt --accent-fill(-2), Weiß >= 4,5:1 (T116). */
	.primary:hover {
		color: #fff;
		box-shadow: 0 8px 22px -6px var(--accent-fill);
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--focus, #1a5fb4);
		outline-offset: 2px;
	}
</style>
