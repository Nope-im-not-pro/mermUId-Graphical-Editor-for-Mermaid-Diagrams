<!--
	Fehlerliste (T19 C3): Code-Fehler aus `SyncState.errors` und optionale Modell-Befunde.
	Klick meldet das Sprungziel an `onjump` (Code-Zeile oder Element); die Shell setzt es um.
	Parser-Rohtext (V-18) nur aufklappbar hinter "Details", als Textknoten.
-->
<script lang="ts">
	import type { SyncController } from '../../controllers/sync';
	import type { ModelIssue } from '../../services/validator';
	import { errorEntries, type JumpTarget } from './errors';
	import { t } from '../shell/i18n.svelte';

	let {
		sync,
		issues = [],
		onjump
	}: {
		sync: SyncController;
		issues?: readonly ModelIssue[];
		onjump: (target: JumpTarget) => void;
	} = $props();

	const commands = $derived(sync.commands);
	const entries = $derived(errorEntries($sync.errors, issues, $commands.doc));
	const uid = $props.id();
	/** Aufgeklappte Details je Eintrag; Rohtext im Schlüssel, damit neue Fehler zu bleiben. */
	let open = $state<Record<string, boolean>>({});
	const openKey = (entry: { key: string; raw?: string }) => `${entry.key}\u0000${entry.raw}`;
</script>

<section class="errors" aria-label={t('panels.errors.label')}>
	{#if entries.length === 0}
		<p>{t('panels.errors.none')}</p>
	{:else}
		<ul data-count={entries.length} data-label={t('panels.errors.problems')}>
			{#each entries as entry, i (entry.key)}
				{@const expanded = open[openKey(entry)] === true}
				<li class={entry.severity}>
					<button
						type="button"
						class="jump"
						disabled={entry.target === null}
						onclick={() => entry.target && onjump(entry.target)}
					>
						<span class="badge"
							>{t(entry.severity === 'error' ? 'panels.errors.error' : 'panels.errors.hint')}</span
						>
						{entry.text}
					</button>
					{#if entry.raw}
						<button
							type="button"
							class="details"
							aria-expanded={expanded}
							aria-controls={`${uid}-raw-${i}`}
							onclick={() => (open[openKey(entry)] = !expanded)}
						>
							{t(expanded ? 'services.validate.hideDetails' : 'services.validate.details')}
						</button>
						{#if expanded}
							<pre id={`${uid}-raw-${i}`}>{entry.raw}</pre>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.errors {
		padding: 10px 14px;
		border-top: 1px solid var(--line, #888);
		font-size: 13px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* Zähler-Badge rein visuell: attr() bleibt außerhalb von textContent und Namen. */
	ul::before {
		content: attr(data-label) ' ' attr(data-count);
		display: block;
		margin-bottom: 8px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2, inherit);
	}
	.jump {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		margin-bottom: 8px;
		text-align: left;
		background: var(--surface-2, transparent);
		border: 1px solid var(--line, #888);
		padding: 10px;
		border-radius: 10px;
		color: var(--text, inherit);
		font: inherit;
		cursor: pointer;
	}
	.jump::before {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		font-weight: 700;
		font-size: 12px;
	}
	.error .jump::before {
		content: '!';
		/* Leerer Alt-Text: Icon rein visuell, nicht Teil des Button-Namens. */
		content: '!' / '';
		color: var(--err);
		background: color-mix(in srgb, var(--err) 15%, transparent);
	}
	.hint .jump::before {
		content: 'i';
		/* Leerer Alt-Text: Icon rein visuell, nicht Teil des Button-Namens. */
		content: 'i' / '';
		color: var(--accent);
		background: var(--accent-soft);
	}
	.jump:hover:not(:disabled) {
		border-color: var(--text-3, currentColor);
	}
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.jump:disabled {
		cursor: default;
	}
	.details {
		margin: -4px 0 8px;
		padding: 2px 8px;
		background: transparent;
		border: 1px solid var(--line, #888);
		border-radius: 6px;
		color: var(--text-2, inherit);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.details:hover {
		border-color: var(--text-3, currentColor);
	}
	pre {
		margin: 0 0 8px;
		padding: 8px 10px;
		background: var(--surface-2, transparent);
		border: 1px solid var(--line, #888);
		border-radius: 8px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 12px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.badge {
		font-weight: 600;
		margin-right: 0.4rem;
	}
</style>
