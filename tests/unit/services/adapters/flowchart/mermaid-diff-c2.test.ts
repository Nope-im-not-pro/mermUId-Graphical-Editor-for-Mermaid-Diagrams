// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

// T111 C2, Nachträge O-90 (B1-B5): Differenz Adapter gegen mermaid-12.2.0-DB.

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface FlowDb {
	getVertices(): Map<string, { text?: string }>;
	getSubGraphs(): { id: string; title: string }[];
	getEdges(): { start: string; end: string; text?: string }[];
}

async function db(text: string): Promise<FlowDb> {
	await mermaid.parse(text);
	return (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
}

/** Knoten-IDs und -Label, Kanten-Label, Subgraph-Titel: Adapter gegen mermaid; Roundtrip byte-gleich. */
async function sameAsMermaid(text: string): Promise<DiagramDocument> {
	const doc = parseOk(text);
	const flow = await db(text);
	const vertices = [...flow.getVertices()].map(([id, v]) => [id, v.text ?? id]);
	expect(doc.nodes.map((n) => [n.id, n.label]).sort()).toEqual(vertices.sort());
	expect(doc.edges.map((e) => `${e.sourceId}>${e.targetId}:${e.label}`).sort()).toEqual(
		flow
			.getEdges()
			.map((e) => `${e.start}>${e.end}:${e.text ?? ''}`)
			.sort()
	);
	expect(doc.containers.map((c) => c.label).sort()).toEqual(
		flow
			.getSubGraphs()
			.map((s) => s.title)
			.sort()
	);
	expect(serialize(doc)).toBe(text);
	return doc;
}

describe('B1: Direktiven im Label exakt wie mermaid directiveRegex', () => {
	it.each([
		['einzeilig ab Zeile 2', 'flowchart TD\nA["x\n%%{init: {"a":1}}%%\ny"] --> B\n'],
		['ohne Wort nach %%{ bleibt Text', 'flowchart TD\nA["x\n%%{}%%\ny"] --> B\n'],
		['über Zeilenende', 'flowchart TD\nA["x\n%%{init:\n{}}%%\ny"] --> B\n'],
		['CRLF über Zeilenende', 'flowchart TD\r\nA["x\r\n%%{init:\r\n{}}%%\r\ny"] --> B\r\n']
	])('%s', async (_name, text) => {
		await sameAsMermaid(text);
	});

	it('offenes %%{ ohne }%% im Label: mermaid lehnt ab, Adapter hält das Stück als RawBlock', async () => {
		const text = 'flowchart TD\nA["x\n%%{init: {}}\ny"] --> B\n';
		await expect(mermaid.parse(text)).rejects.toThrow();
		const doc = parseOk(text);
		expect(doc.nodes).toEqual([]);
		expect(serialize(doc)).toBe(text);
	});
});

describe('B2: Direktive in Zeile 1 eines Stücks', () => {
	it('wird für den Label-Text entfernt, Roundtrip byte-gleich', async () => {
		const doc = await sameAsMermaid('flowchart TD\nA["x %%{init: {}}%% y\nz"] --> B\n');
		expect(doc.nodes[0].label).toBe('x  y\nz');
	});
});

describe('B3: Leerzeilen-Läufe im String', () => {
	const text = (n: number, comment: boolean) =>
		`flowchart TD\nA["x\n${'\n'.repeat(n)}${comment ? '%% c\n' : ''}y"] --> B\n`;

	it('gleiche Semantik wie mermaid (Lauf vor %%-Zeile entfällt, sonst bleibt er)', async () => {
		await sameAsMermaid(text(3, true));
		await sameAsMermaid(text(3, false));
		await sameAsMermaid('flowchart TD\nA["x\n  \n\t\n  %% c\n  \ny"] --> B\n');
	});

	it('40000 Leerzeilen: Parse und Serialize unter 1500 ms, Roundtrip byte-gleich', () => {
		for (const comment of [true, false]) {
			const big = text(40000, comment);
			const t0 = performance.now();
			const doc = parseOk(big);
			const out = serialize(doc);
			expect(performance.now() - t0).toBeLessThan(1500);
			expect(out).toBe(big);
			expect(doc.nodes[0].label).toBe(comment ? 'x\ny' : `x\n${'\n'.repeat(40000)}y`);
		}
	}, 20000);
});

describe('B4: `click X call` über Zeilenende (Ist-Verhalten festgehalten)', () => {
	it('Argumente enden am Zeilenende; kein offener String, Folgezeilen eigene Stücke', () => {
		const text = 'flowchart TD\nA --> B\nclick A call fn("x\ny)\nC --> D\n';
		const doc = parseOk(text);
		expect(doc.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D']);
		expect(doc.nodes[0].props.click).toBe('click A call fn("x');
		expect(doc.rawBlocks.map((r) => r.rawText)).toContain('y)\n');
		expect(serialize(doc)).toBe(text);
	});
});

describe('B5: Label-Trim wie mermaid', () => {
	it('Knoten-, Kanten- und Subgraph-Label getrimmt, Quelltext unverändert', async () => {
		const text =
			'flowchart TD\nsubgraph S [" t "]\nA[" x "] -->|" k "| B["\ny\n"]\nend\nC -- " m " --> D\n';
		const doc = await sameAsMermaid(text);
		expect(doc.nodes.map((n) => n.label)).toEqual(['x', 'y', 'C', 'D']);
		expect(doc.edges.map((e) => e.label)).toEqual(['k', 'm']);
		expect(doc.containers[0].label).toBe('t');
	});
});
