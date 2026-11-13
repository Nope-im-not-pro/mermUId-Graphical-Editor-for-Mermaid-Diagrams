<script lang="ts">
	import { onMount } from 'svelte';
	import { createSync, type SyncController } from '../lib/controllers/sync';
	import { browserStorage } from '../lib/views/shell/confirm';
	import { applyLocale, t } from '../lib/views/shell/i18n.svelte';
	import { readLocale } from '../lib/views/shell/locale';
	import Shell from '../lib/views/shell/Shell.svelte';
	import { applyColorScheme, readTheme, systemTheme } from '../lib/views/shell/theme';

	// Sprache schon für Lade- und Fehlertext (Shell setzt sie beim Start erneut).
	applyLocale(readLocale(browserStorage, globalThis.navigator?.language));
	// Farbschema schon für die Ladephase, ohne Aufblitzen des falschen Schemas (T105 C2).
	applyColorScheme(readTheme(browserStorage, systemTheme(globalThis.matchMedia?.bind(globalThis))));

	let sync = $state<SyncController | null>(null);
	let failure = $state('');

	onMount(() => {
		let active = true;
		let made: SyncController | null = null;
		createSync('flowchart TD\n').then(
			(s) => {
				made = s;
				if (active) sync = s;
				else s.dispose();
			},
			(e) => (failure = e instanceof Error ? e.message : String(e))
		);
		return () => {
			active = false;
			made?.dispose();
		};
	});
</script>

<svelte:head>
	<title>mermUId</title>
</svelte:head>

{#if sync}
	<Shell {sync} />
{:else if failure}
	<p role="alert">{t('page.failed', { reason: failure })}</p>
{:else}
	<p>{t('page.loading')}</p>
{/if}
