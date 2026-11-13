import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import {
	addContainer,
	addNode,
	moveToContainer,
	reorder,
	updateNode
} from '../../../../../src/lib/model/operations';
import type { Container, DiagramDocument, DiagramNode } from '../../../../../src/lib/model/types';

// T111 C3: Subgraph-ID bei gespeicherter Position (V-13) und Nachträge aus dem C2-Review
// (O-97 (3), O-102 (2)-(5)).

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const edit = (text: string, id: string, patch: Partial<DiagramNode>) =>
	serialize(updateNode(parseOk(text), id, patch));

const nodeOf = (text: string, id: string) => {
	const n = parseOk(text).nodes.find((x) => x.id === id)!;
	return { label: n.label, shape: n.shape, style: n.style, parentId: n.parentId };
};

const boxes = (doc: DiagramDocument) =>
	doc.containers.map((c) => ({ id: c.id, label: c.label, members: c.sections[0].memberIds }));

const TWO = [
	'flowchart TD',
	'    subgraph Erste Gruppe',
	'        A',
	'    end',
	'    subgraph Zweite Gruppe',
	'        B',
	'    end',
	''
].join('\n');

describe('unbenannte Subgraphen (V-13)', () => {
	it('ohne gespeicherte Position bleibt der Text byte-gleich (keine ID geschrieben)', () => {
		const doc = parseOk(TWO);
		expect(doc.containers.map((c) => c.id)).toEqual(['subGraph0', 'subGraph1']);
		expect(serialize(doc)).toBe(TWO);
		// Positionen schlüsselt die Meta-Zeile nach ID; der Serializer liest sie nicht.
		const positions: DiagramDocument['layout']['positions'] = {
			A: [1, 2, 3, 4],
			subGraph1: [0, 0, 100, 50]
		};
		expect(serialize({ ...doc, layout: { ...doc.layout, positions } })).toBe(TWO);
	});

	it('Container mit Editor-ID: Serializer schreibt die ID explizit, Einfügen davor (Code) lässt sie stehen', () => {
		// Vorschlag SCOPE-BEDARF: beim Speichern eines Rahmens erhält der unbenannte Subgraph eine
		// Editor-ID (`c<N>`); diese liegt außerhalb des mermaid-Musters `subGraph<N>`.
		const doc = parseOk(TWO);
		const c = doc.containers[1];
		const renamed: DiagramDocument = {
			...doc,
			order: doc.order.map((id) => (id === c.id ? 'c9' : id)),
			containers: doc.containers.map((x) => (x === c ? { ...x, id: 'c9' } : x)),
			nodes: doc.nodes.map((n) => (n.parentId === c.id ? { ...n, parentId: 'c9' } : n))
		};
		const out = serialize(renamed);
		expect(out).toBe(TWO.replace('subgraph Zweite Gruppe', 'subgraph c9 [Zweite Gruppe]'));
		const typed = out.replace(
			'    subgraph c9',
			'    subgraph Dritte Gruppe\n        C\n    end\n    subgraph c9'
		);
		expect(boxes(parseOk(typed))).toEqual([
			{ id: 'subGraph0', label: 'Erste Gruppe', members: ['A'] },
			{ id: 'subGraph1', label: 'Dritte Gruppe', members: ['C'] },
			{ id: 'c9', label: 'Zweite Gruppe', members: ['B'] }
		]);
	});

	it('Einfügen davor (Grafik) behält die IDs vorhandener unbenannter Subgraphen', () => {
		const doc = parseOk(TWO);
		const box: Container = {
			id: 'c99',
			kind: 'subgraph',
			label: 'Dritte',
			direction: '',
			parentId: null,
			sections: [{ label: '', memberIds: [] }],
			props: {},
			sourceText: ''
		};
		const next = reorder(addContainer(doc, box), 'c99', doc.order.indexOf('subGraph1'));
		expect(boxes(parseOk(serialize(next))).map((b) => [b.id, b.label])).toEqual([
			['subGraph0', 'Erste Gruppe'],
			['c99', 'Dritte'],
			['subGraph1', 'Zweite Gruppe']
		]);
	});
});

describe('Nachträge C2 (O-102, O-97)', () => {
	it('O-102 (2): verschobener Knoten mit Label-Änderung erhält den Einzug des Ziel-Containers', () => {
		const text = 'flowchart TD\n    A[x]\n    subgraph S\n        B\n    end\n';
		const doc = updateNode(moveToContainer(parseOk(text), 'A', 'S'), 'A', { label: 'Neu' });
		const out = serialize(doc);
		expect(out).toBe('flowchart TD\n    subgraph S\n        B\n        A[Neu]\n    end\n');
		expect(nodeOf(out, 'A')).toMatchObject({ label: 'Neu', parentId: 'S' });
	});

	it('O-102 (2): Verschieben aus dem Container heraus, auch ohne Label-Änderung', () => {
		const text = 'flowchart TD\n    subgraph S\n        B\n        A[x]\n    end\n';
		const out = serialize(moveToContainer(parseOk(text), 'A', null));
		expect(out).toBe('flowchart TD\n    subgraph S\n        B\n    end\n    A[x]\n');
		expect(nodeOf(out, 'A')).toMatchObject({ label: 'x', parentId: null });
	});

	it('O-102 (2): Label-Änderung ohne Container-Wechsel bleibt in place', () => {
		const text = 'flowchart TD\n    subgraph S\n          A[x]\n    end\n';
		expect(edit(text, 'A', { label: 'y' })).toBe(text.replace('A[x]', 'A[y]'));
	});

	it('O-102 (3): kopierter Knoten mit `props.stmtText` des Originals', () => {
		const doc = parseOk('flowchart TD\n    A[x]\n');
		const a = doc.nodes[0];
		const copy = addNode(doc, { ...a, id: 'n1', sourceText: '' });
		const out = serialize(copy);
		expect(out).toBe('flowchart TD\n    A[x]\n    n1[x]\n');
		const edited = serialize(updateNode(copy, 'A', { label: 'y' }));
		expect(edited).toBe('flowchart TD\n    A[y]\n    n1[x]\n');
	});

	it('O-102 (4): Formänderung an mehrzeiligem Label mit `%%` tauscht nur die Klammern (Einzelzeile)', () => {
		const text = 'flowchart TD\n    A["x\n%% c\ny"]\n';
		const out = edit(text, 'A', { shape: 'round' });
		expect(out).toBe('flowchart TD\n    A("x\n%% c\ny")\n');
		expect(nodeOf(out, 'A')).toMatchObject({ shape: 'round', label: 'x\ny' });
	});

	it('O-102 (4): Formänderung an mehrzeiligem Label mit `%%` tauscht nur die Klammern (Kettenzeile)', () => {
		const text = 'flowchart TD\n    A["x\n%% c\ny"] --> B\n';
		const out = edit(text, 'A', { shape: 'diamond' });
		expect(out).toBe('flowchart TD\n    A{"x\n%% c\ny"} --> B\n');
		expect(nodeOf(out, 'A')).toMatchObject({ shape: 'diamond', label: 'x\ny' });
	});

	it('O-102 (4): Formänderung tauscht die Klammern jeder Nennung mit Form (O-106 (1))', () => {
		const text = 'flowchart TD\n    A["x\n%% c\ny"] --> B & A["x\n%% c\ny"]\n';
		const out = edit(text, 'A', { shape: 'round' });
		expect(out).toBe('flowchart TD\n    A("x\n%% c\ny") --> B & A("x\n%% c\ny")\n');
		expect(nodeOf(out, 'A')).toMatchObject({ shape: 'round', label: 'x\ny' });
	});

	it('O-102 (4): Klammertausch, der das Label bräche, schreibt das Token neu', () => {
		const text = 'flowchart TD\n    A[x)y]\n';
		const out = edit(text, 'A', { shape: 'round' });
		expect(out).toBe('flowchart TD\n    A("x)y")\n');
		expect(nodeOf(out, 'A')).toMatchObject({ shape: 'round', label: 'x)y' });
		const chain = edit('flowchart TD\n    A[x)y] --> B\n', 'A', { shape: 'round' });
		expect(chain).toBe('flowchart TD\n    A("x)y") --> B\n');
	});

	it('O-102 (4): Label- und Formänderung zusammen ersetzen das ganze Token', () => {
		const text = 'flowchart TD\n    A["x\n%% c\ny"]\n';
		expect(edit(text, 'A', { shape: 'round', label: 'z' })).toBe('flowchart TD\n    A(z)\n');
	});

	it('O-102 (5): Dokument ohne Schluss-Zeilenende mit `;`: angehängte Zeile in eigener Zeile', () => {
		const single = edit('flowchart TD\n    A[x];', 'A', { style: { fill: '#f00' } });
		expect(single).toBe('flowchart TD\n    A[x];\n    style A fill:#f00\n');
		const chain = edit('flowchart TD\n    A[x] --> B;', 'A', { style: { fill: '#f00' } });
		expect(chain).toBe('flowchart TD\n    A[x] --> B;\n    style A fill:#f00\n');
		expect(nodeOf(chain, 'A').style).toEqual({ fill: '#f00' });
	});

	it('O-97 (3): Subgraph-Mitglied außerhalb definiert - Label-Änderung ändert nur das Token', () => {
		const text = 'flowchart TD\n    A[x] --> B\n    subgraph S\n        A\n    end\n';
		const out = edit(text, 'A', { label: 'y' });
		expect(out).toBe(text.replace('A[x]', 'A[y]'));
		expect(nodeOf(out, 'A')).toMatchObject({ label: 'y', parentId: 'S' });
	});
});
