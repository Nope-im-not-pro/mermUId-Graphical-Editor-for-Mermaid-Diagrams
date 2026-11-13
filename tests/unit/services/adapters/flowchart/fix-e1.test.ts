// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { moveToContainer } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface FlowDb {
	getVertices(): Map<string, unknown>;
	getSubGraphs(): { id: string; nodes: string[] }[];
}

/** parentId je Knoten laut mermaid-db (erster Schließer beansprucht). */
async function owners(text: string): Promise<Record<string, string | null>> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
	const owner = new Map<string, string>();
	for (const s of db.getSubGraphs()) for (const n of s.nodes) owner.set(n, s.id);
	return Object.fromEntries([...db.getVertices().keys()].map((id) => [id, owner.get(id) ?? null]));
}

const parents = (doc: DiagramDocument) =>
	Object.fromEntries(doc.nodes.map((n) => [n.id, n.parentId]));

const edgeEnds = (doc: DiagramDocument) =>
	doc.edges.map((e) => `${e.sourceId}>${e.targetId}`).sort();

type Op = (d: DiagramDocument) => DiagramDocument;
const move =
	(...steps: [string, string | null][]): Op =>
	(d) =>
		steps.reduce((acc, [id, to]) => moveToContainer(acc, id, to), d);
const edgeOf =
	(index: number, to: string | null): Op =>
	(d) =>
		moveToContainer(d, d.edges[index].id, to);

describe('Container-Nennung nach moveToContainer (P2)', () => {
	const S = 'flowchart TD\nsubgraph S\nA --> B\nend\n';
	const ST = 'flowchart TD\nsubgraph S\nA --> B\nend\nsubgraph T\nC\nend\n';
	const SI = 'flowchart TD\nsubgraph S\nsubgraph I\nA --> B\nend\nend\n';
	const TS = 'flowchart TD\nsubgraph T\nC\nend\nsubgraph S\nA --> B\nend\n';
	it.each<[string, string, Op]>([
		['move(A, null)', S, move(['A', null])],
		['move(A, T) Geschwister danach', ST, move(['A', 'T'])],
		['move(A, T) Geschwister davor', TS, move(['A', 'T'])],
		['move(A, S) aus innerem I', SI, move(['A', 'S'])],
		['move(A, null) aus innerem I', SI, move(['A', null])],
		['beide Endpunkte nach T', ST, move(['A', 'T'], ['B', 'T'])],
		[
			'beide Endpunkte und Kante nach T',
			ST,
			(d) => edgeOf(0, 'T')(move(['A', 'T'], ['B', 'T'])(d))
		],
		[
			'Kettenglied move(B, T)',
			'flowchart TD\nsubgraph S\nA --> B --> C\nend\nsubgraph T\nD\nend\n',
			move(['B', 'T'])
		]
	])('%s: Re-Parse und mermaid-db gleich Modell', async (_name, text, op) => {
		const edited = op(parseOk(text));
		const out = serialize(edited);
		const again = parseOk(out);
		expect(parents(again)).toEqual(parents(edited));
		expect(edgeEnds(again)).toEqual(edgeEnds(edited));
		expect(await owners(out)).toEqual(parents(edited));
	});

	it('unverändertes Dokument mit Mehrfachnennung bleibt byte-gleich', () => {
		const text = 'flowchart TD\nsubgraph S\nA\nend\nsubgraph T\nA --> B\nend\n';
		expect(serialize(parseOk(text))).toBe(text);
	});

	it('nur die betroffene Anweisung wird umgeschrieben', () => {
		const text = 'flowchart TD\n  subgraph S\n    C --> D\n    A --> B\n  end\n';
		const out = serialize(move(['A', null])(parseOk(text)));
		expect(out).toContain('    C --> D\n');
		expect(out).not.toMatch(/subgraph S\n[^]*A --> B[^]*end/);
	});
});
