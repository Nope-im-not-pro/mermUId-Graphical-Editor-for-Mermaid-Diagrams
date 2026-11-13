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
	getEdges(): { start: string; end: string }[];
}

async function db(text: string): Promise<FlowDb> {
	await mermaid.parse(text);
	return (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
}

/** parentId je Knoten laut mermaid-db (erster Schließer beansprucht). */
async function owners(text: string): Promise<Record<string, string | null>> {
	const flow = await db(text);
	const owner = new Map<string, string>();
	for (const s of flow.getSubGraphs()) for (const n of s.nodes) owner.set(n, s.id);
	return Object.fromEntries(
		[...flow.getVertices().keys()].map((id) => [id, owner.get(id) ?? null])
	);
}

const parents = (doc: DiagramDocument) =>
	Object.fromEntries(doc.nodes.map((n) => [n.id, n.parentId]));
const boxes = (doc: DiagramDocument) => doc.containers.map((c) => `${c.id}:${c.parentId}`).sort();
const edgeEnds = (doc: DiagramDocument) =>
	doc.edges.map((e) => `${e.sourceId}>${e.targetId}`).sort();

describe('Knoten mit Container-ID (P2)', () => {
	const UT = 'flowchart TD\nsubgraph U\nA --> T\nend\nsubgraph T\nC\nend\n';
	const UTS = 'flowchart TD\nsubgraph U\nA --> T\nend\nsubgraph T\nC\nend\nsubgraph S\nD\nend\n';
	it.each<[string, string, string, string | null, boolean]>([
		['move(A, null)', UT, 'A', null, true],
		['move(T, null)', UT, 'T', null, true],
		// moveToContainer verschiebt bei doppelter ID den order-Eintrag des Containers mit (SUBSET.md).
		['move(T, S)', UTS, 'T', 'S', false]
	])(
		'%s: Subgraph einmal, Re-Parse und mermaid-db gleich Modell',
		async (_n, text, id, to, box) => {
			const edited = moveToContainer(parseOk(text), id, to);
			const out = serialize(edited);
			const again = parseOk(out);
			expect(out.match(/^subgraph T$/gm)).toHaveLength(1);
			expect(again.containers.map((c) => c.id).sort()).toEqual(
				edited.containers.map((c) => c.id).sort()
			);
			if (box) expect(boxes(again)).toEqual(boxes(edited));
			expect(parents(again)).toEqual(parents(edited));
			expect(edgeEnds(again)).toEqual(edgeEnds(edited));
			expect(await owners(out)).toEqual(parents(edited));
		}
	);
});

describe('Hängende Kanten im mark-Modus (P2)', () => {
	it.each<[string, string, (d: DiagramDocument) => DiagramDocument, string[]]>([
		[
			'verschoben: move(A, null) legt B nicht wieder an',
			'flowchart TD\nsubgraph S\nA --> B\nC --> B\nend\n',
			(d) => moveToContainer(removeNode(d, 'B', 'mark'), 'A', null),
			['%% A --> B', '%% C --> B']
		],
		[
			'Endpunkt A bleibt deklariert',
			'flowchart TD\nA --> B\n',
			(d) => removeNode(d, 'B', 'mark'),
			['%% A --> B']
		]
	])('%s', async (_n, text, op, comments) => {
		const edited = op(parseOk(text));
		const out = serialize(edited);
		const again = parseOk(out);
		for (const c of comments) expect(out).toContain(`${c}\n`);
		expect(out).not.toMatch(/^\s*[^%\s].*-->/m);
		expect(parents(again)).toEqual(parents(edited));
		expect(again.edges).toEqual([]);
		expect(await owners(out)).toEqual(parents(edited));
		expect((await db(out)).getEdges()).toEqual([]);
	});
});

/** Hub `A` mit `n` Kanten im Subgraph, danach `A` aus dem Subgraph verschoben. */
function movedHub(n: number): DiagramDocument {
	const lines = Array.from({ length: n }, (_, i) => `A --> X${i}`).join('\n');
	return moveToContainer(parseOk(`flowchart TD\nsubgraph S\n${lines}\nend\n`), 'A', null);
}

/** Laufzeit von `run` in ms. */
function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

describe('Verschobene Kanten linear (P3)', () => {
	// Verhältnis statt absoluter Zeit: Unter Parallel-Last (gesamte Suite) schwankt die absolute
	// Laufzeit um Faktor 2 und mehr, beide Größen werden aber ähnlich gebremst. 16-fache Eingabe
	// ergibt linear Faktor 20 bis 40 (gemessen, isoliert und unter Last), quadratisch bis 256;
	// der Vorstand vor T10 (Spread je Kante, 16000 Kanten etwa 4 s) lag in der Probe bei 75-94.
	// Grenze 64 = Exponent 1,5. Faktor 8 mit Grenze 20 war zu knapp (linear unter Last bis 17,
	// Mischform mit quadratischem Anteil ab 32). Warmlauf je Größe (JIT), Messungen im Wechsel
	// klein/groß, je Größe das Minimum (filtert Last-Spitzen und GC-Pausen); die kurze kleine
	// Messung öfter, da Störungen sie relativ stärker treffen.
	it('Hub mit 16000 verschobenen Kanten: 16-fache Eingabe < 64-fache Zeit', () => {
		const small = movedHub(1000);
		const large = movedHub(16000);
		serialize(small);
		const out = serialize(large);
		const tSmall: number[] = [];
		const tLarge: number[] = [];
		for (let i = 0; i < 3; i++) {
			for (let k = 0; k < 4; k++) tSmall.push(timed(() => serialize(small)));
			tLarge.push(timed(() => serialize(large)));
		}
		expect(Math.min(...tLarge) / Math.min(...tSmall)).toBeLessThan(64);
		expect(out.endsWith('A --> X15999\n')).toBe(true);
	}, 30000);
});
