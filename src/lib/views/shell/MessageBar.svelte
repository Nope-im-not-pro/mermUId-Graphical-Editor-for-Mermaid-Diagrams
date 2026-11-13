<!--
	Meldungszeile der Shell (T123 C4, V-24). Zwei dauerhafte Regionen (O-85): Fehler in
	`role="alert"`, sonst höflich; Text nur in die zum Ton passende Region, kein Rollenwechsel.
	`{#key}`: jede neue Meldung ist ein neuer Textknoten (auch bei gleichem Text), Sprachwechsel
	nicht. Feste Zeilenhöhe in jedem Zustand (T114 F1, O-114): Meldungen verschieben die
	Arbeitsfläche nicht; lange Texte mit Ellipse, voller Text in `title`.
-->
<script lang="ts">
	import { messageText, type StatusMessage } from './status';

	let { message }: { message: StatusMessage | null } = $props();
</script>

<div
	class="message"
	class:shown={message !== null}
	class:error={message?.tone === 'error'}
	title={message ? messageText(message) : undefined}
	data-testid="message"
>
	<p role="alert">
		{#key message}{message?.tone === 'error' ? messageText(message) : ''}{/key}
	</p>
	<p aria-live="polite">
		{#key message}{message && message.tone !== 'error' ? messageText(message) : ''}{/key}
	</p>
</div>

<style>
	/*
		Reservierte Zeile mit fester Höhe in jedem Zustand (T114 F1): Erscheinen, Wechsel und
		Ausblenden einer Meldung ändern die Box des Hauptbereichs nicht. Leer ohne Hintergrund und
		mit transparentem Rahmen; Zustandsklassen setzen nur Farben.
	*/
	.message {
		flex: none;
		box-sizing: border-box;
		height: 32px;
		padding: 0 14px;
		overflow: hidden;
		font-size: 13px;
		line-height: 31px;
		border-top: 1px solid transparent;
	}
	.message p {
		margin: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.message.shown {
		color: var(--text);
		background: var(--accent-soft);
		border-top-color: var(--line);
	}
	.message.shown.error {
		color: var(--err);
		background: color-mix(in srgb, var(--err) 12%, var(--surface));
		border-top-color: var(--err);
		font-weight: 500;
	}
</style>
