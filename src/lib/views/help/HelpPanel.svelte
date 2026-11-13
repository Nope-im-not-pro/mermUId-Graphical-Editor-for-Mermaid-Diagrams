<script lang="ts">
	/**
	 * In-App-Hilfe (T22, O-30): modaler Dialog mit Inhalt aus `static/help/*.md` (per `?raw`
	 * gebündelt, keine Laufzeit-Requests). Markdown wird zu Svelte-Elementen, Diagramme laufen
	 * über `renderSvg` und die SVG-Einbettung aus `svg.ts`. Esc schließt, solange der Dialog offen
	 * ist; Tab/Shift-Tab bleiben zyklisch im Dialog (aria-modal). Fokus geht beim Öffnen in den
	 * Dialog und beim Schließen zurück zum Auslöser. Ein Backdrop fängt bei offenem Dialog alle
	 * Zeiger-Ereignisse ab (kein Fokus auf Canvas dahinter); Klick darauf schließt wie Esc.
	 */
	import type { Attachment } from 'svelte/attachments';
	import hilfe from '../../../../static/help/hilfe.md?raw';
	import help from '../../../../static/help/help.md?raw';
	import { currentLocale, t } from '../shell/i18n.svelte';
	import { parseMarkdown, type Block, type Inline } from './markdown';
	import { showMermaid } from './svg';

	let { open, onclose }: { open: boolean; onclose: () => void } = $props();

	// V-26: per `define` aus CHANGELOG.md (vite.config.ts, Typ in app.d.ts).
	const APP_VERSION = __APP_VERSION__;

	const blocks: Block[] = $derived(parseMarkdown(currentLocale() === 'en' ? help : hilfe));

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	/** Tab an den Rändern (oder von außerhalb/vom Dialog selbst) springt zyklisch um. */
	function trapTab(dialog: HTMLElement, e: KeyboardEvent): void {
		const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
		const first = items[0] ?? dialog;
		const last = items[items.length - 1] ?? dialog;
		const active = document.activeElement;
		const inside = active !== dialog && dialog.contains(active);
		if (inside && active !== (e.shiftKey ? first : last)) return;
		e.preventDefault();
		(e.shiftKey ? last : first).focus();
	}

	const focusTrap: Attachment<HTMLElement> = (dialog) => {
		const previous = document.activeElement;
		dialog.focus();
		const onkeydown = (e: KeyboardEvent): void => {
			if (e.key === 'Tab') trapTab(dialog, e);
			else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				onclose();
			}
		};
		document.addEventListener('keydown', onkeydown, true);
		return () => {
			document.removeEventListener('keydown', onkeydown, true);
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	};

	const diagram =
		(code: string): Attachment<HTMLElement> =>
		(el) =>
			showMermaid(el, code).cancel;

	const headingTag = (level: number) => `h${Math.min(Math.max(level, 2), 6)}`;
</script>

{#snippet inline(content: Inline[])}
	{#each content as part, i (i)}
		{#if part.type === 'code'}<code>{part.text}</code>{:else}{part.text}{/if}
	{/each}
{/snippet}

{#if open}
	<div class="help-backdrop" aria-hidden="true" onclick={onclose}></div>
	<div
		class="help-panel"
		role="dialog"
		aria-modal="true"
		aria-labelledby="help-title"
		tabindex="-1"
		{@attach focusTrap}
	>
		<header class="help-header">
			<h2 id="help-title">{t('help.title')}</h2>
			<span class="help-version">{t('help.version', { version: APP_VERSION })}</span>
			<button type="button" class="help-close" onclick={onclose}>{t('help.close')}</button>
		</header>
		<div class="help-body">
			{#each blocks as block, i (i)}
				{#if block.type === 'heading'}
					<svelte:element this={headingTag(block.level)}
						>{@render inline(block.content)}</svelte:element
					>
				{:else if block.type === 'paragraph'}
					<p>{@render inline(block.content)}</p>
				{:else if block.type === 'list'}
					<svelte:element this={block.ordered ? 'ol' : 'ul'}>
						{#each block.items as item, j (j)}
							<li>{@render inline(item)}</li>
						{/each}
					</svelte:element>
				{:else if block.type === 'table'}
					<table>
						<thead>
							<tr>
								{#each block.head as cell, j (j)}
									<th scope="col">{@render inline(cell)}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each block.rows as row, r (r)}
								<tr>
									{#each row as cell, j (j)}
										<td>{@render inline(cell)}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				{:else if block.type === 'code'}
					<pre><code data-lang={block.lang || undefined}>{block.text}</code></pre>
				{:else}
					<div class="help-mermaid" {@attach diagram(block.text)}></div>
				{/if}
			{/each}
		</div>
	</div>
{/if}

<style>
	.help-backdrop {
		position: fixed;
		inset: 0;
		z-index: 49;
		background: rgb(0 0 0 / 30%);
	}
	.help-panel {
		position: fixed;
		inset: 5vh 10vw;
		z-index: 50;
		display: flex;
		flex-direction: column;
		background: var(--surface, #fff);
		color: var(--text, #1a1a1a);
		border: 1px solid var(--border, #ccc);
		border-radius: 6px;
		box-shadow: 0 8px 32px rgb(0 0 0 / 25%);
	}
	.help-panel:focus {
		outline: 2px solid var(--focus, #2563eb);
	}
	.help-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border, #ccc);
	}
	.help-version {
		margin-left: auto;
		margin-right: 1rem;
		color: var(--text-2);
		font-size: 0.85rem;
	}
	.help-body {
		overflow: auto;
		padding: 0 1rem 1rem;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		border: 1px solid var(--border, #ccc);
		padding: 0.25rem 0.5rem;
		text-align: left;
		vertical-align: top;
	}
	pre {
		overflow: auto;
		padding: 0.5rem;
		background: var(--surface-alt, #f4f4f5);
	}
	.help-mermaid {
		margin: 0.5rem 0;
	}
	.help-mermaid :global(.help-error) {
		color: var(--error, #b91c1c);
	}
</style>
