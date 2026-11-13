import { describe, expect, it } from 'vitest';
import {
	MAX_SHARE_CODE_BYTES,
	MAX_SHARE_FRAGMENT_LENGTH,
	SHARE_FRAGMENT_PREFIX,
	decodeShareFragment,
	encodeShareFragment,
	isShareFragment
} from '../../../../src/lib/services/file/share';

/** base64url ohne Padding (Testhelfer, unabhängig von der Implementierung). */
function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Ein unkomprimierter Deflate-Block (Typ "stored", final): 5 Byte Kopf plus Nutzdaten. */
function storedBlock(data: Uint8Array): Uint8Array {
	const len = data.length;
	const out = new Uint8Array(5 + len);
	out.set([0x01, len & 0xff, len >> 8, ~len & 0xff, (~len >> 8) & 0xff]);
	out.set(data, 5);
	return out;
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
	const stream = new ReadableStream<BufferSource>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		}
	}).pipeThrough(new CompressionStream('deflate-raw'));
	const chunks: number[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(...value);
	}
	return new Uint8Array(chunks);
}

const fragmentOf = (payload: Uint8Array): string => SHARE_FRAGMENT_PREFIX + base64url(payload);

async function roundtrip(text: string): Promise<string> {
	const enc = await encodeShareFragment(text);
	if (!enc.ok) throw new Error(`encode: ${enc.error}`);
	const dec = await decodeShareFragment(enc.fragment);
	if (!dec.ok) throw new Error(`decode: ${dec.error}`);
	return dec.text;
}

describe('Umgebung', () => {
	it('stellt CompressionStream/DecompressionStream mit deflate-raw bereit', () => {
		expect(typeof CompressionStream).toBe('function');
		expect(typeof DecompressionStream).toBe('function');
		expect(() => new CompressionStream('deflate-raw')).not.toThrow();
	});
});

describe('encodeShareFragment / decodeShareFragment', () => {
	it('liefert Fragment mit Präfix und base64url-Zeichen', async () => {
		const enc = await encodeShareFragment('flowchart TD\n  A --> B\n');
		expect(enc.ok).toBe(true);
		if (!enc.ok) return;
		expect(enc.fragment.startsWith(SHARE_FRAGMENT_PREFIX)).toBe(true);
		expect(enc.fragment.slice(SHARE_FRAGMENT_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('Roundtrip exakt: LF, CRLF, gemischt, einzelnes CR, BOM', async () => {
		for (const text of [
			'flowchart TD\n  A --> B\n',
			'flowchart TD\r\n  A --> B\r\n',
			'a\r\nb\nc\rd',
			'\uFEFFsequenceDiagram\n  A->>B: hi'
		]) {
			expect(await roundtrip(text)).toBe(text);
		}
	});

	it('Roundtrip exakt: Unicode (Umlaute, CJK, Emoji, Surrogatpaare)', async () => {
		const text = 'flowchart LR\n  A["Größe ÄÖÜ ß"] --> B["漢字"] --> C["\u{1F600} \u{1D11E}"]\n';
		expect(await roundtrip(text)).toBe(text);
	});

	it('Roundtrip exakt: leerer Code', async () => {
		expect(await roundtrip('')).toBe('');
	});

	it('akzeptiert führendes # beim Dekodieren', async () => {
		const enc = await encodeShareFragment('graph TD\nA-->B');
		if (!enc.ok) throw new Error(enc.error);
		const dec = await decodeShareFragment('#' + enc.fragment);
		expect(dec).toEqual({ ok: true, text: 'graph TD\nA-->B' });
	});
});

describe('decodeShareFragment Fehlercodes (kein Throw)', () => {
	it('fehlendes oder fremdes Präfix -> invalid-prefix', async () => {
		for (const f of ['', '#', 'foo=bar', 'code', 'code=', 'code=v1', 'Code=v1:abc', 'x#code=v1:']) {
			expect(await decodeShareFragment(f)).toEqual({ ok: false, error: 'invalid-prefix' });
		}
	});

	it('unbekannte Version -> unsupported-version', async () => {
		for (const f of ['code=v2:abc', '#code=v10:', 'code=x:abc']) {
			expect(await decodeShareFragment(f)).toEqual({ ok: false, error: 'unsupported-version' });
		}
	});

	it('defektes base64 -> invalid-base64', async () => {
		for (const payload of ['ab+c', 'ab/c', 'abc=', 'a', 'abcde', 'ab c', 'äöü']) {
			expect(await decodeShareFragment(SHARE_FRAGMENT_PREFIX + payload)).toEqual({
				ok: false,
				error: 'invalid-base64'
			});
		}
	});

	it('nicht kanonisches base64 (gesetzte Restbits) -> invalid-base64', async () => {
		const valid = await encodeShareFragment('flowchart TD\n  A --> B\n');
		if (!valid.ok) throw new Error(valid.error);
		const payload = valid.fragment.slice(SHARE_FRAGMENT_PREFIX.length);
		// Nur Längen mod 4 == 2 oder 3 haben Restbits; dann das niedrigste Bit des letzten Zeichens kippen.
		expect(payload.length % 4).not.toBe(0);
		const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
		const last = alphabet.indexOf(payload[payload.length - 1]);
		const flipped = payload.slice(0, -1) + alphabet[last ^ 1];
		expect(await decodeShareFragment(SHARE_FRAGMENT_PREFIX + flipped)).toEqual({
			ok: false,
			error: 'invalid-base64'
		});
		// Minimalfall: `AA` und `AB` ergäben beide das Byte 0x00.
		expect(await decodeShareFragment(SHARE_FRAGMENT_PREFIX + 'AB')).toEqual({
			ok: false,
			error: 'invalid-base64'
		});
	});

	it('Laufzeit-Eigenheit Node: Bytes nach dem letzten Deflate-Block werden ignoriert', async () => {
		// Node verwirft Daten hinter dem finalen Block, Browser melden vermutlich `invalid-data`
		// (siehe Kopfkommentar share.ts). Dieser Test schreibt nur das Node-Verhalten fest.
		const text = 'flowchart TD\n  A --> B\n';
		const valid = await deflateRaw(new TextEncoder().encode(text));
		const withTrailer = new Uint8Array([...valid, 0x00, 0x01, 0x02]);
		expect(await decodeShareFragment(fragmentOf(withTrailer))).toEqual({ ok: true, text });
	});

	it('defekter Deflate-Strom -> invalid-data', async () => {
		const valid = await deflateRaw(new TextEncoder().encode('flowchart TD\n  A --> B\n'.repeat(5)));
		for (const payload of [
			new Uint8Array([0xff, 0xff, 0xff]),
			valid.slice(0, valid.length - 2),
			new Uint8Array(0)
		]) {
			expect(await decodeShareFragment(fragmentOf(payload))).toEqual({
				ok: false,
				error: 'invalid-data'
			});
		}
	});

	it('kein UTF-8 im entpackten Inhalt -> not-utf8', async () => {
		const payload = storedBlock(new Uint8Array([0x61, 0xff, 0xfe, 0x62]));
		expect(await decodeShareFragment(fragmentOf(payload))).toEqual({
			ok: false,
			error: 'not-utf8'
		});
	});
});

describe('Längengrenze Fragment', () => {
	// Stored-Block: m = 5 + n Byte; base64url ohne Padding = ceil(4m/3) Zeichen.
	// 8192 = Präfix (8) + 8184 -> m = 6138 -> n = 6133.
	const nAtLimit = ((MAX_SHARE_FRAGMENT_LENGTH - SHARE_FRAGMENT_PREFIX.length) * 3) / 4 - 5;

	it('Fragment genau an der Grenze wird dekodiert', async () => {
		expect(Number.isInteger(nAtLimit)).toBe(true);
		const text = 'a'.repeat(nAtLimit);
		const fragment = fragmentOf(storedBlock(new TextEncoder().encode(text)));
		expect(fragment.length).toBe(MAX_SHARE_FRAGMENT_LENGTH);
		expect(await decodeShareFragment(fragment)).toEqual({ ok: true, text });
		// führendes # zählt nicht zur Grenze
		expect(await decodeShareFragment('#' + fragment)).toEqual({ ok: true, text });
	});

	it('Fragment über der Grenze -> too-long', async () => {
		const fragment = fragmentOf(storedBlock(new TextEncoder().encode('a'.repeat(nAtLimit + 1))));
		expect(fragment.length).toBeGreaterThan(MAX_SHARE_FRAGMENT_LENGTH);
		expect(await decodeShareFragment(fragment)).toEqual({ ok: false, error: 'too-long' });
	});

	it('Kodieren eines schlecht komprimierbaren Codes über der Grenze -> too-long', async () => {
		let seed = 1;
		let text = '';
		while (text.length < MAX_SHARE_FRAGMENT_LENGTH * 2) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			text += String.fromCharCode(0x21 + (seed % 94));
		}
		expect(await encodeShareFragment(text)).toEqual({ ok: false, error: 'too-long' });
	});
});

describe('Größengrenze entpackter Inhalt (Zip-Bombe)', () => {
	it('genau an der Grenze wird dekodiert', async () => {
		const text = 'a'.repeat(MAX_SHARE_CODE_BYTES);
		const fragment = fragmentOf(await deflateRaw(new TextEncoder().encode(text)));
		expect(fragment.length).toBeLessThanOrEqual(MAX_SHARE_FRAGMENT_LENGTH);
		expect(await decodeShareFragment(fragment)).toEqual({ ok: true, text });
	});

	it('über der Grenze -> too-large', async () => {
		const bomb = await deflateRaw(new Uint8Array(MAX_SHARE_CODE_BYTES * 8).fill(0x61));
		const fragment = fragmentOf(bomb);
		expect(fragment.length).toBeLessThanOrEqual(MAX_SHARE_FRAGMENT_LENGTH);
		expect(await decodeShareFragment(fragment)).toEqual({ ok: false, error: 'too-large' });
	});

	it('Kodieren über der Grenze -> too-large; an der Grenze ok', async () => {
		expect(await encodeShareFragment('a'.repeat(MAX_SHARE_CODE_BYTES + 1))).toEqual({
			ok: false,
			error: 'too-large'
		});
		// Grenze in UTF-8-Bytes, nicht in UTF-16-Zeichen
		expect(await encodeShareFragment('ä'.repeat(MAX_SHARE_CODE_BYTES / 2 + 1))).toEqual({
			ok: false,
			error: 'too-large'
		});
		expect((await encodeShareFragment('a'.repeat(MAX_SHARE_CODE_BYTES))).ok).toBe(true);
	});
});

describe('isShareFragment', () => {
	it('erkennt Teilen-Fragmente jeder Version, sonst false', () => {
		expect(isShareFragment('#code=v1:abc')).toBe(true);
		expect(isShareFragment('code=v1:')).toBe(true);
		expect(isShareFragment('#code=v2:abc')).toBe(true);
		expect(isShareFragment('')).toBe(false);
		expect(isShareFragment('#')).toBe(false);
		expect(isShareFragment('#section-1')).toBe(false);
	});
});
