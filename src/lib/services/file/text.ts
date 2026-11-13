// Datei-Service, Kern `.mmd` (KONZEPT §9): reine Funktionen ohne DOM (O-18).
// Konventionen: nur UTF-8 (fatal, V-04), neue Dateien LF ohne BOM, bestehende Dateien behalten
// Zeilenende und BOM.
import { msg } from '../i18n';

/** Zeilenende einer Datei. `none`: keine Zeilenumbrüche; `mixed`: LF und CRLF gemischt. */
export type LineEnding = 'lf' | 'crlf' | 'mixed' | 'none';

const BOM = '﻿';

/**
 * Fehlerart; die Shell zeigt `message`, `code` dient Tests und der Unterscheidung (z. B.
 * `changed-on-disk` -> Rückfrage überschreiben/neu laden, T105).
 */
export type FileErrorCode =
	| 'open-failed'
	| 'save-failed'
	| 'not-utf8'
	| 'too-large'
	| 'changed-on-disk'
	| 'permission-denied'
	| 'not-found'
	| 'quota';

/** Fehler mit nutzerlesbarer Meldung ohne Pfade oder Systeminfos. */
export class FileServiceError extends Error {
	readonly code: FileErrorCode;
	constructor(message: string, code: FileErrorCode) {
		super(message);
		this.name = 'FileServiceError';
		this.code = code;
	}
}

/** Erkennt das Zeilenende. Ein einzelnes CR (ohne folgendes LF) zählt nicht als Umbruch. */
export function detectLineEnding(text: string): LineEnding {
	let lf = 0;
	let crlf = 0;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) !== 10) continue;
		if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
		else lf++;
	}
	if (lf > 0 && crlf > 0) return 'mixed';
	if (crlf > 0) return 'crlf';
	return lf > 0 ? 'lf' : 'none';
}

/**
 * Wendet ein Zeilenende auf `text` an. `mixed` lässt den Text unverändert,
 * `none` (Vorlage ohne Umbruch) und `lf` schreiben LF.
 */
export function applyLineEnding(text: string, ending: LineEnding): string {
	if (ending === 'mixed') return text;
	const lf = text.replace(/\r\n/g, '\n');
	return ending === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
}

/** Entfernt ein führendes BOM (U+FEFF). */
export function stripBom(text: string): string {
	return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Dekodiert UTF-8 streng, BOM bleibt erhalten. Ungültige Bytes (Windows-1252, UTF-16 mit BOM)
 * und NUL-Bytes (UTF-16 ohne BOM) ergeben `FileServiceError` mit Code `not-utf8`.
 */
function decodeStrict(bytes: Uint8Array): string {
	try {
		const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
		// NUL kommt in Textdateien nicht vor, wohl aber in Binärdateien, UTF-16 ohne BOM und
		// UTF-32: diese sind formal gültiges UTF-8 und werden so trotzdem abgelehnt.
		if (!text.includes('\0')) return text;
	} catch {
		// ungültige UTF-8-Sequenz
	}
	throw new FileServiceError(msg('services.file.notUtf8'), 'not-utf8');
}

/** Dekodiert UTF-8; ein BOM wird toleriert und entfernt. Kein UTF-8: `FileServiceError`. */
export function decodeUtf8(bytes: Uint8Array): string {
	return stripBom(decodeStrict(bytes));
}

/** Kodiert als UTF-8; ein BOM nur mit `bom` (Datei hatte eines). */
export function encodeUtf8(text: string, bom = false): Uint8Array {
	return new TextEncoder().encode((bom ? BOM : '') + stripBom(text));
}

/** Gelesener Text ohne BOM; Zeilenenden unverändert. */
export interface TextDocument {
	text: string;
	lineEnding: LineEnding;
	hadBom: boolean;
}

/**
 * Liest Text oder Bytes: BOM entfernen (`hadBom` merken), Zeilenende erkennen, Text sonst
 * unverändert. Bytes ohne gültiges UTF-8: `FileServiceError` (`not-utf8`).
 */
export function readText(input: string | Uint8Array): TextDocument {
	const raw = typeof input === 'string' ? input : decodeStrict(input);
	const hadBom = raw.startsWith(BOM);
	const text = hadBom ? raw.slice(1) : raw;
	return { text, lineEnding: detectLineEnding(text), hadBom };
}

/** Liest eine `.mmd`-Datei (Text oder Bytes). */
export function readMmd(input: string | Uint8Array): TextDocument {
	return readText(input);
}

/**
 * Erzeugt den Dateitext einer `.mmd`-Datei. `lineEnding` ist das Zeilenende der gelesenen
 * Datei; ohne Angabe (neue Datei) gilt LF. Text ohne BOM; ein BOM setzt erst `encodeUtf8`
 * (Option `bom` von `saveFile`).
 */
export function writeMmd(text: string, lineEnding: LineEnding = 'lf'): string {
	return applyLineEnding(stripBom(text), lineEnding);
}
