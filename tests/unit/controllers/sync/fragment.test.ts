// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fragmentText, readFragment } from '../../../../src/lib/controllers/sync/fragment';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { MAX_FILE_BYTES } from '../../../../src/lib/services/file';
import { BAD, fakeAdapters } from './helpers';

const SOURCE = [
	'---',
	'title: Quelle',
	'---',
	'%%{init: {"theme": "dark"}}%%',
	'flowchart LR',
	'  A[Start]:::hot --> B{Frage}',
	'  B -->|ja| C',
	'  B -.-> D',
	'  subgraph S1 [Box]',
	'    D --> A',
	'  end',
	'  classDef hot fill:#f00',
	'  classDef cold fill:#00f',
	'  style C fill:#0f0',
	'  %% Kommentar',
	''
].join('\n');

function parsed(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error('parse');
	return result.doc;
}

const withPositions = (doc: DiagramDocument): DiagramDocument => ({
	...doc,
	layout: {
		...doc.layout,
		mode: 'manual',
		positions: { A: [10, 20, 0, 0], B: [110, 20, 0, 0], C: [210, 20, 0, 0], D: [0, 90, 0, 0] }
	}
});

const ids = (list: readonly { id: string }[]) => list.map((el) => el.id);
const read = (text: string) => readFragment(text, fakeAdapters);

describe('Fragment serialisieren (T133 C1)', () => {
	it('enthält ausgewählte Knoten und nur innere Kanten', () => {
		const text = fragmentText(parsed(SOURCE), ['A', 'B', 'C']);
		expect(text).not.toBeNull();
		const doc = parsed(text!);
		expect(ids(doc.nodes).sort()).toEqual(['A', 'B', 'C']);
		expect(doc.edges.map((e) => [e.sourceId, e.targetId])).toEqual([
			['A', 'B'],
			['B', 'C']
		]);
		expect(doc.edges[1].label).toBe('ja');
	});

	it('übernimmt Form, Label, Stil und nur die benötigten Klassen', () => {
		const doc = parsed(fragmentText(parsed(SOURCE), ['A', 'B', 'C'])!);
		const node = (id: string) => doc.nodes.find((n) => n.id === id)!;
		expect(node('A')).toMatchObject({ label: 'Start', shape: 'square', cssClasses: ['hot'] });
		expect(node('B')).toMatchObject({ label: 'Frage', shape: 'diamond' });
		expect(node('C').style).toEqual({ fill: '#0f0' });
		expect(doc.classDefs.map((c) => [c.name, c.style])).toEqual([['hot', { fill: '#f00' }]]);
	});

	it('ohne Frontmatter, Direktiven, Kommentare und Container, Richtung bleibt', () => {
		const text = fragmentText(parsed(SOURCE), ['A', 'D'])!;
		expect(text.startsWith('flowchart LR\n')).toBe(true);
		expect(text).not.toMatch(/---|%%\{|Kommentar|subgraph|end\b/);
		const doc = parsed(text);
		expect(doc.containers).toEqual([]);
		expect(doc.nodes.every((n) => n.parentId === null)).toBe(true);
		expect(doc.edges.map((e) => [e.sourceId, e.targetId])).toEqual([['D', 'A']]);
	});

	it('ohne Richtung im Quelltext entsteht eine gültige Kopfzeile', () => {
		const text = fragmentText(parsed('flowchart\n  A --> B\n'), ['A'])!;
		expect(text.split('\n')[0]).toBe('flowchart');
		expect(ids(parsed(text).nodes)).toEqual(['A']);
	});

	it('Positionen der Auswahl stehen in der Metadaten-Zeile, andere nicht', async () => {
		const text = fragmentText(withPositions(parsed(SOURCE)), ['A', 'B'])!;
		expect(text).toMatch(/@mermuid/);
		const result = await read(text);
		expect(result.ok && result.fragment.positions).toEqual({
			A: [10, 20, 0, 0],
			B: [110, 20, 0, 0]
		});
	});

	it('ohne Knoten in der Auswahl oder außerhalb flowchart: null', () => {
		const doc = parsed(SOURCE);
		expect(fragmentText(doc, [])).toBeNull();
		expect(fragmentText(doc, ['S1', 'e1', 'X'])).toBeNull();
		expect(fragmentText({ ...doc, diagramType: 'sequence' }, ['A'])).toBeNull();
	});

	it('linkStyle folgt der neuen Kantenfolge', () => {
		const source = 'flowchart LR\n  A --> B\n  B --> C\n  C --> D\n  linkStyle 2 stroke:#f00\n';
		const text = fragmentText(parsed(source), ['C', 'D'])!;
		expect(text).toMatch(/linkStyle 0 stroke:#f00/);
		expect(parsed(text).edges.map((e) => e.style)).toEqual([{ stroke: '#f00' }]);
		const other = parsed(fragmentText(parsed(source), ['A', 'B'])!);
		expect(other.edges.map((e) => e.style)).toEqual([{}]);
	});

	it('explizite Kanten-ID bleibt erhalten', () => {
		const doc = parsed(fragmentText(parsed('flowchart LR\n  A e1@--> B\n'), ['A', 'B'])!);
		expect(doc.edges.map((e) => [e.id, e.props.explicitId])).toEqual([['e1', true]]);
	});

	it('Labels mit |, #quot; und <br/> überstehen die Kopie', () => {
		const source = [
			'flowchart LR',
			'  A["a | b"] -->|"x | y"| B["sag #quot;hi#quot;"]',
			'  B --> C["eins<br/>zwei"]',
			''
		].join('\n');
		const doc = parsed(source);
		const copy = parsed(fragmentText(doc, ['A', 'B', 'C'])!);
		expect(copy.nodes.map((n) => n.label)).toEqual(doc.nodes.map((n) => n.label));
		expect(copy.edges.map((e) => e.label)).toEqual(doc.edges.map((e) => e.label));
	});

	it('click-Anweisung bleibt am Knoten', () => {
		const source = 'flowchart LR\n  A --> B\n  click A "https://example.com"\n';
		const text = fragmentText(parsed(source), ['A'])!;
		expect(text).toMatch(/click A "https:\/\/example.com"/);
		expect(parsed(text).nodes[0].props.click).toBe('click A "https://example.com"');
	});

	it('ignoriert unbekannte IDs in der Auswahl', () => {
		const doc = parsed(fragmentText(parsed(SOURCE), ['A', 'X', 'S1'])!);
		expect(ids(doc.nodes)).toEqual(['A']);
	});
});

describe('Fremd-Text lesen (T133 C1)', () => {
	it('liest gültigen flowchart-Text als Fragment-Modell', async () => {
		const result = await read(SOURCE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { fragment } = result;
		expect(ids(fragment.nodes)).toEqual(['A', 'B', 'C', 'D']);
		expect(fragment.edges).toHaveLength(4);
		expect(fragment.classDefs.map((c) => c.name)).toEqual(['hot']);
		expect(fragment.positions).toEqual({});
		expect(result.dropped).toBe(1);
	});

	it('zählt verworfene Container und nicht unterstützte Anweisungen, Kopfzeile nicht', async () => {
		const plain = await read('%%{init: {}}%%\nflowchart LR\n\n  A --> B\n  style A fill:#f00\n');
		expect(plain).toMatchObject({ ok: true, dropped: 0 });
		const text = 'flowchart LR\n  A --> B\n  accTitle: Titel\n  classDef x,y fill:#f00\n';
		expect(await read(text)).toMatchObject({ ok: true, dropped: 2 });
	});

	it('nur Verworfenes ist nicht leer, sondern nicht unterstützt', async () => {
		const texts = [
			'flowchart LR\n  accTitle: Titel\n',
			'flowchart LR\n  subgraph S\n  end\n',
			'flowchart LR\n  A["offen --> B\n'
		];
		for (const text of texts)
			expect(await read(text)).toMatchObject({ ok: false, reason: 'unsupported' });
	});

	it('Knoten mit Container-ID entfällt samt Kanten und zählt als verworfen', async () => {
		const text = 'flowchart LR\n  subgraph S\n    A\n  end\n  S --> C\n  C --> A\n';
		const result = await read(text);
		if (!result.ok) throw new Error('ok erwartet');
		expect(ids(result.fragment.nodes)).toEqual(['A', 'C']);
		expect(result.fragment.edges.map((e) => [e.sourceId, e.targetId])).toEqual([['C', 'A']]);
		expect(result.dropped).toBe(3);
		expect(ids(parsed(fragmentText(parsed(text), ['S', 'C'])!).nodes)).toEqual(['C']);
	});

	it('Fragment-Elemente sind kanonisch und ohne Container-Bezug', async () => {
		const result = await read(SOURCE);
		if (!result.ok) throw new Error('ok erwartet');
		const { nodes, edges, classDefs } = result.fragment;
		for (const el of [...nodes, ...edges, ...classDefs]) expect(el.sourceText).toBe('');
		for (const el of [...nodes, ...edges]) expect(el.parentId).toBeNull();
		for (const n of nodes) expect(n.props).not.toHaveProperty('stmtText');
		for (const e of edges) expect(e.props).not.toHaveProperty('stmt');
	});

	it('Kopie und Lesen ergeben dieselben Knoten und Kanten', async () => {
		const doc = withPositions(parsed(SOURCE));
		const result = await read(fragmentText(doc, ['A', 'B', 'C', 'D'])!);
		if (!result.ok) throw new Error('ok erwartet');
		const pick = (n: DiagramDocument['nodes'][number]) => [n.id, n.label, n.shape, n.style];
		expect(result.fragment.nodes.map(pick)).toEqual(doc.nodes.map(pick));
		const edge = (e: DiagramDocument['edges'][number]) => [e.sourceId, e.targetId, e.lineStyle];
		expect(result.fragment.edges.map(edge)).toEqual(doc.edges.map(edge));
	});

	it('entfernt ein BOM wie beim Datei-Öffnen', async () => {
		const result = await read('﻿flowchart LR\n  A --> B\n');
		expect(result.ok && ids(result.fragment.nodes)).toEqual(['A', 'B']);
	});

	it('ungültiger Text (Validierung): Fehlerergebnis', async () => {
		const result = await read(`flowchart LR\n  A --> B\n  ${BAD}\n`);
		expect(result).toMatchObject({ ok: false, reason: 'invalid' });
		expect(!result.ok && result.errors.length).toBeGreaterThan(0);
	});

	it('Parser-Fehler: Fehlerergebnis', async () => {
		const result = await read('flowchart LR\n  subgraph S\n    A --> B\n');
		expect(result).toMatchObject({ ok: false, reason: 'invalid' });
		expect(!result.ok && result.errors.length).toBeGreaterThan(0);
	});

	it('kein flowchart (Prosa, sequence, leer): Fehlerergebnis', async () => {
		for (const text of ['Hallo Welt', 'sequenceDiagram\n  A->>B: x\n', '', '   \n']) {
			expect(await read(text)).toMatchObject({ ok: false, reason: 'not-flowchart' });
		}
	});

	it('flowchart ohne Knoten: Fehlerergebnis', async () => {
		expect(await read('flowchart LR\n')).toMatchObject({ ok: false, reason: 'empty' });
	});

	it('zu großer Text wie beim Datei-Öffnen abgelehnt', async () => {
		const text = `flowchart LR\n  A --> B\n%% ${'x'.repeat(MAX_FILE_BYTES)}\n`;
		expect(await read(text)).toMatchObject({ ok: false, reason: 'too-large' });
	});

	it('Frontmatter und Direktiven des Fremd-Texts gelangen nicht ins Fragment', async () => {
		const result = await read(SOURCE);
		if (!result.ok) throw new Error('ok erwartet');
		expect(JSON.stringify(result.fragment)).not.toMatch(/theme|Quelle|Kommentar/);
	});
});

describe('Fragment mit mermaid-Validierung (Standard-Adapter)', () => {
	it('Fragment-Text besteht den Prüfpfad des Datei-Öffnens', async () => {
		const text = fragmentText(withPositions(parsed(SOURCE)), ['A', 'B', 'C', 'D'])!;
		const result = await readFragment(text);
		expect(result.ok).toBe(true);
	});

	it('für mermaid ungültiger Text: Fehlerergebnis', async () => {
		const result = await readFragment('flowchart TD\n    A --> B\n    C -->\n');
		expect(result).toMatchObject({ ok: false, reason: 'invalid' });
	});
});
