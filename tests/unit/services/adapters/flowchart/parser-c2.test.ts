import { describe, expect, it } from 'vitest';
import { flowchartAdapter } from '../../../../../src/lib/services/adapters/flowchart';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const node = (doc: DiagramDocument, id: string) => doc.nodes.find((n) => n.id === id)!;
const box = (doc: DiagramDocument, id: string) => doc.containers.find((c) => c.id === id)!;

describe('flowchart parser: Subgraphen', () => {
	const text = [
		'flowchart TB',
		'  subgraph outer [Außen]',
		'    direction LR',
		'    A --> B',
		'    subgraph inner',
		'      C',
		'    end',
		'  end',
		'  subgraph "Mit Leerzeichen"',
		'    D',
		'  end',
		'  subgraph x y z',
		'    E',
		'  end',
		''
	].join('\n');

	it('liest verschachtelte Subgraphen mit ID, Label und Richtung', () => {
		const doc = parseOk(text);
		expect(doc.containers.map((c) => [c.id, c.label, c.parentId, c.direction])).toEqual([
			['outer', 'Außen', null, 'LR'],
			['inner', 'inner', 'outer', ''],
			['subGraph2', 'Mit Leerzeichen', null, ''],
			['subGraph3', 'x y z', null, '']
		]);
		expect(doc.order).toEqual([doc.rawBlocks[0].id, 'outer', 'subGraph2', 'subGraph3']);
		const outer = box(doc, 'outer');
		expect(outer.sourceText).toBe('  subgraph outer [Außen]\n');
		expect(outer.props.endText).toBe('  end\n');
		expect(outer.props.dirText).toBe('    direction LR\n');
		expect(outer.props.dirIndex).toBe(0);
		expect(outer.sections[0].memberIds).toEqual([doc.edges[0].id, 'inner']);
		expect(box(doc, 'inner').sections[0].memberIds).toEqual(['C']);
		expect(node(doc, 'A').parentId).toBe('outer');
		expect(node(doc, 'C').parentId).toBe('inner');
		expect(doc.edges[0].parentId).toBe('outer');
	});

	it('meldet nicht geschlossene Subgraphen; überzähliges end und direction oben werden RawBlock', () => {
		const open = flowchartAdapter.parse('flowchart TB\nsubgraph a\nA\n');
		expect(open).toEqual({ ok: false, errors: [expect.objectContaining({ line: 2 })] });
		const doc = parseOk('flowchart TB\nend\ndirection LR\n');
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([
			'flowchart TB\n',
			'end\n',
			'direction LR\n'
		]);
	});
});

describe('flowchart parser: Klassen, Styles, linkStyle, click', () => {
	const text = [
		'flowchart LR',
		'  classDef warn fill:#f96,stroke:rgb(1,2,3)',
		'  classDef a,b color:red',
		'  A:::warn --> B',
		'  class A,B big',
		'  style B fill:#00f,stroke-width:2px',
		'  linkStyle 0 stroke:#f00',
		'  linkStyle default stroke:#999',
		'  click A "https://example.org" "Tipp"',
		'  click B call cb()',
		'  class X ghost',
		''
	].join('\n');

	it('legt classDef mit order-Schlüssel classDef:<name> ab, Mehrfach-Namen als RawBlock', () => {
		const doc = parseOk(text);
		expect(doc.classDefs).toEqual([
			{
				name: 'warn',
				style: { fill: '#f96', stroke: 'rgb(1,2,3)' },
				sourceText: '  classDef warn fill:#f96,stroke:rgb(1,2,3)\n'
			}
		]);
		expect(doc.order).toContain('classDef:warn');
		expect(doc.rawBlocks.map((r) => r.rawText)).toContain('  classDef a,b color:red\n');
	});

	it('wendet class, :::, style, linkStyle und click auf Modell-Eigenschaften an', () => {
		const doc = parseOk(text);
		expect(node(doc, 'A').cssClasses).toEqual(['warn', 'big']);
		expect(node(doc, 'B').cssClasses).toEqual(['big']);
		expect(node(doc, 'B').style).toEqual({ fill: '#00f', 'stroke-width': '2px' });
		expect(doc.edges[0].style).toEqual({ stroke: '#f00' });
		expect(node(doc, 'A').props.click).toBe('click A "https://example.org" "Tipp"');
		expect(node(doc, 'B').props.click).toBe('click B call cb()');
		expect(doc.nodes.map((n) => n.id)).toEqual(['A', 'B']);
	});

	it('hält die Anweisungen selbst als RawBlock in order (byte-gleich)', () => {
		const doc = parseOk(text);
		const raws = doc.rawBlocks.map((r) => r.rawText);
		for (const line of text.split('\n').slice(4, 11)) expect(raws).toContain(`${line}\n`);
	});
});

describe('flowchart parser: Unbekanntes als RawBlock', () => {
	it('übernimmt unbekannte Syntax unverändert', () => {
		const lines = [
			'accTitle: Titel',
			'A@{ shape: rect }',
			'e1@{ animate: true }',
			'A --> B %% Kommentar',
			'foo bar',
			'subgraph'
		];
		const doc = parseOk(`flowchart LR\n${lines.join('\n')}`);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([
			'flowchart LR\n',
			...lines.slice(0, -1).map((l) => `${l}\n`),
			'subgraph'
		]);
		expect(doc.edges).toHaveLength(0);
	});
});
