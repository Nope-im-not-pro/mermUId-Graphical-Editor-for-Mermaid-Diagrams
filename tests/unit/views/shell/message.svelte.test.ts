// @vitest-environment jsdom
// T114 (V-19, V-32): Statusmeldung folgt dem Sprachwechsel, Fehler als `role="alert"` mit
// eigenem Stil, Erfolg verschwindet nach Zeitablauf oder nächster Änderung, Cursor nach "Neu"
// auf 1:1, `role="status"` nur auf Parser-/Sync-Pille.
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installBrowserStubs } from '../canvas/helpers';
import type { SyncController } from '../../../../src/lib/controllers/sync';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import type { FileEnv, FileHandleLike } from '../../../../src/lib/services/file';
import { button, createFake, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(() => {
	vi.useRealTimers();
	unmountShells();
	applyLocale('de');
});

const TWO = 'flowchart LR\n  A\n  B\n';
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const messageEl = (target: HTMLElement) =>
	target.querySelector<HTMLElement>('[data-testid="message"]')!;
const message = (target: HTMLElement) => text(messageEl(target));
/** Dauerhafte Regionen (O-85): Fehler sofort, sonst höflich; kein Rollenwechsel. */
const alertEl = (target: HTMLElement) => messageEl(target).querySelector('[role="alert"]');
const politeEl = (target: HTMLElement) => messageEl(target).querySelector('[aria-live="polite"]');

/** Sprachwahl im Speicher, damit kein Test die Wahl des nächsten verändert. */
function memory() {
	const data = new Map<string, string>();
	return () => ({
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v)
	});
}

function click(el: Element) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	flushSync();
}

function enter(el: Element) {
	const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
	el.dispatchEvent(e);
	if (!e.defaultPrevented && el instanceof HTMLButtonElement) el.click();
	flushSync();
}

/** Neu -> Enter (Standardvorlage); `wait` treibt die Zeit (echte oder falsche Timer). */
async function createNew(target: HTMLElement, wait: () => Promise<void> = settle) {
	click(button(target, 'Neu'));
	await wait();
	enter(document.activeElement!);
	await wait();
}

async function editorView(target: HTMLElement) {
	const { EditorView } = await import('@codemirror/view');
	return EditorView.findFromDOM(target.querySelector<HTMLElement>('.cm-editor')!)!;
}

describe('T114: Statusmeldung', () => {
	it('Sprachwechsel übersetzt die angezeigte Meldung', async () => {
		const { target } = await mountShell(TWO, { storage: memory() });
		await createNew(target);
		expect(message(target)).toBe('Neues Diagramm.');
		click(button(target, 'EN (Englisch)'));
		expect(message(target)).toBe('New diagram.');
		click(button(target, 'DE (German)'));
		expect(message(target)).toBe('Neues Diagramm.');
	});

	it('Fehler: role="alert" und eigener Stil; Hinweis/Erfolg ohne alert', async () => {
		const { sync, target } = await mountShell(TWO, { storage: memory() });
		vi.spyOn(sync, 'undo').mockRejectedValueOnce(new Error('kaputt'));
		click(button(target, 'Rückgängig'));
		await settle();
		const el = messageEl(target);
		expect(text(alertEl(target))).toBe('Rückgängig fehlgeschlagen: kaputt');
		expect(text(politeEl(target))).toBe('');
		expect(el.classList.contains('error')).toBe(true);
		click(button(target, 'EN (Englisch)'));
		expect(text(alertEl(target))).toBe('Undo failed: kaputt');
		click(button(target, 'DE (German)'));
		await createNew(target);
		expect(text(politeEl(target))).toBe('Neues Diagramm.');
		expect(text(alertEl(target))).toBe('');
		expect(messageEl(target).classList.contains('error')).toBe(false);
	});

	it('beide Regionen bestehen vor der ersten Meldung, ohne Rollenwechsel (O-85)', async () => {
		const { sync, target } = await mountShell(TWO, { storage: memory() });
		const alert = alertEl(target)!;
		const polite = politeEl(target)!;
		expect(alert).not.toBeNull();
		expect(polite).not.toBeNull();
		expect(alert).not.toBe(polite);
		expect(alert.getAttribute('aria-live')).toBeNull();
		expect(polite.getAttribute('role')).toBeNull();
		expect(message(target)).toBe('');
		vi.spyOn(sync, 'undo').mockRejectedValueOnce(new Error('kaputt'));
		click(button(target, 'Rückgängig'));
		await settle();
		await createNew(target);
		// Dieselben Knoten, Rollen unverändert.
		expect(alertEl(target)).toBe(alert);
		expect(politeEl(target)).toBe(polite);
		expect(alert.getAttribute('role')).toBe('alert');
		expect(polite.getAttribute('aria-live')).toBe('polite');
	});

	it('Info-Ton: höflich, ohne Fehlerstil', async () => {
		const { target } = await mountShell(TWO, { storage: memory() });
		const canvas = target.querySelector<HTMLElement>('.graph-canvas')!;
		canvas.focus();
		canvas.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true })
		);
		flushSync();
		expect(text(politeEl(target))).toBe('Zum Verbinden zuerst einen Knoten auswählen.');
		expect(text(alertEl(target))).toBe('');
		expect(messageEl(target).classList.contains('error')).toBe(false);
	});

	it('Erfolg, dann Fehler binnen 4 s: alter Zeitgeber löscht den Fehler nicht', async () => {
		const create = (code: string) => createFake(code).then((s) => (current = s));
		const { target } = await mountShell(TWO, { storage: memory(), create });
		vi.useFakeTimers();
		const tickFake = async () => {
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(1);
				flushSync();
			}
		};
		await createNew(target, tickFake);
		expect(message(target)).toBe('Neues Diagramm.');
		await vi.advanceTimersByTimeAsync(2000);
		vi.spyOn(current!, 'undo').mockRejectedValueOnce(new Error('kaputt'));
		click(button(target, 'Rückgängig'));
		await tickFake();
		expect(message(target)).toBe('Rückgängig fehlgeschlagen: kaputt');
		await vi.advanceTimersByTimeAsync(5000);
		flushSync();
		expect(message(target)).toBe('Rückgängig fehlgeschlagen: kaputt');
	});

	it('Code-Änderung bei angezeigtem Fehler: Fehler bleibt', async () => {
		const { sync, target } = await mountShell(TWO, { storage: memory() });
		vi.spyOn(sync, 'undo').mockRejectedValueOnce(new Error('kaputt'));
		click(button(target, 'Rückgängig'));
		await settle();
		click(button(target, 'Code ein/aus'));
		const view = await editorView(target);
		view.dispatch({ changes: { from: view.state.doc.length, insert: '  X\n' } });
		await settle();
		expect(message(target)).toBe('Rückgängig fehlgeschlagen: kaputt');
	});

	it('verkettete Meldung (toter Handle, Picker scheitert) wechselt die Sprache', async () => {
		const { target } = await openedShell();
		disk.fail = 'NotFoundError';
		current!.editCode('flowchart LR\n  A\n  X\n');
		await current!.flush();
		await settle();
		ctrlS();
		await settle();
		expect(text(alertEl(target))).toBe(
			'Datei nicht gefunden (verschoben oder gelöscht). Datei konnte nicht gespeichert werden.'
		);
		click(button(target, 'EN (Englisch)'));
		expect(text(alertEl(target))).toBe(
			'File not found (moved or deleted). File could not be saved.'
		);
	});

	it('Erfolg verschwindet nach Zeitablauf', async () => {
		const { target } = await mountShell(TWO, { storage: memory() });
		vi.useFakeTimers();
		const tickFake = async () => {
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(1);
				flushSync();
			}
		};
		await createNew(target, tickFake);
		expect(message(target)).toBe('Neues Diagramm.');
		await vi.advanceTimersByTimeAsync(2000);
		flushSync();
		expect(message(target)).toBe('Neues Diagramm.');
		await vi.advanceTimersByTimeAsync(5000);
		flushSync();
		expect(message(target)).toBe('');
	});

	it('Erfolg verschwindet bei der nächsten Änderung', async () => {
		const { target } = await mountShell(TWO, { storage: memory() });
		await createNew(target);
		expect(message(target)).toBe('Neues Diagramm.');
		click(button(target, 'Code ein/aus'));
		const view = await editorView(target);
		view.dispatch({ changes: { from: view.state.doc.length, insert: '  X\n' } });
		await settle();
		expect(message(target)).toBe('');
	});

	it('Fehler bleibt bei Zeitablauf stehen', async () => {
		const { sync, target } = await mountShell(TWO, { storage: memory() });
		vi.spyOn(sync, 'undo').mockRejectedValueOnce(new Error('kaputt'));
		vi.useFakeTimers();
		click(button(target, 'Rückgängig'));
		await vi.advanceTimersByTimeAsync(10_000);
		flushSync();
		expect(message(target)).toBe('Rückgängig fehlgeschlagen: kaputt');
	});
});

describe('T114: Statuszeile', () => {
	it('role="status" nur auf Parser-/Sync-Pille, nicht auf der Cursor-Position', async () => {
		const { target } = await mountShell(TWO, { storage: memory() });
		const bar = target.querySelector('.statusbar')!;
		expect(bar.getAttribute('role')).toBeNull();
		const live = [...bar.querySelectorAll('[role="status"]')];
		expect(live.map(text)).toEqual(['Parser: OK Sync: Grafik=Code']);
		const cursor = [...bar.querySelectorAll('.pill')].find((p) => text(p).startsWith('Z '))!;
		expect(cursor.closest('[role="status"], [aria-live]')).toBeNull();
	});

	it('Cursor-Anzeige nach "Neu" zeigt 1:1', async () => {
		const { target } = await mountShell(TWO, { storage: memory() });
		click(button(target, 'Code ein/aus'));
		const view = await editorView(target);
		view.dispatch({ selection: { anchor: 16 } });
		target
			.querySelector('#shell-code')!
			.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
		flushSync();
		expect(text(target.querySelector('.statusbar'))).toContain('Z 2:4');
		await createNew(target);
		expect(text(target.querySelector('.statusbar'))).toContain('Z 1:1');
	});

	it('Cursor-Anzeige nach "Öffnen" zeigt 1:1', async () => {
		const { target } = await openedShell();
		expect(message(target)).toBe('Geöffnet: a.mmd');
		expect(text(target.querySelector('.statusbar'))).toContain('Z 1:1');
	});
});

/** Datei-Attrappe mit Handle; `fail` lässt das Schreiben mit diesem DOMException-Namen scheitern. */
const disk = { fail: null as string | null };
let current: SyncController | null = null;

const handle: FileHandleLike = {
	name: 'a.mmd',
	getFile: async () => new File(['flowchart LR\n  A\n'], 'a.mmd', { lastModified: 1 }),
	createWritable: async () => {
		if (disk.fail) throw Object.assign(new Error(disk.fail), { name: disk.fail });
		return { write: async () => {}, close: async () => {} };
	}
};

/** Shell mit Open-Picker; Save-Picker scheitert ohne User-Activation (SecurityError). */
async function openedShell() {
	disk.fail = null;
	const env: FileEnv = {
		document,
		createObjectURL: () => 'blob:x',
		revokeObjectURL: () => {},
		showOpenFilePicker: async () => [handle],
		showSaveFilePicker: async () => {
			throw new DOMException('keine User-Activation', 'SecurityError');
		}
	};
	const create = (code: string) => createFake(code).then((s) => (current = s));
	const mounted = await mountShell(TWO, { storage: memory(), fileEnv: env, create });
	current = mounted.sync;
	click(button(mounted.target, 'Öffnen'));
	await settle();
	return mounted;
}

function ctrlS() {
	window.dispatchEvent(
		new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
	);
	flushSync();
}

describe('T114: Statuszeile ohne Zwischenansage', () => {
	it('"ausstehend" sichtbar, aber außerhalb der Live-Region; Endzustand unverändert', async () => {
		const { sync, target } = await mountShell(TWO, { storage: memory() });
		const bar = target.querySelector('.statusbar')!;
		const live = bar.querySelector('[role="status"]')!;
		expect(text(live)).toBe('Parser: OK Sync: Grafik=Code');
		sync.editCode('flowchart LR\n  A\n  B\n  C\n');
		flushSync();
		const pending = [...bar.querySelectorAll('.pill')].find(
			(p) => text(p) === 'Sync: Code wird geprüft'
		);
		expect(pending).toBeDefined();
		expect(pending!.closest('[role="status"], [aria-live]')).toBeNull();
		expect(text(live)).toBe('Parser: OK Sync: Grafik=Code');
		await sync.flush();
		await settle();
		expect(text(live)).toBe('Parser: OK Sync: Grafik=Code');
		expect(text(bar)).not.toContain('wird geprüft');
	});
});

describe('T114 I3: stabile Live-Knoten', () => {
	it('ausstehend bis Endzustand: keine Knoten-Mutation in der Region, gleiche Pille', async () => {
		const { sync, target } = await mountShell(TWO, { storage: memory() });
		const live = target.querySelector('.statusbar [role="status"]')!;
		const pills = [...live.querySelectorAll('.pill')];
		expect(pills.map(text)).toEqual(['Parser: OK', 'Sync: Grafik=Code']);
		const added: Node[] = [];
		const removed: Node[] = [];
		const observer = new MutationObserver((records) => {
			for (const r of records) {
				added.push(...r.addedNodes);
				removed.push(...r.removedNodes);
			}
		});
		observer.observe(live, { childList: true, subtree: true });
		sync.editCode('flowchart LR\n  A\n  B\n  C\n');
		flushSync();
		// Endzustand-Pille bleibt in der Region, nur optisch ausgeblendet.
		expect(pills[1].classList.contains('visually-hidden')).toBe(true);
		await sync.flush();
		await settle();
		observer.takeRecords().forEach((r) => {
			added.push(...r.addedNodes);
			removed.push(...r.removedNodes);
		});
		observer.disconnect();
		expect(added).toEqual([]);
		expect(removed).toEqual([]);
		expect([...live.querySelectorAll('.pill')]).toEqual(pills);
		expect(pills[1].classList.contains('visually-hidden')).toBe(false);
	});

	it('Sprachwechsel während "ausstehend": Endzustand in neuer Sprache', async () => {
		const { sync, target } = await mountShell(TWO, { storage: memory() });
		const live = target.querySelector('.statusbar [role="status"]')!;
		sync.editCode('flowchart LR\n  A\n  B\n  C\n');
		flushSync();
		click(button(target, 'EN (Englisch)'));
		expect(text(live)).toBe('Parser: OK Sync: diagram=code');
		expect(text(target.querySelector('.statusbar'))).toContain('Sync: checking code');
		await sync.flush();
		await settle();
		expect(text(live)).toBe('Parser: OK Sync: diagram=code');
	});

	it('gleiche Meldung zweimal: zwei getrennte Textknoten; Sprachwechsel behält den Knoten', async () => {
		const { target } = await mountShell(TWO, { storage: memory() });
		const canvas = target.querySelector<HTMLElement>('.graph-canvas')!;
		const pressC = () => {
			canvas.focus();
			canvas.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true })
			);
			flushSync();
		};
		const node = () =>
			[...politeEl(target)!.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent);
		pressC();
		const first = node();
		expect(first?.textContent).toBe('Zum Verbinden zuerst einen Knoten auswählen.');
		pressC();
		const second = node();
		expect(second?.textContent).toBe('Zum Verbinden zuerst einen Knoten auswählen.');
		expect(second).not.toBe(first);
		click(button(target, 'EN (Englisch)'));
		expect(node()).toBe(second);
		expect(second!.textContent).not.toBe('Zum Verbinden zuerst einen Knoten auswählen.');
	});
});
