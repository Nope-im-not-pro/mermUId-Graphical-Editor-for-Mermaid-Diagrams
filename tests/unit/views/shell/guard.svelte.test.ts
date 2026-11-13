// @vitest-environment jsdom
// T101 C1 (V-02): `beforeunload` warnt genau dann, wenn ungespeicherte Änderungen vorliegen.
// T101 C2 (V-03): Ungespeichert-Dialog Speichern (primär, fokussiert) / Verwerfen / Abbrechen.
// T101 C3: Speichern läuft höchstens einmal gleichzeitig; Neu/Öffnen warten darauf.
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileEnv, FileHandleLike } from '../../../../src/lib/services/file';
import { installBrowserStubs, nodeEl } from '../canvas/helpers';
import { button, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(() => {
	unmountShells();
	vi.restoreAllMocks();
});

const TWO = 'flowchart LR\n  A\n  B\n';

/** Löst `beforeunload` aus und liefert Abbruch-Flag und gesetzten `returnValue`. */
function unload() {
	const e = new Event('beforeunload', { cancelable: true });
	let returnValue: unknown = undefined;
	Object.defineProperty(e, 'returnValue', {
		get: () => returnValue,
		set: (v) => (returnValue = v)
	});
	window.dispatchEvent(e);
	return { prevented: e.defaultPrevented, returnValue };
}

const beforeunloadCalls = (spy: { mock: { calls: unknown[][] } }) =>
	spy.mock.calls.filter(([type]) => type === 'beforeunload').length;

async function edit(sync: { editCode(c: string): void; flush(): Promise<void> }, code: string) {
	sync.editCode(code);
	await sync.flush();
	await settle();
}

describe('T101 C1: beforeunload-Schutz', () => {
	it('nicht dirty: kein Handler, keine Wirkung', async () => {
		const add = vi.spyOn(window, 'addEventListener');
		await mountShell(TWO);
		await settle();
		expect(beforeunloadCalls(add)).toBe(0);
		expect(unload()).toEqual({ prevented: false, returnValue: undefined });
	});

	it('dirty: Handler registriert, preventDefault und returnValue gesetzt', async () => {
		const add = vi.spyOn(window, 'addEventListener');
		const { sync } = await mountShell(TWO);
		await edit(sync, 'flowchart LR\n  X\n');
		expect(beforeunloadCalls(add)).toBe(1);
		const result = unload();
		expect(result.prevented).toBe(true);
		expect(result.returnValue).toBe(true);
	});

	it('wieder sauber: Handler entfernt, keine Wirkung', async () => {
		const remove = vi.spyOn(window, 'removeEventListener');
		const { sync } = await mountShell(TWO);
		await edit(sync, 'flowchart LR\n  X\n');
		expect(unload().prevented).toBe(true);
		await edit(sync, TWO);
		expect(beforeunloadCalls(remove)).toBe(1);
		expect(unload()).toEqual({ prevented: false, returnValue: undefined });
	});
});

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const dialog = () => document.querySelector<HTMLElement>('.dialog[role="dialog"]');
const labels = () => [...dialog()!.querySelectorAll('button')].map(text);
const fileLabel = (target: HTMLElement) => text(target.querySelector('[data-testid="file"]'));
const message = (target: HTMLElement) => text(target.querySelector('[data-testid="message"]'));

function click(el: Element) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	flushSync();
}

function dialogButton(label: string) {
	const b = [...dialog()!.querySelectorAll('button')].find((x) => text(x) === label);
	if (!b) throw new Error(`Dialog-Button fehlt: ${label}`);
	return b;
}

/** T105 C1: nach der Rückfrage folgt der Neu-Dialog; "Anlegen" wählt die Standardvorlage. */
async function create() {
	expect(text(dialog()!.querySelector('h2'))).toBe('Neues Diagramm');
	click(dialogButton('Anlegen'));
	await settle();
}

/** Enter wie im Browser: keydown, ohne preventDefault aktiviert der fokussierte Button. */
function enter() {
	const el = document.activeElement as HTMLElement;
	const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
	el.dispatchEvent(e);
	if (!e.defaultPrevented && el instanceof HTMLButtonElement) el.click();
	flushSync();
}

/** Datei-Umgebung: Download-Fallback (zählt Namen) oder Save-Picker mit festem Verhalten. */
function fakeEnv(extra: Partial<FileEnv> = {}) {
	const names: string[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		names.push(this.download);
	});
	const env: FileEnv = {
		document,
		createObjectURL: () => 'blob:x',
		revokeObjectURL: () => {},
		...extra
	};
	return { env, names };
}

const failingPicker = (error: Error) => ({
	showSaveFilePicker: async () => {
		throw error;
	}
});
const abort = () => Object.assign(new Error('abgebrochen'), { name: 'AbortError' });

/** Shell mit geänderter Datei; `Neu` fokussiert und ausgelöst, Dialog offen. */
async function dirtyNew(env: FileEnv) {
	const mounted = await mountShell(TWO, { fileEnv: env });
	await edit(mounted.sync, 'flowchart LR\n  X\n');
	const trigger = button(mounted.target, 'Neu');
	trigger.focus();
	click(trigger);
	await settle();
	return { ...mounted, trigger };
}

function expectUnchanged(target: HTMLElement) {
	expect(dialog()).toBeNull();
	expect(nodeEl(target, 'X')).not.toBeNull();
	expect(fileLabel(target)).toBe('Datei: diagramm.mmd (geändert)');
}

describe('T101 C2: Ungespeichert-Dialog', () => {
	it('Reihenfolge Speichern, Verwerfen, Abbrechen; Speichern fokussiert und primär', async () => {
		await dirtyNew(fakeEnv().env);
		expect(labels()).toEqual(['Speichern', 'Verwerfen', 'Abbrechen']);
		expect(document.activeElement).toBe(dialogButton('Speichern'));
		expect(dialogButton('Speichern').classList.contains('primary')).toBe(true);
	});

	it('Speichern erfolgreich: speichert, danach Neu', async () => {
		const { env, names } = fakeEnv();
		const { target } = await dirtyNew(env);
		click(dialogButton('Speichern'));
		await settle();
		expect(names).toEqual(['diagramm.mmd']);
		await create();
		expect(message(target)).toBe('Neues Diagramm.');
		expect(nodeEl(target, 'X')).toBeNull();
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
	});

	it('Speichern abgebrochen (Datei-Dialog): Aktion abgebrochen, dirty bleibt', async () => {
		const { target } = await dirtyNew(fakeEnv(failingPicker(abort())).env);
		click(dialogButton('Speichern'));
		await settle();
		expectUnchanged(target);
		expect(message(target)).not.toBe('Neues Diagramm.');
	});

	it('Speichern fehlgeschlagen: Meldung, Aktion abgebrochen, dirty bleibt', async () => {
		const { target } = await dirtyNew(fakeEnv(failingPicker(new Error('kaputt'))).env);
		click(dialogButton('Speichern'));
		await settle();
		expectUnchanged(target);
		expect(message(target)).toBe('Datei konnte nicht gespeichert werden.');
	});

	it('Verwerfen: lädt neu, ohne zu speichern', async () => {
		const { env, names } = fakeEnv();
		const { target } = await dirtyNew(env);
		click(dialogButton('Verwerfen'));
		await settle();
		expect(names).toEqual([]);
		await create();
		expect(nodeEl(target, 'X')).toBeNull();
		expect(message(target)).toBe('Neues Diagramm.');
	});

	it('Abbrechen und Esc: nichts passiert, Fokus zurück zum Auslöser', async () => {
		const { env, names } = fakeEnv();
		const { target, trigger } = await dirtyNew(env);
		click(dialogButton('Abbrechen'));
		await settle();
		expectUnchanged(target);
		expect(document.activeElement).toBe(trigger);
		click(trigger);
		await settle();
		document.activeElement!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		await settle();
		expectUnchanged(target);
		expect(document.activeElement).toBe(trigger);
		expect(names).toEqual([]);
	});

	it('Neu gefolgt von Enter verwirft nicht, sondern speichert', async () => {
		const { env, names } = fakeEnv();
		const { target } = await dirtyNew(env);
		enter();
		await settle();
		expect(names).toEqual(['diagramm.mmd']);
		expect(text(dialog()!.querySelector('h2'))).toBe('Neues Diagramm');
		enter();
		await settle();
		expect(nodeEl(target, 'X')).toBeNull();
		unmountShells();
		const aborted = await dirtyNew(fakeEnv(failingPicker(abort())).env);
		enter();
		await settle();
		expectUnchanged(aborted.target);
	});

	it('Öffnen: Speichern erfolgreich öffnet danach die Datei', async () => {
		const opened = fakeEnv({
			showOpenFilePicker: async () => [
				{ name: 'a.mmd', getFile: async () => new File(['flowchart TD\n  Z\n'], 'a.mmd') }
			]
		});
		const { sync, target } = await mountShell(TWO, { fileEnv: opened.env });
		await edit(sync, 'flowchart LR\n  X\n');
		click(button(target, 'Öffnen'));
		await settle();
		click(dialogButton('Speichern'));
		await settle();
		expect(opened.names).toEqual(['diagramm.mmd']);
		expect(nodeEl(target, 'Z')).not.toBeNull();
		expect(message(target)).toBe('Geöffnet: a.mmd');
	});

	it('Datei-Drop: Speichern abgebrochen lädt die Datei nicht', async () => {
		const { sync, target } = await mountShell(TWO, {
			fileEnv: fakeEnv(failingPicker(abort())).env
		});
		await edit(sync, 'flowchart LR\n  X\n');
		const e = new MouseEvent('drop', { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'dataTransfer', {
			value: { types: ['Files'], files: [new File(['flowchart TD\n  D\n'], 'd.mmd')] }
		});
		target.querySelector('.shell')!.dispatchEvent(e);
		await settle();
		click(dialogButton('Speichern'));
		await settle();
		expectUnchanged(target);
		expect(nodeEl(target, 'D')).toBeNull();
	});
});

/**
 * Save-Picker, der bis `release()` hängt; zählt Picker-Aufrufe und Schreibvorgänge. Mit `fail`
 * wirft er danach diesen Fehler statt ein Handle zu liefern.
 */
function slowPicker(fail?: Error) {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const calls = { picks: 0, writes: 0 };
	const handle: FileHandleLike = {
		name: 'diagramm.mmd',
		getFile: async () => new File([''], 'diagramm.mmd'),
		createWritable: async () => ({
			write: async () => void calls.writes++,
			close: async () => {}
		})
	};
	const showSaveFilePicker = async () => {
		calls.picks++;
		await gate;
		if (fail) throw fail;
		return handle;
	};
	return { ...fakeEnv({ showSaveFilePicker }), release, calls };
}

const ctrlS = () => {
	window.dispatchEvent(
		new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
	);
	flushSync();
};

describe('T101 C3: kein paralleles Speichern', () => {
	it('zweimal Strg-S und Knopf während laufendem Schreiben: genau ein Speichervorgang', async () => {
		const { env, release, calls } = slowPicker();
		const { sync, target } = await mountShell(TWO, { fileEnv: env });
		await edit(sync, 'flowchart LR\n  X\n');
		ctrlS();
		ctrlS();
		click(button(target, 'Speichern'));
		await settle();
		release();
		await settle();
		expect(calls).toEqual({ picks: 1, writes: 1 });
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
	});

	it('Neu während Speichern: kein zweiter Dialog, danach Neu', async () => {
		const { env, release, calls } = slowPicker();
		const { target, trigger } = await dirtyNew(env);
		enter();
		await settle();
		expect(dialog()).toBeNull();
		click(trigger);
		await settle();
		expect(dialog()).toBeNull();
		release();
		await settle();
		expect(calls).toEqual({ picks: 1, writes: 1 });
		await create();
		expect(dialog()).toBeNull();
		expect(nodeEl(target, 'X')).toBeNull();
		expect(message(target)).toBe('Neues Diagramm.');
	});

	it('Neu während Speichern, das misslingt: kein Dialog, Abbruch, dirty bleibt', async () => {
		const { env, release, calls } = slowPicker(new Error('kaputt'));
		const { target, trigger } = await dirtyNew(env);
		enter();
		await settle();
		click(trigger);
		await settle();
		release();
		await settle();
		expect(calls).toEqual({ picks: 1, writes: 0 });
		expectUnchanged(target);
		expect(message(target)).toBe('Datei konnte nicht gespeichert werden.');
	});

	it('während des Wartens weiter editiert: nach dem Speichern erscheint der Dialog', async () => {
		const { env, release, calls } = slowPicker();
		const { sync, target } = await mountShell(TWO, { fileEnv: env });
		await edit(sync, 'flowchart LR\n  X\n');
		ctrlS();
		await settle();
		await edit(sync, 'flowchart LR\n  Y\n');
		click(button(target, 'Neu'));
		await settle();
		expect(dialog()).toBeNull();
		release();
		await settle();
		expect(calls).toEqual({ picks: 1, writes: 1 });
		expect(labels()).toEqual(['Speichern', 'Verwerfen', 'Abbrechen']);
		click(dialogButton('Abbrechen'));
		await settle();
		expect(nodeEl(target, 'Y')).not.toBeNull();
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd (geändert)');
	});

	it('Datei während Speichern gewechselt: Speichermeldung überschreibt nichts', async () => {
		const { env, release } = slowPicker();
		const { target } = await mountShell(TWO, { fileEnv: env });
		ctrlS();
		await settle();
		click(button(target, 'Neu'));
		await settle();
		await create();
		expect(message(target)).toBe('Neues Diagramm.');
		release();
		await settle();
		expect(message(target)).toBe('Neues Diagramm.');
	});
});

/** Open-Picker, der nach dem Speichern wegen verbrauchter Nutzer-Aktivierung scheitert. */
const blockedOpen = (name: string) =>
	fakeEnv({
		showOpenFilePicker: async () => {
			throw Object.assign(new Error('Must be handling a user gesture'), { name });
		}
	});

describe('T101 C3: Speichern, dann Öffnen ohne Nutzer-Aktivierung', () => {
	for (const name of ['SecurityError', 'NotAllowedError']) {
		it(`${name}: gespeichert, verständliche Meldung statt Rohtext`, async () => {
			const { env, names } = blockedOpen(name);
			const { sync, target } = await mountShell(TWO, { fileEnv: env });
			await edit(sync, 'flowchart LR\n  X\n');
			click(button(target, 'Öffnen'));
			await settle();
			click(dialogButton('Speichern'));
			await settle();
			expect(names).toEqual(['diagramm.mmd']);
			expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
			expect(message(target)).toBe('Gespeichert. Bitte Öffnen erneut wählen.');
		});
	}

	it('ohne vorheriges Speichern: normale Fehlermeldung', async () => {
		const { env } = blockedOpen('SecurityError');
		const { target } = await mountShell(TWO, { fileEnv: env });
		click(button(target, 'Öffnen'));
		await settle();
		expect(message(target)).toBe('Datei konnte nicht geöffnet werden.');
	});
});
