// T136 C2 (F-11): Teilen per Link in der Datei-Sitzung: "Link kopieren" und Laden eines
// Teilen-Fragments (Rückfrage, Prüfpfade des Datei-Öffnens, Fehler je Code, Dirty-Schutz).
import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type { SyncController } from '../../../../src/lib/controllers/sync';
import {
	MAX_SHARE_CODE_BYTES,
	MAX_SHARE_FRAGMENT_LENGTH,
	SHARE_FRAGMENT_PREFIX,
	encodeShareFragment
} from '../../../../src/lib/services/file';
import { createFileSession, shareBase } from '../../../../src/lib/views/shell/fileSession.svelte';
import type { StatusMessage } from '../../../../src/lib/views/shell/status';

const START = 'flowchart TD\n  A\n';
const SHARED = 'flowchart LR\n  X --> Y\n';

function setup() {
	let code = START;
	const said: (StatusMessage | null)[] = [];
	const created: string[] = [];
	const answers: (string | null)[] = [];
	const ask = vi.fn(async () => ({ value: answers.shift() ?? null }));
	const session = createFileSession({
		code: () => code,
		initial: START,
		create: async (text) => {
			created.push(text);
			code = text;
			return Object.assign(writable({ code: text }), {
				dispose: vi.fn()
			}) as unknown as SyncController;
		},
		env: () => ({ document: {} as Document, createObjectURL: () => '', revokeObjectURL: () => {} }),
		ask,
		say: (m) => said.push(m),
		reset: vi.fn()
	});
	return { session, ask, answers, said, created, edit: (next: string) => (code = next) };
}

async function fragmentOf(code: string): Promise<string> {
	const result = await encodeShareFragment(code);
	if (!result.ok) throw new Error(result.error);
	return result.fragment;
}

describe('openShared: Rückfrage vor dem Laden', () => {
	it('Laden: Inhalt geladen, neutraler Name, ungespeichert, ohne Handle', async () => {
		const { session, ask, answers, said, created } = setup();
		answers.push('load');
		await session.openShared('#' + (await fragmentOf(SHARED)));
		expect(ask).toHaveBeenCalledTimes(1);
		expect(created).toEqual([SHARED]);
		expect(session.file.name).toBe('geteilt.mmd');
		expect(session.file.handle).toBeNull();
		expect(session.file.stamp).toBeNull();
		expect(session.file.saved).toBe('');
		expect(session.dirty).toBe(true);
		expect(said.at(-1)).toEqual({
			key: 'app.share.loaded',
			params: { name: 'geteilt.mmd' },
			tone: 'success'
		});
	});

	it('Abbrechen und Esc: nichts geladen, keine Meldung', async () => {
		const { session, answers, said, created } = setup();
		const fragment = await fragmentOf(SHARED);
		answers.push('cancel', null);
		await session.openShared(fragment);
		await session.openShared(fragment);
		expect(created).toEqual([]);
		expect(said).toEqual([]);
		expect(session.file.name).toBe('diagramm.mmd');
	});

	it('Rückfrage nennt Laden (primär) und Abbrechen', async () => {
		const { session, ask } = setup();
		await session.openShared(await fragmentOf(SHARED));
		const request = (ask.mock.calls[0] as unknown as [{ actions: { value: string }[] }])[0];
		expect(request.actions.map((a) => a.value)).toEqual(['load', 'cancel']);
	});
});

describe('openShared: Fehler ergeben Meldung, kein Laden', () => {
	const cases: [string, () => Promise<string>, string][] = [
		['defektes base64', async () => SHARE_FRAGMENT_PREFIX + '!!!', 'app.share.openInvalid'],
		['defekter Strom', async () => SHARE_FRAGMENT_PREFIX + 'AAAA', 'app.share.openInvalid'],
		['unbekannte Version', async () => 'code=v9:abc', 'app.share.openVersion'],
		[
			'zu langes Fragment',
			async () => SHARE_FRAGMENT_PREFIX + 'A'.repeat(MAX_SHARE_FRAGMENT_LENGTH),
			'app.share.openTooLong'
		]
	];
	for (const [label, make, key] of cases) {
		it(label, async () => {
			const { session, answers, said, created } = setup();
			answers.push('load');
			await session.openShared(await make());
			expect(created).toEqual([]);
			expect(said.at(-1)?.key).toBe(key);
			expect(said.at(-1)?.tone).toBe('error');
		});
	}

	it('Prüfpfad des Datei-Öffnens: NUL-Zeichen wird wie in einer Datei abgelehnt', async () => {
		const { session, answers, said, created } = setup();
		answers.push('load');
		await session.openShared(await fragmentOf('flowchart TD\n  A\0B\n'));
		expect(created).toEqual([]);
		expect(said.at(-1)).toEqual({ key: 'services.file.notUtf8', tone: 'error' });
	});
});

describe('openShared: Dirty-Schutz', () => {
	it('ungespeichert: Ungespeichert-Rückfrage nach Laden; Abbrechen lädt nicht', async () => {
		const { session, ask, answers, created, edit } = setup();
		edit('flowchart TD\n  B\n');
		answers.push('load', 'cancel');
		await session.openShared(await fragmentOf(SHARED));
		expect(ask).toHaveBeenCalledTimes(2);
		expect(created).toEqual([]);
	});

	it('ungespeichert: Verwerfen lädt den geteilten Inhalt', async () => {
		const { session, answers, created, edit } = setup();
		edit('flowchart TD\n  B\n');
		answers.push('load', 'discard');
		await session.openShared(await fragmentOf(SHARED));
		expect(created).toEqual([SHARED]);
	});

	it('defekter Link: keine Ungespeichert-Rückfrage', async () => {
		const { session, ask, answers, edit } = setup();
		edit('flowchart TD\n  B\n');
		answers.push('load');
		await session.openShared('code=v1:!!!');
		expect(ask).toHaveBeenCalledTimes(1);
	});
});

describe('copyLink', () => {
	it('kopiert Basis + "#" + Fragment des aktuellen Codes und meldet Erfolg', async () => {
		const { session, said, edit } = setup();
		edit(SHARED);
		const copy = vi.fn(async () => {});
		await session.copyLink('https://app.example/mermuid/', copy);
		expect(copy).toHaveBeenCalledWith('https://app.example/mermuid/#' + (await fragmentOf(SHARED)));
		expect(said.at(-1)).toEqual({ key: 'app.share.copied', tone: 'success' });
	});

	it('Zwischenablage verweigert: Meldung', async () => {
		const { session, said } = setup();
		await session.copyLink('https://x/', async () => {
			throw new DOMException('denied', 'NotAllowedError');
		});
		expect(said.at(-1)).toEqual({ key: 'app.share.copyFailed', tone: 'error' });
	});

	it('Code zu groß: Meldung, nichts kopiert', async () => {
		const { session, said, edit } = setup();
		edit('x'.repeat(MAX_SHARE_CODE_BYTES + 1));
		const copy = vi.fn(async () => {});
		await session.copyLink('https://x/', copy);
		expect(copy).not.toHaveBeenCalled();
		expect(said.at(-1)).toMatchObject({ key: 'app.share.copyTooLarge', tone: 'error' });
	});

	it('Fragment zu lang (schlecht komprimierbar): Meldung, nichts kopiert', async () => {
		const { session, said, edit } = setup();
		let noise = '';
		let seed = 1;
		for (let i = 0; i < 20000; i++) {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			noise += String.fromCharCode(33 + (seed % 90));
		}
		edit(noise);
		const copy = vi.fn(async () => {});
		await session.copyLink('https://x/', copy);
		expect(copy).not.toHaveBeenCalled();
		expect(said.at(-1)).toMatchObject({ key: 'app.share.copyTooLong', tone: 'error' });
	});

	it('Laufzeit ohne CompressionStream: Meldung', async () => {
		const { session, said } = setup();
		vi.stubGlobal('CompressionStream', undefined);
		try {
			await session.copyLink('https://x/', async () => {});
		} finally {
			vi.unstubAllGlobals();
		}
		expect(said.at(-1)).toEqual({ key: 'app.share.copyUnavailable', tone: 'error' });
	});
});

describe('shareBase', () => {
	it('ohne Query und Fragment; auch für file://', () => {
		expect(shareBase('https://a.example/app/index.html?x=1#code=v1:abc')).toBe(
			'https://a.example/app/index.html'
		);
		expect(shareBase('file:///C:/mermuid/index.html#x')).toBe('file:///C:/mermuid/index.html');
	});
});
