// T102 C2 (V-11 Service-Teil): Standvergleich vor dem Schreiben, getrennte Fehlercodes, abort.
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
	FileServiceError,
	openFile,
	saveFile,
	type FileEnv,
	type FileHandleLike,
	type FileStamp
} from '../../../../src/lib/services/file';
import { setLocale } from '../../../../src/lib/services/i18n';
import { afterSave, newFile, planOpen, saveOptions } from '../../../../src/lib/views/shell/file';

const BOM_BYTES = [0xef, 0xbb, 0xbf];
const domError = (name: string) => new DOMException('System: /home/x/a.mmd', name);

interface FakeWritable {
	write: Mock<(data: Uint8Array) => Promise<void>>;
	close: Mock<() => Promise<void>>;
	abort: Mock<() => Promise<void>>;
}

/** Handle, dessen Datei sich "auf der Platte" ändern lässt; Schreiben aktualisiert den Stand. */
function diskHandle(name: string, content = 'flowchart TD\n', lastModified = 1000) {
	const disk = { content, lastModified };
	const writables: FakeWritable[] = [];
	const handle: FileHandleLike = {
		name,
		getFile: vi.fn(async () => new File([disk.content], name, { lastModified: disk.lastModified })),
		createWritable: vi.fn(async () => {
			const writable: FakeWritable = {
				write: vi.fn(async (data: Uint8Array) => {
					disk.content = new TextDecoder().decode(data);
				}),
				close: vi.fn(async () => {
					disk.lastModified += 1;
				}),
				abort: vi.fn(async () => {})
			};
			writables.push(writable);
			return writable;
		})
	};
	return { handle, disk, writables };
}

const stampOf = (content: string, lastModified: number): FileStamp => ({
	lastModified,
	size: new TextEncoder().encode(content).length
});

function baseEnv(extra: Partial<FileEnv> = {}): FileEnv {
	return {
		document,
		createObjectURL: vi.fn(() => 'blob:attrappe'),
		revokeObjectURL: vi.fn(),
		...extra
	};
}

async function rejection(promise: Promise<unknown>): Promise<FileServiceError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(FileServiceError);
		return error as FileServiceError;
	}
	throw new Error('kein Fehler geworfen');
}

afterEach(() => {
	setLocale('de');
	vi.restoreAllMocks();
});

describe('Öffnungsstand (lastModified, Größe)', () => {
	it('openFile über Picker liefert den Stand der gelesenen Datei', async () => {
		const { handle } = diskHandle('a.mmd', 'flowchart TD\n', 4711);
		const opened = await openFile(baseEnv({ showOpenFilePicker: async () => [handle] }));
		expect(opened?.stamp).toEqual(stampOf('flowchart TD\n', 4711));
	});

	it('Shell: planOpen übernimmt den Stand, saveOptions reicht ihn und das BOM weiter', async () => {
		const { handle } = diskHandle('a.mmd', '﻿flowchart TD\n', 5);
		const opened = await openFile(baseEnv({ showOpenFilePicker: async () => [handle] }));
		if (!opened) throw new Error('nichts geöffnet');
		const plan = planOpen(opened);
		if (plan.type !== 'load') throw new Error(plan.type);
		const state = { ...plan.file, saved: plan.text };
		expect(state.stamp).toEqual(opened.stamp);
		expect(saveOptions(state)).toEqual({
			handle,
			suggestedName: 'a.mmd',
			bom: true,
			expected: opened.stamp
		});
		expect(saveOptions(newFile('x'))).toEqual({
			handle: null,
			suggestedName: 'diagramm.mmd',
			bom: false,
			expected: null
		});
	});

	it('Shell: afterSave übernimmt den neuen Stand aus dem Speicherergebnis', () => {
		const stamp = { lastModified: 9, size: 3 };
		const next = afterSave(newFile('x'), 'y', {
			method: 'picker',
			name: 'b.mmd',
			handle: null,
			stamp
		});
		expect(next.stamp).toEqual(stamp);
	});
});

describe('Speichern mit Handle: Standvergleich vor dem Schreiben (changed-on-disk)', () => {
	it('unveränderter Stand: schreibt und liefert den neuen Stand', async () => {
		const { handle, disk } = diskHandle('a.mmd', 'flowchart TD\n', 1000);
		const result = await saveFile('flowchart LR\n', {
			handle,
			expected: stampOf('flowchart TD\n', 1000),
			env: baseEnv()
		});
		expect(disk.content).toBe('flowchart LR\n');
		expect(result?.stamp).toEqual(stampOf('flowchart LR\n', 1001));
	});

	it('extern geändertes lastModified: Code changed-on-disk, kein Schreiben', async () => {
		const { handle, disk } = diskHandle('a.mmd', 'flowchart TD\n', 1000);
		disk.lastModified = 2000;
		const error = await rejection(
			saveFile('flowchart LR\n', {
				handle,
				expected: stampOf('flowchart TD\n', 1000),
				env: baseEnv()
			})
		);
		expect(error.code).toBe('changed-on-disk');
		expect(error.message).toBe(
			'Datei wurde außerhalb der App geändert. Nicht gespeichert, um die Änderung nicht zu überschreiben.'
		);
		expect(handle.createWritable).not.toHaveBeenCalled();
		expect(disk.content).toBe('flowchart TD\n');
	});

	it('extern geänderte Größe bei gleichem lastModified: changed-on-disk', async () => {
		const { handle, disk } = diskHandle('a.mmd', 'flowchart TD\n', 1000);
		disk.content = 'flowchart TD\n  A\n';
		const error = await rejection(
			saveFile('x', { handle, expected: stampOf('flowchart TD\n', 1000), env: baseEnv() })
		);
		expect(error.code).toBe('changed-on-disk');
		expect(handle.createWritable).not.toHaveBeenCalled();
	});

	it('ohne erwarteten Stand (z. B. frisch über Picker gewählt): kein Vergleich', async () => {
		const { handle, disk } = diskHandle('a.mmd', 'alt', 1000);
		await saveFile('neu', { handle, env: baseEnv() });
		expect(disk.content).toBe('neu');
	});

	it('Save-Picker liefert den Stand der geschriebenen Datei', async () => {
		const { handle } = diskHandle('neu.mmd', '', 50);
		const result = await saveFile('abc', {
			env: baseEnv({ showSaveFilePicker: async () => handle })
		});
		expect(result?.stamp).toEqual(stampOf('abc', 51));
	});

	it('Stand nach erfolgreichem Schreiben nicht lesbar: Erfolg ohne stamp, afterSave setzt null', async () => {
		const { handle, disk } = diskHandle('a.mmd', 'flowchart TD\n', 1000);
		vi.mocked(handle.getFile)
			.mockImplementationOnce(
				async () => new File([disk.content], 'a.mmd', { lastModified: disk.lastModified })
			)
			.mockRejectedValueOnce(domError('NotFoundError'));
		const result = await saveFile('flowchart LR\n', {
			handle,
			expected: stampOf('flowchart TD\n', 1000),
			env: baseEnv()
		});
		expect(disk.content).toBe('flowchart LR\n');
		expect(result?.method).toBe('handle');
		expect(result?.stamp).toBeUndefined();
		if (!result) throw new Error('kein Ergebnis');
		const next = afterSave(newFile('x'), 'flowchart LR\n', result);
		expect(next.stamp).toBeNull();
		expect(saveOptions(next).expected).toBeNull();
	});

	it('Kette open -> save -> afterSave -> zweites save auf demselben Handle: kein changed-on-disk', async () => {
		const { handle, disk } = diskHandle('a.mmd', 'flowchart TD\n', 1000);
		const env = baseEnv({ showOpenFilePicker: async () => [handle] });
		const opened = await openFile(env);
		if (!opened) throw new Error('nichts geöffnet');
		const plan = planOpen(opened);
		if (plan.type !== 'load') throw new Error(plan.type);
		const state = { ...plan.file, saved: plan.text };
		const first = await saveFile('flowchart LR\n', { ...saveOptions(state), env });
		if (!first) throw new Error('kein Ergebnis');
		const next = afterSave(state, 'flowchart LR\n', first);
		const second = await saveFile('flowchart RL\n', { ...saveOptions(next), env });
		expect(second?.method).toBe('handle');
		expect(disk.content).toBe('flowchart RL\n');
		expect(second?.stamp).toEqual(stampOf('flowchart RL\n', 1002));
	});
});

describe('getrennte Fehlercodes (DOMException)', () => {
	it.each([
		['NotAllowedError', 'permission-denied', 'Keine Berechtigung für die Datei.'],
		['NotFoundError', 'not-found', 'Datei nicht gefunden (verschoben oder gelöscht).'],
		['QuotaExceededError', 'quota', 'Nicht genug Speicherplatz zum Speichern.']
	])('%s beim Öffnen des Schreibzugriffs: Code %s', async (name, code, message) => {
		const { handle } = diskHandle('a.mmd');
		vi.mocked(handle.createWritable!).mockRejectedValueOnce(domError(name));
		const error = await rejection(saveFile('x', { handle, env: baseEnv() }));
		expect(error.code).toBe(code);
		expect(error.message).toBe(message);
		expect(error.message).not.toContain('/home');
	});

	it('NotFoundError beim Standvergleich (Datei gelöscht): not-found', async () => {
		const { handle } = diskHandle('a.mmd');
		vi.mocked(handle.getFile).mockRejectedValueOnce(domError('NotFoundError'));
		const error = await rejection(
			saveFile('x', { handle, expected: { lastModified: 1000, size: 13 }, env: baseEnv() })
		);
		expect(error.code).toBe('not-found');
		expect(handle.createWritable).not.toHaveBeenCalled();
	});

	it('Meldungen auf Englisch', async () => {
		setLocale('en');
		const cases: [string, string][] = [
			['NotAllowedError', 'No permission for the file.'],
			['NotFoundError', 'File not found (moved or deleted).'],
			['QuotaExceededError', 'Not enough storage space to save.']
		];
		for (const [name, message] of cases) {
			const { handle } = diskHandle('a.mmd');
			vi.mocked(handle.createWritable!).mockRejectedValueOnce(domError(name));
			expect((await rejection(saveFile('x', { handle, env: baseEnv() }))).message).toBe(message);
		}
		const { handle, disk } = diskHandle('a.mmd', 'a', 1);
		disk.lastModified = 2;
		const changed = await rejection(
			saveFile('x', { handle, expected: stampOf('a', 1), env: baseEnv() })
		);
		expect(changed.message).toBe(
			'File was changed outside the app. Not saved, to avoid overwriting the change.'
		);
	});

	it('übrige Fehler bleiben save-failed', async () => {
		const { handle } = diskHandle('a.mmd');
		vi.mocked(handle.createWritable!).mockRejectedValueOnce(new Error('EIO'));
		expect((await rejection(saveFile('x', { handle, env: baseEnv() }))).code).toBe('save-failed');
	});
});

describe('Schreibfehler: writable.abort() statt halbgeschriebener Datei', () => {
	it('write schlägt fehl: abort, kein close, Fehlercode erhalten', async () => {
		const { handle, writables } = diskHandle('a.mmd');
		const original = vi.mocked(handle.createWritable!).getMockImplementation()!;
		vi.mocked(handle.createWritable!).mockImplementationOnce(async () => {
			const writable = (await original()) as unknown as FakeWritable;
			writable.write.mockRejectedValueOnce(domError('QuotaExceededError'));
			return writable as never;
		});
		const error = await rejection(saveFile('x', { handle, env: baseEnv() }));
		expect(error.code).toBe('quota');
		expect(writables[0].abort).toHaveBeenCalledOnce();
		expect(writables[0].close).not.toHaveBeenCalled();
	});

	it('close schlägt fehl: abort; Fehler von abort überdeckt den Ursprung nicht', async () => {
		const { handle, writables } = diskHandle('a.mmd');
		const original = vi.mocked(handle.createWritable!).getMockImplementation()!;
		vi.mocked(handle.createWritable!).mockImplementationOnce(async () => {
			const writable = (await original()) as unknown as FakeWritable;
			writable.close.mockRejectedValueOnce(new Error('EIO'));
			writable.abort.mockRejectedValueOnce(new Error('bereits geschlossen'));
			return writable as never;
		});
		const error = await rejection(saveFile('x', { handle, env: baseEnv() }));
		expect(error.code).toBe('save-failed');
		expect(writables[0].abort).toHaveBeenCalledOnce();
	});

	it('Writable ohne abort: ursprünglicher Fehlercode, kein TypeError', async () => {
		const { handle } = diskHandle('a.mmd');
		vi.mocked(handle.createWritable!).mockImplementationOnce(async () => ({
			write: async () => {
				throw domError('QuotaExceededError');
			},
			close: async () => {}
		}));
		const error = await rejection(saveFile('x', { handle, env: baseEnv() }));
		expect(error.code).toBe('quota');
	});
});

describe('BOM als Option (Naht T105: saveFile(..., { bom }))', () => {
	it('bom: true schreibt BOM, ohne Option keins; U+FEFF im Text wird nie als BOM gedeutet', async () => {
		const { handle, disk } = diskHandle('a.mmd');
		const bytes = vi.fn();
		vi.mocked(handle.createWritable!).mockImplementation(async () => ({
			write: async (data: Uint8Array | Blob | string) => {
				bytes([...(data as Uint8Array)]);
				disk.content = '';
			},
			close: async () => {},
			abort: async () => {}
		}));
		await saveFile('a', { handle, bom: true, env: baseEnv() });
		await saveFile('﻿a', { handle, env: baseEnv() });
		expect(bytes.mock.calls[0][0]).toEqual([...BOM_BYTES, 0x61]);
		expect(bytes.mock.calls[1][0]).toEqual([0x61]);
	});
});
