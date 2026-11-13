// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	FileServiceError,
	browserEnv,
	fileKind,
	hasFileSystemAccess,
	openFile,
	readDroppedFile,
	saveFile,
	type FileEnv,
	type FileHandleLike
} from '../../../../src/lib/services/file';
import { setLocale } from '../../../../src/lib/services/i18n';

const abort = (): DOMException => new DOMException('Der Nutzer hat abgebrochen.', 'AbortError');
const decode = (data: unknown): string => new TextDecoder().decode(data as Uint8Array);

function makeHandle(name: string, content = ''): FileHandleLike & { written: unknown[] } {
	const written: unknown[] = [];
	return {
		name,
		written,
		getFile: async () => new File([content], name),
		createWritable: async () => ({
			write: async (data: unknown) => {
				written.push(data);
			},
			close: async () => {}
		})
	};
}

function baseEnv(extra: Partial<FileEnv> = {}): FileEnv & {
	createObjectURL: ReturnType<typeof vi.fn>;
	revokeObjectURL: ReturnType<typeof vi.fn>;
} {
	return {
		document,
		createObjectURL: vi.fn(() => 'blob:attrappe'),
		revokeObjectURL: vi.fn(),
		...extra
	} as FileEnv & {
		createObjectURL: ReturnType<typeof vi.fn>;
		revokeObjectURL: ReturnType<typeof vi.fn>;
	};
}

/** Fängt das vom Fallback erzeugte `<input type=file>` ab. */
function captureInput(): { input: () => HTMLInputElement } {
	let captured: HTMLInputElement | null = null;
	const original = document.createElement.bind(document);
	vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
		const el = original(tag);
		if (tag === 'input') {
			captured = el as HTMLInputElement;
			vi.spyOn(captured, 'click').mockImplementation(() => {});
		}
		return el;
	}) as typeof document.createElement);
	return {
		input: () => {
			if (!captured) throw new Error('kein input erzeugt');
			return captured;
		}
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('fileKind', () => {
	it('erkennt .mmd und .md ohne Pfad', () => {
		expect(fileKind('a.mmd')).toBe('mmd');
		expect(fileKind('README.MD')).toBe('md');
		expect(fileKind('bild.png')).toBeNull();
		expect(fileKind('ohne')).toBeNull();
	});
});

describe('Feature-Erkennung', () => {
	it('hasFileSystemAccess je nach Attrappe', () => {
		expect(hasFileSystemAccess(baseEnv())).toBe(false);
		expect(
			hasFileSystemAccess(
				baseEnv({
					showOpenFilePicker: async () => [],
					showSaveFilePicker: async () => makeHandle('x')
				})
			)
		).toBe(true);
	});

	it('browserEnv liest globale Picker, sonst Fallback', () => {
		const env = browserEnv();
		expect(env.document).toBe(document);
		expect(env.showOpenFilePicker).toBeUndefined();
		const g = globalThis as unknown as Record<string, unknown>;
		g.showOpenFilePicker = async () => [];
		g.showSaveFilePicker = async () => makeHandle('x');
		try {
			expect(hasFileSystemAccess(browserEnv())).toBe(true);
		} finally {
			delete g.showOpenFilePicker;
			delete g.showSaveFilePicker;
		}
	});
});

describe('openFile mit File System Access API', () => {
	it('liest Bytes, liefert Name ohne Pfad und Handle zum Wiederspeichern', async () => {
		const handle = makeHandle('diagramm.mmd', 'flowchart TD\n');
		const picker = vi.fn(async () => [handle]);
		const opened = await openFile(baseEnv({ showOpenFilePicker: picker }));
		expect(picker).toHaveBeenCalledOnce();
		expect(opened?.name).toBe('diagramm.mmd');
		expect(opened?.kind).toBe('mmd');
		expect(decode(opened?.bytes)).toBe('flowchart TD\n');
		expect(opened?.handle).toBe(handle);
	});

	it('Abbruch durch Nutzer ergibt null ohne Fehler', async () => {
		const opened = await openFile(
			baseEnv({
				showOpenFilePicker: async () => {
					throw abort();
				}
			})
		);
		expect(opened).toBeNull();
	});

	it('leere Auswahl ergibt null', async () => {
		expect(await openFile(baseEnv({ showOpenFilePicker: async () => [] }))).toBeNull();
	});

	it('anderer Fehler wird zu Meldung ohne Pfad', async () => {
		const promise = openFile(
			baseEnv({
				showOpenFilePicker: async () => {
					throw new Error('EACCES /home/nutzer/geheim.mmd');
				}
			})
		);
		await expect(promise).rejects.toBeInstanceOf(FileServiceError);
		await expect(promise).rejects.toThrow('Datei konnte nicht geöffnet werden.');
		await promise.catch((e: Error) => expect(e.message).not.toMatch(/\//));
	});
});

describe('openFile Fallback ohne API (Upload)', () => {
	it('nutzt input[type=file] und liest die gewählte Datei', async () => {
		const cap = captureInput();
		const promise = openFile(baseEnv());
		const input = cap.input();
		expect(input.type).toBe('file');
		expect(input.accept).toBe('.mmd,.md');
		expect(input.click).toHaveBeenCalledOnce();
		const file = new File(['# Titel\n'], 'notiz.md');
		Object.defineProperty(input, 'files', { value: [file] });
		input.dispatchEvent(new Event('change'));
		const opened = await promise;
		expect(opened?.name).toBe('notiz.md');
		expect(opened?.kind).toBe('md');
		expect(opened?.handle).toBeNull();
		expect(decode(opened?.bytes)).toBe('# Titel\n');
	});

	it('Abbruch (cancel) ergibt null', async () => {
		const cap = captureInput();
		const promise = openFile(baseEnv());
		cap.input().dispatchEvent(new Event('cancel'));
		expect(await promise).toBeNull();
	});

	it('change ohne Datei ergibt null', async () => {
		const cap = captureInput();
		const promise = openFile(baseEnv());
		cap.input().dispatchEvent(new Event('change'));
		expect(await promise).toBeNull();
	});

	it('Lesefehler wird zu Meldung ohne Pfad', async () => {
		const cap = captureInput();
		const promise = openFile(baseEnv());
		const broken = {
			name: 'x.mmd',
			arrayBuffer: async () => {
				throw new Error('C:\\Users\\x\\x.mmd');
			}
		};
		Object.defineProperty(cap.input(), 'files', { value: [broken] });
		cap.input().dispatchEvent(new Event('change'));
		await expect(promise).rejects.toThrow('Datei konnte nicht geöffnet werden.');
	});
});

describe('saveFile', () => {
	it('mit vorhandenem Handle: schreibt direkt, UTF-8 ohne BOM', async () => {
		const handle = makeHandle('a.mmd');
		const picker = vi.fn();
		const result = await saveFile('\uFEFFGröße\r\n', {
			handle,
			env: baseEnv({ showSaveFilePicker: picker })
		});
		expect(picker).not.toHaveBeenCalled();
		expect(result).toEqual({ method: 'handle', name: 'a.mmd', handle, stamp: expect.any(Object) });
		expect(handle.written).toHaveLength(1);
		const data = handle.written[0] as Uint8Array;
		expect(data[0]).not.toBe(0xef);
		expect(decode(data)).toBe('Größe\r\n');
	});

	it('mit API ohne Handle: Save-Picker mit Vorschlagsname, liefert Handle', async () => {
		const handle = makeHandle('neu.md');
		const picker = vi.fn(async () => handle);
		const result = await saveFile('x', {
			suggestedName: 'neu.md',
			env: baseEnv({ showSaveFilePicker: picker })
		});
		expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'neu.md' }));
		expect(result).toEqual({ method: 'picker', name: 'neu.md', handle, stamp: expect.any(Object) });
		expect(decode(handle.written[0])).toBe('x');
	});

	it('Abbruch im Save-Picker ergibt null ohne Fehler', async () => {
		const result = await saveFile('x', {
			env: baseEnv({
				showSaveFilePicker: async () => {
					throw abort();
				}
			})
		});
		expect(result).toBeNull();
	});

	it('Schreibfehler wird zu Meldung ohne Pfad', async () => {
		const handle: FileHandleLike = {
			name: 'a.mmd',
			getFile: async () => new File([''], 'a.mmd'),
			createWritable: async () => {
				throw new Error('/tmp/a.mmd gesperrt');
			}
		};
		await expect(saveFile('x', { handle, env: baseEnv() })).rejects.toThrow(
			'Datei konnte nicht gespeichert werden.'
		);
	});

	it('Handle ohne createWritable ist ein Fehler', async () => {
		const handle: FileHandleLike = { name: 'a.mmd', getFile: async () => new File([''], 'a.mmd') };
		await expect(saveFile('x', { handle, env: baseEnv() })).rejects.toBeInstanceOf(
			FileServiceError
		);
	});

	it('ohne API: Download-Fallback über Blob und Anker', async () => {
		vi.useFakeTimers();
		try {
			const env = baseEnv();
			const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
			const result = await saveFile('\uFEFFÜbersicht', { suggestedName: 'notiz.md', env });
			expect(result).toEqual({ method: 'download', name: 'notiz.md', handle: null });
			expect(env.createObjectURL).toHaveBeenCalledOnce();
			const blob = env.createObjectURL.mock.calls[0][0] as Blob;
			expect(blob.type).toBe('text/markdown;charset=utf-8');
			const buf = new Uint8Array(await blob.arrayBuffer());
			expect(buf[0]).not.toBe(0xef);
			expect(new TextDecoder().decode(buf)).toBe('Übersicht');
			expect(click).toHaveBeenCalledOnce();
			const a = click.mock.contexts[0] as HTMLAnchorElement;
			expect(a.download).toBe('notiz.md');
			expect(a.getAttribute('href')).toBe('blob:attrappe');
			expect(a.isConnected).toBe(false);
			expect(env.revokeObjectURL).not.toHaveBeenCalled();
			vi.runAllTimers();
			expect(env.revokeObjectURL).toHaveBeenCalledWith('blob:attrappe');
		} finally {
			vi.useRealTimers();
		}
	});

	it('Download-Fallback: Standardname, text/plain für .mmd, Name ohne Pfad', async () => {
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		const env = baseEnv();
		const first = await saveFile('x', { env });
		expect(first?.name).toBe('diagramm.mmd');
		expect((env.createObjectURL.mock.calls[0][0] as Blob).type).toBe('text/plain;charset=utf-8');
		const second = await saveFile('x', { suggestedName: 'C:\\daten\\a.mmd', env });
		expect(second?.name).toBe('a.mmd');
	});

	it('Standardname je Sprache (T127 C2, O-137): EN diagram.mmd', async () => {
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		setLocale('en');
		try {
			expect((await saveFile('x', { env: baseEnv() }))?.name).toBe('diagram.mmd');
		} finally {
			setLocale('de');
		}
		expect((await saveFile('x', { env: baseEnv() }))?.name).toBe('diagramm.mmd');
	});
});

describe('readDroppedFile', () => {
	it('liest die erste .mmd/.md-Datei aus DataTransfer', async () => {
		const files = [new File(['png'], 'bild.png'), new File(['flowchart TD\n'], 'd.mmd')];
		const dropped = await readDroppedFile({ files } as unknown as DataTransfer);
		expect(dropped?.name).toBe('d.mmd');
		expect(dropped?.kind).toBe('mmd');
		expect(dropped?.handle).toBeNull();
		expect(decode(dropped?.bytes)).toBe('flowchart TD\n');
	});

	it('ohne passende Datei oder ohne DataTransfer: null', async () => {
		expect(await readDroppedFile(null)).toBeNull();
		expect(await readDroppedFile({ files: null } as unknown as DataTransfer)).toBeNull();
		expect(
			await readDroppedFile({ files: [new File([''], 'x.txt')] } as unknown as DataTransfer)
		).toBeNull();
	});
});
