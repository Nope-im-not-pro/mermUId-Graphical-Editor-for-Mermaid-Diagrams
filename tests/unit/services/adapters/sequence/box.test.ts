/**
 * T135 C2 (F-06): `box [Farbe] [Titel] ... end` als Teilnehmer-Gruppe (Container `kind: 'box'`,
 * `props.color`), sonst RawBlock wie bisher. Abgleich gegen mermaid 12.2 (`getBoxes`).
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { isBoxColor, parse, serialize } from '../../../../../src/lib/services/adapters/sequence';
import { addContainer, addNode } from '../../../../../src/lib/model/operations';
import type { Container, DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface MermaidBox {
	name?: string;
	fill: string;
	wrap: boolean;
	actorKeys: string[];
}

/** Gruppen aus mermaids db; Entity-Marken im Namen dekodiert wie beim Zeichnen. */
async function mermaidBoxes(text: string): Promise<MermaidBox[]> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as {
		getBoxes(): MermaidBox[];
	};
	return db.getBoxes().map((b) => ({
		...b,
		name: b.name?.replace(/ﬂ°°(\d+)¶ß/g, (_, n: string) => String.fromCodePoint(Number(n)))
	}));
}

const boxes = (doc: DiagramDocument) => doc.containers.filter((c) => c.kind === 'box');

const dir = join(__dirname, '../../../../fixtures/sequence/roundtrip');

describe('box als Teilnehmer-Gruppe (T135 C2)', () => {
	it('Container mit Farbe, Titel und Teilnehmern; byte-gleich', () => {
		const text =
			'sequenceDiagram\n    box Aqua Gruppe\n        participant A\n        actor B as Bob\n    end\n    A->>B: x\n';
		const doc = ok(text);
		expect(doc.rawBlocks).toEqual([]);
		const [box] = boxes(doc);
		expect(box).toMatchObject({ kind: 'box', label: 'Gruppe', parentId: null });
		expect(box.props.color).toBe('Aqua');
		expect(box.sections).toEqual([{ label: 'Gruppe', memberIds: ['A', 'B'] }]);
		expect(doc.nodes.filter((n) => n.kind !== 'note').map((n) => [n.id, n.parentId])).toEqual([
			['A', box.id],
			['B', box.id]
		]);
		expect(doc.order).toEqual([box.id, doc.edges[0].id]);
		expect(serialize(doc)).toBe(text);
	});

	it('Kommentare und Leerzeilen in der Gruppe bleiben byte-gleich', () => {
		const text =
			'sequenceDiagram\n\n  BOX lightblue\n  %% Kopf\n\n    participant A\n  # c\n  end\n\n  A->>A: x\n';
		const doc = ok(text);
		const [box] = boxes(doc);
		expect(box.props.color).toBe('lightblue');
		expect(box.label).toBe('');
		expect(box.sections[0].memberIds).toHaveLength(3);
		expect(serialize(doc)).toBe(text);
	});

	it.each([
		'box',
		'box Aqua',
		'box aqua Gruppe',
		'box Gruppe A',
		'box rgb(1,2,3) T',
		'box rgb(1, 2, 3)',
		'box rgba(1, 2, 3, 0.5) Halb',
		'box transparent T',
		'box hsl(10,20%,30%) X',
		'box  red   T  ',
		'box wrap:T',
		'box red nowrap:T',
		'box red A#59;B',
		'box 123 Titel',
		'box Gruppe %% kein Kommentar'
	])('Kopf %j wie mermaid (Farbe, Titel)', async (head) => {
		const text = `sequenceDiagram\n${head}\nparticipant A\nend\nA->>A: x\n`;
		const [box] = boxes(ok(text));
		const [m] = await mermaidBoxes(text);
		expect(box).toBeDefined();
		expect(box.props.color || 'transparent').toBe(m.fill);
		expect(box.label).toBe(m.name ?? '');
		expect(box.props.wrap === true).toBe(m.wrap);
		expect(box.sections[0].memberIds).toEqual(m.actorKeys);
	});

	it.each([
		['Farbe außerhalb der Allow-Liste', 'box currentcolor T'],
		['CSS-Schlüsselwort', 'box inherit T'],
		['Systemfarbe', 'box Canvas Team'],
		['Funktion mit Klammer im Titel', 'box rgb(1,2,3) T (x)'],
		['Funktion außerhalb der Allow-Liste', 'box rgb(foo) T'],
		['Kommentar im Kopf', 'box red T #c']
	])('%s: bleibt RawBlock', (_, head) => {
		const text = `sequenceDiagram\n${head}\nparticipant A\nend\nA->>A: x\n`;
		const doc = ok(text);
		expect(boxes(doc)).toEqual([]);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([`${head}\nparticipant A\nend\n`]);
		expect(serialize(doc)).toBe(text);
	});

	it.each([
		['Nachricht', 'sequenceDiagram\nbox G\nA->>B: x\nend\n'],
		['mehrere Anweisungen', 'sequenceDiagram\nbox G\nparticipant A; participant B\nend\n'],
		['create', 'sequenceDiagram\nbox G\ncreate participant A\nend\n'],
		['schon genannt', 'sequenceDiagram\nA->>B: x\nbox G\nparticipant B\nend\n'],
		['schon deklariert', 'sequenceDiagram\nparticipant B\nbox G\nparticipant B\nend\n'],
		['doppelt in der Gruppe', 'sequenceDiagram\nbox G\nparticipant B\nactor B as Bee\nend\n'],
		['Konfiguration', 'sequenceDiagram\nbox G\nparticipant A@{ "type" : "boundary" }\nend\n'],
		['in einem Block', 'sequenceDiagram\nloop L\nbox G\nparticipant A\nend\nend\n'],
		['verschachtelt', 'sequenceDiagram\nbox G\nbox H\nparticipant A\nend\nend\n'],
		['Direktive', 'sequenceDiagram\nbox G\n%%{init: {}}%%\nparticipant A\nend\n'],
		['autonumber', 'sequenceDiagram\nbox G\nautonumber\nparticipant A\nend\n']
	])('Inhalt %s: box bleibt RawBlock (Bestand)', (_, text) => {
		const doc = ok(text);
		expect(boxes(doc)).toEqual([]);
		expect(doc.rawBlocks.some((r) => /^\s*box G/.test(r.rawText))).toBe(true);
		expect(serialize(doc)).toBe(text);
	});

	it('zweite Gruppe mit demselben Teilnehmer bleibt RawBlock', () => {
		const text = 'sequenceDiagram\nbox G\nparticipant A\nend\nbox H\nparticipant A\nend\n';
		const doc = ok(text);
		expect(boxes(doc).map((b) => b.label)).toEqual(['G']);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual(['box H\nparticipant A\nend\n']);
	});

	it('leere Gruppe und spätere Deklaration mit Alias außerhalb', async () => {
		const text = 'sequenceDiagram\nbox G\nend\nbox H\nparticipant A\nend\nparticipant A as Al\n';
		const doc = ok(text);
		expect(boxes(doc).map((b) => b.sections[0].memberIds)).toEqual([[], ['A']]);
		expect((await mermaidBoxes(text)).map((b) => b.actorKeys)).toEqual([[], ['A']]);
		expect(serialize(doc)).toBe(text);
	});
});

describe('box kanonisch schreiben (T135 C2)', () => {
	const base = () => ok('sequenceDiagram\n    A->>B: x\n');
	const withBox = (color: string, label: string, props: Record<string, unknown> = {}) => {
		const box: Container = {
			id: 'c1',
			kind: 'box',
			label,
			direction: '',
			parentId: null,
			sections: [{ label, memberIds: [] }],
			props: { color, ...props },
			sourceText: ''
		};
		let doc = addContainer(base(), box);
		doc = { ...doc, order: ['c1', ...doc.order.filter((id) => id !== 'c1')] };
		return addNode(
			doc,
			{
				id: 'Z',
				kind: 'participant',
				label: 'Z',
				shape: 'participant',
				cssClasses: [],
				style: {},
				props: {},
				parentId: 'c1',
				sourceText: ''
			},
			0
		);
	};

	it.each([
		['', '', 'box'],
		['lightblue', '', 'box lightblue'],
		['', 'Red team', 'box transparent Red team'],
		['Aqua', 'G; #1 50%', 'box Aqua G#59; #35;1 50#37;'],
		['rgb(1, 2, 3)', 'T (x)', 'box rgb(1, 2, 3) T #40;x#41;'],
		['', 'wrap: x', 'box transparent wrap#58; x']
	])('Farbe %j, Titel %j -> %j, mermaid liest dasselbe', async (color, label, head) => {
		const doc = withBox(color, label);
		const text = serialize(doc);
		expect(text).toBe(
			`sequenceDiagram\n    ${head}\n        participant Z\n    end\n    A->>B: x\n`
		);
		const [m] = await mermaidBoxes(text);
		expect(m.fill).toBe(color || 'transparent');
		expect(m.name ?? '').toBe(label);
		expect(m.actorKeys).toEqual(['Z']);
		const [again] = boxes(ok(text));
		expect([again.props.color || 'transparent', again.label]).toEqual([
			color || 'transparent',
			label
		]);
	});

	it('Umbruch-Schalter wird geschrieben', async () => {
		const text = serialize(withBox('red', 'T', { wrap: true }));
		expect(text).toContain('    box red wrap:T\n');
		expect((await mermaidBoxes(text))[0]).toMatchObject({ fill: 'red', name: 'T', wrap: true });
	});
});

describe('isBoxColor (Allow-Liste, T135 C2)', () => {
	it.each([
		'transparent',
		'Aqua',
		'lightblue',
		'rgb(1,2,3)',
		'rgba(1, 2, 3, 0.5)',
		'hsl(10,20%,30%)'
	])('%j zulässig', (c) => expect(isBoxColor(c)).toBe(true));
	it.each(['', '#fff', 'url(x)', 'currentcolor', 'inherit', 'red;', 'red blue', 'expression(1)'])(
		'%j abgelehnt',
		(c) => expect(isBoxColor(c)).toBe(false)
	);
});

describe('Roundtrip-Fixture box (LF und CRLF)', () => {
	const lf = readFileSync(join(dir, 'box.mmd'), 'utf8');
	const crlf = readFileSync(join(dir, 'box-crlf.mmd'), 'utf8');

	it('Fixtures: LF ohne CR, CRLF durchgehend, sonst gleich', () => {
		expect(lf).not.toContain('\r');
		expect(crlf.split('\r\n').join('\n')).toBe(lf);
		expect(crlf.replace(/\r\n/g, '')).not.toContain('\n');
	});

	it.each([
		['LF', lf],
		['CRLF', crlf]
	])('%s: Gruppen als Container, byte-gleich, wie mermaid', async (_, text) => {
		const doc = ok(text);
		// Die Gruppe mit `currentcolor` bleibt RawBlock (Farbe hängt vom Browser ab).
		const m = (await mermaidBoxes(text)).filter((b) => b.fill !== 'currentcolor');
		expect(doc.rawBlocks.map((r) => r.rawText.trim().split(/\r?\n/)[0])).toEqual([
			'box currentcolor Rest'
		]);
		expect(boxes(doc).map((b) => [b.props.color || 'transparent', b.label])).toEqual(
			m.map((b) => [b.fill, b.name ?? ''])
		);
		expect(
			boxes(doc).map((b) => b.sections[0].memberIds.filter((id) => !id.startsWith('n')))
		).toEqual(m.map((b) => b.actorKeys));
		expect(serialize(doc)).toBe(text);
		expect(serialize(ok(serialize(doc)))).toBe(text);
	});
});
