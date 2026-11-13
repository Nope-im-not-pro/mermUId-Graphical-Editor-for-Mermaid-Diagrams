<!--
	Neu-Dialog (T105 C1, V-14, F-14): Typwahl flowchart/sequence mit je drei Startvorlagen.
	Muster wie ExportDialog: Fokus-Falle, Esc und Klick neben den Dialog brechen ab. "Anlegen" ist
	beim Öffnen fokussiert, Enter legt die Standardvorlage (leeres flowchart) an. Enter in einer
	Radiogruppe legt die aktuelle Auswahl an (Firefox sendet dort sonst nicht ab, T105 C2).
-->
<script lang="ts">
	import { focusTrap } from './focusTrap';
	import { t } from './i18n.svelte';
	import {
		DEFAULT_TEMPLATE,
		NEW_TYPES,
		TYPE_LABEL,
		templateCode,
		templatesFor,
		type NewType
	} from './templates';

	let { oncreate, oncancel }: { oncreate: (code: string) => void; oncancel: () => void } = $props();

	const uid = $props.id();
	let type = $state<NewType>(DEFAULT_TEMPLATE.type);
	let id = $state(DEFAULT_TEMPLATE.id);

	function pickType(next: NewType) {
		type = next;
		id = templatesFor(next)[0].id;
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		oncreate(templateCode(type, id));
	}

	function radioEnter(e: KeyboardEvent) {
		const el = e.target;
		if (e.key !== 'Enter' || !(el instanceof HTMLInputElement) || el.type !== 'radio') return;
		e.preventDefault();
		el.form?.requestSubmit();
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
	<h2 id="{uid}-title">{t('app.new.title')}</h2>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Enter-Weiterleitung der Radios) -->
	<form onsubmit={submit} onkeydown={radioEnter}>
		<fieldset>
			<legend>{t('app.new.type')}</legend>
			{#each NEW_TYPES as value (value)}
				<label
					><input
						type="radio"
						name="{uid}-type"
						{value}
						checked={type === value}
						onchange={() => pickType(value)}
					/>
					{t(TYPE_LABEL[value])}</label
				>
			{/each}
		</fieldset>
		<fieldset>
			<legend>{t('app.new.template')}</legend>
			{#each templatesFor(type) as tpl (tpl.id)}
				<label
					><input type="radio" name="{uid}-template" value={tpl.id} bind:group={id} />
					{t(tpl.label)}</label
				>
			{/each}
		</fieldset>
		<div class="actions">
			<button type="submit" class="primary" data-autofocus>{t('app.new.create')}</button>
			<button type="button" onclick={oncancel}>{t('app.shell.cancel')}</button>
		</div>
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
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin: 0 0 0.75rem;
		border: 1px solid var(--line, #000);
		border-radius: var(--radius, 0);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
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
	input:focus-visible {
		outline: 2px solid var(--focus, #1a5fb4);
		outline-offset: 2px;
	}
</style>
