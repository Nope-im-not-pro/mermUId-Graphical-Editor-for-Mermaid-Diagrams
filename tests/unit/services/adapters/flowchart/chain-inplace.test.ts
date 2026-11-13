import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { addNode, updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument, DiagramNode } from '../../../../../src/lib/model/types';

// T111 C2 / V-12: Label-, Form- und Stiländerung schreibt die Kettenzeile in place
// statt sie in Definition und Kante zu zerlegen (FA-08 minimale Diffs).

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const edit = (text: string, id: string, patch: Partial<DiagramNode>) =>
	serialize(updateNode(parseOk(text), id, patch));

/** Knoten-Eigenschaften nach Re-Parse (Semantik der Ausgabe). */
const nodeOf = (text: string, id: string) => {
	const n = parseOk(text).nodes.find((x) => x.id === id)!;
	return {
		label: n.label,
		shape: n.shape,
		style: n.style,
		classes: [...n.cssClasses].sort(),
		click: n.props.click
	};
};

/** Zeilen von `after`, die in `before` nicht an gleicher Stelle stehen. */
function changedLines(before: string, after: string): string[] {
	const a = before.split('\n');
	const b = after.split('\n');
	return b.filter((line, i) => a[i] !== line);
}

const CHAIN = 'flowchart TD\n    A[Start] --> B{Ok?}\n';

describe('Kettenzeile in place (V-12)', () => {
	it('Label-Änderung ändert nur die betroffene Zeile', () => {
		const out = edit(CHAIN, 'A', { label: 'Neu' });
		expect(out).toBe('flowchart TD\n    A[Neu] --> B{Ok?}\n');
		expect(changedLines(CHAIN, out)).toEqual(['    A[Neu] --> B{Ok?}']);
	});

	it('Form-Änderung ändert nur die betroffene Zeile', () => {
		expect(edit(CHAIN, 'B', { shape: 'round' })).toBe('flowchart TD\n    A[Start] --> B(Ok?)\n');
		expect(edit(CHAIN, 'A', { shape: 'diamond' })).toBe('flowchart TD\n    A{Start} --> B{Ok?}\n');
	});

	it('Stiländerung lässt die Kettenzeile stehen und hängt genau eine Zeile an', () => {
		const out = edit(CHAIN, 'A', { style: { fill: '#f00' } });
		expect(out).toBe(CHAIN + '    style A fill:#f00\n');
		expect(nodeOf(out, 'A').style).toEqual({ fill: '#f00' });
	});

	it('vorhandene `class`-Zeile bleibt an ihrer Stelle, Stil steht danach', () => {
		const text = CHAIN + '    class A rot\n';
		const out = edit(text, 'A', { style: { fill: '#f00' } });
		expect(out).toBe(text + '    style A fill:#f00\n');
	});

	it('vorhandene `style`-Zeile wird in place ersetzt', () => {
		const text = 'flowchart TD\n    A --> B\n    style A fill:#f00\n    C\n';
		const out = edit(text, 'A', { style: { fill: '#0f0', stroke: '#000' } });
		expect(out).toBe('flowchart TD\n    A --> B\n    style A fill:#0f0,stroke:#000\n    C\n');
	});

	it('neue Klasse hängt genau eine `class`-Zeile an', () => {
		const out = edit(CHAIN, 'B', { cssClasses: ['warn'] });
		expect(out).toBe(CHAIN + '    class B warn\n');
		expect(nodeOf(out, 'B').classes).toEqual(['warn']);
	});

	it('mittleres Glied einer Kette, `;`-Zeile und `:::`-Klasse', () => {
		expect(edit('flowchart TD\nA[a] --> B[b] --> C[c]\n', 'B', { label: 'neu' })).toBe(
			'flowchart TD\nA[a] --> B[neu] --> C[c]\n'
		);
		expect(edit('flowchart TD\nA[x] --> B; C[y] --> D\n', 'C', { label: 'neu' })).toBe(
			'flowchart TD\nA[x] --> B; C[neu] --> D\n'
		);
		expect(edit('flowchart TD\nA[x]:::rot --> B\n', 'A', { label: 'neu' })).toBe(
			'flowchart TD\nA[neu]:::rot --> B\n'
		);
	});

	it('mehrfach definierter Knoten: alle Definitionen in place', () => {
		const text = 'flowchart TD\nA[x] --> B\nA[x] --> C\n';
		expect(edit(text, 'A', { label: 'y' })).toBe('flowchart TD\nA[y] --> B\nA[y] --> C\n');
	});

	it('CRLF und Einrückung bleiben erhalten', () => {
		const text = 'flowchart TD\r\n  A[Start] --> B\r\n';
		expect(edit(text, 'A', { label: 'Neu' })).toBe('flowchart TD\r\n  A[Neu] --> B\r\n');
		expect(edit(text, 'A', { style: { fill: '#f00' } })).toBe(text + '  style A fill:#f00\r\n');
	});

	it('Label mit Sonderzeichen wird gequotet, Re-Parse ergibt das Modell', () => {
		const out = edit(CHAIN, 'B', { label: 'Ja "oder" nein\nzweite' });
		expect(out).toBe('flowchart TD\n    A[Start] --> B{"Ja #quot;oder#quot; nein\nzweite"}\n');
		expect(nodeOf(out, 'B')).toMatchObject({ label: 'Ja "oder" nein\nzweite', shape: 'diamond' });
	});

	it('Knoten ohne Form in der Kette: Kettenzeile bleibt, eine Zeile wird angehängt', () => {
		const text = 'flowchart TD\nA --> B\n';
		const out = edit(text, 'B', { label: 'neu' });
		expect(out.startsWith(text)).toBe(true);
		expect(out.slice(text.length).split('\n').filter(Boolean)).toHaveLength(1);
		expect(nodeOf(out, 'B').label).toBe('neu');
	});
});

describe('Kommentarzeile im mehrzeiligen Label einer unveränderten Kettenzeile (O-88)', () => {
	const TEXT = 'flowchart TD\nA["x\n%% note\ny"] --> B\n';

	it('Änderung an B oder Stil an A lässt die %%-Zeile stehen', () => {
		const relabel = edit(TEXT, 'B', { label: 'neu' });
		expect(relabel.startsWith(TEXT)).toBe(true);
		expect(nodeOf(relabel, 'B').label).toBe('neu');
		expect(edit(TEXT, 'A', { style: { fill: '#f00' } })).toBe(TEXT + 'style A fill:#f00\n');
	});

	it('Label-Änderung an A ersetzt nur das Knoten-Token', () => {
		expect(edit(TEXT, 'A', { label: 'neu' })).toBe('flowchart TD\nA[neu] --> B\n');
		expect(edit('flowchart TD\r\nA["x\r\n%% note\r\ny"] --> B[b]\r\n', 'B', { label: 'c' })).toBe(
			'flowchart TD\r\nA["x\r\n%% note\r\ny"] --> B[c]\r\n'
		);
	});
});

describe('Goldens T111 C2 (e2e actions/comments, Startzustand wie in den Specs)', () => {
	const golden = (path: string) =>
		readFileSync(join(__dirname, '../../../../fixtures/golden', path), 'utf8');
	const FLOW = 'flowchart TD\n    A[Start] --> B[Ende]\n';

	it('actions/03 umbenennen, actions/04 Form ändern', () => {
		expect(edit(FLOW, 'B', { label: 'Fertig' })).toBe(golden('actions/03-flow-umbenennen.mmd'));
		expect(edit(FLOW, 'A', { shape: 'diamond' })).toBe(golden('actions/04-flow-form-aendern.mmd'));
	});

	it('comments/01 umbenennen', () => {
		expect(edit(golden('comments/flowchart-kommentare.mmd'), 'B', { label: 'Kontrolle' })).toBe(
			golden('comments/01-flowchart-umbenennen.mmd')
		);
	});
});

describe('Edit in place: Semantik nach Re-Parse gleich dem Modell', () => {
	const dir = join(__dirname, '../../../../fixtures/flowchart/roundtrip');
	const files = readdirSync(dir).filter((f) => f.endsWith('.mmd'));
	const semantics = (doc: DiagramDocument) => ({
		nodes: doc.nodes
			.map((n) =>
				JSON.stringify([
					n.id,
					n.label,
					n.shape,
					n.parentId,
					[...n.cssClasses].sort(),
					n.style,
					n.props.click ?? null
				])
			)
			.sort(),
		edges: doc.edges.map((e) => [e.sourceId, e.targetId, e.label]),
		containers: doc.containers.map((c) => [c.id, c.parentId]).sort()
	});
	// Ein Label ungleich der ID braucht eine Form (mermaid: `default` wird `square`).
	const patches = (n: DiagramNode): Partial<DiagramNode>[] => [
		{ label: 'Neu X', shape: n.shape === 'default' ? 'square' : n.shape },
		{ shape: 'round' },
		{ style: { ...n.style, fill: '#f00' } },
		{ cssClasses: [...n.cssClasses, 'neu'] },
		{ label: 'Zwei\nZeilen', shape: 'diamond', style: { stroke: '#000' } }
	];

	it.each(files)('%s: jede Änderung an jedem Knoten', (file) => {
		const doc = parseOk(readFileSync(join(dir, file), 'utf8'));
		for (const n of doc.nodes)
			for (const patch of patches(n)) {
				const changed = updateNode(doc, n.id, patch);
				expect(semantics(parseOk(serialize(changed))), `${n.id} ${JSON.stringify(patch)}`).toEqual(
					semantics(changed)
				);
			}
	});

	it('Knoten im Subgraphen: Zuordnung bleibt, Zeile im Subgraphen in place', () => {
		const text = 'flowchart TD\nsubgraph S\n  A[a] --> B\nend\nC --> A\n';
		const out = edit(text, 'A', { label: 'neu', style: { fill: '#f00' } });
		expect(out).toBe(
			'flowchart TD\nsubgraph S\n  A[neu] --> B\nend\nC --> A\n  style A fill:#f00\n'
		);
		expect(parseOk(out).nodes.find((n) => n.id === 'A')?.parentId).toBe('S');
	});

	it('click-Zeile in place; entfernte Klasse fällt auf kanonisches Schreiben zurück', () => {
		const text = 'flowchart TD\nA[a]:::rot --> B\nclick A "https://a.example"\n';
		expect(edit(text, 'A', { props: { click: 'click A "https://b.example"' } })).toBe(
			'flowchart TD\nA[a]:::rot --> B\nclick A "https://b.example"\n'
		);
		const out = edit(text, 'A', { cssClasses: [] });
		expect(nodeOf(out, 'A').classes).toEqual([]);
		expect(nodeOf(out, 'A').click).toBe('click A "https://a.example"');
	});
});

describe('Einzelknoten-Anweisung in place (O-97 Befund 1)', () => {
	it('Stiländerung: vorhandene `style`-Zeile bleibt an ihrer Stelle, nur der Wert ändert sich', () => {
		const text = 'flowchart TD\n    A[Start]\n    B[Ende]\n    A --> B\n    style A fill:#f00\n';
		expect(edit(text, 'A', { style: { fill: '#0f0' } })).toBe(text.replace('#f00', '#0f0'));
	});

	it('mehrzeiliges Label mit %%-Zeile: Stil hängt an, Label-Änderung ersetzt nur das Token', () => {
		const text = 'flowchart TD\nA["x\n%% c\ny"]\nA --> B\n';
		expect(edit(text, 'A', { style: { fill: '#f00' } })).toBe(text + 'style A fill:#f00\n');
		expect(edit(text, 'B', { label: 'neu' }).startsWith('flowchart TD\nA["x\n%% c\ny"]\n')).toBe(
			true
		);
		expect(edit(text, 'A', { label: 'neu' })).toBe('flowchart TD\nA[neu]\nA --> B\n');
	});

	it('`;` und `:::k` bleiben, keine `class`-Zeile; Form in place', () => {
		expect(edit('flowchart TD\nA[Start];\nA --> B\n', 'A', { label: 'Neu' })).toBe(
			'flowchart TD\nA[Neu];\nA --> B\n'
		);
		expect(edit('flowchart TD\nA["Start"]:::k\nA --> B\n', 'A', { label: 'Neu' })).toBe(
			'flowchart TD\nA[Neu]:::k\nA --> B\n'
		);
		expect(edit('flowchart TD\n  A[Start]\n  A --> B\n', 'A', { shape: 'round' })).toBe(
			'flowchart TD\n  A(Start)\n  A --> B\n'
		);
	});

	it('im Subgraphen in place, Zuordnung bleibt', () => {
		const text = 'flowchart TD\nsubgraph S\n  A[a]\nend\nA --> B\n';
		const out = edit(text, 'A', { label: 'neu' });
		expect(out).toBe('flowchart TD\nsubgraph S\n  A[neu]\nend\nA --> B\n');
		expect(parseOk(out).nodes.find((n) => n.id === 'A')?.parentId).toBe('S');
	});

	it('entfernte Klasse fällt auf kanonisches Schreiben zurück, Semantik bleibt', () => {
		const out = edit('flowchart TD\nA[a]:::k\nA --> B\n', 'A', { cssClasses: [] });
		expect(nodeOf(out, 'A')).toMatchObject({ label: 'a', shape: 'square', classes: [] });
	});

	it('kopierter Knoten übernimmt nicht die Anweisung des Originals', () => {
		const doc = parseOk('flowchart TD\nA[a]\n');
		const a = doc.nodes[0];
		const out = serialize(addNode(doc, { ...a, id: 'C', label: 'c', sourceText: '' }));
		expect(out.match(/A\[a\]/g)).toHaveLength(1);
		expect(nodeOf(out, 'C').label).toBe('c');
	});
});

describe('Testlücken Review C2 I1 (M7, M15)', () => {
	it('M7: zwei formgebende Nennungen desselben Knotens in einer Anweisung in place', () => {
		expect(edit('flowchart TD\nA[x] --> A[y]\n', 'A', { label: 'lang lang' })).toBe(
			'flowchart TD\nA[lang lang] --> A[lang lang]\n'
		);
	});

	it('M15: angehängte Zeile entfällt, wenn der Knoten später kanonisch geschrieben wird', () => {
		// Stil an A hängt eine Zeile an; X verliert eine Klasse -> Kettenzeile entfällt -> A kanonisch.
		const doc = parseOk('flowchart TD\nA[a] --> X[x]:::k\n');
		const changed = updateNode(updateNode(doc, 'A', { style: { fill: '#f00' } }), 'X', {
			cssClasses: []
		});
		const out = serialize(changed);
		expect(out.match(/style A/g)).toHaveLength(1);
		expect(nodeOf(out, 'A')).toMatchObject({ label: 'a', style: { fill: '#f00' } });
		expect(nodeOf(out, 'X').classes).toEqual([]);
	});
});
