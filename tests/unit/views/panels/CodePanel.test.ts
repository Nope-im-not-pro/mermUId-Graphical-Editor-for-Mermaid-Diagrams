// @vitest-environment jsdom
import { forEachDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { updateNode } from '../../../../src/lib/model/operations';
import CodePanel from '../../../../src/lib/views/panels/CodePanel.svelte';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import { BAD, fakeAdapters } from './helpers';

const timer = { set: () => 0, clear: () => {} };
const TEXT = 'flowchart TD\n    A[Start]\n    B[Ende]\n    A --> B\n';
let cleanup: (() => void) | null = null;
const tick = () => new Promise((r) => setTimeout(r, 0));

async function setup(text = TEXT) {
	const sync = await createSync(text, { adapters: fakeAdapters, timer });
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(CodePanel, { target, props: { sync } });
	await tick();
	const view = EditorView.findFromDOM(target.querySelector('.cm-editor') as HTMLElement)!;
	cleanup = () => {
		unmount(app);
		target.remove();
		sync.dispose();
	};
	return { sync, target, view, app };
}

const diagnostics = (view: EditorView) => {
	const out: string[] = [];
	forEachDiagnostic(view.state, (d) => out.push(d.message));
	return out;
};

afterEach(() => cleanup?.());

describe('CodePanel', () => {
	it('Edit geht an den Sync-Controller', async () => {
		const { sync, view } = await setup();
		const edit = vi.spyOn(sync, 'editCode');
		view.dispatch({ changes: { from: view.state.doc.length, insert: '    B --> C\n' } });
		expect(edit).toHaveBeenCalledWith(`${TEXT}    B --> C\n`);
		await sync.flush();
		expect(get(sync.commands).doc.nodes.map((n) => n.id)).toContain('C');
		expect(edit).toHaveBeenCalledTimes(1);
	});

	it('Fremd-Update ohne Cursor-Sprung', async () => {
		const { sync, view } = await setup();
		const pos = TEXT.indexOf('A --> B') + 3;
		view.dispatch({ selection: { anchor: pos } });
		const edit = vi.spyOn(sync, 'editCode');
		await sync.execute({ label: 'x', do: (d) => updateNode(d, 'A', { label: 'Anfang lang' }) });
		await tick();
		const text = view.state.doc.toString();
		expect(text).toContain('Anfang lang');
		const head = view.state.selection.main.head;
		expect(text.slice(head - 3, head + 4)).toBe('A --> B');
		expect(edit).not.toHaveBeenCalled();
	});

	it('Undo-Tasten rufen den Command-Stack', async () => {
		const { sync, view } = await setup();
		const undo = vi.spyOn(sync, 'undo');
		const redo = vi.spyOn(sync, 'redo');
		const key = (init: KeyboardEventInit) =>
			view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
		key({ key: 'z', ctrlKey: true });
		key({ key: 'y', ctrlKey: true });
		key({ key: 'Z', keyCode: 90, ctrlKey: true, shiftKey: true });
		expect(undo).toHaveBeenCalledTimes(1);
		expect(redo).toHaveBeenCalledTimes(2);
	});

	it('Fehler als Marker, Konflikt mit Diff-Ansicht', async () => {
		const { sync, view, target } = await setup();
		view.dispatch({ changes: { from: view.state.doc.length, insert: `${BAD}\n` } });
		await sync.flush();
		await tick();
		await tick();
		expect(diagnostics(view)).toEqual(['Zeile 5: Syntaxfehler']);
		expect(target.querySelector('.diff')).toBeNull();
		// Konflikt nur bei echter Modell-Änderung (T107/O-71); Position ändert die .del-Zeilen nicht.
		await sync.execute({
			label: 'place',
			do: (d) => ({
				...d,
				layout: {
					...d.layout,
					mode: 'manual',
					positions: { ...d.layout.positions, A: [1, 1, 0, 0] }
				}
			})
		});
		await tick();
		await tick();
		const diff = target.querySelector('.diff');
		expect(diff?.querySelector('.del')?.textContent?.trim()).toBe(`- ${BAD}`);
		view.dispatch({ changes: { from: TEXT.length, to: view.state.doc.length, insert: '' } });
		await sync.keepCode();
		await tick();
		await tick();
		expect(diagnostics(view)).toEqual([]);
		expect(target.querySelector('.diff')).toBeNull();
	});

	it('reveal setzt Cursor auf Zeile und Spalte', async () => {
		const { view, app } = await setup();
		app.reveal(3, 5);
		expect(view.state.selection.main.head).toBe(TEXT.indexOf('B[Ende]'));
		app.reveal(99, 99);
		expect(view.state.selection.main.head).toBe(TEXT.length);
	});

	it('Code-Feld trägt aria-label und folgt dem Sprachwechsel (V-32)', async () => {
		const { target } = await setup();
		const content = () => target.querySelector('.cm-content')!;
		expect(content().getAttribute('aria-label')).toBe('Mermaid-Quelltext');
		try {
			applyLocale('en');
			flushSync();
			expect(content().getAttribute('aria-label')).toBe('Mermaid source code');
		} finally {
			applyLocale('de');
		}
	});
});
