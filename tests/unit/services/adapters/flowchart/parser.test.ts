import { describe, expect, it } from 'vitest';
import { flowchartAdapter, getDirection } from '../../../../../src/lib/services/adapters/flowchart';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const node = (doc: DiagramDocument, id: string) => doc.nodes.find((n) => n.id === id)!;

describe('flowchart parser: Header', () => {
	it('liest flowchart/graph mit Richtung', () => {
		expect(flowchartAdapter.type).toBe('flowchart');
		expect(getDirection(parseOk('flowchart LR\nA\n'))).toBe('LR');
		expect(getDirection(parseOk('graph TD\nA'))).toBe('TD');
		expect(getDirection(parseOk('graph\nA'))).toBe('');
		expect(parseOk('flowchart LR\n').diagramType).toBe('flowchart');
	});

	it('übernimmt Frontmatter und führende init-Direktiven unverändert', () => {
		const text = '---\ntitle: "Mein Titel"\n---\n%%{init: {"theme": "dark"}}%%\nflowchart TB\nA\n';
		const doc = parseOk(text);
		expect(doc.header.frontmatter).toBe('---\ntitle: "Mein Titel"\n---\n');
		expect(doc.header.directives).toEqual(['%%{init: {"theme": "dark"}}%%\n']);
		expect(doc.title).toBe('Mein Titel');
	});

	it('meldet fehlende Deklaration und offenes Frontmatter mit Zeile', () => {
		const a = flowchartAdapter.parse('%% nur Kommentar\nsequenceDiagram\n');
		expect(a).toEqual({ ok: false, errors: [expect.objectContaining({ line: 2, column: 1 })] });
		const b = flowchartAdapter.parse('---\ntitle: x\nflowchart LR\n');
		expect(b.ok).toBe(false);
		expect(flowchartAdapter.parse('').ok).toBe(false);
	});
});

describe('flowchart parser: Knoten und Formen', () => {
	it('erkennt alle Formen mit Label', () => {
		const shapes: [string, string, string][] = [
			['A[a]', 'square', 'a'],
			['A(a)', 'round', 'a'],
			['A([a])', 'stadium', 'a'],
			['A[[a]]', 'subroutine', 'a'],
			['A[(a)]', 'cylinder', 'a'],
			['A((a))', 'circle', 'a'],
			['A(((a)))', 'doublecircle', 'a'],
			['A>a]', 'odd', 'a'],
			['A{a}', 'diamond', 'a'],
			['A{{a}}', 'hexagon', 'a'],
			['A[/a/]', 'lean_right', 'a'],
			['A[\\a\\]', 'lean_left', 'a'],
			['A[/a\\]', 'trapezoid', 'a'],
			['A[\\a/]', 'inv_trapezoid', 'a'],
			['A', 'default', 'A'],
			['A["x; <b>y</b>"]', 'square', 'x; <b>y</b>']
		];
		for (const [src, shape, label] of shapes) {
			const doc = parseOk(`flowchart TD\n${src}\n`);
			expect([src, node(doc, 'A').shape, node(doc, 'A').label]).toEqual([src, shape, label]);
			expect(doc.order).toContain('A');
		}
	});

	it('übernimmt :::Klassen und erkennt IDs mit Punkt/Bindestrich', () => {
		const doc = parseOk('graph TD\nmy-node.x[Text]:::warn:::big\n');
		expect(node(doc, 'my-node.x').cssClasses).toEqual(['warn', 'big']);
		expect(node(doc, 'my-node.x').sourceText).toBe('my-node.x[Text]:::warn:::big\n');
	});
});

describe('flowchart parser: Kanten', () => {
	it('erkennt Linien, Spitzen, Längen und Labels', () => {
		const cases: [string, string, string, number, string][] = [
			['A-->B', 'solid', 'arrow', 1, ''],
			['A --- B', 'solid', 'none', 1, ''],
			['A ---> B', 'solid', 'arrow', 2, ''],
			['A -.-> B', 'dotted', 'arrow', 1, ''],
			['A -..-> B', 'dotted', 'arrow', 2, ''],
			['A ==> B', 'thick', 'arrow', 1, ''],
			['A === B', 'thick', 'none', 1, ''],
			['A ~~~ B', 'invisible', 'none', 1, ''],
			['A --o B', 'solid', 'circle', 1, ''],
			['A --x B', 'solid', 'cross', 1, ''],
			['A <--> B', 'solid', 'double_arrow', 1, ''],
			['A o--o B', 'solid', 'double_circle', 1, ''],
			['A -- text --> B', 'solid', 'arrow', 1, 'text'],
			['A -- "q" --- B', 'solid', 'none', 1, 'q'],
			['A == t ==> B', 'thick', 'arrow', 1, 't'],
			['A -. t .-> B', 'dotted', 'arrow', 1, 't'],
			['A -->|t| B', 'solid', 'arrow', 1, 't'],
			['A --x|"y"| B', 'solid', 'cross', 1, 'y']
		];
		for (const [src, lineStyle, arrowHead, length, label] of cases) {
			const doc = parseOk(`flowchart TD\n${src}\n`);
			const e = doc.edges[0];
			expect([
				src,
				e.sourceId,
				e.targetId,
				e.lineStyle,
				e.arrowHead,
				e.props.length ?? 1,
				e.label
			]).toEqual([src, 'A', 'B', lineStyle, arrowHead, length, label]);
		}
	});

	it('zerlegt Ketten und & in Einzelkanten einer Anweisung', () => {
		const doc = parseOk('flowchart LR\nA-->B-->C\nA & B --> C & D\n');
		expect(doc.edges.map((e) => `${e.sourceId}>${e.targetId}`)).toEqual([
			'A>B',
			'B>C',
			'A>C',
			'A>D',
			'B>C',
			'B>D'
		]);
		const [first, second] = doc.edges;
		expect(doc.order).toContain(first.id);
		expect(doc.order).toContain(second.id);
		expect(second.props.stmt).toBe(first.id);
		expect(second.sourceText).toBe('A-->B-->C\n');
		expect(doc.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D']);
	});

	it('übernimmt explizite Kanten-IDs, interne IDs kommen aus ids.ts', () => {
		const doc = parseOk('flowchart LR\nA e7@--> B\nB --> C\n');
		expect(doc.edges[0].id).toBe('e7');
		expect(doc.edges[0].props.explicitId).toBe(true);
		expect(doc.edges[1].id).toBe('e8');
		expect(doc.edges[1].props.explicitId).toBeUndefined();
	});

	it('nimmt Labels aus Kanten-Anweisungen in Knoten auf', () => {
		const doc = parseOk('flowchart LR\nA[Start] --> B{Frage?}\nB -->|ja| A\n');
		expect(node(doc, 'A').label).toBe('Start');
		expect(node(doc, 'B').shape).toBe('diamond');
		expect(doc.order).not.toContain('A');
	});

	it('trennt Anweisungen an ; außerhalb von Labels', () => {
		const doc = parseOk('graph TD;A-->B; B["x;y"]-->C;\n');
		expect(doc.edges).toHaveLength(2);
		expect(node(doc, 'B').label).toBe('x;y');
	});
});

describe('flowchart parser: Kommentare und Leerzeilen', () => {
	it('legt Kommentare als eigene Elemente in order ab', () => {
		const doc = parseOk('%% vorne\nflowchart TD\n  %% innen\n\nA\n%% @mermuid {"v":1}\n');
		expect(doc.comments.map((c) => c.text)).toEqual([
			'%% vorne\n',
			'  %% innen\n',
			'%% @mermuid {"v":1}\n'
		]);
		expect(doc.order[0]).toBe(doc.comments[0].id);
		expect(doc.rawBlocks.some((r) => r.rawText === '\n')).toBe(true);
	});
});
