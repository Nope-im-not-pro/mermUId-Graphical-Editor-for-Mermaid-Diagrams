// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { moveToContainer, removeNode } from '../../../../../src/lib/model/operations';
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

async function db(text: string): Promise<FlowDb> {
	await mermaid.parse(text);
	return (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
}

const parents = (doc: DiagramDocument) =>
	Object.fromEntries(doc.nodes.map((n) => [n.id, n.parentId]));
const boxes = (doc: DiagramDocument) => doc.containers.map((c) => `${c.id}:${c.parentId}`).sort();
/** Hängende Kanten (mark-Modus) stehen nur als Kommentar und fehlen beim Re-Parse. */
const edgeEnds = (doc: DiagramDocument) => {
	const ids = new Set(doc.nodes.map((n) => n.id));
	return doc.edges
		.filter((e) => ids.has(e.sourceId) && ids.has(e.targetId))
		.map((e) => `${e.sourceId}>${e.targetId}`)
		.sort();
};

/** Fixpunkt ab der ersten Ausgabe; Re-Parse und mermaid-db entsprechen dem Modell. */
async function stable(edited: DiagramDocument): Promise<string> {
	const out = serialize(edited);
	const again = parseOk(out);
	expect(serialize(again)).toBe(out);
	expect(serialize(parseOk(serialize(again)))).toBe(out);
	expect(boxes(again)).toEqual(boxes(edited));
	expect(parents(again)).toEqual(parents(edited));
	expect(edgeEnds(again)).toEqual(edgeEnds(edited));
	const flow = await db(out);
	const ids = flow.getSubGraphs().map((s) => s.id);
	expect(ids.sort()).toEqual(edited.containers.map((c) => c.id).sort());
	expect([...flow.getVertices().keys()].sort()).toEqual(edited.nodes.map((n) => n.id).sort());
	const owner = new Map<string, string>();
	for (const s of flow.getSubGraphs()) for (const n of s.nodes) owner.set(n, s.id);
	for (const n of edited.nodes) expect([n.id, owner.get(n.id) ?? null]).toEqual([n.id, n.parentId]);
	return out;
}

const UT = 'flowchart TD\nsubgraph U\nA --> T\nend\nsubgraph T\nC\nend\n';
const UTS = 'flowchart TD\nsubgraph U\nA --> T\nend\nsubgraph T\nC\nend\nsubgraph S\nD\nend\n';

describe('Container-ID als Knotennennung: Subgraph genau einmal (P2 E3)', () => {
	it.each([
		['Nennung in U', 'flowchart TD\nsubgraph U\nT\nend\nsubgraph T\nC\nend\n'],
		['Kante in U', UT],
		['Mehrfachnennung', 'flowchart TD\nsubgraph U\nT\nT\nend\nsubgraph T\nC\nend\n'],
		['drei Ebenen', 'flowchart TD\nsubgraph U\nsubgraph V\nT\nend\nend\nsubgraph T\nC\nend\n']
	])('%s: unverändert byte-gleich und stabil', async (_n, text) => {
		expect(await stable(parseOk(text))).toBe(text);
	});

	it.each<[string, string, (d: DiagramDocument) => DiagramDocument]>([
		['move(A, null)', UT, (d) => moveToContainer(d, 'A', null)],
		['move(T, null)', UT, (d) => moveToContainer(d, 'T', null)],
		['move(T, S)', UTS, (d) => moveToContainer(d, 'T', 'S')],
		[
			'mark + move(A, null)',
			'flowchart TD\nsubgraph S\nA --> B\nC --> B\nend\n',
			(d) => moveToContainer(removeNode(d, 'B', 'mark'), 'A', null)
		],
		['mark', 'flowchart TD\nA --> B\n', (d) => removeNode(d, 'B', 'mark')]
	])('%s: Fixpunkt ab der ersten Ausgabe, kein doppelter Subgraph', async (_n, text, op) => {
		const out = await stable(op(parseOk(text)));
		expect(out.match(/^subgraph T$/gm)?.length ?? 0).toBeLessThanOrEqual(1);
	});
});
