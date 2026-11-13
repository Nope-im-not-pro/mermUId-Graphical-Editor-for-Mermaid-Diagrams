<!--
	Canvas-Suche (Strg-F, T21 C3): Teilstring in Label oder ID. Treffer werden im Canvas
	ausgewählt und zentriert; Enter oder "Weiter" springt zum nächsten Treffer, Esc schließt.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import type { DiagramDocument } from '../../model/types';
	import { t } from './i18n.svelte';
	import { searchMatches } from './search';

	let {
		doc,
		onpick,
		onclose
	}: { doc: DiagramDocument; onpick: (id: string) => void; onclose: () => void } = $props();

	const uid = $props.id();
	let query = $state('');
	let index = $state(0);
	const matches = $derived(searchMatches(doc, query));
	const result = $derived(
		query.trim() === ''
			? ''
			: matches.length === 0
				? t('app.search.none')
				: t('app.search.count', { index: index + 1, total: matches.length })
	);

	const autofocus: Attachment<HTMLInputElement> = (input) => input.focus();

	function oninput() {
		index = 0;
		if (matches.length > 0) onpick(matches[0]);
	}

	function next() {
		if (matches.length === 0) return;
		index = (index + 1) % matches.length;
		onpick(matches[index]);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			next();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}
</script>

<div class="search" role="search" aria-label={t('app.search.label')}>
	<label for="{uid}-q">{t('app.search.field')}</label>
	<input id="{uid}-q" type="search" bind:value={query} {oninput} {onkeydown} {@attach autofocus} />
	<span aria-live="polite" data-testid="search-result">{result}</span>
	<button type="button" disabled={matches.length === 0} onclick={next}
		>{t('app.search.next')}</button
	>
	<button type="button" onclick={onclose}>{t('app.search.close')}</button>
</div>

<style>
	.search {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.25rem 0.5rem;
		border-bottom: 1px solid var(--line, #888);
		background: var(--surface, transparent);
	}
	button:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--focus, #1a5fb4);
		outline-offset: 2px;
	}
</style>
