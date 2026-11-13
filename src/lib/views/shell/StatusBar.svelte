<!--
	Statuszeile (Entwurf A): Einträge als Pills, Parser/Sync mit Zustandspunkt. Nur Parser/Sync
	sind Live-Region (`role="status"`, V-32); Layout und Cursor-Position werden nicht angesagt.
	Der Zwischenzustand "Sync ausstehend" steht sichtbar außerhalb der Region; in der Region bleibt
	derselbe Knoten mit dem Endzustand, nur optisch ausgeblendet (keine Ansage je Debounce-Zyklus,
	T114 I3). Den Endzustand in aktueller Sprache liefert die Shell (`liveStatus`).
-->
<script lang="ts">
	import { t } from './i18n.svelte';
	import type { LiveItem } from './status';

	let { live, items }: { live: readonly LiveItem[]; items: readonly string[] } = $props();

	/** Zustandspunkt nur für Parser und Sync; Farbe folgt dem Text, nicht umgekehrt. */
	function tone(item: string): 'ok' | 'warn' | 'err' | null {
		if (!item.startsWith('Parser:') && !item.startsWith('Sync:')) return null;
		if (item === t('app.status.parserOk') || item === t('app.status.syncOk')) return 'ok';
		const parserError = t('app.status.parserError', { line: '' });
		if (item === t('app.status.syncConflict') || item.startsWith(parserError)) return 'err';
		return 'warn';
	}
</script>

{#snippet pill(item: string, hidden = false)}
	{@const mark = tone(item)}
	<span class="pill" class:visually-hidden={hidden}
		>{#if mark}<span class="dot {mark}" aria-hidden="true"></span>{/if}{item}</span
	>
{/snippet}

<div class="statusbar">
	<span class="live" role="status">
		{#each live as e, i (i)}{@render pill(e.settled, e.pending !== undefined)}{i < live.length - 1
				? ' '
				: ''}{/each}
	</span>
	{#each live as e, i (i)}{#if e.pending}<span class="pending" aria-hidden="true"
				>{@render pill(e.pending)}</span
			>{/if}{/each}
	{#each items as item, i (i)}{@render pill(item)}{i < items.length - 1 ? ' ' : ''}{/each}
</div>

<style>
	.statusbar {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px;
		border-top: 1px solid var(--line);
		background: var(--surface);
		font-size: 12px;
		color: var(--text-3);
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.pending {
		display: inline-flex;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		border-radius: 6px;
		white-space: nowrap;
	}
	.statusbar > .pill:last-child {
		margin-left: auto;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.ok {
		background: var(--ok);
	}
	.warn {
		background: var(--warn);
	}
	.err {
		background: var(--err);
	}
</style>
