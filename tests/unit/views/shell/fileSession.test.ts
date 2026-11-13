// T123 C1 (V-24): Datei-Sitzung als eigenes Modul, ohne Komponente geprüft.
import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type { SyncController } from '../../../../src/lib/controllers/sync';
import type { FileEnv, FileHandleLike } from '../../../../src/lib/services/file';
import {
	createFileSession,
	type FileSessionDeps
} from '../../../../src/lib/views/shell/fileSession.svelte';
import type { StatusMessage } from '../../../../src/lib/views/shell/status';

const START = 'flowchart TD\n  A\n';

/** Minimaler Controller: Store mit `code`, zählbares `dispose`. */
function fakeController(code: string) {
	const store = writable({ code });
	return Object.assign(store, { dispose: vi.fn() }) as unknown as SyncController & {
		dispose: ReturnType<typeof vi.fn>;
	};
}

/** Datei-Handle im Speicher; `touch` simuliert eine externe Änderung. */
function fakeHandle(name: string, content: string) {
	let file = new File([content], name, { lastModified: 1 });
	const writes: string[] = [];
	const handle = {
		name,
		getFile: async () => file,
		createWritable: async () => ({
			write: async (data: Uint8Array | Blob | string) => {
				const text = typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array);
				writes.push(text);
				file = new File([text], name, { lastModified: file.lastModified + 1 });
			},
			close: async () => {}
		}),
		writes,
		touch: () => (file = new File([content + '%%\n'], name, { lastModified: 99 }))
	};
	return handle satisfies FileHandleLike;
}

function setup(over: Partial<Omit<FileSessionDeps, 'env'>> & { env?: FileEnv } = {}) {
	const { env: customEnv, ...rest } = over;
	let code = START;
	const said: (StatusMessage | null)[] = [];
	const created: ReturnType<typeof fakeController>[] = [];
	const answers: (string | null)[] = [];
	const ask = vi.fn(async () => ({ value: answers.shift() ?? null }));
	const env: FileEnv = customEnv ?? {
		document: {} as Document,
		createObjectURL: () => 'blob:x',
		revokeObjectURL: () => {}
	};
	const deps: FileSessionDeps = {
		code: () => code,
		initial: START,
		create: async (text) => {
			const c = fakeController(text);
			created.push(c);
			code = text;
			return c;
		},
		env: () => env,
		ask,
		say: (m) => said.push(m),
		reset: vi.fn(),
		...rest
	};
	const session = createFileSession(deps);
	return {
		session,
		deps,
		ask,
		answers,
		said,
		created,
		edit: (next: string) => (code = next),
		last: () => said.at(-1)
	};
}

describe('createFileSession: Zustand', () => {
	it('Start: Standardname, sauber, kein eigener Controller, kein Neu-Dialog', () => {
		const { session } = setup();
		expect(session.file.name).toBe('diagramm.mmd');
		expect(session.file.saved).toBe(START);
		expect(session.dirty).toBe(false);
		expect(session.controller).toBeNull();
		expect(session.picking).toBe(false);
	});

	it('dirty folgt dem aktuellen Code', () => {
		const { session, edit } = setup();
		edit('flowchart TD\n  B\n');
		expect(session.dirty).toBe(true);
		edit(START);
		expect(session.dirty).toBe(false);
	});
});

describe('createFileSession: guard', () => {
	it('sauber: "clean" ohne Rückfrage', async () => {
		const { session, ask } = setup();
		expect(await session.guard()).toBe('clean');
		expect(ask).not.toHaveBeenCalled();
	});

	it('geändert: Verwerfen -> "discard", Abbrechen/Esc -> null', async () => {
		const { session, answers, edit, ask } = setup();
		edit('flowchart TD\n  B\n');
		answers.push('discard', 'cancel', null);
		expect(await session.guard()).toBe('discard');
		expect(await session.guard()).toBeNull();
		expect(await session.guard()).toBeNull();
		const values = (ask.mock.calls[0] as unknown as [{ actions: { value: string }[] }])[0].actions;
		expect(values.map((a) => a.value)).toEqual(['save', 'discard', 'cancel']);
	});

	it('geändert: Speichern -> "saved" und sauber', async () => {
		const target = fakeHandle('neu.mmd', '');
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showSaveFilePicker: async () => target
		};
		const { session, answers, edit } = setup({ env });
		edit('flowchart TD\n  B\n');
		answers.push('save');
		expect(await session.guard()).toBe('saved');
		expect(session.dirty).toBe(false);
		expect(target.writes).toEqual(['flowchart TD\n  B\n']);
	});
});

describe('createFileSession: Speichern', () => {
	function pickerEnv(target: FileHandleLike) {
		const picker = vi.fn(async () => target);
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showSaveFilePicker: picker
		};
		return { env, picker };
	}

	it('Save-Picker: Name und Handle übernommen, Erfolgsmeldung', async () => {
		const target = fakeHandle('mein.mmd', '');
		const { session, edit, last } = setup({ env: pickerEnv(target).env });
		edit('flowchart TD\n  C\n');
		expect(await session.save()).toBe(true);
		expect(session.file.name).toBe('mein.mmd');
		expect(session.file.handle).toBe(target);
		expect(session.dirty).toBe(false);
		expect(last()).toEqual({
			key: 'app.file.saved',
			params: { name: 'mein.mmd' },
			tone: 'success'
		});
	});

	it('zweiter Aufruf während des Schreibens: dieselbe Promise, ein Schreibvorgang', async () => {
		const target = fakeHandle('mein.mmd', '');
		const { env, picker } = pickerEnv(target);
		const { session } = setup({ env });
		const first = session.save();
		expect(session.save()).toBe(first);
		await first;
		expect(picker).toHaveBeenCalledTimes(1);
	});

	it('extern geändert: Rückfrage, Überschreiben schreibt über das Handle', async () => {
		const handle = fakeHandle('alt.mmd', START);
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showOpenFilePicker: async () => [handle]
		};
		const { session, answers, edit, said } = setup({ env });
		await session.open();
		expect(session.file.name).toBe('alt.mmd');
		handle.touch();
		edit('flowchart TD\n  D\n');
		answers.push('overwrite');
		expect(await session.save()).toBe(true);
		expect(said.some((m) => m?.tone === 'error')).toBe(true);
		expect(handle.writes).toEqual(['flowchart TD\n  D\n']);
		expect(session.dirty).toBe(false);
	});
});

describe('createFileSession: Neu, Öffnen, Drop', () => {
	it('Neu: Vorlagenwahl, dann eigener Controller, UI zurückgesetzt, alter Controller entsorgt', async () => {
		const { session, deps, created, last } = setup();
		const first = session.newDiagram();
		await Promise.resolve();
		expect(session.picking).toBe(true);
		session.closeNew('sequenceDiagram\n');
		await first;
		expect(session.picking).toBe(false);
		expect(session.controller).toBe(created[0]);
		expect(session.file.saved).toBe('sequenceDiagram\n');
		expect(deps.reset).toHaveBeenCalledTimes(1);
		expect(last()).toEqual({ key: 'app.shell.newDiagram', tone: 'success' });
		const second = session.newDiagram();
		await Promise.resolve();
		session.closeNew('flowchart LR\n');
		await second;
		expect(created[0].dispose).toHaveBeenCalledTimes(1);
		session.dispose();
		expect(created[1].dispose).toHaveBeenCalledTimes(1);
	});

	it('Neu abgebrochen: nichts geladen', async () => {
		const { session, created } = setup();
		const pending = session.newDiagram();
		await Promise.resolve();
		session.closeNew(null);
		await pending;
		expect(created).toEqual([]);
		expect(session.controller).toBeNull();
	});

	it('Öffnen: Datei geladen, Handle und Meldung', async () => {
		const handle = fakeHandle('x.mmd', 'flowchart LR\n  Q\n');
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showOpenFilePicker: async () => [handle]
		};
		const { session, created, last } = setup({ env });
		await session.open();
		expect(created).toHaveLength(1);
		expect(session.file).toMatchObject({ name: 'x.mmd', handle, saved: 'flowchart LR\n  Q\n' });
		expect(last()).toEqual({ key: 'app.shell.opened', params: { name: 'x.mmd' }, tone: 'success' });
	});

	it('Drop ohne passende Datei: Fehlermeldung, nichts geladen', async () => {
		const { session, created, last } = setup();
		await session.openDropped({ files: [] as unknown as FileList });
		expect(created).toEqual([]);
		expect(last()).toEqual({ key: 'app.file.unsupported', tone: 'error' });
	});

	it('Laden scheitert: Fehlermeldung, Datei-Zustand unverändert', async () => {
		const { session, last } = setup({
			create: async () => {
				throw new Error('kaputt');
			}
		});
		const pending = session.newDiagram();
		await Promise.resolve();
		session.closeNew('flowchart LR\n');
		await pending;
		expect(session.controller).toBeNull();
		expect(session.file.saved).toBe(START);
		expect(last()?.tone).toBe('error');
	});
});

// T123 C2: Nachzug aus Review C1 (Abbruch- und Fehlerpfade).
describe('createFileSession: Abbruch und Fehler', () => {
	it('Speichern unter abgebrochen: false, Datei-Zustand unverändert, keine Meldung', async () => {
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showSaveFilePicker: async () => {
				throw new DOMException('abgebrochen', 'AbortError');
			}
		};
		const { session, edit, said } = setup({ env });
		edit('flowchart TD\n  E\n');
		const before = session.file;
		expect(await session.save()).toBe(false);
		expect(session.file).toBe(before);
		expect(session.dirty).toBe(true);
		expect(said).toEqual([]);
	});

	it('Write-Fehler über das Handle: false, Fehlermeldung, weiter ungespeichert', async () => {
		const handle = fakeHandle('w.mmd', START);
		const broken = {
			...handle,
			createWritable: async () => ({
				write: async () => {
					throw new Error('Platte voll');
				},
				close: async () => {}
			})
		} satisfies FileHandleLike;
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showOpenFilePicker: async () => [broken]
		};
		const { session, edit, last } = setup({ env });
		await session.open();
		const before = session.file;
		edit('flowchart TD\n  F\n');
		expect(await session.save()).toBe(false);
		expect(session.file).toBe(before);
		expect(session.dirty).toBe(true);
		expect(last()).toMatchObject({ key: 'services.file.saveFailed', tone: 'error' });
	});

	it('Öffnen bei ungespeicherten Änderungen + Abbrechen: kein Picker, nichts geladen', async () => {
		const picker = vi.fn(async () => [fakeHandle('y.mmd', START)]);
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showOpenFilePicker: picker
		};
		const { session, edit, answers, ask, created } = setup({ env });
		edit('flowchart TD\n  G\n');
		answers.push('cancel');
		await session.open();
		expect(ask).toHaveBeenCalledTimes(1);
		expect(picker).not.toHaveBeenCalled();
		expect(created).toEqual([]);
		expect(session.controller).toBeNull();
	});
});
