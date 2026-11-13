/**
 * T128 C1 (V-25): Lexer- und RawBlock-Erkennung im Sequence-Adapter gegen das Golden
 * `grammar.golden.jsonl` (festgeschriebene Ergebnisse der früheren View-Erkennung
 * `views/canvas/sequence/{lexer,raw}.ts` auf Fixtures und Korpus aus `grammar-corpus.ts`, erzeugt
 * von `grammar-view.test.ts`; beide mit T128 C2 entfernt, das Golden ist seitdem fest). Gleichheit bis auf `DEVIATION`: `\r`, `\u2028`, `\u2029` im Text
 * nach dem `:` ergeben im Adapter keine Nachricht/Notiz (neues Soll, wie `rawUses` und Parser), die
 * View las dort eine. Nennungen deckungsgleich mit `rawUses`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messageLexes, parse, rawEvents } from '../../../../../src/lib/services/adapters/sequence';
import { rawUses } from '../../../../../src/lib/services/adapters/sequence/syntax';
import {
	DEVIATION,
	DEVIATION_REASON,
	GOLDEN_FILE,
	LEX_CASES,
	lexGrid,
	rawTexts,
	type GoldenEvents,
	type GoldenHead
} from './grammar-corpus';

const [head, ...rows] = readFileSync(new URL(GOLDEN_FILE, import.meta.url), 'utf8')
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line)) as [GoldenHead, ...GoldenEvents[]];

describe('Golden der Sequenz-Erkennung (T128 C1)', () => {
	it('deckt genau die Eingaben aus grammar-corpus.ts ab', () => {
		expect(rows.map((r) => r.text)).toEqual(rawTexts());
		expect(head.messageLexes).toHaveLength(lexGrid().length);
	});

	it('Abweichungen nur nach DEVIATION, als solche markiert', () => {
		const marked = rows.filter((r) => r.deviation !== undefined);
		expect(marked.length).toBeGreaterThan(0);
		for (const r of marked) {
			expect(r.deviation).toBe(DEVIATION_REASON);
			expect(r.text).toMatch(DEVIATION);
			expect(r.adapter).not.toEqual(r.events);
		}
	});
});

describe('rawEvents im Adapter (T128 C1)', () => {
	it('gleich dem Golden (bei DEVIATION gleich dem Adapter-Soll)', () => {
		const diff = rows.filter(
			(r) => JSON.stringify(rawEvents(r.text)) !== JSON.stringify(r.adapter ?? r.events)
		);
		expect(diff.map((r) => r.text)).toEqual([]);
	});

	it('Nennungen deckungsgleich mit rawUses', () => {
		for (const text of rawTexts())
			expect(rawEvents(text).uses).toEqual(rawUses(text).map((u) => u.id));
	});

	it('Zeilenende im Text nach ":": keine Nachricht, keine Notiz (DEVIATION)', () => {
		const empty = { uses: [], act: [], declared: [], steps: [] };
		for (const sep of ['\r', '\u2028', '\u2029']) {
			for (const line of [`A->>B: x${sep}y`, `A->>+B:${sep}z`, `note over A: x${sep}y`]) {
				const text = `break b\n${line}\nend\n`;
				expect(text).toMatch(DEVIATION);
				expect(rawEvents(text)).toEqual(empty);
				expect(rawUses(text)).toEqual([]);
			}
			// Parser: dieselbe Zeile wird keine Nachricht (Kante).
			const result = parse(`sequenceDiagram\nA->>B: x${sep}y\n`);
			expect(result.ok && result.doc.edges).toEqual([]);
		}
		// Zeilenende `\r\n` (CRLF) bleibt eine Nachricht und fällt nicht unter DEVIATION.
		expect('break b\r\nA->>B: x\r\nend\r\n').not.toMatch(DEVIATION);
		expect(rawEvents('break b\r\nA->>B: x\r\nend\r\n').uses).toEqual(['A', 'B']);
	});

	it('Anweisungsfolge mit create/destroy/Nachricht', () => {
		expect(
			rawEvents('break b\ncreate participant Z as Zed\nA->>Z: x\ndestroy Z\nend\n').steps
		).toEqual([
			{ type: 'create', id: 'Z', decl: { kind: 'participant', alias: true } },
			{ type: 'use', id: 'A' },
			{ type: 'use', id: 'Z' },
			{ type: 'message', from: 'A', to: 'Z' },
			{ type: 'destroy', id: 'Z' }
		]);
		expect(rawEvents('box G\nparticipant X\nactor Y as Why\nend\n').declared).toEqual(['X', 'Y']);
	});
});

describe('messageLexes im Adapter (T128 C1)', () => {
	it.each(LEX_CASES)('%s %s %s %s -> %s', (from, arrow, act, to, want) => {
		expect(messageLexes(from, arrow, act, to)).toBe(want);
	});

	it('gleich dem Golden über Namen x Pfeile x Aktivierung', () => {
		const got = lexGrid()
			.map((c) => (messageLexes(...c) ? '1' : '0'))
			.join('');
		expect(got).toBe(head.messageLexes);
	});
});
