import { describe, expect, it } from 'vitest';
import {
	applyLineEnding,
	decodeUtf8,
	detectLineEnding,
	encodeUtf8,
	readMmd,
	stripBom,
	writeMmd
} from '../../../../src/lib/services/file';

const BOM = '﻿';
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('detectLineEnding', () => {
	it('erkennt LF, CRLF, gemischt und keine', () => {
		expect(detectLineEnding('a\nb\n')).toBe('lf');
		expect(detectLineEnding('a\r\nb\r\n')).toBe('crlf');
		expect(detectLineEnding('a\r\nb\n')).toBe('mixed');
		expect(detectLineEnding('einzeilig')).toBe('none');
		expect(detectLineEnding('')).toBe('none');
	});

	it('wertet einzelnes CR nicht als CRLF', () => {
		expect(detectLineEnding('a\rb\n')).toBe('lf');
	});
});

describe('applyLineEnding', () => {
	it('wandelt nach LF und CRLF ohne Doppel-CR', () => {
		expect(applyLineEnding('a\r\nb\nc', 'lf')).toBe('a\nb\nc');
		expect(applyLineEnding('a\r\nb\nc', 'crlf')).toBe('a\r\nb\r\nc');
	});

	it('lässt gemischte Zeilenenden unverändert', () => {
		expect(applyLineEnding('a\r\nb\nc', 'mixed')).toBe('a\r\nb\nc');
	});

	it('nutzt LF, wenn die Vorlage keine Zeilenenden hatte', () => {
		expect(applyLineEnding('a\r\nb', 'none')).toBe('a\nb');
	});
});

describe('BOM und UTF-8', () => {
	it('stripBom entfernt nur ein führendes BOM', () => {
		expect(stripBom(`${BOM}a${BOM}`)).toBe(`a${BOM}`);
		expect(stripBom('a')).toBe('a');
	});

	it('decodeUtf8 toleriert BOM und entfernt es', () => {
		const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('Größe')]);
		expect(decodeUtf8(withBom)).toBe('Größe');
		expect(decodeUtf8(bytes('Größe'))).toBe('Größe');
	});

	it('encodeUtf8 erzeugt nie ein BOM', () => {
		const out = encodeUtf8(`${BOM}Übersicht`);
		expect([...out.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
		expect(new TextDecoder().decode(out)).toBe('Übersicht');
	});
});

describe('readMmd / writeMmd', () => {
	it('liest Bytes mit BOM, entfernt es und merkt sich CRLF', () => {
		const doc = readMmd(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('flowchart TD\r\nA-->B\r\n')]));
		expect(doc.text).toBe('flowchart TD\r\nA-->B\r\n');
		expect(doc.lineEnding).toBe('crlf');
		expect(doc.hadBom).toBe(true);
	});

	it('liest Text-Eingabe und entfernt BOM', () => {
		const doc = readMmd(`${BOM}flowchart TD\nA-->B\n`);
		expect(doc.text).toBe('flowchart TD\nA-->B\n');
		expect(doc.lineEnding).toBe('lf');
		expect(doc.hadBom).toBe(true);
	});

	it('CRLF-Datei bleibt CRLF, auch wenn der Editor LF liefert', () => {
		const doc = readMmd('flowchart TD\r\nA-->B\r\n');
		expect(writeMmd('flowchart TD\nA-->B\nB-->C\n', doc.lineEnding)).toBe(
			'flowchart TD\r\nA-->B\r\nB-->C\r\n'
		);
	});

	it('gemischte Zeilenenden bleiben unverändert (Roundtrip byte-gleich)', () => {
		const raw = 'flowchart TD\r\nA-->B\nB-->C\r\n';
		const doc = readMmd(raw);
		expect(doc.lineEnding).toBe('mixed');
		expect(writeMmd(doc.text, doc.lineEnding)).toBe(raw);
	});

	it('neue Datei ohne Vorlage schreibt LF', () => {
		expect(writeMmd('flowchart TD\r\nA-->B\r\n')).toBe('flowchart TD\nA-->B\n');
	});

	it('Schreiben erzeugt nie ein BOM', () => {
		expect(writeMmd(`${BOM}flowchart TD\n`, 'lf')).toBe('flowchart TD\n');
	});
});
