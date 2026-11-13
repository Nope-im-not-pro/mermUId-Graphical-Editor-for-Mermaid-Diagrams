<!--
	Kopfzeile (Entwurf A "Studio"): links Datei-Aktionen, Dateiname und Diagrammtyp, mittig das
	Logo, rechts Suchen, Code, Sprache, Farbschema, Hilfe und Export. Icon-Buttons tragen ein
	aria-label; Buttons mit sichtbarem Text beginnen ihren Namen mit diesem Text (WCAG 2.5.3).
-->
<script lang="ts">
	import { t } from './i18n.svelte';
	import Icon from './Icon.svelte';
	import type { Locale } from './locale';
	import type { Dock } from './panels';
	import type { Theme } from './theme';

	let {
		typeLabel,
		codeOpen,
		locked,
		ontogglecode,
		fileName,
		dirty,
		canSearch,
		theme,
		locale,
		onnew,
		onopen,
		onsave,
		onexport,
		onshare,
		onsearch,
		onhelp,
		ontheme,
		onlocale,
		docks,
		ondock
	}: {
		typeLabel: string;
		codeOpen: boolean;
		/** Grund, falls Code-Panel fest offen ist (Modus "nur Code"), sonst `null`. */
		locked: string | null;
		ontogglecode: () => void;
		fileName: string;
		/** Ungespeicherte Änderungen (Text "(geändert)", nicht nur Farbe). */
		dirty: boolean;
		canSearch: boolean;
		theme: Theme;
		locale: Locale;
		onnew: () => void;
		onopen: () => void;
		onsave: () => void;
		onexport: () => void;
		/** "Link kopieren" (T136 C2): Code im URL-Fragment in die Zwischenablage. */
		onshare: () => void;
		onsearch: () => void;
		onhelp: () => void;
		ontheme: () => void;
		onlocale: () => void;
		/** Leisten offen/zu (T129 C1); Palette `null`, wenn es keine gibt (nicht flowchart). */
		docks: { palette: boolean | null; inspector: boolean };
		ondock: (dock: Dock) => void;
	} = $props();

	/** Knopf je Leiste; `aria-controls` zeigt auf die Leiste in Shell.svelte. */
	const dockButtons = $derived(
		[
			{
				dock: 'palette' as const,
				open: docks.palette,
				label: t('toolbar.palette'),
				title: t('toolbar.paletteTitle'),
				path: 'M4 5h16v14H4zM9 5v14'
			},
			{
				dock: 'inspector' as const,
				open: docks.inspector,
				label: t('toolbar.inspector'),
				title: t('toolbar.inspectorTitle'),
				path: 'M4 5h16v14H4zM15 5v14'
			}
		].filter((b) => b.open !== null)
	);
</script>

<header class="toolbar" role="toolbar" aria-label={t('toolbar.label')}>
	<div class="side left">
		<div class="group" role="group" aria-label={t('toolbar.file')}>
			<button
				type="button"
				class="icon-btn"
				aria-label={t('toolbar.new')}
				title={t('toolbar.newTitle')}
				onclick={onnew}><Icon name="file" /></button
			>
			<button
				type="button"
				class="icon-btn"
				aria-label={t('toolbar.open')}
				title={t('toolbar.openTitle')}
				onclick={onopen}><Icon name="open" /></button
			>
			<button
				type="button"
				class="icon-btn"
				aria-label={t('toolbar.save')}
				title={t('toolbar.saveTitle')}
				onclick={onsave}><Icon name="save" /></button
			>
			<button
				type="button"
				class="icon-btn"
				aria-label={t('app.share.copy')}
				title={t('app.share.copyTitle')}
				onclick={onshare}
				><svg class="dock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
					><path
						d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1"
					/></svg
				></button
			>
		</div>
		<div class="group" role="group" aria-label={t('toolbar.docks')}>
			{#each dockButtons as b (b.dock)}
				<button
					type="button"
					class="icon-btn"
					id="shell-toggle-{b.dock}"
					aria-label={b.label}
					aria-expanded={b.open === true}
					aria-controls="shell-{b.dock}"
					title={b.title}
					onclick={() => ondock(b.dock)}
					><svg class="dock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
						><path d={b.path} /></svg
					></button
				>
			{/each}
		</div>
		<!--
			Text bleibt "Datei: name (geändert)" bzw. "Typ: x" (auch innerText): die Zusätze sind nur
			optisch versteckt und inline, damit keine Zeilenumbrüche entstehen.
		-->
		<span class="file-name" data-testid="file" title={fileName}
			><span class="sr">{`${t('toolbar.filePrefix')} `}</span>{fileName}{#if dirty}<span class="sr"
					>&#32;(</span
				><span class="dirty">{t('toolbar.dirty')}</span><span class="sr">)</span>{/if}</span
		>
		<span class="chip" data-testid="type"
			><span class="sr">{`${t('toolbar.typePrefix')} `}</span>{typeLabel}</span
		>
	</div>

	<span class="logo" translate="no">merm<span class="ui">UI</span>d</span>

	<div class="side right">
		<button
			type="button"
			class="ghost"
			aria-label={t('toolbar.search')}
			disabled={!canSearch}
			title={t('toolbar.searchTitle')}
			onclick={onsearch}
			><Icon name="search" /><span>{t('toolbar.search')}</span><kbd
				data-keys={t('toolbar.searchKeys')}
			></kbd></button
		>
		<button
			type="button"
			class="ghost"
			aria-label={t('toolbar.code')}
			aria-pressed={codeOpen}
			disabled={locked !== null}
			title={locked ?? t('toolbar.codeTitle')}
			aria-describedby={locked === null ? undefined : 'toolbar-locked'}
			onclick={ontogglecode}><Icon name="code" /><span>{t('toolbar.codeText')}</span></button
		>
		{#if locked !== null}
			<span id="toolbar-locked" class="visually-hidden">{locked}</span>
		{/if}
		<button
			type="button"
			class="icon-btn lang"
			aria-label={t('locale.label')}
			aria-pressed={locale === 'en'}
			title={t('locale.title')}
			onclick={onlocale}>{t('locale.short')}</button
		>
		<button
			type="button"
			class="icon-btn"
			aria-label={t('toolbar.theme')}
			aria-pressed={theme === 'light'}
			title={t('toolbar.themeTitle')}
			onclick={ontheme}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button
		>
		<button
			type="button"
			class="icon-btn"
			aria-label={t('toolbar.help')}
			title={t('toolbar.helpTitle')}
			onclick={onhelp}><Icon name="help" /></button
		>
		<button type="button" class="primary" aria-label={t('toolbar.export')} onclick={onexport}
			><Icon name="export" /><span>{t('toolbar.export')}</span></button
		>
	</div>
</header>

<style>
	.toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 1rem;
		height: 52px;
		padding: 0 14px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}
	.side {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.right {
		justify-content: flex-end;
	}
	.group {
		display: flex;
		gap: 2px;
	}
	.icon-btn {
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		background: transparent;
		display: grid;
		place-items: center;
	}
	.icon-btn:hover:not(:disabled),
	.icon-btn[aria-pressed='true'] {
		background: var(--surface-3);
		color: var(--text);
	}
	.lang {
		font: 600 12px var(--mono);
		letter-spacing: 0.04em;
	}
	.file-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		color: var(--text);
	}
	.dirty {
		display: inline-block;
		margin-left: 8px;
		font-size: 12px;
		font-weight: 500;
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		padding: 0 8px;
		border-radius: 999px;
	}
	.chip {
		flex: none;
		font: 12px var(--mono);
		color: var(--text-2);
		background: var(--surface-3);
		padding: 3px 8px;
		border-radius: 6px;
		white-space: nowrap;
	}

	.logo {
		font-family: Georgia, 'Times New Roman', Times, serif;
		font-style: italic;
		font-weight: 700;
		font-size: 22px;
		letter-spacing: -0.01em;
		color: var(--text);
		white-space: nowrap;
		user-select: none;
	}
	.logo .ui {
		color: var(--logo-accent);
	}

	/* Tastenkürzel über attr(): bleibt außerhalb von textContent und zugänglichem Namen. */
	kbd::before {
		content: attr(data-keys);
	}
	kbd {
		font: 11px var(--mono);
		color: var(--text-3);
		border: 1px solid var(--line);
		border-bottom-width: 2px;
		border-radius: 4px;
		padding: 0 5px;
	}
	.ghost {
		height: 32px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.ghost[aria-pressed='true'] {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 50%, transparent);
		background: var(--accent-soft);
	}
	.primary {
		height: 32px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
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
	/* Optisch versteckt, aber inline (kein Zeilenumbruch in innerText). */
	.sr {
		display: inline-block;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: pre;
		vertical-align: top;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.dock-icon {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	@media (max-width: 1100px) {
		.ghost span,
		.ghost kbd,
		.primary span {
			display: none;
		}
	}
	/* Schmal (< 900 px, M-09): Logo weicht, rechte Gruppe in voller Breite, Typ-Chip kürzt sich. */
	@media (max-width: 899.98px) {
		.toolbar {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 8px;
			padding: 0 10px;
		}
		.logo {
			display: none;
		}
		.side {
			gap: 6px;
		}
		.chip {
			flex: 0 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}
</style>
