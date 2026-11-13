// @vitest-environment jsdom
import mermaid from 'mermaid';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { removeEdge, removeNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

const dir = join(__dirname, '../../../../fixtures/flowchart/roundtrip');
const fixture = (name: string) => readFileSync(join(dir, name), 'utf8');

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const parents = (doc: DiagramDocument) =>
	Object.fromEntries(doc.nodes.map((n) => [n.id, n.parentId]));

describe('Zeilenende nach `;` vor Kommentar (P2)', () => {
	const lastEdge = (doc: DiagramDocument) => removeEdge(doc, doc.edges.at(-1)!.id);
	it.each([
		['removeEdge hinter `;`', 'flowchart TD\nA-->B; C-->D\n%% x\n', lastEdge],
		[
			'removeNode hinter `;`',
			'flowchart TD\nA; B\n%% x\n',
			(d: DiagramDocument) => removeNode(d, 'B', 'cascade')
		],
		['Fixture 07 rmEdgeLast', fixture('07-semicolons-meta.mmd'), lastEdge],
		[
			'Fixture 07 rmNodeLastC',
			fixture('07-semicolons-meta.mmd'),
			(d: DiagramDocument) => removeNode(d, 'C', 'cascade')
		]
	])('%s ergibt gültiges mermaid', async (_name, text, op) => {
		const out = serialize(op(parseOk(text)));
		expect(out).not.toMatch(/;[ \t]*%%/);
		await expect(mermaid.parse(out)).resolves.toBeTruthy();
	});
});

describe('Container-Zugehörigkeit nach removeEdge (P2)', () => {
	it.each([
		['Kante im Subgraphen', 'flowchart TD\nsubgraph S\nA --> B\nend\nA --> C\n', 0],
		['Fixture 04 rmEdge0', fixture('04-init-subgraphs.mmd'), 0]
	])('%s: Re-Parse-parentId gleich Modell', (_name, text, index) => {
		const doc = parseOk(text);
		const edited = removeEdge(doc, doc.edges[index].id);
		expect(parents(parseOk(serialize(edited)))).toEqual(parents(edited));
	});
});

/** Hub `H` mit `n` Nachbarn, alle Nachbar-Labels geändert. */
function changedHub(n: number): DiagramDocument {
	const lines = ['flowchart TD'];
	for (let i = 0; i < n; i++) lines.push(`    H --> n${i}[L ${i}]`);
	const doc = parseOk(`${lines.join('\n')}\n`);
	return {
		...doc,
		nodes: doc.nodes.map((n) => (n.id === 'H' ? n : { ...n, label: `${n.label}!` }))
	};
}

/** Laufzeit von `run` in ms. */
function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

describe('Laufzeit Fixpunkt (P3)', () => {
	// Verhältnis statt absoluter Zeit (Vorlage fix-e2): Die frühere Grenze 300 ms lag unter
	// Gesamtlast bei 2000 Nachbarn knapp an der Messung (bis 400 ms) und schlug sporadisch fehl.
	// 16-fache Eingabe ergibt hier 25 bis 45, unter Last vereinzelt bis 90 (Allokation und GC
	// wachsen mit dem Dokument mit); quadratisch etwa 256. Grenze 128 = Exponent 1,75.
	// Warmlauf, Messungen im Wechsel klein/groß, je Größe das Minimum.
	it('Hub mit 4000 geänderten Nachbarn: 16-fache Eingabe < 128-fache Zeit', () => {
		const small = changedHub(250);
		const large = changedHub(4000);
		serialize(small);
		const out = serialize(large);
		const tSmall: number[] = [];
		const tLarge: number[] = [];
		for (let i = 0; i < 5; i++) {
			for (let k = 0; k < 4; k++) tSmall.push(timed(() => serialize(small)));
			tLarge.push(timed(() => serialize(large)));
		}
		expect(Math.min(...tLarge) / Math.min(...tSmall)).toBeLessThan(128);
		expect(out).toContain('n3999[L 3999!]');
	}, 30000);
});
