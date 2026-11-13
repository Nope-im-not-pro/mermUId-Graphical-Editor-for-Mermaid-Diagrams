<!--
	Rückfrage-Dialog der Shell (T21 C3): ungespeicherte Änderungen, Löschen mit Kanten (D-10),
	Blockwahl bei .md. Kein Browser-confirm: die Antwort kommt asynchron über `onanswer`.
	Esc und Klick neben den Dialog brechen ab (`null`).
-->
<script lang="ts" module>
	export interface DialogRequest {
		title: string;
		text: string;
		/** `primary`: hervorgehoben und beim Öffnen fokussiert (Enter löst sie aus). */
		actions: { label: string; value: string; primary?: boolean }[];
		/** Beschriftung eines optionalen Kontrollkästchens (z. B. "Nicht mehr fragen"). */
		remember?: string;
	}
</script>

<script lang="ts">
	import { focusTrap } from './focusTrap';

	let {
		request,
		onanswer
	}: { request: DialogRequest; onanswer: (value: string | null, remember: boolean) => void } =
		$props();

	const uid = $props.id();
	let remember = $state(false);
	const cancel = () => onanswer(null, false);
</script>

<div class="dialog-backdrop" aria-hidden="true" onclick={cancel}></div>
<div
	class="dialog"
	role="dialog"
	aria-modal="true"
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-text"
	tabindex="-1"
	{@attach focusTrap(cancel)}
>
	<h2 id="{uid}-title">{request.title}</h2>
	<p id="{uid}-text">{request.text}</p>
	{#if request.remember}
		<label><input type="checkbox" bind:checked={remember} /> {request.remember}</label>
	{/if}
	<div class="actions">
		{#each request.actions as action (action.value)}
			<button
				type="button"
				class:primary={action.primary}
				data-autofocus={action.primary || undefined}
				onclick={() => onanswer(action.value, remember)}>{action.label}</button
			>
		{/each}
	</div>
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
		top: 20%;
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
	.actions {
		display: flex;
		flex-wrap: wrap;
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
