<!--
	Klassen-Liste (F-02, T137 C2): `classDef`s des Dokuments mit Vorschau, je Klasse ein
	Umschalter (aria-pressed) für die Zuweisung am gewählten Knoten, dazu "Als Klasse speichern".
	Jede Aktion ist ein Command (ein Undo-Schritt) über `run`. Vorschau-Werte nur aus der
	Allow-Liste (`classPanelFor` über `safeStyle`, T106). Nach dem Speichern liegt der Fokus auf
	dem Umschalter der neuen Klasse.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { Command } from '../../controllers/commands/history';
	import type { DiagramDocument } from '../../model/types';
	import { classCommand, classNameError, classPanelFor, saveClassCommand } from './properties';
	import { t } from '../shell/i18n.svelte';

	let {
		doc,
		id,
		run
	}: {
		doc: DiagramDocument;
		id: string;
		/** Führt den Command aus; `false`, wenn er fehlschlug. */
		run: (command: Command) => Promise<boolean>;
	} = $props();

	const uid = $props.id();
	const panel = $derived(classPanelFor(doc, id));

	let name = $state('');
	let error = $state('');
	let section: HTMLElement | undefined = $state();

	$effect.pre(() => {
		void id;
		name = '';
		error = '';
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const v = name.trim();
		error = classNameError(doc, v) ?? '';
		const command = error ? null : saveClassCommand(doc, id, v);
		if (!command || !(await run(command))) return;
		name = '';
		await tick();
		// Name ist geprüft ([A-Za-z0-9_-]), als Selektor-Wert unbedenklich.
		section?.querySelector<HTMLButtonElement>(`[data-class="${v}"]`)?.focus();
	}

	async function toggle(n: string, assign: boolean) {
		const command = classCommand(doc, id, n, assign);
		if (command) await run(command);
	}
</script>

{#if panel && (panel.entries.length > 0 || panel.saveable)}
	<section class="classes" aria-labelledby={`${uid}-title`} bind:this={section}>
		<h3 id={`${uid}-title`}>{t('panels.classes.label')}</h3>
		{#if panel.entries.length > 0}
			<ul>
				{#each panel.entries as entry (entry.name)}
					<li>
						<button
							type="button"
							data-class={entry.name}
							aria-pressed={entry.assigned}
							onclick={() => toggle(entry.name, !entry.assigned)}
						>
							<span
								class="preview"
								aria-hidden="true"
								style:background={entry.fill}
								style:border-color={entry.stroke}
								style:color={entry.color}>Aa</span
							>
							<span>{entry.name}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if panel.saveable}
			<form class="field" novalidate onsubmit={save}>
				<label for={`${uid}-name`}>{t('panels.classes.name')}</label>
				<span class="control">
					<input
						id={`${uid}-name`}
						type="text"
						spellcheck="false"
						autocomplete="off"
						bind:value={name}
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={error ? `${uid}-error` : undefined}
						oninput={() => (error = '')}
					/>
					<button type="submit">{t('panels.classes.save')}</button>
				</span>
				{#if error}
					<p id={`${uid}-error`} class="error" role="alert">{error}</p>
				{/if}
			</form>
		{/if}
	</section>
{/if}

<style>
	.classes,
	.field {
		display: grid;
		gap: 6px;
	}
	h3,
	label {
		margin: 0;
		font-size: 12px;
		font-weight: normal;
		color: var(--text-2, inherit);
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px;
		background: var(--surface-2, transparent);
		border: 1px solid var(--line, #888);
		border-radius: 8px;
		color: var(--text, inherit);
		font: inherit;
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		border-color: var(--accent, currentColor);
		box-shadow: 0 0 0 1px var(--accent, currentColor);
	}
	button:focus-visible,
	input:focus {
		border-color: var(--accent);
		outline: none;
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.preview {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 18px;
		border: 2px solid var(--line, #888);
		border-radius: 4px;
		font-size: 10px;
	}
	.control {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 6px;
	}
	input {
		height: 34px;
		padding: 0 10px;
		background: var(--surface-2, transparent);
		border: 1px solid var(--line, #888);
		border-radius: 8px;
		color: var(--text, inherit);
		font: inherit;
	}
	.control > button {
		height: 34px;
	}
	.error {
		margin: 0;
		font-size: 12px;
	}
</style>
