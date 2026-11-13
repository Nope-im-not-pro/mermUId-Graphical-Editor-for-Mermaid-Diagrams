// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

// T138 C1 Iteration 2: Review-Befunde 1-5 (W31_T138_C1_I1_review).

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const node = (doc: DiagramDocument, id: string) => doc.nodes.find((n) => n.id === id)!;

async function vertex(text: string, id: string): Promise<{ text?: string; type?: string }> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as {
		getVertices(): Map<string, { text?: string; type?: string }>;
	};
	return db.getVertices().get(id)!;
}

describe('Befund 1: Mehrfach-Definition in eigenständigen Zeilen bleibt byte-gleich', () => {
	it.each([
		['A@{ shape: doc }\nA@{ shape: delay }', 'delay', 'A'],
		['A[Alt]\nA@{ shape: doc, label: "x" }', 'doc', 'x'],
		['A@{ shape: doc, label: "x" }\nA[Alt]', 'square', 'Alt'],
		['A@{ shape: doc }\nA[Alt]', 'square', 'Alt'],
		// Basis-Fall (Ursache vor C1): Klammer-Formen.
		['A(x)\nA[Alt]', 'square', 'Alt'],
		['A[x]\nA(Alt)', 'round', 'Alt'],
		// Kante nach der eigenständigen Zeile.
		['A(x)\nA[y] --> B', 'square', 'y']
	])('%j', async (body, shape, label) => {
		const text = `flowchart TD\n${body}\n`;
		const doc = parseOk(text);
		expect(node(doc, 'A')).toMatchObject({ shape, label });
		expect((await vertex(text, 'A')).text).toBe(label);
		expect(serialize(doc)).toBe(text);
	});

	it('Formänderung schreibt alle formgebenden Nennungen konsistent', () => {
		const doc = parseOk('flowchart TD\nA(x)\nA[Alt]\n');
		const out = serialize(updateNode(doc, 'A', { shape: 'doc' }));
		expect(node(parseOk(out), 'A')).toMatchObject({ shape: 'doc', label: 'Alt' });
	});
});

describe('Befund 2: @{} auf eine Subgraph-ID bleibt RawBlock', () => {
	it.each([
		'subgraph S\nX\nend\nS@{ shape: doc }',
		'subgraph S\nX\nend\nS@{ shape: doc, label: "L" }',
		'S@{ shape: doc }\nsubgraph S\nX\nend',
		'subgraph S\nX\nend\nS@{ shape: doc } --> X',
		'subgraph "Ohne ID"\nX\nend\nsubGraph0@{ shape: doc }'
	])('%j', async (body) => {
		const text = `flowchart TD\n${body}\n`;
		await mermaid.parse(text);
		const doc = parseOk(text);
		expect(doc.nodes.map((n) => n.id)).toEqual(['X']);
		expect(doc.rawBlocks.map((r) => r.rawText)).toContainEqual(expect.stringContaining('@{'));
		expect(serialize(doc)).toBe(text);
	});

	it('Klammer-Knoten mit Subgraph-ID bleibt wie bisher modelliert', () => {
		const doc = parseOk('flowchart TD\nsubgraph S\nX\nend\nS[Foo]\n');
		expect(node(doc, 'S')).toMatchObject({ shape: 'square', label: 'Foo' });
	});
});

describe('Befund 3: ungequotete Werte, die js-yaml nicht als String liest, bleiben RawBlock', () => {
	it.each([
		'~',
		'null',
		'Null',
		'NULL',
		'True',
		'TRUE',
		'true',
		'False',
		'FALSE',
		'+1',
		'0x1F',
		'010',
		'.5',
		'.inf',
		'1_000',
		'12'
	])('label: %s', (value) => {
		const text = `flowchart TD\nA@{ shape: doc, label: ${value} }\n`;
		const doc = parseOk(text);
		expect(doc.nodes).toEqual([]);
		expect(serialize(doc)).toBe(text);
	});

	it.each(['Wort', 'zwei Worte', 'a.b'])('label: %s bleibt modelliert', async (value) => {
		const text = `flowchart TD\nA@{ shape: doc, label: ${value} }\n`;
		expect(node(parseOk(text), 'A').label).toBe(value);
		expect((await vertex(text, 'A')).text).toBe(value);
	});
});

describe('Befund 4: @{} vor einer Kanten-ID bleibt RawBlock', () => {
	it.each(['A@{ shape: doc } e1@--> B', 'X --> A@{ shape: doc } e1@--> B'])('%j', async (body) => {
		const text = `flowchart TD\n${body}\n`;
		await expect(mermaid.parse(text)).rejects.toThrow();
		const doc = parseOk(text);
		expect(doc.nodes).toEqual([]);
		expect(serialize(doc)).toBe(text);
	});

	it('Kanten-ID ohne @{} davor bleibt modelliert', async () => {
		const text = 'flowchart TD\nA@{ shape: doc } --> B e1@--> C\n';
		await mermaid.parse(text);
		const doc = parseOk(text);
		expect(node(doc, 'A').shape).toBe('doc');
		expect(doc.edges.map((e) => e.id)).toContain('e1');
		expect(serialize(doc)).toBe(text);
	});
});

describe('Befund 5: Label-Folgezeile mit %% bleibt RawBlock', () => {
	it.each(['A@{ shape: doc, label: "a\n%% c" }', 'A@{ shape: doc, label: "a\n  %% c" }'])(
		'%j',
		(body) => {
			const text = `flowchart TD\n${body}\n`;
			const doc = parseOk(text);
			expect(doc.nodes).toEqual([]);
			expect(serialize(doc)).toBe(text);
		}
	);
});
