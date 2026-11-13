// T102 C1 (V-04, V-30): fatal-Dekodierung, BOM erhalten, Größenlimit.
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
	FileServiceError,
	MAX_FILE_BYTES,
	decodeUtf8,
	encodeUtf8,
	openFile,
	readDroppedFile,
	readMarkdown,
	readMmd,
	saveFile,
	writeMmd,
	type FileEnv,
	type FileHandleLike
} from '../../../../src/lib/services/file';
import {
	afterSave,
	newFile,
	planOpen,
	saveOptions,
	saveText
} from '../../../../src/lib/views/shell/file';

const BOM = '﻿';
const BOM_BYTES = [0xef, 0xbb, 0xbf];
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
/** "Größe" in Windows-1252: ö = 0xF6, ß = 0xDF. */
const cp1252 = new Uint8Array([0x47, 0x72, 0xf6, 0xdf, 0x65, 0x0a]);
/** "flowchart TD\n" in UTF-16 LE mit BOM. */
const utf16le = (text: string, bom = true): Uint8Array => {
	const out: number[] = bom ? [0xff, 0xfe] : [];
	for (const ch of text) out.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8);
	return new Uint8Array(out);
};
const utf16be = (text: string): Uint8Array => {
	const out: number[] = [0xfe, 0xff];
	for (const ch of text) out.push(ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 0xff);
	return new Uint8Array(out);
};

function expectNotUtf8(run: () => unknown): void {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(FileServiceError);
		expect((error as FileServiceError).code).toBe('not-utf8');
		expect((error as Error).message).toBe('Datei ist keine UTF-8-Textdatei.');
		return;
	}
	throw new Error('kein Fehler geworfen');
}

describe('fatal-Dekodierung (V-04)', () => {
	it('Windows-1252 wird abgelehnt, nicht mit U+FFFD geladen', () => {
		expectNotUtf8(() => decodeUtf8(cp1252));
		expectNotUtf8(() => readMmd(cp1252));
		expectNotUtf8(() => readMarkdown(cp1252));
	});

	it('UTF-16 LE/BE mit BOM und UTF-16 ohne BOM werden abgelehnt', () => {
		expectNotUtf8(() => readMmd(utf16le('flowchart TD\n')));
		expectNotUtf8(() => readMmd(utf16be('flowchart TD\n')));
		expectNotUtf8(() => readMmd(utf16le('flowchart TD\n', false)));
	});

	it('gültiges UTF-8 mit und ohne BOM wird weiter gelesen', () => {
		expect(readMmd(utf8('Größe\n')).text).toBe('Größe\n');
		expect(readMmd(new Uint8Array([...BOM_BYTES, ...utf8('Größe\n')])).hadBom).toBe(true);
		expect(decodeUtf8(new Uint8Array([...BOM_BYTES, ...utf8('a')]))).toBe('a');
	});

	it('Shell-Plan: keine UTF-8-Datei ergibt Fehler-Plan, kein Laden', () => {
		const opened = (name: string, bytes: Uint8Array, kind: 'mmd' | 'md') => ({
			name,
			kind,
			bytes,
			handle: null
		});
		expect(planOpen(opened('alt.mmd', cp1252, 'mmd'))).toEqual({
			type: 'error',
			message: 'Datei ist keine UTF-8-Textdatei.'
		});
		expect(planOpen(opened('alt.md', utf16le('# T\n'), 'md'))).toEqual({
			type: 'error',
			message: 'Datei ist keine UTF-8-Textdatei.'
		});
	});
});

describe('BOM bleibt beim Zurückschreiben erhalten (V-04)', () => {
	const opened = (name: string, bytes: Uint8Array, kind: 'mmd' | 'md') => ({
		name,
		kind,
		bytes,
		handle: null
	});

	it('encodeUtf8 schreibt BOM nur auf Wunsch, writeMmd nie', () => {
		expect([...encodeUtf8('a', true)]).toEqual([...BOM_BYTES, 0x61]);
		expect([...encodeUtf8(`${BOM}a`, true)]).toEqual([...BOM_BYTES, 0x61]);
		expect([...encodeUtf8(`${BOM}a`)]).toEqual([0x61]);
		expect(writeMmd(`${BOM}a\n`, 'crlf')).toBe('a\r\n');
	});

	it('.mmd mit BOM: saveText ohne BOM, Option bom, Datei-Bytes beginnen mit BOM', async () => {
		const plan = planOpen(
			opened('a.mmd', new Uint8Array([...BOM_BYTES, ...utf8('flowchart TD\r\n')]), 'mmd')
		);
		if (plan.type !== 'load') throw new Error(plan.type);
		expect(plan.file.hadBom).toBe(true);
		const state = { ...plan.file, saved: plan.text };
		const text = saveText(state, 'flowchart LR\n');
		expect(text).toBe('flowchart LR\r\n');
		expect(saveOptions(state).bom).toBe(true);
		const handle = makeHandle('a.mmd');
		await saveFile(text, { ...saveOptions(state), handle, env: baseEnv() });
		expect([...(handle.written[0] as Uint8Array).slice(0, 3)]).toEqual(BOM_BYTES);
	});

	it('.mmd ohne BOM: kein BOM', async () => {
		const plan = planOpen(opened('a.mmd', utf8('flowchart TD\n'), 'mmd'));
		if (plan.type !== 'load') throw new Error(plan.type);
		expect(plan.file.hadBom).toBe(false);
		const state = { ...plan.file, saved: plan.text };
		const text = saveText(state, 'flowchart LR\n');
		expect(text).toBe('flowchart LR\n');
		const handle = makeHandle('a.mmd');
		await saveFile(text, { ...saveOptions(state), handle, env: baseEnv() });
		expect((handle.written[0] as Uint8Array)[0]).toBe(0x66);
		expect(newFile('x').hadBom).toBe(false);
	});

	it('.md mit BOM: Text ohne BOM, Option bom, gemerkter Markdown-Text ohne BOM', () => {
		const md = '# T\n\n```mermaid\nflowchart TD\n```\n';
		const plan = planOpen(opened('d.md', new Uint8Array([...BOM_BYTES, ...utf8(md)]), 'md'));
		if (plan.type !== 'load') throw new Error(plan.type);
		const state = { ...plan.file, saved: plan.text };
		expect(saveText(state, 'flowchart LR')).toBe('# T\n\n```mermaid\nflowchart LR\n```\n');
		expect(saveOptions(state).bom).toBe(true);
		const next = afterSave(state, 'flowchart LR', { method: 'handle', name: 'd.md', handle: null });
		expect(next.markdown?.startsWith(BOM)).toBe(false);
		expect(next.hadBom).toBe(true);
		expect(saveOptions(next).bom).toBe(true);
	});

	it('.md ohne BOM: kein BOM', () => {
		const plan = planOpen(opened('d.md', utf8('```mermaid\nflowchart TD\n```\n'), 'md'));
		if (plan.type !== 'load') throw new Error(plan.type);
		const state = { ...plan.file, saved: plan.text };
		expect(saveText(state, 'x')).toBe('```mermaid\nx\n```\n');
		expect(saveOptions(state).bom).toBe(false);
	});
});

function makeHandle(name: string, file?: File): FileHandleLike & { written: unknown[] } {
	const written: unknown[] = [];
	return {
		name,
		written,
		getFile: async () => file ?? new File([''], name),
		createWritable: async () => ({
			write: async (data: unknown) => {
				written.push(data);
			},
			close: async () => {}
		})
	};
}

function baseEnv(extra: Partial<FileEnv> = {}): FileEnv {
	return {
		document,
		createObjectURL: vi.fn(() => 'blob:attrappe'),
		revokeObjectURL: vi.fn(),
		...extra
	};
}

/** Datei-Attrappe mit beliebiger `size`; `arrayBuffer` darf nicht aufgerufen werden. */
function bigFile(name: string, size: number) {
	const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
	return { file: { name, size, arrayBuffer } as unknown as File, arrayBuffer };
}

describe('Größenlimit vor arrayBuffer (V-30)', () => {
	it('Konstante: 1 MiB (200000 UTF-16-Einheiten x max. 3 Byte = 600000, plus Markdown-Hülle)', () => {
		expect(MAX_FILE_BYTES).toBe(1024 * 1024);
	});

	it('openFile über Picker: zu groß ergibt too-large, kein arrayBuffer', async () => {
		const { file, arrayBuffer } = bigFile('gross.mmd', MAX_FILE_BYTES + 1);
		const handle = makeHandle('gross.mmd', file);
		const promise = openFile(baseEnv({ showOpenFilePicker: async () => [handle] }));
		await expect(promise).rejects.toBeInstanceOf(FileServiceError);
		await promise.catch((e: FileServiceError) => {
			expect(e.code).toBe('too-large');
			expect(e.message).toBe('Datei ist zu groß (Grenze 1 MB).');
		});
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('genau an der Grenze wird gelesen', async () => {
		const { file, arrayBuffer } = bigFile('rand.mmd', MAX_FILE_BYTES);
		const handle = makeHandle('rand.mmd', file);
		const opened = await openFile(baseEnv({ showOpenFilePicker: async () => [handle] }));
		expect(opened?.name).toBe('rand.mmd');
		expect(arrayBuffer).toHaveBeenCalledOnce();
	});

	it('Drop: zu groß ergibt too-large, kein arrayBuffer', async () => {
		const { file, arrayBuffer } = bigFile('gross.md', MAX_FILE_BYTES + 1);
		const promise = readDroppedFile({ files: [file] } as unknown as DataTransfer);
		await expect(promise).rejects.toMatchObject({ code: 'too-large' });
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('übrige Lesefehler behalten Code open-failed', async () => {
		const promise = openFile(
			baseEnv({
				showOpenFilePicker: async () => {
					throw new Error('EACCES');
				}
			})
		);
		await expect(promise).rejects.toMatchObject({ code: 'open-failed' });
	});
});
