import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import {
	addContainer,
	addEdge,
	addNode,
	removeEdge,
	removeNode,
	updateContainer,
	updateEdge,
	updateNode
} from '../../../../../src/lib/model/operations';
import type { DiagramDocument, DiagramEdge, DiagramNode } from '../../../../../src/lib/model/types';

const dir = join(__dirname, '../../../../fixtures/flowchart/roundtrip');
const files = readdirSync(dir).filter((f) => f.endsWith('.mmd'));
const fixture = (name: string) => readFileSync(join(dir, name), 'utf8');

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

/** Semantik-Abbild: Knoten, Kanten (ohne generierte IDs), Container. */
function semantics(doc: DiagramDocument) {
	return {
		nodes: doc.nodes
			.map((n) => [
				n.id,
				n.label,
				n.shape,
				n.parentId,
				[...n.cssClasses].sort(),
				n.style,
				n.props.click ?? null
			])
			.sort(),
		edges: doc.edges.map((e) => [
			e.sourceId,
			e.targetId,
			e.label,
			e.lineStyle,
			e.arrowHead,
			e.style
		]),
		containers: doc.containers.map((c) => [c.id, c.label, c.direction, c.parentId]).sort(),
		classDefs: doc.classDefs.map((c) => [c.name, c.style])
	};
}

const reparse = (doc: DiagramDocument) => parseOk(serialize(doc));

const newNode = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({
	id,
	kind: 'node',
	label: id,
	shape: 'default',
	cssClasses: [],
	style: {},
	props: {},
	parentId: null,
	sourceText: '',
	...extra
});

const newEdge = (
	id: string,
	sourceId: string,
	targetId: string,
	extra: Partial<DiagramEdge> = {}
): DiagramEdge => ({
	id,
	kind: 'edge',
	sourceId,
	targetId,
	label: '',
	lineStyle: 'solid',
	arrowHead: 'arrow',
	style: {},
	props: {},
	parentId: null,
	sourceText: '',
	...extra
});

describe('Fixtures', () => {
	it('decken LF, CRLF, fehlendes Zeilenende ab und sind in .md einbettbar', () => {
		const texts = files.map(fixture);
		expect(files.length).toBeGreaterThanOrEqual(6);
		expect(texts.some((t) => t.includes('\r\n'))).toBe(true);
		expect(texts.some((t) => !t.includes('\r\n') && t.endsWith('\n'))).toBe(true);
		expect(texts.some((t) => !t.endsWith('\n'))).toBe(true);
		for (const t of texts) expect(t).not.toMatch(/^\s*(```|~~~\s*$)/m);
	});

	it.each(files)('%s: parse -> serialize byte-gleich', (file) => {
		const text = fixture(file);
		expect(serialize(parseOk(text))).toBe(text);
	});
});

describe('Serializer: geänderte Elemente', () => {
	it('schreibt eigenständigen Knoten kanonisch an seiner Stelle', () => {
		const doc = parseOk('flowchart LR\n  A[Alt]\n  A --> B\n');
		const out = serialize(updateNode(doc, 'A', { label: 'Neu "x"', shape: 'round' }));
		expect(out).toBe('flowchart LR\n  A("Neu #quot;x#quot;")\n  A --> B\n');
	});

	it('schreibt Inline-Knoten neu, ohne andere Anweisungen anzufassen', () => {
		const text = fixture('01-basic.mmd');
		const doc = updateNode(parseOk(text), 'A', { label: 'Begin' });
		const out = serialize(doc);
		expect(out).toContain('    B -->|ja| C(Weiter)\n');
		// T111 C2 (V-12): Kettenzeile in place statt `A[Begin]` + `A --> B`.
		expect(out).toBe(text.replace('A[Start]', 'A[Begin]'));
		expect(semantics(reparse(doc))).toEqual(semantics(doc));
	});

	it('übernimmt Labels unverändert und quotet Sonderzeichen, ohne HTML zu deuten', () => {
		const doc = updateNode(parseOk('flowchart TD\nA\n'), 'A', {
			label: '<b>fett</b> [x]',
			shape: 'square'
		});
		expect(serialize(doc)).toBe('flowchart TD\nA["<b>fett</b> [x]"]\n');
		expect(reparse(doc).nodes[0].label).toBe('<b>fett</b> [x]');
	});

	it('hängt neue Knoten ans Ende ihres Containers und behält das Zeilenende bei', () => {
		const text = 'flowchart TB\r\n  subgraph s1 [Eins]\r\n    a\r\n  end\r\n  b\r\n';
		let doc = parseOk(text);
		doc = addNode(doc, newNode('n1', { parentId: 's1', label: 'Neu', shape: 'circle' }));
		doc = addNode(doc, newNode('n2'));
		expect(serialize(doc)).toBe(
			'flowchart TB\r\n  subgraph s1 [Eins]\r\n    a\r\n    n1((Neu))\r\n  end\r\n  b\r\n  n2\r\n'
		);
	});

	it('schreibt Klassen, Style und click geänderter Knoten mit', () => {
		const doc = parseOk(fixture('05-styles.mmd'));
		const changed = updateNode(doc, 'B', { label: 'Sehr gut' });
		const out = serialize(changed);
		// T111 C2 (V-12): nur das Knoten-Token ändert sich; class/click-Zeilen bleiben stehen.
		expect(out).toBe(fixture('05-styles.mmd').replace('B[Gut]', 'B[Sehr gut]'));
		expect(semantics(reparse(changed))).toEqual(semantics(changed));
	});

	it('löscht style-Zeilen gelöschter Knoten', () => {
		const doc = removeNode(parseOk(fixture('05-styles.mmd')), 'C', 'cascade');
		const out = serialize(doc);
		expect(out).not.toMatch(/\bC\b/);
		expect(semantics(reparse(doc)).nodes).toEqual(semantics(doc).nodes);
	});
});

describe('Serializer: Kanten und linkStyle', () => {
	it('baut linkStyle aus DiagramEdge.style mit neuen Indizes neu auf', () => {
		const doc = parseOk(fixture('05-styles.mmd'));
		const [e0, e1] = doc.edges;
		const out = serialize(updateEdge(removeEdge(doc, e0.id), e1.id, { style: { stroke: '#0f0' } }));
		expect(out).not.toContain('linkStyle 2');
		expect(out).toContain('    linkStyle 0 stroke:#0f0\n');
		expect(out).toContain('    linkStyle 1 stroke:#00f\n');
		expect(out).toContain(
			'    A[Alarm]\n    class A warn\n    click A "https://example.org" "Hilfe"\n'
		);
	});

	it('behält linkStyle-Zeilen, solange sich nichts verschiebt', () => {
		const doc = parseOk(fixture('05-styles.mmd'));
		const out = serialize(
			addEdge(doc, newEdge('e99', 'A', 'C', { lineStyle: 'dotted', label: 'neu' }))
		);
		expect(out).toContain(
			'    linkStyle 0 stroke:#f00,stroke-width:2px\n    linkStyle 2 stroke:#00f\n'
		);
		expect(out.endsWith('    A -.->|neu| C\n')).toBe(true);
	});

	it('zerlegt geänderte Ketten in Einzelkanten', () => {
		const doc = parseOk('flowchart LR\nA --> B --> C\nA & B --> D\n');
		const [, second] = doc.edges;
		const changed = updateEdge(doc, second.id, {
			lineStyle: 'thick',
			arrowHead: 'none',
			label: 'a|b'
		});
		expect(serialize(changed)).toBe('flowchart LR\nA --> B\nB ===|"a|b"| C\nA & B --> D\n');
		expect(semantics(reparse(changed))).toEqual(semantics(changed));
	});

	it('schreibt alle Linien- und Spitzenarten kanonisch', () => {
		const heads = [
			'arrow',
			'none',
			'circle',
			'cross',
			'double_arrow',
			'double_circle',
			'double_cross'
		];
		let doc = parseOk('flowchart LR\nA\nB\n');
		let k = 0;
		for (const lineStyle of ['solid', 'dotted', 'thick'])
			for (const arrowHead of heads)
				doc = addEdge(
					doc,
					newEdge(`x${k++}`, 'A', 'B', { lineStyle, arrowHead, props: { length: 2 } })
				);
		doc = addEdge(doc, newEdge('inv', 'A', 'B', { lineStyle: 'invisible', arrowHead: 'none' }));
		doc = addEdge(doc, newEdge('id1', 'B', 'A', { props: { explicitId: true } }));
		const back = reparse(doc);
		expect(semantics(back)).toEqual(semantics(doc));
		expect(back.edges.map((e) => e.props.length ?? 1)).toEqual([...Array(21).fill(2), 1, 1]);
		expect(back.edges.at(-1)!.id).toBe('id1');
	});
});

describe('Serializer: Container, classDef, Richtung', () => {
	it('schreibt neue und geänderte Container kanonisch', () => {
		let doc = parseOk(fixture('04-init-subgraphs.mmd'));
		doc = updateContainer(doc, 'innen', { label: 'Innen neu', direction: 'BT' });
		doc = addContainer(doc, {
			id: 'neu',
			kind: 'subgraph',
			label: 'neu',
			direction: '',
			parentId: 'aussen',
			sections: [{ label: '', memberIds: [] }],
			props: {},
			sourceText: ''
		});
		doc = addNode(doc, newNode('z', { parentId: 'neu' }));
		const out = serialize(doc);
		expect(out).toContain(
			'    subgraph innen [Innen neu]\n      direction BT\n      b1[Innen 1]\n'
		);
		expect(out).toContain('    subgraph neu\n      z\n    end\n  end\n');
		expect(out).toContain('    direction LR\n');
		expect(semantics(reparse(doc))).toEqual(semantics(doc));
	});

	it('behält Kopfzeile und Richtung bei reiner Mitglieder-Änderung', () => {
		const doc = addNode(
			parseOk(fixture('04-init-subgraphs.mmd')),
			newNode('q', { parentId: 'aussen' })
		);
		const out = serialize(doc);
		expect(out).toContain('  subgraph aussen [Außen]\n    direction LR\n');
		expect(out).toContain('    a2 --> b1\n    q\n  end\n');
	});

	it('schreibt geänderte und neue classDefs kanonisch', () => {
		const doc = parseOk(fixture('05-styles.mmd'));
		doc.classDefs[0] = { name: 'warn', style: { fill: '#000' }, sourceText: '' };
		doc.classDefs.push({
			name: 'neu',
			style: { color: 'red', 'font-weight': 'bold' },
			sourceText: ''
		});
		const out = serialize(doc);
		expect(
			out.startsWith('flowchart LR\n    classDef warn fill:#000\n    classDef ok fill:#9f6\n')
		).toBe(true);
		expect(out.endsWith('    classDef neu color:red,font-weight:bold\n')).toBe(true);
	});

	it('trennt an ein fehlendes Zeilenende angehängte Elemente', () => {
		const doc = addNode(parseOk(fixture('06-unknown-no-eol.mmd')), newNode('Z'));
		expect(serialize(doc).endsWith('\tC --> D\n\tZ\n')).toBe(true);
	});
});
