<!--
	Farbfeld (V-20, T137 C1): Textfeld plus nativer Farbwähler, beide melden den Wert über
	`onchange`; dazu die Palette der im Diagramm verwendeten Farben (`paletteFor`) als Buttons.
	Ein Swatch wirkt wie eine Eingabe; der bereits gesetzte Wert ist gedrückt und löst nichts aus.
	Palettenwerte stammen aus der Allow-Liste (T106), nur deshalb als Hintergrund gesetzt.
-->
<script lang="ts">
	import { pickerValue } from './properties';
	import { t } from '../shell/i18n.svelte';

	let {
		id,
		label,
		value,
		hint,
		palette = [],
		onchange
	}: {
		id: string;
		label: string;
		value: string;
		hint?: string;
		palette?: readonly string[];
		onchange: (value: string) => void;
	} = $props();

	const current = $derived(value.trim().toLowerCase());
</script>

<div class="color-field">
	<!-- Palette außerhalb des Labels: Swatch-Namen gehören nicht in den Feldnamen. -->
	<label class="field" for={id}>
		<span>{label}</span>
		<span class="control">
			<input
				{id}
				type="text"
				spellcheck="false"
				{value}
				title={hint}
				onchange={(e) => onchange(e.currentTarget.value)}
			/>
			<input
				type="color"
				aria-label={t('panels.style.picker', { label })}
				value={pickerValue(value)}
				onchange={(e) => onchange(e.currentTarget.value)}
			/>
		</span>
	</label>
	{#if palette.length > 0}
		<div class="palette" role="group" aria-label={t('panels.style.palette', { label })}>
			{#each palette as swatch (swatch)}
				<button
					type="button"
					class="swatch"
					aria-label={swatch}
					title={swatch}
					aria-pressed={swatch === current}
					style:background={swatch}
					onclick={() => {
						if (swatch !== current) onchange(swatch);
					}}
				></button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.color-field,
	.field {
		display: grid;
		gap: 5px;
	}
	label > span:first-child {
		font-size: 12px;
		color: var(--text-2, inherit);
	}
	.control {
		display: grid;
		grid-template-columns: 1fr 34px;
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
	input[type='color'] {
		width: 34px;
		padding: 2px;
		cursor: pointer;
	}
	input:focus {
		border-color: var(--accent);
		outline: none;
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.palette {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.swatch {
		width: 22px;
		height: 22px;
		padding: 0;
		border: 1px solid var(--line, #888);
		border-radius: 6px;
		cursor: pointer;
	}
	.swatch[aria-pressed='true'] {
		box-shadow:
			0 0 0 2px var(--surface, #fff),
			0 0 0 4px var(--accent, currentColor);
	}
	.swatch:focus-visible {
		outline: 2px solid var(--accent, currentColor);
		outline-offset: 2px;
	}
</style>
