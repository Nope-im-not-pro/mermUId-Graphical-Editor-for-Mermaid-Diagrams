<script lang="ts" module>
	/** Abstände der Fehler-Überlagerung zu den Rändern des Containers in px (T101 C3). */
	export interface BannerInset {
		top?: number;
		left?: number;
		right?: number;
	}
</script>

<script lang="ts">
	import type { Banner, BannerAction, BannerLink } from './banner';

	let {
		banner,
		placement = 'top',
		inset = {},
		onaction,
		onjump
	}: {
		banner: Banner;
		/** Nur Fehler-Variante: Überlagerung am oberen oder unteren Rand des Containers (O-58). */
		placement?: 'top' | 'bottom';
		/** Nur Fehler-Variante: freizuhaltende Ränder (Werkzeugleiste, Controls, Vorschau). */
		inset?: BannerInset;
		onaction: (id: BannerAction) => void;
		onjump: (link: BannerLink) => void;
	} = $props();

	const error = $derived(banner.kind === 'error');
	const px = (v: number | undefined) => (v === undefined ? undefined : `${v}px`);
</script>

<!--
	Fehler-Variante: Anker ohne Höhe, Hinweis als kompakte einzeilige Pille über der Fläche
	(O-44, O-58), positioniert relativ zum nächsten positionierten Container (`.shell-canvas`),
	keine Layout-Änderung (D1). Konflikt bleibt `role="alert"` im Spaltenfluss.
	Die Live-Region entsteht mit dem Hinweis (bewusst akzeptiert): Bestandstests verlangen
	`.banner` nur im Fehlerfall; manche Screenreader sagen neu eingefügte Regionen nicht an,
	die Statuszeile ("Parser: Fehler in Zeile n") bleibt dauerhaft im DOM.
	Kein `title`: der Name der Region ist ihr Text; die volle Meldung steht in der Fehlerliste.
-->
<div class:anchor={error}>
	<div
		class="banner"
		class:overlay={error}
		class:top={error && placement === 'top'}
		class:bottom={error && placement === 'bottom'}
		role={error ? 'status' : 'alert'}
		aria-live={error ? 'polite' : undefined}
		style:--banner-top={px(inset.top)}
		style:--banner-left={px(inset.left)}
		style:--banner-right={px(inset.right)}
	>
		<strong>{banner.label}</strong>
		<span class="msg">
			{#if banner.link}
				{@const link = banner.link}
				<span class="before">{link.before}</span><button
					type="button"
					class="line"
					onclick={() => onjump(link)}>{link.text}</button
				><span class="rest">{link.after}</span>
			{:else}
				<span class="rest">{banner.message}</span>
			{/if}
		</span>
		{#each banner.actions as action (action.id)}
			<button type="button" onclick={() => onaction(action.id)}>{action.label}</button>
		{/each}
	</div>
</div>

<style>
	.banner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 6px 14px;
		border-bottom: 1px solid color-mix(in srgb, var(--warn, #b5835a) 45%, transparent);
		background: color-mix(in srgb, var(--warn, #b5835a) 14%, var(--surface, #fff6e5));
		color: var(--text, #222);
	}
	.anchor {
		height: 0;
	}
	/* Pille zwischen den freizuhaltenden Rändern zentriert, nie breiter als der Platz dazwischen. */
	.overlay {
		position: absolute;
		left: var(--banner-left, 14px);
		right: var(--banner-right, 14px);
		z-index: 5;
		width: fit-content;
		max-width: min(520px, calc(100% - var(--banner-left, 14px) - var(--banner-right, 14px)));
		margin-inline: auto;
		gap: 0;
		box-sizing: border-box;
		flex-wrap: nowrap;
		white-space: nowrap;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--warn, #b5835a) 45%, transparent);
		border-radius: 8px;
		box-shadow: 0 2px 6px color-mix(in srgb, #000 18%, transparent);
		/* Klicks gehen durch auf die verdeckte Fläche; nur der Zeilen-Link bleibt bedienbar. */
		pointer-events: none;
	}
	.overlay.top {
		top: var(--banner-top, 8px);
	}
	.overlay.bottom {
		bottom: 14px;
	}
	/* Kürzung nach Vorrang: zuerst der Rest, dann die Einleitung, dann das Label; der Link nie. */
	.overlay .msg {
		display: contents;
	}
	.overlay strong,
	.overlay .before,
	.overlay .rest {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.overlay strong {
		flex: 0 1 auto;
		margin-right: 0.5rem;
	}
	/* Eigene Flex-Elemente: Leerzeichen an den Rändern bleiben erhalten. */
	.overlay .before {
		flex: 0 10 auto;
		white-space: pre;
	}
	.overlay .rest {
		flex: 0 1000 auto;
		white-space: pre;
	}
	.overlay .line {
		flex: none;
		pointer-events: auto;
	}
	.line {
		padding: 0;
		border: none;
		background: none;
		color: var(--accent, #1a5fb4);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 2px solid var(--focus, #1a5fb4);
		outline-offset: 2px;
	}
</style>
