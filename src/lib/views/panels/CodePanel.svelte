<!--
	Code-Panel (T19 C2): CodeMirror 6 ohne Editor-Historie (D-09). Nutzer-Edits gehen an
	`sync.editCode`, Fremd-Updates werden als Zeilen-Änderungen mit erhaltenem Cursor
	eingespielt. Im Konflikt zeigt eine Zeilen-Diff-Ansicht Code gegen Grafik.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { defaultKeymap } from '@codemirror/commands';
	import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
	import { lintGutter, setDiagnostics } from '@codemirror/lint';
	import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers } from '@codemirror/view';
	import { tags } from '@lezer/highlight';
	import type { SyncController, SyncState } from '../../controllers/sync';
	import {
		changesFor,
		editorLabel,
		lineDiff,
		lineRange,
		mapCursor,
		mermaidStream,
		toDiagnostics,
		undoKeymap,
		type DiffRow
	} from './code';
	import { t } from '../shell/i18n.svelte';

	/** Farben über Theme-Variablen der Shell (Entwurf A), Fallbacks für hellen Hintergrund. */
	const mermaidHighlight = HighlightStyle.define([
		{ tag: tags.keyword, color: 'var(--syn-keyword, #708)', fontWeight: '600' },
		{ tag: tags.string, color: 'var(--syn-string, #a11)' },
		{ tag: tags.comment, color: 'var(--syn-comment, #940)', fontStyle: 'italic' },
		{ tag: tags.operator, color: 'var(--syn-operator, #555)' },
		{ tag: [tags.bracket, tags.punctuation], color: 'var(--syn-punct, #555)' }
	]);
	let { sync }: { sync: SyncController } = $props();

	const external = Annotation.define<boolean>();
	const label = new Compartment();
	let host: HTMLDivElement;
	let view: EditorView | null = null;
	let rows: DiffRow[] | null = $state(null);
	let latest: SyncState | null = null;
	let shownErrors: SyncState['errors'] | null = null;
	let wasConflict = false;
	let diffVersion = '';
	let diffRequest = 0;
	let scheduled = false;

	/** Setzt den Cursor auf Zeile/Spalte (1-basiert), z. B. aus der Fehlerliste. */
	export function reveal(line: number, column = 1) {
		if (!view) return;
		const text = view.state.doc.toString();
		const { from, to } = lineRange(text, line);
		const pos = Math.min(from + Math.max(0, column - 1), to);
		view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
		view.focus();
	}

	function apply() {
		scheduled = false;
		const state = latest;
		if (!view || !state) return;
		const text = view.state.doc.toString();
		if (state.code !== text) {
			const { anchor, head } = view.state.selection.main;
			view.dispatch({
				changes: changesFor(text, state.code),
				selection: {
					anchor: mapCursor(text, state.code, anchor),
					head: mapCursor(text, state.code, head)
				},
				annotations: external.of(true)
			});
		}
		if (state.errors !== shownErrors) {
			shownErrors = state.errors;
			view.dispatch(setDiagnostics(view.state, toDiagnostics(state.code, state.errors)));
		}
		// Diff bei Konfliktbeginn und bei jeder Code- oder Modell-Änderung während des Konflikts.
		const version = `${state.codeVersion}:${state.modelVersion}`;
		if (state.conflict !== wasConflict || (state.conflict && version !== diffVersion)) {
			wasConflict = state.conflict;
			diffVersion = version;
			if (!state.conflict) rows = null;
			else {
				const request = ++diffRequest;
				void sync.diff().then((d) => {
					if (request === diffRequest && wasConflict) rows = d && lineDiff(d.code, d.model);
				});
			}
		}
	}

	onMount(() => {
		let initial = '';
		sync.subscribe((s) => (initial = s.code))();
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: initial,
				extensions: [
					label.of(editorLabel()),
					lineNumbers(),
					StreamLanguage.define(mermaidStream),
					syntaxHighlighting(mermaidHighlight),
					lintGutter(),
					Prec.highest(keymap.of(undoKeymap(sync))),
					keymap.of(defaultKeymap),
					EditorView.updateListener.of((u) => {
						if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) {
							sync.editCode(u.state.doc.toString());
						}
					})
				]
			})
		});
		// Mitteilungen können während eines Editor-Updates eintreffen; Abgleich danach.
		const stop = sync.subscribe((s) => {
			latest = s;
			if (!scheduled) {
				scheduled = true;
				queueMicrotask(apply);
			}
		});
		return () => {
			stop();
			view?.destroy();
			view = null;
		};
	});

	// Sprachwechsel: Feldname neu setzen (t() ist reaktiv).
	$effect(() => {
		const ext = editorLabel();
		view?.dispatch({ effects: label.reconfigure(ext) });
	});

	const SIGN: Record<DiffRow['type'], string> = { same: ' ', del: '-', add: '+' };
</script>

<section class="code" aria-label={t('panels.code.label')}>
	<div class="editor" bind:this={host}></div>
	{#if rows}
		<div class="diff" role="region" aria-label={t('panels.diffRegion')}>
			<p>{t('panels.code.conflict')}</p>
			<pre>{#each rows as row, i (i)}<span class={row.type}
						>{SIGN[row.type]} {row.text}
</span>{/each}</pre>
		</div>
	{/if}
</section>

<style>
	.code {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.editor {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.diff pre {
		margin: 0;
		overflow: auto;
	}
	.del {
		background: color-mix(in srgb, var(--err, #d33) 22%, transparent);
	}
	.add {
		background: color-mix(in srgb, var(--ok, #2a2) 22%, transparent);
	}
</style>
