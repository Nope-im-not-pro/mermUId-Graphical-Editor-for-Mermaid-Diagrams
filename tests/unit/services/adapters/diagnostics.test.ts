import { afterEach, describe, expect, it } from 'vitest';
import {
	diagnose,
	reportedColumn,
	reportedLine
} from '../../../../src/lib/services/adapters/diagnostics';
import { setLocale, translate } from '../../../../src/lib/services/i18n';

/** Fehlerobjekt wie von mermaid 12 (jison): `message` plus `hash`. */
function jison(message: string, hash?: Record<string, unknown>): Error {
	return Object.assign(new Error(message), hash ? { hash } : {});
}

const CLOSERS = ["'SQE'", "'PE'", "'DIAMOND_STOP'", "'TAGEND'", "'TEXT'"];

describe('diagnose: Rohmeldung -> Kurztext (V-18)', () => {
	afterEach(() => setLocale('de'));

	it.each([
		[
			'offene Klammer am Dateiende',
			jison(
				"Parse error on line 4:\nflowchart TD  A[x\n-----------------^\nExpecting 'SQE', 'DOUBLECIRCLEEND', 'PE', got '1'",
				{ token: 1, text: '', expected: CLOSERS, loc: { first_line: 2, first_column: 4 } }
			),
			'services.validate.unclosedBracket'
		],
		[
			'falsche schließende Klammer',
			jison(
				"Parse error on line 2:\nflowchart TD  A(x] --> B\n-----------------^\nExpecting 'PE', 'TAGEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'SQE'",
				{ token: 'SQE', text: ']', expected: ["'PE'", "'TAGEND'", "'TEXT'"] }
			),
			'services.validate.bracketMismatch'
		],
		[
			'offener Block',
			jison("Parse error on line 5:\n...\nExpecting 'SPACE', 'NEWLINE', 'end', 'loop', got '1'", {
				token: 1,
				text: '',
				expected: ["'SPACE'", "'NEWLINE'", "'end'", "'loop'"]
			}),
			'services.syntax.blockOpen'
		],
		[
			'end ohne Block',
			jison("Parse error on line 3:\n...\nExpecting 'SEMI', 'NEWLINE', 'subgraph', got 'end'", {
				token: 'end',
				text: 'end\n\n',
				expected: ["'SEMI'", "'NEWLINE'", "'subgraph'"]
			}),
			'services.syntax.endWithoutBlock'
		],
		[
			'Nachrichtentext fehlt',
			jison("Parse error on line 2:\n...\nExpecting 'TXT', got 'NEWLINE'", {
				token: 'NEWLINE',
				text: '\n\n',
				expected: ["'TXT'"]
			}),
			'services.validate.missingText'
		],
		[
			'Dateiende',
			jison("Parse error on line 5:\n...\nExpecting 'AMP', 'COLON', 'PIPE', got 'EOF'", {
				token: 'EOF',
				text: '',
				expected: ["'AMP'", "'COLON'", "'PIPE'"]
			}),
			'services.validate.unexpectedEof'
		],
		[
			'Zeilenende',
			jison("Parse error on line 3:\n...\nExpecting 'SPACE', got 'NEWLINE'", {
				token: 'NEWLINE',
				text: '\n\n',
				expected: ["'SPACE'"]
			}),
			'services.validate.unexpectedLineEnd'
		],
		[
			'unbekannter Text',
			jison('Lexical error on line 3. Unrecognized text.\n... activate\n-----^', {
				token: null,
				text: '',
				line: 2
			}),
			'services.validate.unrecognized'
		]
	])('%s', (_, error, key) => {
		const d = diagnose(error, 3, 1);
		expect(d.key).toBe(key);
		expect(d.raw).toBe(error.message);
		expect(d.message).toBe(translate('de', d.key, d.params));
	});

	it('unerwartetes Wort nennt den Nutzertext, nicht den Token-Namen', () => {
		const d = diagnose(
			jison("Parse error on line 3:\n...\nExpecting 'SPACE', 'NEWLINE', 'loop', got 'else'", {
				token: 'else',
				text: 'else',
				expected: ["'SPACE'", "'NEWLINE'", "'loop'"]
			}),
			3,
			5
		);
		expect(d.key).toBe('services.validate.unexpectedToken');
		expect(d.params).toEqual({ text: 'else' });
		expect(d.message).toContain('"else"');
	});

	it.each([
		['unbekannte Meldung', new Error('Something odd happened')],
		['kein Error-Objekt', 'kaputt'],
		['undefined', undefined],
		['Hash ohne Erwartung', jison('Parse error on line 1: ???', { token: 'X', text: '' })]
	])('fällt auf generischen Kurztext zurück (%s)', (_, error) => {
		const d = diagnose(error, 1, 1);
		expect(d.key).toBe('services.validate.generic');
		expect(d.message).toBe(translate('de', 'services.validate.generic'));
		expect(typeof d.raw).toBe('string');
	});

	it('Kurztext ohne interne Token-Namen und ohne zweite Zeilenangabe', () => {
		const d = diagnose(
			jison(
				"Parse error on line 4:\nflowchart TD  A[x\n-----------------^\nExpecting 'SQE', 'PE', got '1'",
				{ token: 1, text: '', expected: CLOSERS }
			),
			2,
			5
		);
		expect(d.message).not.toMatch(/SQE|PE\b|EOF|Expecting|line|Zeile|\d/);
		expect(d.raw).toContain('SQE');
	});

	it('schließender Pfeil-Token "-)" gilt als Klammer-Fehler', () => {
		const d = diagnose(
			jison("Parse error on line 2:\n...\nExpecting 'TXT', got '-)'", {
				token: '-)',
				text: '-)',
				expected: ["'TXT'"]
			}),
			2,
			3
		);
		expect(d.key).toBe('services.validate.bracketMismatch');
	});

	it('Nutzertext über 20 Zeichen wird nicht zitiert (generisch)', () => {
		const text = 'x'.repeat(21);
		const d = diagnose(
			jison(`Parse error on line 2:\n...\nExpecting 'SPACE', got 'NODE_STRING'`, {
				token: 'NODE_STRING',
				text,
				expected: ["'SPACE'", "'NEWLINE'"]
			}),
			2,
			1
		);
		expect(d.key).toBe('services.validate.generic');
		expect(d.message).not.toContain(text);
	});

	it('Nutzertext mit genau 20 Zeichen wird zitiert', () => {
		const text = 'y'.repeat(20);
		const d = diagnose(
			jison('Parse error', { token: 'NODE_STRING', text, expected: ["'SPACE'"] }),
			1,
			1
		);
		expect(d.key).toBe('services.validate.unexpectedToken');
		expect(d.params).toEqual({ text });
	});

	it('TXT neben weiteren Erwartungen ist kein fehlender Text', () => {
		const d = diagnose(
			jison("Parse error on line 2:\n...\nExpecting 'TXT', 'SPACE', got 'NEWLINE'", {
				token: 'NEWLINE',
				text: '\n',
				expected: ["'TXT'", "'SPACE'"]
			}),
			2,
			1
		);
		expect(d.key).toBe('services.validate.unexpectedLineEnd');
	});

	it('Kurztexte ohne Schlusspunkt (Banner ergänzt ihn)', () => {
		for (const key of [
			'services.validate.generic',
			'services.validate.unrecognized',
			'services.validate.unclosedBracket',
			'services.validate.bracketMismatch',
			'services.validate.missingText',
			'services.validate.unexpectedEof',
			'services.validate.unexpectedLineEnd',
			'services.validate.unexpectedToken',
			'services.syntax.blockOpen',
			'services.syntax.endWithoutBlock'
		] as const) {
			expect(translate('de', key, { text: 't' })).not.toMatch(/\.$/);
			expect(translate('en', key, { text: 't' })).not.toMatch(/\.$/);
		}
	});

	it('übersetzt in der aktuellen Sprache', () => {
		setLocale('en');
		const d = diagnose(new Error('x'), 1, 1);
		expect(d.message).toBe(translate('en', 'services.validate.generic'));
	});

	it.each([NaN, Infinity, -3, 0, 2.5])('Zeile/Spalte %s wird endlich und >= 1', (n) => {
		const d = diagnose(new Error('x'), n, n);
		expect(Number.isInteger(d.line) && d.line >= 1).toBe(true);
		expect(Number.isInteger(d.column) && d.column >= 1).toBe(true);
	});
});

describe('reportedLine', () => {
	it.each([
		['loc', jison('Parse error on line 9:', { loc: { first_line: 4 } }), 4],
		['Meldung', jison('Lexical error on line 3. Unrecognized text.', { line: 2 }), 3],
		['nichts', new Error('kaputt'), NaN],
		['kein Error', 42, NaN]
	])('%s', (_, error, line) => {
		expect(reportedLine(error)).toBe(line);
	});
});

describe('reportedColumn', () => {
	it.each([
		['loc 0-basiert -> 1-basiert', jison('x', { loc: { first_column: 4 } }), 5],
		['loc ohne Spalte', jison('x', { loc: { first_line: 2 } }), 1],
		['ohne hash', new Error('x'), 1],
		['kein Error', null, 1]
	])('%s', (_, error, column) => {
		expect(reportedColumn(error)).toBe(column);
	});
});
