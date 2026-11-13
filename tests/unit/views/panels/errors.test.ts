import { afterEach, describe, expect, it } from 'vitest';
import { diagnose } from '../../../../src/lib/services/adapters/diagnostics';
import { errorEntries } from '../../../../src/lib/views/panels/errors';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import { flow } from './helpers';

describe('errorEntries', () => {
	const doc = flow('flowchart TD\n  A --> B\n');

	it('Parser-Fehler springen zur Zeile, sortiert', () => {
		const list = errorEntries([
			{ line: 4, column: 2, message: 'b' },
			{ line: 2, column: 7, message: 'a' },
			{ line: 2, column: 1, message: 'c' }
		]);
		expect(list.map((e) => e.text)).toEqual([
			'Zeile 2, Spalte 1: c',
			'Zeile 2, Spalte 7: a',
			'Zeile 4, Spalte 2: b'
		]);
		expect(list[1]).toMatchObject({
			source: 'code',
			severity: 'error',
			target: { type: 'line', line: 2, column: 7 }
		});
		expect(new Set(list.map((e) => e.key)).size).toBe(3);
	});

	it('Modell-Befunde springen zum Element; Fehler vor Hinweisen', () => {
		const list = errorEntries(
			[{ line: 1, column: 1, message: 'p' }],
			[
				{ kind: 'unknown-id', severity: 'hint', elementId: 'foo', message: 'h' },
				{ kind: 'dangling-edge', severity: 'error', elementId: 'e1', message: 'x' }
			],
			doc
		);
		expect(list.map((e) => [e.source, e.severity, e.text])).toEqual([
			['code', 'error', 'Zeile 1, Spalte 1: p'],
			['model', 'error', 'e1: x'],
			['model', 'hint', 'foo: h']
		]);
		expect(list[1].target).toEqual({ type: 'element', id: 'e1' });
		expect(list[2].target).toBeNull();
		expect(
			errorEntries([], [{ kind: 'unknown-id', severity: 'error', elementId: 'A', message: 'm' }])[0]
				.target
		).toEqual({
			type: 'element',
			id: 'A'
		});
	});

	describe('Diagnosen (V-18)', () => {
		afterEach(() => applyLocale('de'));
		const raw = "Parse error on line 9:\nA[x\n---^\nExpecting 'SQE', got '1'";
		const diag = () =>
			diagnose(Object.assign(new Error(raw), { hash: { token: 1, expected: ["'SQE'"] } }), 3, 4);

		it('Kurztext in aktueller Sprache, Rohtext getrennt', () => {
			const [entry] = errorEntries([diag()]);
			expect(entry.text).toBe('Zeile 3, Spalte 4: Klammer oder | nicht geschlossen');
			expect(entry.text).not.toContain('9');
			expect(entry.raw).toBe(raw);
			expect(entry.target).toEqual({ type: 'line', line: 3, column: 4 });
		});

		it('Sprachwechsel ohne Neuvalidierung', () => {
			const errors = [diag()];
			applyLocale('en');
			expect(errorEntries(errors)[0].text).toBe('Line 3, column 4: Bracket or | not closed');
		});

		it('Mischliste: einfacher ParseError nutzt message, ohne Rohtext', () => {
			const list = errorEntries([
				{ line: 1, column: 1, message: 'Kein flowchart-Diagramm: x' },
				diag()
			]);
			expect(list.map((e) => [e.text, e.raw])).toEqual([
				['Zeile 1, Spalte 1: Kein flowchart-Diagramm: x', undefined],
				['Zeile 3, Spalte 4: Klammer oder | nicht geschlossen', raw]
			]);
		});

		it('100000 Einträge ohne RangeError', () => {
			const many = Array.from({ length: 100000 }, (_, i) => ({
				line: i + 1,
				column: 1,
				message: 'm'
			}));
			expect(errorEntries(many)).toHaveLength(100000);
		});
	});
});
