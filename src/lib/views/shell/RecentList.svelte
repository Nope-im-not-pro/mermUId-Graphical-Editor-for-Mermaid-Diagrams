<!--
	"Zuletzt geöffnet" (T132 C2, F-13, M-15 a): schmale Leiste unter der Kopfzeile, neben dem
	Öffnen-Weg. Die Shell rendert sie nur mit File System Access und mindestens einem Eintrag.
	Je Eintrag: Name öffnet (Berechtigung wird neu angefragt), × entfernt den Eintrag; der Fokus
	geht danach auf das × des nächsten (sonst vorherigen) Eintrags, bei leerer Liste übernimmt die
	Shell.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { RecentEntry } from '../../services/file';
	import { t } from './i18n.svelte';

	let {
		entries,
		onopen,
		onremove
	}: {
		entries: readonly RecentEntry[];
		onopen: (entry: RecentEntry) => void;
		/** Liefert eine Promise, die nach dem Aktualisieren der Liste erfüllt ist. */
		onremove: (entry: RecentEntry) => Promise<unknown>;
	} = $props();

	let list = $state<HTMLUListElement>();

	async function remove(entry: RecentEntry, index: number) {
		await onremove(entry);
		await tick();
		const buttons = list?.querySelectorAll<HTMLButtonElement>('button.remove') ?? [];
		buttons[Math.min(index, buttons.length - 1)]?.focus();
	}
</script>

<nav class="recent" aria-label={t('app.recent.label')}>
	<span class="title" aria-hidden="true">{t('app.recent.label')}</span>
	<ul bind:this={list}>
		{#each entries as entry, i (entry)}
			<li>
				<button
					type="button"
					class="open"
					title={t('app.recent.open', { name: entry.name })}
					onclick={() => onopen(entry)}>{entry.name}</button
				><button
					type="button"
					class="remove"
					aria-label={t('app.recent.remove', { name: entry.name })}
					title={t('app.recent.remove', { name: entry.name })}
					onclick={() => void remove(entry, i)}><span aria-hidden="true">×</span></button
				>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.recent {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 30px;
		padding: 0 12px;
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		color: var(--text-2);
		font-size: 12px;
		overflow-x: auto;
	}
	.title {
		flex: none;
	}
	ul {
		display: flex;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		flex: none;
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	button {
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		padding: 2px 6px;
		cursor: pointer;
	}
	button:hover {
		background: var(--surface-2);
	}
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.remove {
		color: var(--text-2);
		border-left: 1px solid var(--line);
	}
</style>
