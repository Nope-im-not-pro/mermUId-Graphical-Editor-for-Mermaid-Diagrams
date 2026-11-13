// Teilen per Link (F-11, T136): Code <-> URL-Fragment. Reine Funktionen ohne DOM; nur die
// Stream-APIs `CompressionStream`/`DecompressionStream` ('deflate-raw', Browser und Node >= 21.2),
// keine Abhängigkeit. Das Fragment (`#...`) verlässt den Browser nicht in Requests. Inhalt aus
// fremden Links ist nicht vertrauenswürdig: der Aufrufer schickt `text` durch die Prüfpfade des
// Datei-Öffnens. Fehler werden nicht geworfen, sondern als Code geliefert (Meldung in der Shell).
//
// Laufzeitabweichung: Bytes hinter dem finalen Deflate-Block ignoriert Node (Dekodieren gelingt),
// Browser brechen den Strom vermutlich mit Fehler ab (`invalid-data`). Bewusst nicht vereinheitlicht:
// ein Vergleich per Re-Kompression scheitert, weil Deflate-Ausgaben zwischen Laufzeiten abweichen.

/** Präfix samt Formatversion; spätere Formate erhalten `code=v2:` usw. */
export const SHARE_FRAGMENT_PREFIX = 'code=v1:';

/**
 * Höchstlänge des Fragments (ohne `#`) in Zeichen. Browser selbst erlauben deutlich mehr
 * (Chromium 2 MB), aber Links laufen durch Messenger, Mail-Programme, Ticket-Systeme und
 * Proxys/Server-Header, die URLs oft bei rund 8 KB kappen oder verwerfen (nginx-Standard
 * `large_client_header_buffers` 8k). 8192 bleibt dort brauchbar und reicht nach Kompression für
 * typische Diagramme mit einigen Dutzend KB Text.
 */
export const MAX_SHARE_FRAGMENT_LENGTH = 8192;

/**
 * Höchstgröße des entpackten Codes in UTF-8-Bytes, gilt beim Kodieren und Dekodieren. Deflate
 * erreicht Raten um 1000:1; ohne Grenze würde ein 8-KB-Fragment Megabytes erzeugen (Zip-Bombe).
 * 256 KiB liegt weit über dem, was ein 8-KB-Fragment bei normalem Text ergibt (Rate ~3-10:1),
 * und unter der Datei-Grenze `MAX_FILE_BYTES` (1 MiB).
 */
export const MAX_SHARE_CODE_BYTES = 256 * 1024;

/**
 * Fehlerarten:
 * - `invalid-prefix`: kein `code=<version>:`-Fragment.
 * - `unsupported-version`: Präfix erkannt, Version unbekannt.
 * - `invalid-base64`: Nutzlast ist kein base64url (ohne Padding).
 * - `invalid-data`: Deflate-Strom defekt oder abgeschnitten.
 * - `too-long`: Fragment länger als `MAX_SHARE_FRAGMENT_LENGTH`.
 * - `too-large`: Code größer als `MAX_SHARE_CODE_BYTES`.
 * - `not-utf8`: entpackter Inhalt ist kein gültiges UTF-8.
 * - `unavailable`: Laufzeit ohne `CompressionStream`/`DecompressionStream` mit 'deflate-raw'.
 */
export type ShareErrorCode =
	| 'invalid-prefix'
	| 'unsupported-version'
	| 'invalid-base64'
	| 'invalid-data'
	| 'too-long'
	| 'too-large'
	| 'not-utf8'
	| 'unavailable';

export type ShareFailure = { ok: false; error: ShareErrorCode };
export type ShareEncodeResult = { ok: true; fragment: string } | ShareFailure;
export type ShareDecodeResult = { ok: true; text: string } | ShareFailure;

const FORMAT = 'deflate-raw';
const PREFIX_RE = /^code=([^:]*):/;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

const fail = (error: ShareErrorCode): ShareFailure => ({ ok: false, error });
const stripHash = (fragment: string): string =>
	fragment.startsWith('#') ? fragment.slice(1) : fragment;

/** true, wenn das Fragment ein Teilen-Fragment ist (beliebige Version, auch defekt). */
export function isShareFragment(fragment: string): boolean {
	return stripHash(fragment).startsWith('code=');
}

function streamsAvailable(): boolean {
	return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** Stückgröße beim Einspeisen: so greift der Abbruch in `collect` schon während des Streamens. */
const SOURCE_CHUNK_BYTES = 1024;

function sourceOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
	let offset = 0;
	return new ReadableStream<BufferSource>({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.subarray(offset, offset + SOURCE_CHUNK_BYTES));
			offset += SOURCE_CHUNK_BYTES;
		}
	});
}

/**
 * Liest `stream` vollständig; bricht ab, sobald mehr als `limit` Bytes anfallen (`null`).
 * Stream-Fehler (defekter Deflate-Strom) werden an den Aufrufer weitergereicht.
 */
async function collect(
	stream: ReadableStream<Uint8Array>,
	limit: number
): Promise<Uint8Array | null> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

function toBase64url(bytes: Uint8Array): string {
	let binary = '';
	// Blockweise, damit `String.fromCharCode` nicht an der Argument-Grenze scheitert.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(payload: string): Uint8Array<ArrayBuffer> | null {
	// Länge mod 4 == 1 ist in base64 unmöglich.
	if (!BASE64URL_RE.test(payload) || payload.length % 4 === 1) return null;
	try {
		const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		// Kanonisch: gesetzte Restbits im letzten Zeichen (`AB` statt `AA`) ergäben sonst
		// mehrere Schreibweisen derselben Bytes.
		return toBase64url(out) === payload ? out : null;
	} catch {
		return null;
	}
}

/** Kodiert `code` als Fragment `code=v1:<base64url(deflate-raw(utf8))>` (ohne `#`). */
export async function encodeShareFragment(code: string): Promise<ShareEncodeResult> {
	const bytes = new TextEncoder().encode(code);
	if (bytes.length > MAX_SHARE_CODE_BYTES) return fail('too-large');
	if (!streamsAvailable()) return fail('unavailable');
	let compressed: Uint8Array | null;
	try {
		// Grenze für die komprimierte Größe: base64url macht aus 3 Bytes 4 Zeichen.
		const limit = Math.floor(((MAX_SHARE_FRAGMENT_LENGTH - SHARE_FRAGMENT_PREFIX.length) * 3) / 4);
		compressed = await collect(sourceOf(bytes).pipeThrough(new CompressionStream(FORMAT)), limit);
	} catch {
		// Kompression gültiger UTF-8-Bytes scheitert nur, wenn die Laufzeit 'deflate-raw' trotz
		// vorhandener Klasse nicht unterstützt (Konstruktor wirft); Ergebnis wie ohne Stream-API.
		return fail('unavailable');
	}
	if (!compressed) return fail('too-long');
	const fragment = SHARE_FRAGMENT_PREFIX + toBase64url(compressed);
	return fragment.length > MAX_SHARE_FRAGMENT_LENGTH ? fail('too-long') : { ok: true, fragment };
}

/** Dekodiert ein Fragment (mit oder ohne `#`) zu Code. Wirft nie. */
export async function decodeShareFragment(fragment: string): Promise<ShareDecodeResult> {
	const body = stripHash(fragment);
	const match = PREFIX_RE.exec(body);
	if (!match) return fail('invalid-prefix');
	if (`code=${match[1]}:` !== SHARE_FRAGMENT_PREFIX) return fail('unsupported-version');
	if (body.length > MAX_SHARE_FRAGMENT_LENGTH) return fail('too-long');
	const compressed = fromBase64url(body.slice(SHARE_FRAGMENT_PREFIX.length));
	if (!compressed) return fail('invalid-base64');
	if (!streamsAvailable()) return fail('unavailable');
	let bytes: Uint8Array | null;
	try {
		bytes = await collect(
			sourceOf(compressed).pipeThrough(new DecompressionStream(FORMAT)),
			MAX_SHARE_CODE_BYTES
		);
	} catch {
		return fail('invalid-data');
	}
	if (!bytes) return fail('too-large');
	try {
		// BOM bleibt erhalten (exakter Roundtrip); die Prüfpfade des Datei-Öffnens behandeln ihn.
		return {
			ok: true,
			text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
		};
	} catch {
		return fail('not-utf8');
	}
}
