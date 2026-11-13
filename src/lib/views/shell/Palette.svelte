<!--
	Palette (Entwurf A): Suchfeld, Formen als Kacheln mit Vorschau-Symbol, Container und Vorlagen
	als Karten. Sichtbarer Text bleibt der Werkzeugname (zugänglicher Name, Tests, Ziehen/Anklicken).
-->
<script lang="ts">
	import { t } from './i18n.svelte';
	import Icon from './Icon.svelte';
	import { DRAG_TYPE, filterTools, TOOLS, type Tool } from './palette';

	let {
		armed,
		onarm,
		onrelease,
		onplace,
		id,
		open = true
	}: {
		/** Aktives Werkzeug für Klick-dann-Klick oder `null`. */
		armed: string | null;
		onarm: (id: string) => void;
		onrelease: () => void;
		/** Enter auf dem bewaffneten Werkzeug: in der Canvas-Mitte anlegen (T129 C2, V-32). */
		onplace?: (id: string) => void;
		/** Ziel von `aria-controls` des Einklapp-Knopfs (T129 C1). */
		id?: string;
		/** Eingeklappt bzw. Schublade zu: `hidden`, Zustand (Suchtext) bleibt erhalten. */
		open?: boolean;
	} = $props();

	const groups: { title: string; kind: Tool['kind'] }[] = $derived([
		{ title: t('app.palette.shapes'), kind: 'shape' },
		{ title: t('app.palette.structure'), kind: 'container' },
		{ title: t('app.palette.templates'), kind: 'template' }
	]);

	let query = $state('');
	const shown = $derived(filterTools(TOOLS, query));

	/** Zweite Zeile der Karten über attr(): außerhalb von textContent, Werkzeugname bleibt zugänglicher Name. */
	const NOTES: Record<string, string> = $derived({
		container: t('app.palette.containerNote'),
		'template:linear': [t('app.palette.start'), t('app.palette.step'), t('app.palette.end')].join(
			' · '
		),
		'template:decision': [
			t('app.palette.start'),
			t('app.palette.question'),
			t('app.palette.yes')
		].join(' · ')
	});

	/** Symbol je Werkzeug im Rahmen 34x22. */
	const GLYPHS: Record<string, string> = {
		'shape:square': 'M2 3h30v16H2z',
		'shape:round': 'M7 3h20a5 5 0 015 5v6a5 5 0 01-5 5H7a5 5 0 01-5-5V8a5 5 0 015-5z',
		'shape:stadium': 'M10 3h14a8 8 0 010 16H10a8 8 0 010-16z',
		'shape:subroutine': 'M2 3h30v16H2zM6 3v16M28 3v16',
		'shape:cylinder': 'M6 5a11 3 0 0022 0 11 3 0 00-22 0v12a11 3 0 0022 0V5',
		'shape:circle': 'M17 2a9 9 0 110 18 9 9 0 010-18z',
		'shape:doublecircle': 'M17 1a10 10 0 110 20 10 10 0 010-20zM17 4a7 7 0 110 14 7 7 0 010-14z',
		'shape:odd': 'M2 3h30v16H2l6-8z',
		'shape:diamond': 'M17 1l15 10-15 10L2 11z',
		'shape:hexagon': 'M8 3h18l6 8-6 8H8l-6-8z',
		'shape:lean_right': 'M7 3h25l-5 16H2z',
		'shape:lean_left': 'M2 3h25l5 16H7z',
		'shape:trapezoid': 'M7 3h20l5 16H2z',
		'shape:inv_trapezoid': 'M2 3h30l-5 16H7z',
		'shape:doc': 'M2 3h30v14a7.5 2.5 0 00-15 0 7.5 2.5 0 01-15 0z',
		'shape:delay': 'M2 3h22a8 8 0 010 16H2z',
		'shape:sl-rect': 'M2 8l30-5v16H2z',
		'shape:h-cyl': 'M5 3h24a3 8 0 010 16H5a3 8 0 010-16zM29 3a3 8 0 000 16',
		'shape:lin-cyl': 'M6 5a11 3 0 0022 0 11 3 0 00-22 0v12a11 3 0 0022 0V5M6 8a11 3 0 0022 0',
		container: 'M2 2h30v18H2zM6 7h9v5H6zM19 10h9v6h-9z',
		'template:linear': 'M1 8h8v6H1zM13 8h8v6h-8zM25 8h8v6h-8zM9 11h4M21 11h4',
		'template:decision': 'M9 3l7 8-7 8-7-8zM22 2h11v6H22zM22 14h11v6H22zM16 11l6-6M16 11l6 6'
	};

	/** Enter auf dem bewaffneten Werkzeug legt an; sonst Bestand (Enter/Leertaste = Klick). */
	function toolKey(e: KeyboardEvent, id: string) {
		if (e.key !== 'Enter' || armed !== id || !onplace) return;
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		e.preventDefault();
		onplace(id);
	}

	function dragstart(e: DragEvent, id: string) {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData(DRAG_TYPE, id);
		e.dataTransfer.effectAllowed = 'copy';
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
	{id}
	class="palette"
	hidden={!open}
	aria-label={t('app.palette.label')}
	onkeydown={(e) => e.key === 'Escape' && onrelease()}
>
	<label class="search">
		<Icon name="search" />
		<input
			type="search"
			bind:value={query}
			placeholder={t('app.palette.searchPlaceholder')}
			aria-label={t('app.palette.search')}
		/>
	</label>
	{#each groups as group (group.kind)}
		{@const tools = shown.filter((t) => t.kind === group.kind)}
		{#if tools.length > 0}
			<h2>{group.title}</h2>
			<ul class={group.kind === 'shape' ? 'tiles' : 'cards'}>
				{#each tools as tool (tool.id)}
					<li>
						<button
							type="button"
							draggable="true"
							title={tool.label}
							aria-pressed={armed === tool.id}
							ondragstart={(e) => dragstart(e, tool.id)}
							onclick={() => onarm(tool.id)}
							onkeydown={(e) => toolKey(e, tool.id)}
							><svg viewBox="0 0 34 22" aria-hidden="true" focusable="false"
								><path d={GLYPHS[tool.id] ?? GLYPHS['shape:square']} /></svg
							><span data-note={NOTES[tool.id]}>{tool.label}</span></button
						>
					</li>
				{/each}
			</ul>
		{/if}
	{/each}
	{#if shown.length === 0}<p class="empty" role="status">{t('app.palette.empty')}</p>{/if}
	<p class="hint">{t('app.palette.hint')}</p>
</nav>

<style>
	.palette {
		overflow-y: auto;
		padding: 14px 12px;
		background: var(--surface);
		border-right: 1px solid var(--line);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 10px;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: 8px;
		color: var(--text-3);
	}
	.search:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.search input {
		flex: 1;
		min-width: 0;
		height: auto;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		outline: none;
		box-shadow: none;
	}
	h2 {
		margin: 18px 4px 8px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.tiles {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	button {
		width: 100%;
		border-radius: 10px;
		cursor: grab;
		transition:
			transform 0.12s,
			border-color 0.12s;
	}
	button:hover {
		border-color: var(--accent);
		color: var(--text);
	}
	svg {
		flex: none;
		width: 34px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.tiles button {
		min-height: 74px;
		padding: 8px 4px 6px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 10.5px;
		line-height: 1.2;
		text-align: center;
		overflow-wrap: anywhere;
		hyphens: auto;
	}
	.tiles button:hover {
		transform: translateY(-1px);
	}
	.cards button {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px;
		text-align: left;
		font-weight: 600;
		font-size: 13px;
	}
	.cards span[data-note]::after {
		content: attr(data-note);
		display: block;
		font-weight: 400;
		font-size: 12px;
		color: var(--text-3);
	}
	.cards svg {
		width: 46px;
		height: 30px;
		padding: 4px 6px;
		border-radius: 6px;
		background: var(--surface-3);
	}
	button[aria-pressed='true'] {
		color: var(--accent);
		border-color: var(--accent);
		background: var(--accent-soft);
		box-shadow: 0 0 0 1px var(--accent) inset;
	}
	.empty {
		margin: 12px 4px 0;
		font-size: 12px;
		color: var(--text-3);
	}
	.hint {
		margin: 16px 4px 0;
		font-size: 11.5px;
		color: var(--text-3);
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
</style>
