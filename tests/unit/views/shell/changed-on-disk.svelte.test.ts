// @vitest-environment jsdom
// T105 C3 (V-11 Shell-Teil): Speichern mit `changed-on-disk` fragt Speichern unter (primär) /
// Überschreiben / Abbrechen (Esc); toter Handle weicht auf Save-Picker bzw. Download aus.
// T101-Guard: Neu/Öffnen läuft nach "Speichern" nur weiter, wenn das Speichern samt Rückfrage
// gelungen ist. T105 C2 Fix (O-73): Tab-Titel nennt dieselbe Datei wie die Toolbar.
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileEnv, FileHandleLike } from '../../../../src/lib/services/file';
import { installBrowserStubs, nodeEl } from '../canvas/helpers';
import type { SyncController } from '../../../../src/lib/controllers/sync';
import { button, createFake, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(() => {
	unmountShells();
	vi.restoreAllMocks();
});

const OPENED = 'flowchart LR\n  A\n';

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const dialog = () => document.querySelector<HTMLElement>('.dialog[role="dialog"]');
const heading = () => text(dialog()?.querySelector('h2') ?? null);
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

/** Enter wie im Browser: keydown, ohne preventDefault aktiviert der fokussierte Button. */
function enter() {
	const el = document.activeElement as HTMLElement;
	const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
	el.dispatchEvent(e);
	if (!e.defaultPrevented && el instanceof HTMLButtonElement) el.click();
	flushSync();
}

function escape() {
	document.activeElement!.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
	);
	flushSync();
}

const ctrlS = () => {
	window.dispatchEvent(
		new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
	);
	flushSync();
};

/**
 * Datei auf der "Platte" mit Handle: `touch()` ändert sie extern; `fail` lässt `createWritable`
 * mit diesem DOMException-Namen scheitern (toter Handle). Zählt Schreibvorgänge.
 */
function diskFile(name: string, content = OPENED) {
	const disk = {
		content,
		lastModified: 1000,
		writes: 0,
		fail: null as string | null,
		bytes: null as Uint8Array | null
	};
	const handle: FileHandleLike = {
		name,
		getFile: async () => new File([disk.content], name, { lastModified: disk.lastModified }),
		createWritable: async () => {
			if (disk.fail) throw Object.assign(new Error(disk.fail), { name: disk.fail });
			return {
				write: async (data) => {
					disk.bytes = data as Uint8Array;
					disk.content = new TextDecoder().decode(data as Uint8Array);
				},
				close: async () => {
					disk.writes++;
					disk.lastModified++;
				}
			};
		}
	};
	const touch = () => {
		disk.content += '  EXTERN\n';
		disk.lastModified += 10;
	};
	return { disk, handle, touch };
}

/**
 * Umgebung mit Open-Picker für `opened`; mit `saveAs` zusätzlich Save-Picker (zählt Vorschläge),
 * sonst Download-Fallback (zählt Namen).
 */
function fakeEnv(opened: FileHandleLike, saveAs?: FileHandleLike) {
	const downloads: string[] = [];
	const suggested: (string | undefined)[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		downloads.push(this.download);
	});
	const env: FileEnv = {
		document,
		createObjectURL: () => 'blob:x',
		revokeObjectURL: () => {},
		showOpenFilePicker: async () => [opened]
	};
	if (saveAs) {
		env.showSaveFilePicker = async (options) => {
			suggested.push(options.suggestedName);
			return saveAs;
		};
	}
	return { env, downloads, suggested };
}

/** Zuletzt von der Shell erzeugter bzw. übergebener Controller (Neu/Öffnen ersetzen ihn). */
let current: SyncController | null = null;
const create = (code: string) => createFake(code).then((s) => (current = s));

/** Shell mit Datei-Umgebung; jeder neue Controller wird in `current` festgehalten. */
async function shell(env: FileEnv) {
	const mounted = await mountShell('flowchart TD\n', { fileEnv: env, create });
	current = mounted.sync;
	return mounted;
}

/** Shell, Datei über Öffnen geladen. */
async function openedDirty(env: FileEnv) {
	const mounted = await shell(env);
	click(button(mounted.target, 'Öffnen'));
	await settle();
	return mounted;
}

/** Ändert den Code des aktuell geladenen Diagramms. */
async function editLoaded(_target: HTMLElement, code: string) {
	current!.editCode(code);
	await current!.flush();
	await settle();
}

const EDITED = 'flowchart LR\n  A\n  X\n';
const BOM = '\uFEFF';
const BOM_BYTES = [0xef, 0xbb, 0xbf];
const CHANGED =
	'Datei wurde außerhalb der App geändert. Nicht gespeichert, um die Änderung nicht zu überschreiben.';

async function changedOnDisk(saveAs?: FileHandleLike, content = OPENED) {
	const a = diskFile('a.mmd', content);
	const files = fakeEnv(a.handle, saveAs);
	const { target } = await openedDirty(files.env);
	expect(fileLabel(target)).toBe('Datei: a.mmd');
	await editLoaded(target, EDITED);
	expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
	a.touch();
	return { ...files, a, target };
}

describe('T105 C3: Rückfrage bei changed-on-disk', () => {
	it('Speichern zeigt Rückfrage, schreibt nichts; Speichern unter primär und fokussiert', async () => {
		const { a, target } = await changedOnDisk();
		ctrlS();
		await settle();
		expect(heading()).toBe('Datei extern geändert');
		expect(labels()).toEqual(['Speichern unter', 'Überschreiben', 'Abbrechen']);
		expect(dialogButton('Speichern unter').classList.contains('primary')).toBe(true);
		expect(document.activeElement).toBe(dialogButton('Speichern unter'));
		expect(a.disk.writes).toBe(0);
		expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
	});

	it('Überschreiben: schreibt ohne Standvergleich in dieselbe Datei, danach sauber', async () => {
		const { a, target } = await changedOnDisk();
		ctrlS();
		await settle();
		click(dialogButton('Überschreiben'));
		await settle();
		expect(a.disk.writes).toBe(1);
		expect(a.disk.content).toBe(EDITED);
		expect(fileLabel(target)).toBe('Datei: a.mmd');
		expect(message(target)).toBe('Gespeichert: a.mmd');
		// Neuer Stand übernommen: nächstes Speichern ohne Rückfrage.
		await editLoaded(target, EDITED + '  Y\n');
		ctrlS();
		await settle();
		expect(dialog()).toBeNull();
		expect(a.disk.writes).toBe(2);
	});

	it('Speichern unter: Save-Picker mit Dateiname, neue Datei, Original unberührt', async () => {
		const b = diskFile('b.mmd', '');
		const { a, suggested, target } = await changedOnDisk(b.handle);
		ctrlS();
		await settle();
		click(dialogButton('Speichern unter'));
		await settle();
		expect(suggested).toEqual(['a.mmd']);
		expect(a.disk.writes).toBe(0);
		expect(b.disk.content).toBe(EDITED);
		expect(fileLabel(target)).toBe('Datei: b.mmd');
		expect(message(target)).toBe('Gespeichert: b.mmd');
		expect(document.title).toBe('b.mmd - mermUId');
	});

	it('Speichern unter ohne Save-Picker: Download unter dem Dateinamen', async () => {
		const { a, downloads, target } = await changedOnDisk();
		ctrlS();
		await settle();
		click(dialogButton('Speichern unter'));
		await settle();
		expect(downloads).toEqual(['a.mmd']);
		expect(a.disk.writes).toBe(0);
		expect(message(target)).toBe('Als Download gespeichert: a.mmd');
		expect(fileLabel(target)).toBe('Datei: a.mmd');
	});

	it('Enter wählt Speichern unter, nicht Überschreiben', async () => {
		const b = diskFile('b.mmd', '');
		const { a } = await changedOnDisk(b.handle);
		ctrlS();
		await settle();
		enter();
		await settle();
		expect(a.disk.writes).toBe(0);
		expect(b.disk.writes).toBe(1);
	});

	it('Abbrechen und Esc: nichts geschrieben, Änderungen bleiben', async () => {
		const { a, downloads, target } = await changedOnDisk();
		ctrlS();
		await settle();
		click(dialogButton('Abbrechen'));
		await settle();
		expect(dialog()).toBeNull();
		ctrlS();
		await settle();
		expect(heading()).toBe('Datei extern geändert');
		escape();
		await settle();
		expect(dialog()).toBeNull();
		expect(a.disk.writes).toBe(0);
		expect(downloads).toEqual([]);
		expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
		expect(message(target)).toBe(CHANGED);
	});

	it('Speichern unter mit Picker-Abbruch: nichts geschrieben, geändert, Meldung bleibt', async () => {
		const b = diskFile('b.mmd', '');
		const { a, env, target } = await changedOnDisk(b.handle);
		env.showSaveFilePicker = async () => {
			throw new DOMException('abgebrochen', 'AbortError');
		};
		ctrlS();
		await settle();
		click(dialogButton('Speichern unter'));
		await settle();
		expect(dialog()).toBeNull();
		expect(a.disk.writes).toBe(0);
		expect(b.disk.writes).toBe(0);
		expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
		expect(message(target)).toBe(CHANGED);
	});

	it('BOM bleibt nach Überschreiben', async () => {
		const { a } = await changedOnDisk(undefined, BOM + OPENED);
		ctrlS();
		await settle();
		click(dialogButton('Überschreiben'));
		await settle();
		expect(a.disk.writes).toBe(1);
		expect([...a.disk.bytes!.slice(0, 3)]).toEqual(BOM_BYTES);
	});

	it('BOM bleibt nach Speichern unter', async () => {
		const b = diskFile('b.mmd', '');
		const { a } = await changedOnDisk(b.handle, BOM + OPENED);
		ctrlS();
		await settle();
		click(dialogButton('Speichern unter'));
		await settle();
		expect(a.disk.writes).toBe(0);
		expect([...b.disk.bytes!.slice(0, 3)]).toEqual(BOM_BYTES);
	});

	it('Schließen der Rückfrage gibt den Fokus an den Auslöser zurück', async () => {
		const { target } = await changedOnDisk();
		const save = button(target, 'Speichern');
		save.focus();
		click(save);
		await settle();
		expect(heading()).toBe('Datei extern geändert');
		expect(document.activeElement).toBe(dialogButton('Speichern unter'));
		click(dialogButton('Abbrechen'));
		await settle();
		expect(dialog()).toBeNull();
		expect(document.activeElement).toBe(save);
	});

	it('Save-Lock: weiteres Strg-S während der Rückfrage startet nichts Zusätzliches', async () => {
		const { a } = await changedOnDisk();
		ctrlS();
		await settle();
		ctrlS();
		ctrlS();
		await settle();
		expect(document.querySelectorAll('.dialog[role="dialog"]')).toHaveLength(1);
		click(dialogButton('Überschreiben'));
		await settle();
		expect(a.disk.writes).toBe(1);
		expect(dialog()).toBeNull();
	});
});

describe('T105 C3: toter Handle', () => {
	for (const name of ['NotFoundError', 'NotAllowedError']) {
		it(`${name} beim Schreiben: Save-Picker statt Fehlermeldung`, async () => {
			const a = diskFile('a.mmd');
			const b = diskFile('b.mmd', '');
			const { env, suggested } = fakeEnv(a.handle, b.handle);
			const { target } = await openedDirty(env);
			await editLoaded(target, EDITED);
			a.disk.fail = name;
			ctrlS();
			await settle();
			expect(dialog()).toBeNull();
			expect(suggested).toEqual(['a.mmd']);
			expect(b.disk.content).toBe(EDITED);
			expect(fileLabel(target)).toBe('Datei: b.mmd');
		});
	}

	it('ohne Save-Picker: Download', async () => {
		const a = diskFile('a.mmd');
		const { env, downloads } = fakeEnv(a.handle);
		const { target } = await openedDirty(env);
		await editLoaded(target, EDITED);
		a.disk.fail = 'NotFoundError';
		ctrlS();
		await settle();
		expect(downloads).toEqual(['a.mmd']);
		expect(message(target)).toBe('Als Download gespeichert: a.mmd');
		expect(fileLabel(target)).toBe('Datei: a.mmd');
	});

	const REASONS = [
		['NotFoundError', 'Datei nicht gefunden (verschoben oder gelöscht).'],
		['NotAllowedError', 'Keine Berechtigung für die Datei.']
	] as const;

	for (const [name, reason] of REASONS) {
		it(`${name} und Picker-Abbruch: Meldung nennt Grund, Änderungen bleiben`, async () => {
			const a = diskFile('a.mmd');
			const b = diskFile('b.mmd', '');
			const { env } = fakeEnv(a.handle, b.handle);
			env.showSaveFilePicker = async () => {
				throw new DOMException('abgebrochen', 'AbortError');
			};
			const { target } = await openedDirty(env);
			await editLoaded(target, EDITED);
			a.disk.fail = name;
			ctrlS();
			await settle();
			expect(b.disk.writes).toBe(0);
			expect(message(target)).toBe(reason);
			expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
		});

		it(`${name} und SecurityError im Picker: Meldung nennt Grund und Fehlschlag`, async () => {
			const a = diskFile('a.mmd');
			const { env } = fakeEnv(a.handle);
			env.showSaveFilePicker = async () => {
				throw new DOMException('keine User-Activation', 'SecurityError');
			};
			const { target } = await openedDirty(env);
			await editLoaded(target, EDITED);
			a.disk.fail = name;
			ctrlS();
			await settle();
			expect(message(target)).toBe(`${reason} Datei konnte nicht gespeichert werden.`);
			expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
		});
	}

	it('anderer Schreibfehler: Meldung, kein Ausweichen', async () => {
		const a = diskFile('a.mmd');
		const { env, downloads } = fakeEnv(a.handle);
		const { target } = await openedDirty(env);
		await editLoaded(target, EDITED);
		a.disk.fail = 'QuotaExceededError';
		ctrlS();
		await settle();
		expect(downloads).toEqual([]);
		expect(message(target)).not.toBe('');
		expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
	});
});

describe('T105 C3: Guard-Kette Neu mit Speichern', () => {
	async function newWithSave(saveAs?: FileHandleLike) {
		const ctx = await changedOnDisk(saveAs);
		click(button(ctx.target, 'Neu'));
		await settle();
		expect(heading()).toBe('Ungespeicherte Änderungen');
		click(dialogButton('Speichern'));
		await settle();
		expect(heading()).toBe('Datei extern geändert');
		return ctx;
	}

	it('Abbrechen in der Rückfrage bricht Neu ab', async () => {
		const { a, target } = await newWithSave();
		click(dialogButton('Abbrechen'));
		await settle();
		expect(dialog()).toBeNull();
		expect(a.disk.writes).toBe(0);
		expect(nodeEl(target, 'X')).not.toBeNull();
		expect(fileLabel(target)).toBe('Datei: a.mmd (geändert)');
	});

	it('Speichern unter gelungen: danach Neu-Dialog, Anlage mit Standardname', async () => {
		const b = diskFile('b.mmd', '');
		const { target } = await newWithSave(b.handle);
		click(dialogButton('Speichern unter'));
		await settle();
		expect(b.disk.content).toBe(EDITED);
		expect(heading()).toBe('Neues Diagramm');
		click(dialogButton('Anlegen'));
		await settle();
		expect(message(target)).toBe('Neues Diagramm.');
		expect(nodeEl(target, 'X')).toBeNull();
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
		expect(document.title).toBe('diagramm.mmd - mermUId');
	});
});

describe('T105 C2 Fix (O-73): Tab-Titel wie Toolbar', () => {
	it('ohne Datei Standardname, Stern bei Änderungen', async () => {
		const a = diskFile('a.mmd');
		const { target } = await shell(fakeEnv(a.handle).env);
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
		expect(document.title).toBe('diagramm.mmd - mermUId');
		await editLoaded(target, 'flowchart TD\n  Q\n');
		expect(document.title).toBe('diagramm.mmd* - mermUId');
	});

	it('nach Speichern unter neuer Name, nach Neu-Dialog wieder Standardname ohne Stern', async () => {
		const a = diskFile('a.mmd');
		const b = diskFile('b.mmd', '');
		const { env } = fakeEnv(a.handle, b.handle);
		const { target } = await shell(env);
		await editLoaded(target, 'flowchart TD\n  Q\n');
		ctrlS();
		await settle();
		expect(document.title).toBe('b.mmd - mermUId');
		await editLoaded(target, 'flowchart TD\n  R\n');
		expect(document.title).toBe('b.mmd* - mermUId');
		click(button(target, 'Neu'));
		await settle();
		click(dialogButton('Verwerfen'));
		await settle();
		click(dialogButton('Anlegen'));
		await settle();
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
		expect(document.title).toBe('diagramm.mmd - mermUId');
	});
});
