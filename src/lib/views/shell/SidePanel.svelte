<!--
	Seitenleiste der Shell (T123 C4, V-24): Tabs Eigenschaften/Code, Fehlerliste. Meldet die
	Cursor-Position des Code-Panels; `reveal`/`focusDiff` für Sprung und "Diff ansehen".
-->
<script lang="ts">
	import { EditorView } from '@codemirror/view';
	import type { SyncController } from '../../controllers/sync';
	import type { ModelIssue } from '../../services/validator';
	import CodePanel from '../panels/CodePanel.svelte';
	import ErrorList from '../panels/ErrorList.svelte';
	import type { JumpTarget } from '../panels/errors';
	import PropertiesPanel from '../panels/PropertiesPanel.svelte';
	import { t } from './i18n.svelte';
	import { nextTab, type SideTab } from './panels';
	import type { Cursor } from './status';

	let {
		sync,
		tab,
		selected,
		issues,
		onselecttab,
		onjump,
		oncursor,
		id,
		open = true
	}: {
		sync: SyncController;
		tab: SideTab;
		selected: string | null;
		issues: readonly ModelIssue[];
		onselecttab: (tab: SideTab) => void;
		onjump: (target: JumpTarget) => void;
		oncursor: (cursor: Cursor) => void;
		/** Ziel von `aria-controls` des Einklapp-Knopfs (T129 C1). */
		id?: string;
		/** Eingeklappt bzw. Schublade zu: `hidden`, Panels bleiben eingehängt. */
		open?: boolean;
	} = $props();

	let codeBox = $state<HTMLDivElement>();
	let codePanel = $state<ReturnType<typeof CodePanel>>();

	const tabs: { id: SideTab; label: string }[] = $derived([
		{ id: 'properties', label: t('app.shell.tabProperties') },
		{ id: 'code', label: t('app.shell.tabCode') }
	]);

	/** Im Modus "nur Code" ist der Eigenschaften-Tab gesperrt. */
	const locked = (id: SideTab) => id === 'properties' && $sync.mode === 'code';

	/** Tabs-Muster (T129 C2, V-32): Pfeile/Home/End wählen, Fokus folgt (roving tabindex). */
	function tabKey(e: KeyboardEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		const next = nextTab(
			tabs.map((item) => item.id),
			tab,
			e.key,
			(id) => !locked(id)
		);
		if (next === null) return;
		e.preventDefault();
		if (next !== tab) onselecttab(next);
		document.getElementById(`tab-${next}`)?.focus();
	}

	/** Code-Zeile im Code-Panel anspringen (Tab muss offen und gerendert sein). */
	export function reveal(line: number, column: number) {
		codePanel?.reveal(line, column);
	}

	/** Fokus auf die Diff-Region (sonst das Code-Panel); Code-Tab muss offen sein. */
	export function focusDiff() {
		const region = codeBox?.querySelector<HTMLElement>(
			`[role="region"][aria-label="${t('panels.diffRegion')}"]`
		);
		if (region && !region.hasAttribute('tabindex')) region.tabIndex = -1;
		(region ?? codeBox)?.focus();
	}

	/** Zeile:Spalte aus dem CodeMirror-Zustand des Code-Panels. */
	function trackCursor() {
		const el = codeBox?.querySelector<HTMLElement>('.cm-editor');
		const view = el ? EditorView.findFromDOM(el) : null;
		if (!view) return;
		const head = view.state.selection.main.head;
		const line = view.state.doc.lineAt(head);
		oncursor({ line: line.number, column: head - line.from + 1 });
	}
</script>

<aside {id} class="side" hidden={!open}>
	<div class="tabs" role="tablist" aria-label={t('app.shell.sidebar')}>
		{#each tabs as item (item.id)}
			<button
				type="button"
				role="tab"
				id="tab-{item.id}"
				aria-selected={tab === item.id}
				aria-controls="shell-{item.id}"
				tabindex={tab === item.id ? 0 : -1}
				disabled={locked(item.id)}
				onclick={() => onselecttab(item.id)}
				onkeydown={tabKey}>{item.label}</button
			>
		{/each}
	</div>
	<div
		id="shell-properties"
		role="tabpanel"
		aria-labelledby="tab-properties"
		hidden={tab !== 'properties'}
	>
		<PropertiesPanel {sync} {selected} />
	</div>
	<div
		id="shell-code"
		role="tabpanel"
		tabindex="-1"
		aria-labelledby="tab-code"
		hidden={tab !== 'code'}
		bind:this={codeBox}
		onkeyup={trackCursor}
		onpointerup={trackCursor}
		onfocusin={trackCursor}
	>
		<CodePanel {sync} bind:this={codePanel} />
	</div>
	<ErrorList {sync} {issues} {onjump} />
</aside>

<style>
	.side {
		display: grid;
		grid-template-rows: auto 1fr auto;
		min-height: 0;
		min-width: 0;
		overflow: auto;
		background: var(--surface);
		border-left: 1px solid var(--line);
	}
	.side[hidden] {
		display: none;
	}
	.side > [role='tabpanel'] {
		min-height: 0;
		overflow: auto;
		padding: 14px;
	}
	.side > [role='tabpanel'][hidden] {
		display: none;
	}
	.tabs {
		display: flex;
		gap: 4px;
		padding: 8px 10px 0;
		border-bottom: 1px solid var(--line);
	}
	[role='tab'] {
		border: 0;
		border-radius: 0;
		background: transparent;
		padding: 8px 10px 10px;
		margin-bottom: -1px;
		font-weight: 500;
		color: var(--text-3);
		border-bottom: 2px solid transparent;
	}
	[role='tab'][aria-selected='true'] {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
</style>
