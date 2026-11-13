// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ARROW_TOKENS, arrowStyle } from '../../../../src/lib/views/canvas/sequence/arrows';
import {
	displayLines,
	editorText,
	labelFromEditor,
	ROW,
	textMeasure,
	toSequence,
	type SeqItem
} from '../../../../src/lib/views/canvas/sequence/mapping';
import { layoutSequence } from '../../../../src/lib/services/layout';
import { parseOk, SAMPLE } from './helpers';

const byId = (items: SeqItem[], id: string) => items.find((i) => i.id === id)!;

describe('Pfeile', () => {
	it('kennt alle 26 Token aus SUBSET und ihre Stile', () => {
		expect(ARROW_TOKENS).toHaveLength(26);
		expect(arrowStyle('-->>')).toEqual({ lineStyle: 'dotted', arrowHead: 'arrow' });
		expect(arrowStyle('<<->>')).toEqual({ lineStyle: 'solid', arrowHead: 'both' });
		expect(arrowStyle('--|\\')).toEqual({ lineStyle: 'dotted', arrowHead: 'half' });
		expect(arrowStyle('/|--')).toEqual({ lineStyle: 'dotted', arrowHead: 'half' });
		expect(() => arrowStyle('=>')).toThrow('Unbekannter Pfeil');
	});

	it('jedes Token wird als Nachricht geparst', () => {
		for (const token of ARROW_TOKENS) {
			const doc = parseOk(`sequenceDiagram\nA${token}B: x\n`);
			expect(doc.edges[0].props.arrow, token).toBe(token);
			expect(doc.edges[0]).toMatchObject(arrowStyle(token));
		}
	});
});

describe('Labels', () => {
	it('zeigt Text ohne Markup, bricht an <br>', () => {
		expect(displayLines('a<br>b<b>c</b>', textMeasure)).toEqual(['a', 'bc']);
		expect(displayLines('<img src=x onerror=alert(1)>Hi', textMeasure)).toEqual(['Hi']);
	});

	it('Editor-Text und Rückweg', () => {
		expect(editorText('a<br/>b')).toBe('a\nb');
		expect(labelFromEditor('  a\r\nb \n')).toBe('a<br>b');
	});
});

describe('toSequence', () => {
	const doc = parseOk(SAMPLE);
	const view = toSequence(doc, [], textMeasure);
	const layout = layoutSequence(doc, () => ({ width: 1, height: 1 }));

	it('Teilnehmer zuerst (links nach rechts), danach Dokument-Reihenfolge', () => {
		expect(view.items.map((i) => i.id)).toEqual([
			'A',
			'B',
			'e1',
			'n1',
			'c1',
			'e2',
			'c1:1',
			'e3',
			'e4',
			'e5'
		]);
		expect(view.items.map((i) => i.type)).toEqual([
			'participant',
			'actor',
			'message',
			'note',
			'container',
			'message',
			'section',
			'activate',
			'message',
			'deactivate'
		]);
		expect(Object.keys(layout.participants)).toEqual(['A', 'B']);
	});

	it('aria-Labels mit Typ und Label', () => {
		expect(view.items.map((i) => i.aria)).toEqual([
			'Teilnehmer: Alice',
			'Akteur: B',
			'Nachricht: Hallo',
			'Notiz: Notiz',
			'Block alt: Fall',
			'Nachricht: Ja',
			'Abschnitt else: Sonst',
			'Aktivierung: Alice',
			'Nachricht: Nein',
			'Deaktivierung: Alice'
		]);
	});

	it('Koordinaten aus layoutSequence', () => {
		const real = layoutSequence(doc, (el) => {
			const lines = displayLines(el.label, textMeasure);
			return {
				width: Math.max(80, Math.max(...lines.map(textMeasure)) + 32),
				height: lines.length * 18 + 24
			};
		});
		const a = byId(view.items, 'A');
		expect([a.box.x, a.box.y, a.box.w, a.box.h]).toEqual(real.participants.A);
		const c = byId(view.items, 'c1');
		expect([c.box.x, c.box.y, c.box.w, c.box.h]).toEqual(real.containers.c1);
		const msg = byId(view.items, 'e1');
		expect(msg.box.y + ROW / 2).toBe(real.rows.e1);
		expect(view.height).toBe(real.height);
		const section = byId(view.items, 'c1:1');
		expect(section.box.y + ROW / 2).toBe(real.rows.e3 ?? real.rows.e4 - ROW);
	});

	it('Nachrichten: Linie, Strichelung, Marker', () => {
		const ja = byId(view.items, 'e2');
		expect(ja.dashed).toBe(true);
		expect(ja.head).toBe('arrow');
		expect(byId(view.items, 'e4').head).toBe('cross');
		expect(byId(view.items, 'e1').path).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+$/);
	});

	it('Lebenslinien und Aktivierungsbalken', () => {
		expect(view.lifelines.map((l) => l.id)).toEqual(['A', 'B']);
		// B aktiviert durch "+" bis zum Ende, A durch activate/deactivate.
		expect(view.bars.map((b) => b.id)).toEqual(['B', 'A']);
		const barA = view.bars[1];
		expect(barA.y).toBe(byId(view.items, 'e4').box.y + ROW / 4);
		expect(barA.h).toBe(ROW / 2);
		expect(view.bars[0].y + view.bars[0].h).toBe(view.height - ROW);
	});

	it('Notizen: over, left of, right of', () => {
		const d = parseOk(
			'sequenceDiagram\nparticipant A\nparticipant B\nNote left of A: l\nNote right of B: r\nNote over A: o\n'
		);
		const v = toSequence(d, [], textMeasure);
		const a = byId(v.items, 'A');
		const b = byId(v.items, 'B');
		const left = byId(v.items, 'n1').box;
		const right = byId(v.items, 'n2').box;
		const over = byId(v.items, 'n3').box;
		expect(left.x + left.w).toBe(a.box.x + a.box.w / 2 - 8);
		expect(right.x).toBe(b.box.x + b.box.w / 2 + 8);
		expect(over.x + over.w / 2).toBe(a.box.x + a.box.w / 2);
		expect(v.minX).toBeLessThan(0);
	});

	it('Selbstnachricht als Schleife; Aktivierung über "-" schließt', () => {
		const d = parseOk('sequenceDiagram\nA->>+A: s\nA-->>-A: t\n');
		const v = toSequence(d, [], textMeasure);
		expect(byId(v.items, 'e1').path).toMatch(/V/);
		expect(v.bars).toHaveLength(1);
		expect(v.bars[0].h).toBe(ROW);
	});

	it('RawBlocks als nicht grafisch editierbar, Fehler als Hinweise', () => {
		const v = toSequence(doc, [{ line: 3, column: 1, message: 'kaputt' }], textMeasure);
		// T135: autonumber ist per Schalter editierbar, kein RawBlock-Hinweis mehr.
		expect(v.rawBlocks).toEqual([]);
		const box = toSequence(
			parseOk('sequenceDiagram\nbox currentcolor G\nparticipant C\nend\n'),
			[],
			textMeasure
		);
		expect(box.rawBlocks).toEqual([
			{
				id: expect.any(String),
				text: 'box currentcolor G\nparticipant C\nend',
				note: 'nicht grafisch editierbar'
			}
		]);
		expect(v.issues).toEqual(['Zeile 3: kaputt']);
	});

	it('Teilnehmer aus RawBlock-Deklaration sind nicht editierbar', () => {
		const d = parseOk('sequenceDiagram\nbox currentcolor Gruppe\nparticipant X\nend\nX->>Y: a\n');
		const v = toSequence(d, [], textMeasure);
		const x = byId(v.items, 'X');
		expect(x.editable).toBe(false);
		expect(x.aria).toBe('Teilnehmer: X (nicht grafisch editierbar)');
		expect(byId(v.items, 'Y').editable).toBe(true);
	});

	it('leeres Diagramm', () => {
		const v = toSequence(parseOk('sequenceDiagram\n'), [], textMeasure);
		expect(v.items).toEqual([]);
		expect(v.width).toBeGreaterThan(0);
	});

	it('Verschachtelung als Liste', () => {
		expect(view.outline).toEqual([
			{ id: 'e1', aria: 'Nachricht: Hallo', children: [] },
			{ id: 'n1', aria: 'Notiz: Notiz', children: [] },
			{
				id: 'c1',
				aria: 'Block alt: Fall',
				children: [
					{
						id: 'c1:0',
						aria: 'Abschnitt: Fall',
						children: [{ id: 'e2', aria: 'Nachricht: Ja', children: [] }]
					},
					{
						id: 'c1:1',
						aria: 'Abschnitt else: Sonst',
						children: [
							{ id: 'e3', aria: 'Aktivierung: Alice', children: [] },
							{ id: 'e4', aria: 'Nachricht: Nein', children: [] },
							{ id: 'e5', aria: 'Deaktivierung: Alice', children: [] }
						]
					}
				]
			}
		]);
	});
});
