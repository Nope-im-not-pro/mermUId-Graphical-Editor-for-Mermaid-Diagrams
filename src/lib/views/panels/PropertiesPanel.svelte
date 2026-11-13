<!--
	Eigenschaften-Panel (T19 C1): Felder aus `panelFor`, jede Änderung als Command über den
	Sync-Controller (`execute`, async). Texte erst bei `change`, Auswahlfelder sofort.
	V-20: jedes Feld per `<label for>` benannt, Farben als Textfeld plus Farbwähler, Meldung
	beim Auswahlwechsel geleert. T137 C1: Farbfelder als `ColorField` mit Palette der im Diagramm
	verwendeten Farben. T137 C2: `ClassList` (Klassen zuweisen/entfernen, "Als Klasse speichern").
-->
<script lang="ts">
	import type { Command } from '../../controllers/commands/history';
	import type { SyncController } from '../../controllers/sync';
	import ClassList from './ClassList.svelte';
	import ColorField from './ColorField.svelte';
	import { commandFor, paletteFor, panelFor, type Field } from './properties';
	import { t } from '../shell/i18n.svelte';

	let { sync, selected = null }: { sync: SyncController; selected?: string | null } = $props();

	const uid = $props.id();
	const fieldId = (key: string) => `${uid}-${key.replace(/[^\w-]/g, '-')}`;

	const commands = $derived(sync.commands);
	const panel = $derived($sync.mode === 'code' ? null : panelFor($commands.doc, selected));
	const palette = $derived(panel ? paletteFor($commands.doc) : []);

	let failure = $state('');

	$effect.pre(() => {
		void selected;
		failure = '';
	});

	/** Command ausführen; Meldung nur, solange dieselbe Auswahl besteht. */
	async function run(command: Command): Promise<boolean> {
		const target = selected;
		try {
			await sync.execute(command);
			if (selected === target) failure = '';
			return true;
		} catch (e) {
			if (selected === target) failure = e instanceof Error ? e.message : String(e);
			return false;
		}
	}

	async function change(field: Field, value: string) {
		const command = commandFor($commands.doc, selected, field.key, value);
		if (!command) {
			failure = value.trim() === field.value.trim() ? '' : t('panels.props.invalid', { value });
			return;
		}
		await run(command);
	}
</script>

<section class="properties" aria-label={t('panels.props.label')}>
	{#if failure}
		<p role="alert">{failure}</p>
	{/if}
	{#if panel}
		<h2>{panel.title}</h2>
		{#each panel.fields as field (field.key)}
			{@const id = fieldId(field.key)}
			{#if field.kind === 'readonly' || field.kind === 'select'}
				<!-- Kein umschließendes Label: Optionstexte gehören nicht in den Feldnamen. -->
				<div class="field">
					<label for={id}>{field.label}</label>
					{#if field.kind === 'readonly'}
						<output {id} aria-describedby={field.hint ? `${id}-hint` : undefined}
							>{field.value}</output
						>
						{#if field.hint}
							<small id={`${id}-hint`} class="hint">{field.hint}</small>
						{/if}
					{:else}
						<select {id} value={field.value} onchange={(e) => change(field, e.currentTarget.value)}>
							{#each field.options ?? [] as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					{/if}
				</div>
			{:else if field.kind === 'color'}
				<ColorField
					{id}
					label={field.label}
					value={field.value}
					hint={field.hint}
					{palette}
					onchange={(value) => change(field, value)}
				/>
			{:else}
				<label class="field" for={id}>
					<span>{field.label}</span>
					<span class="control">
						<input
							{id}
							type={field.kind === 'number' ? 'number' : 'text'}
							min={field.kind === 'number' ? 1 : undefined}
							value={field.value}
							title={field.hint}
							onchange={(e) => change(field, e.currentTarget.value)}
						/>
					</span>
				</label>
			{/if}
		{/each}
		{#if selected !== null}
			<ClassList doc={$commands.doc} id={selected} {run} />
		{/if}
		{#if panel.gaps.length > 0}
			<details>
				<summary>{t('panels.props.gaps')}</summary>
				<ul>
					{#each panel.gaps as gap (gap)}
						<li>{gap}</li>
					{/each}
				</ul>
			</details>
		{/if}
	{:else}
		<p>{t('panels.props.none')}</p>
	{/if}
</section>

<style>
	.properties {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.field {
		display: grid;
		gap: 5px;
	}
	.field > label,
	.field > span:first-child {
		font-size: 12px;
		color: var(--text-2, inherit);
	}
	input,
	select {
		height: 34px;
		padding: 0 10px;
		background: var(--surface-2, transparent);
		border: 1px solid var(--line, #888);
		border-radius: 8px;
		color: var(--text, inherit);
		font: inherit;
	}
	.hint {
		font-size: 12px;
		color: var(--text-2, inherit);
	}
	.control {
		display: grid;
	}
	input:focus,
	select:focus {
		border-color: var(--accent);
		outline: none;
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	output {
		font-family: var(--mono);
		color: var(--text-3, inherit);
	}
	details {
		font-size: 12px;
		color: var(--text-2, inherit);
	}
</style>
