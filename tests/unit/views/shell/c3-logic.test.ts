// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { encodeUtf8 } from '../../../../src/lib/services/file';
import {
	CONFIRM_KEY,
	confirmEnabled,
	disableConfirm,
	needsConfirm
} from '../../../../src/lib/views/shell/confirm';
import {
	BACKGROUND,
	downloadBlob,
	editorAvailable,
	selectionAvailable,
	themePalette,
	exportName,
	initialExport,
	markdownFor,
	toGeometry
} from '../../../../src/lib/views/shell/exporting';
import {
	afterSave,
	chooseBlock,
	isDirty,
	NEW_TEXT,
	newFile,
	planOpen,
	saveText,
	saveStatus
} from '../../../../src/lib/views/shell/file';
import { focusTrap } from '../../../../src/lib/views/shell/focusTrap';
import { searchMatches } from '../../../../src/lib/views/shell/search';
import { container, edge, emptyDoc, node } from '../../model/fixtures';

const graph = emptyDoc({
	nodes: [node('A', { label: 'Start' }), node('B', { label: 'Ende' }), node('C', { label: 'x' })],
	edges: [edge('e1', 'A', 'B', { label: 'weiter' })],
	containers: [container('S', { label: 'Startgruppe' })]
});

describe('confirm (D-10)', () => {
	const store = (value: string | null) => {
		const data = new Map<string, string>();
		if (value !== null) data.set(CONFIRM_KEY, value);
		return {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
			data
		};
	};

	it('Standard aktiv, "false" schaltet ab', () => {
		expect(confirmEnabled(() => store(null))).toBe(true);
		expect(confirmEnabled(() => store('false'))).toBe(false);
	});

	it('ohne Storage bleibt die Rückfrage aktiv', () => {
		expect(
			confirmEnabled(() => {
				throw new Error('SecurityError');
			})
		).toBe(true);
		expect(confirmEnabled(() => null)).toBe(true);
	});

	it('dauerhaft abschalten, Fehler liefert false', () => {
		const s = store(null);
		expect(disableConfirm(() => s)).toBe(true);
		expect(s.data.get(CONFIRM_KEY)).toBe('false');
		expect(disableConfirm(() => null)).toBe(false);
		expect(
			disableConfirm(() => ({
				getItem: () => null,
				setItem: () => {
					throw new Error('QuotaExceeded');
				}
			}))
		).toBe(false);
	});

	it('nur Knoten mit Kanten fragen; Shift oder abgeschaltet nie', () => {
		const on = { force: false, enabled: true };
		expect(needsConfirm(graph, ['A'], on)).toBe(true);
		expect(needsConfirm(graph, ['B'], on)).toBe(true);
		expect(needsConfirm(graph, ['C'], on)).toBe(false);
		expect(needsConfirm(graph, ['e1'], on)).toBe(false);
		expect(needsConfirm(graph, ['A'], { force: true, enabled: true })).toBe(false);
		expect(needsConfirm(graph, ['A'], { force: false, enabled: false })).toBe(false);
	});
});

describe('file (dirty/clean, Öffnen, Speichern)', () => {
	const opened = (name: string, text: string, kind: 'mmd' | 'md' | null) => ({
		name,
		kind,
		bytes: encodeUtf8(text),
		handle: null
	});

	it('neue Datei ist sauber, Änderung macht sie dirty', () => {
		const state = newFile(NEW_TEXT);
		expect(state.name).toBe('diagramm.mmd');
		expect(isDirty(state, NEW_TEXT)).toBe(false);
		expect(isDirty(state, NEW_TEXT + '  A\n')).toBe(true);
	});

	it('.mmd: Text unverändert, Zeilenende bleibt beim Speichern', () => {
		const plan = planOpen(opened('a.mmd', '﻿flowchart TD\r\n  A\r\n', 'mmd'));
		expect(plan.type).toBe('load');
		if (plan.type !== 'load') return;
		expect(plan.text).toBe('flowchart TD\r\n  A\r\n');
		const state = { ...plan.file, saved: plan.text };
		expect(saveText(state, 'flowchart TD\n  B\n')).toBe('flowchart TD\r\n  B\r\n');
	});

	it('.md mit einem Block lädt ihn, Speichern ersetzt nur den Block', () => {
		const md = '# T\n\n```mermaid\nflowchart TD\n  A\n```\n\nText\n';
		const plan = planOpen(opened('d.md', md, 'md'));
		expect(plan.type).toBe('load');
		if (plan.type !== 'load') return;
		expect(plan.text).toBe('flowchart TD\n  A');
		const state = { ...plan.file, saved: plan.text };
		expect(saveText(state, 'flowchart TD\n  B')).toBe(
			'# T\n\n```mermaid\nflowchart TD\n  B\n```\n\nText\n'
		);
	});

	it('.md mit mehreren Blöcken verlangt Auswahl', () => {
		const md = '```mermaid\nflowchart TD\n```\n\n```mermaid\nsequenceDiagram\n```\n';
		const plan = planOpen(opened('d.md', md, 'md'));
		expect(plan.type).toBe('choose');
		if (plan.type !== 'choose') return;
		expect(plan.blocks).toEqual([
			{ index: 0, label: 'Block 1: flowchart TD' },
			{ index: 1, label: 'Block 2: sequenceDiagram' }
		]);
		const picked = chooseBlock(plan, 1);
		expect(picked.text).toBe('sequenceDiagram');
		expect(picked.file.block).toBe(1);
	});

	it('Fehlerfälle: ohne Mermaid-Block, falscher Typ', () => {
		expect(planOpen(opened('d.md', '# nur Text\n', 'md'))).toEqual({
			type: 'error',
			message: 'd.md enthält keinen Mermaid-Block.'
		});
		expect(planOpen(opened('x.txt', 'a', null))).toEqual({
			type: 'error',
			message: 'Nur .mmd- und .md-Dateien werden unterstützt.'
		});
	});

	it('nach Speichern sauber, Name und Handle übernommen', () => {
		const state = newFile(NEW_TEXT);
		const handle = { name: 'neu.mmd', getFile: async () => new File([], 'neu.mmd') };
		const next = afterSave(state, 'flowchart LR\n', { method: 'picker', name: 'neu.mmd', handle });
		expect(next.name).toBe('neu.mmd');
		expect(next.handle).toBe(handle);
		expect(isDirty(next, 'flowchart LR\n')).toBe(false);
		expect(saveStatus({ method: 'download', name: 'a.mmd', handle: null })).toBe(
			'Als Download gespeichert: a.mmd'
		);
		expect(saveStatus({ method: 'handle', name: 'a.mmd', handle })).toBe('Gespeichert: a.mmd');
	});

	it('afterSave bei .md übernimmt den neuen Markdown-Text', () => {
		const md = '```mermaid\nflowchart TD\n```\n';
		const plan = planOpen(opened('d.md', md, 'md'));
		if (plan.type !== 'load') throw new Error('load erwartet');
		const state = { ...plan.file, saved: plan.text };
		const next = afterSave(state, 'flowchart LR', {
			method: 'download',
			name: 'd.md',
			handle: null
		});
		expect(next.markdown).toBe('```mermaid\nflowchart LR\n```\n');
	});
});

describe('exporting', () => {
	it('Startoptionen nach defaultSource (D-04)', () => {
		expect(initialExport(graph, 'flowchart').source).toBe('mermaid');
		const manual = emptyDoc({ layout: { ...graph.layout, mode: 'manual' } });
		expect(initialExport(manual, 'flowchart')).toEqual({
			source: 'editor',
			format: 'svg',
			scale: 1,
			background: false,
			embed: true,
			theme: false,
			selection: false
		});
		expect(initialExport(manual, 'code').source).toBe('mermaid');
	});

	it('Editor-SVG im Graph- und Sequenz-Canvas, nicht im Code-Modus', () => {
		expect(editorAvailable('flowchart')).toBe(true);
		expect(editorAvailable('sequence')).toBe(true);
		expect(editorAvailable('code')).toBe(false);
	});

	it('Auswahl-Export nur im Graph-Canvas mit Auswahl', () => {
		expect(selectionAvailable('flowchart', 2)).toBe(true);
		expect(selectionAvailable('flowchart', 0)).toBe(false);
		expect(selectionAvailable('sequence', 1)).toBe(false);
	});

	it('Theme-Palette aus den CSS-Variablen der Shell', () => {
		const vars: Record<string, string> = { '--node': ' #1d2232 ', '--bg': '#0d0f14' };
		const palette = themePalette({ getPropertyValue: (n: string) => vars[n] ?? '' });
		expect(palette.nodeFill).toBe('#1d2232');
		expect(palette.background).toBe('#0d0f14');
		expect(palette.text).toBe('');
	});

	it('Geometrie, Dateinamen, Hintergrund', () => {
		expect(toGeometry({ A: { x: 1, y: 2, w: 3, h: 4 } })).toEqual({ A: [1, 2, 3, 4] });
		expect(exportName('diagramm.mmd', 'svg')).toBe('diagramm.svg');
		expect(exportName('doku.v2.md', 'png')).toBe('doku.v2.png');
		expect(exportName('', 'png')).toBe('diagramm.png');
		expect(BACKGROUND).toBe('#ffffff');
	});

	it('Copy-as-Markdown mit und ohne Layout', () => {
		const manual = emptyDoc({
			nodes: [node('n1')],
			layout: { ...graph.layout, mode: 'manual', positions: { n1: [0, 0, 10, 10] } }
		});
		const withLayout = markdownFor('flowchart TD\n  n1\n', manual, true);
		expect(withLayout.markdown).toMatch(/^```mermaid\nflowchart TD\n {2}n1\n%% @mermuid: /);
		const without = markdownFor('flowchart TD\n  n1\n', manual, false);
		expect(without.markdown).toBe('```mermaid\nflowchart TD\n  n1\n```\n');
	});

	it('downloadBlob: Anker mit Dateiname, URL wird freigegeben', () => {
		vi.useFakeTimers();
		const create = vi.fn(() => 'blob:x');
		const revoke = vi.fn();
		const clicked: string[] = [];
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement
		) {
			clicked.push(this.download);
		});
		downloadBlob(new Blob(['x']), 'a.svg', {
			document,
			createObjectURL: create,
			revokeObjectURL: revoke
		});
		expect(clicked).toEqual(['a.svg']);
		vi.runAllTimers();
		expect(revoke).toHaveBeenCalledWith('blob:x');
		click.mockRestore();
		vi.useRealTimers();
	});
});

describe('search', () => {
	it('Teilstring ohne Groß/Klein in Dokument-Reihenfolge, auch IDs', () => {
		expect(searchMatches(graph, 'start')).toEqual(['S', 'A']);
		expect(searchMatches(graph, 'WEITER')).toEqual(['e1']);
		expect(searchMatches(graph, 'b')).toEqual(['B']);
		expect(searchMatches(graph, '  ')).toEqual([]);
	});
});

describe('focusTrap', () => {
	const tab = (shiftKey = false) => {
		const e = new KeyboardEvent('keydown', {
			key: 'Tab',
			shiftKey,
			bubbles: true,
			cancelable: true
		});
		document.activeElement!.dispatchEvent(e);
		return e;
	};

	it('Fokus rein, Tab zyklisch, Esc schließt, Fokus zurück zum Auslöser', () => {
		const opener = document.createElement('button');
		const dialog = document.createElement('div');
		dialog.tabIndex = -1;
		const [a, b] = ['a', 'b'].map((t) => {
			const x = document.createElement('button');
			x.textContent = t;
			dialog.append(x);
			return x;
		});
		document.body.append(opener, dialog);
		opener.focus();
		const onclose = vi.fn();
		const cleanup = focusTrap(onclose)(dialog) as () => void;
		expect(document.activeElement).toBe(a);
		expect(tab().defaultPrevented).toBe(false);
		b.focus();
		expect(tab().defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(a);
		expect(tab(true).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(b);
		opener.focus();
		tab();
		expect(document.activeElement).toBe(a);
		document.activeElement!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		expect(onclose).toHaveBeenCalledTimes(1);
		cleanup();
		expect(document.activeElement).toBe(opener);
		dialog.remove();
		opener.remove();
	});

	it('ohne Bedienelemente bleibt der Fokus auf dem Dialog', () => {
		const dialog = document.createElement('div');
		dialog.tabIndex = -1;
		document.body.append(dialog);
		const cleanup = focusTrap(() => {})(dialog) as () => void;
		expect(document.activeElement).toBe(dialog);
		expect(tab().defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(dialog);
		cleanup();
		dialog.remove();
	});
});
