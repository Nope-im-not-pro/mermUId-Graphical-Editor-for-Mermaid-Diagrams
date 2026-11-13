import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeNode } from '../../../../src/lib/model/operations';
import type { DiagramDocument, ParseResult } from '../../../../src/lib/model/types';
import {
	parse as parseFlowchart,
	serialize as serializeFlowchart
} from '../../../../src/lib/services/adapters/flowchart';
import { parse as parseSequence } from '../../../../src/lib/services/adapters/sequence';
import { validateModel, type ModelIssue } from '../../../../src/lib/services/validator';
import { container, deepFreeze, edge, emptyDoc, node, sampleDoc } from '../../model/fixtures';

const kinds = (issues: ModelIssue[]) => issues.map((i) => [i.kind, i.elementId]);

function fixtures(dir: string, parse: (text: string) => ParseResult): [string, DiagramDocument][] {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.mmd'))
		.map((f) => {
			const result = parse(readFileSync(join(dir, f), 'utf8'));
			if (!result.ok) throw new Error(`${f}: ${JSON.stringify(result.errors)}`);
			return [f, result.doc];
		});
}

describe('gültige Dokumente', () => {
	it('leeres Dokument und sampleDoc ohne Meldungen', () => {
		expect(validateModel(emptyDoc())).toEqual([]);
		expect(validateModel(sampleDoc())).toEqual([]);
	});

	it('Eingabe bleibt unverändert', () => {
		const doc = deepFreeze(sampleDoc());
		expect(() => validateModel(doc)).not.toThrow();
	});

	const all = [
		...fixtures('tests/fixtures/flowchart/roundtrip', parseFlowchart),
		...fixtures('tests/fixtures/sequence/roundtrip', parseSequence)
	];
	it.each(all)('Fixture %s ohne Fehler', (_name, doc) => {
		expect(validateModel(doc).filter((i) => i.severity === 'error')).toEqual([]);
	});

	it('order mit classDef, RawBlock und Kommentar ist gültig', () => {
		const doc = emptyDoc({
			order: ['classDef:rot', 'r1', 'k1'],
			classDefs: [{ name: 'rot', style: {}, sourceText: '' }],
			rawBlocks: [{ id: 'r1', rawText: 'click A' }],
			comments: [{ id: 'k1', text: '%% x' }]
		});
		expect(validateModel(doc)).toEqual([]);
	});

	it('Knoten ohne Eintrag in order oder memberIds ist gültig (implizite Nennung)', () => {
		const doc = emptyDoc({
			nodes: [node('a', { parentId: 'c1' }), node('b')],
			containers: [container('c1')],
			order: ['c1']
		});
		expect(validateModel(doc)).toEqual([]);
	});

	it('Positionen unbekannter IDs sind kein Fehler (Positions-Erbe §8)', () => {
		const doc = sampleDoc();
		doc.layout.positions.weg = [0, 0, 1, 1];
		expect(validateModel(doc)).toEqual([]);
	});
});

describe('unbekannte IDs', () => {
	it('in order', () => {
		const doc = sampleDoc();
		doc.order.push('x1', 'classDef:fehlt');
		expect(kinds(validateModel(doc))).toEqual([
			['unknown-id', 'x1'],
			['unknown-id', 'classDef:fehlt']
		]);
	});

	it('in Section-memberIds', () => {
		const doc = sampleDoc();
		doc.containers[0].sections[0].memberIds.push('x2');
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([['unknown-id', 'x2']]);
		expect(issues[0].message).toContain('c1');
	});

	it('unbekannter classDef-Name in Section-memberIds ist Fehler', () => {
		const doc = sampleDoc();
		doc.containers[0].sections[0].memberIds.push('classDef:fehlt');
		expect(kinds(validateModel(doc))).toEqual([['unknown-id', 'classDef:fehlt']]);
	});

	it.each([
		['im Subgraphen', 'flowchart TD\nsubgraph S\nclassDef foo fill:#f00\nA\nend\n'],
		[
			'verschachtelt',
			'flowchart TD\nsubgraph O\nsubgraph I\nclassDef foo fill:#f00\nA --> B\nend\nend\n'
		]
	])('classDef %s ohne Fehler, auch nach serialize + parse', (_name, text) => {
		const first = parseFlowchart(text);
		if (!first.ok) throw new Error(JSON.stringify(first.errors));
		const members = first.doc.containers.flatMap((c) => c.sections.flatMap((s) => s.memberIds));
		expect(members).toContain('classDef:foo');
		expect(validateModel(first.doc)).toEqual([]);
		const second = parseFlowchart(serializeFlowchart(first.doc));
		if (!second.ok) throw new Error(JSON.stringify(second.errors));
		expect(validateModel(second.doc)).toEqual([]);
	});

	it('Notiz-Bezug auf unbekannten Teilnehmer', () => {
		const doc = emptyDoc({
			diagramType: 'sequence',
			order: ['A', 'n1'],
			nodes: [
				node('A', { kind: 'participant' }),
				node('n1', { kind: 'note', props: { participants: ['A', 'B'] } })
			]
		});
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([['unknown-id', 'n1']]);
		expect(issues[0].message).toContain('"B"');
	});
});

describe('doppelte IDs', () => {
	it('zwei Knoten, Knoten und Kante, RawBlock und Kommentar', () => {
		const doc = emptyDoc({
			order: ['a', 'b', 'r'],
			nodes: [node('a'), node('a'), node('b')],
			edges: [edge('b', 'a', 'a')],
			rawBlocks: [{ id: 'r', rawText: 'x' }],
			comments: [{ id: 'r', text: '%% y' }]
		});
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([
			['duplicate-id', 'a'],
			['duplicate-id', 'b'],
			['duplicate-id', 'r']
		]);
		expect(issues.every((i) => i.severity === 'error')).toBe(true);
		expect(issues[1].message).toContain('Knoten');
		expect(issues[1].message).toContain('Kante');
	});

	it('Knoten-ID gleich Container-ID ist nur Hinweis (mermaid-Semantik)', () => {
		const doc = emptyDoc({
			order: ['T'],
			nodes: [node('T')],
			containers: [container('T')]
		});
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([['node-container-id', 'T']]);
		expect(issues[0].severity).toBe('hint');
	});

	it('Knoten, Container und weiterer Knoten gleicher ID bleiben Fehler', () => {
		const doc = emptyDoc({
			order: ['T'],
			nodes: [node('T'), node('T')],
			containers: [container('T')]
		});
		expect(kinds(validateModel(doc))).toEqual([['duplicate-id', 'T']]);
	});
});

describe('dangling Edges', () => {
	it('nach removeNode im Modus "mark"', () => {
		const doc = removeNode(sampleDoc(), 'n2', 'mark');
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([
			['dangling-edge', 'e1'],
			['dangling-edge', 'e2']
		]);
		expect(issues[0].message).toContain('Ziel "n2"');
		expect(issues[1].message).toContain('Quelle "n2"');
	});

	it('beide Endpunkte unbekannt', () => {
		const doc = emptyDoc({ order: ['e1'], edges: [edge('e1', 'x', 'y')] });
		const [issue] = validateModel(doc);
		expect(issue.message).toContain('Quelle "x"');
		expect(issue.message).toContain('Ziel "y"');
	});

	it('Container als Endpunkt ist gültig', () => {
		const doc = emptyDoc({
			order: ['a', 'c1', 'e1'],
			nodes: [node('a')],
			containers: [container('c1')],
			edges: [edge('e1', 'a', 'c1')]
		});
		expect(validateModel(doc)).toEqual([]);
	});
});

describe('ungültige Container-Referenzen', () => {
	it('parentId unbekannt oder kein Container', () => {
		const doc = emptyDoc({
			order: ['e1', 'c1'],
			nodes: [node('a', { parentId: 'fehlt' }), node('b'), node('k', { parentId: 'b' })],
			edges: [edge('e1', 'a', 'b', { parentId: 'fehlt' })],
			containers: [container('c1', { parentId: 'fehlt' })]
		});
		expect(kinds(validateModel(doc))).toEqual([
			['invalid-container-ref', 'a'],
			['invalid-container-ref', 'k'],
			['invalid-container-ref', 'e1'],
			['invalid-container-ref', 'c1']
		]);
	});

	it('Zyklus in der parentId-Kette', () => {
		const doc = emptyDoc({
			containers: [
				container('c1', { parentId: 'c2', sections: [{ label: '', memberIds: ['c2', 'c4'] }] }),
				container('c2', { parentId: 'c1', sections: [{ label: '', memberIds: ['c1'] }] }),
				container('c3', { parentId: 'c3', sections: [{ label: '', memberIds: ['c3'] }] }),
				container('c4', { parentId: 'c1' })
			]
		});
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([
			['invalid-container-ref', 'c1'],
			['invalid-container-ref', 'c2'],
			['invalid-container-ref', 'c3']
		]);
		expect(issues[0].message).toContain('Zyklus');
	});

	it('Eintrag einer Kante oder eines Containers widerspricht parentId', () => {
		const doc = sampleDoc();
		doc.containers.push(container('c2', { parentId: 'c1' }));
		doc.order.push('e2', 'c2');
		doc.containers[0].sections[0].memberIds.push('e1');
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([
			['invalid-container-ref', 'e2'],
			['invalid-container-ref', 'c2'],
			['invalid-container-ref', 'e1']
		]);
		expect(issues[1].message).toContain('Container "c1"');
	});

	it('Knoten-Einträge sind Anweisungsstellen und werden nicht gegen parentId geprüft', () => {
		const doc = sampleDoc();
		doc.order.push('n3');
		doc.containers[0].sections[0].memberIds.push('n1');
		expect(validateModel(doc)).toEqual([]);
	});

	it.each([
		['(a) alleinstehend, dann im Subgraph', 'flowchart TD\nA\nsubgraph S\nA\nend\n'],
		['(b) verschachtelt', 'flowchart TD\nsubgraph O\nA\nsubgraph I\nA --> B\nend\nend\n'],
		[
			'(c) drei Ebenen, dann oberste Ebene',
			'flowchart TD\nsubgraph X\nsubgraph Y\nsubgraph Z\nx --> y\nend\nend\nend\nx\n'
		]
	])('flowchart-Adapter %s ohne Fehler, auch nach serialize + parse', (_name, text) => {
		const first = parseFlowchart(text);
		if (!first.ok) throw new Error(JSON.stringify(first.errors));
		expect(validateModel(first.doc)).toEqual([]);
		const second = parseFlowchart(serializeFlowchart(first.doc));
		if (!second.ok) throw new Error(JSON.stringify(second.errors));
		expect(validateModel(second.doc)).toEqual([]);
	});

	it('fehlender Eintrag bei Kante, Container, RawBlock, Kommentar und Notiz ist Fehler', () => {
		const doc = emptyDoc({
			diagramType: 'sequence',
			order: ['A'],
			nodes: [
				node('A', { kind: 'participant' }),
				node('B', { kind: 'participant' }),
				node('n1', { kind: 'note', props: { participants: ['A'] } })
			],
			edges: [edge('e1', 'A', 'B')],
			containers: [container('c1')],
			rawBlocks: [{ id: 'r1', rawText: 'x' }],
			comments: [{ id: 'k1', text: '%% y' }]
		});
		const issues = validateModel(doc);
		expect(kinds(issues)).toEqual([
			['invalid-container-ref', 'n1'],
			['invalid-container-ref', 'e1'],
			['invalid-container-ref', 'c1'],
			['invalid-container-ref', 'r1'],
			['invalid-container-ref', 'k1']
		]);
		expect(issues[0].message).toContain('verloren');
	});

	it('gleichnamiger Knoten und Container: passende parentId genügt', () => {
		const doc = emptyDoc({
			order: ['S', 'T'],
			nodes: [node('T')],
			containers: [
				container('S', { sections: [{ label: '', memberIds: ['T'] }] }),
				container('T', { parentId: 'S' })
			]
		});
		expect(kinds(validateModel(doc))).toEqual([['node-container-id', 'T']]);
	});
});

/** `n` verschachtelte Container mit je einem Knoten und einer Kante darin (4n Elemente). */
function nested(n: number): DiagramDocument {
	const nodes = [];
	const edges = [];
	const containers = [];
	const order: string[] = [];
	for (let i = 0; i < n; i++) {
		const parent = i === 0 ? null : `c${i - 1}`;
		containers.push(
			container(`c${i}`, {
				parentId: parent,
				sections: [{ label: '', memberIds: [`n${i}`, `e${i}`, `c${i + 1}`] }]
			})
		);
		nodes.push(node(`n${i}`, { parentId: `c${i}` }), node(`m${i}`));
		edges.push(edge(`e${i}`, `n${i}`, `m${i}`, { parentId: `c${i}` }));
		order.push(`m${i}`);
	}
	containers[n - 1].sections[0].memberIds.pop();
	order.push('c0');
	return emptyDoc({ nodes, edges, containers, order });
}

/** Laufzeit von `run` in ms. */
function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

/**
 * Zeitfaktor groß/klein (Vorlage fix-e2): Warmlauf je Größe, 5 Runden im Wechsel (je 4x klein,
 * 1x groß), je Größe das Minimum (filtert Last-Spitzen und GC-Pausen).
 */
function growth(small: () => void, large: () => void): number {
	small();
	large();
	const tSmall: number[] = [];
	const tLarge: number[] = [];
	for (let i = 0; i < 5; i++) {
		for (let k = 0; k < 4; k++) tSmall.push(timed(small));
		tLarge.push(timed(large));
	}
	return Math.min(...tLarge) / Math.min(...tSmall);
}

describe('Reihenfolge, Meldungen, Laufzeit', () => {
	function broken(): DiagramDocument {
		const doc = removeNode(sampleDoc(), 'n2', 'mark');
		doc.order.push('x');
		doc.nodes.push(node('n1'), node('z', { parentId: 'q' }));
		return doc;
	}

	it('deterministisch und nach Klassen geordnet', () => {
		const first = validateModel(broken());
		expect(validateModel(broken())).toEqual(first);
		expect(first.map((i) => i.kind)).toEqual([
			'duplicate-id',
			'unknown-id',
			'invalid-container-ref',
			'dangling-edge',
			'dangling-edge'
		]);
	});

	it('Meldungen deutsch, ohne Pfade und Gedankenstriche', () => {
		for (const issue of validateModel(broken())) {
			expect(issue.message).not.toMatch(/[/\\]|[\u2013\u2014]|Error|\bat /);
			expect(issue.message.length).toBeGreaterThan(0);
		}
		expect(validateModel(broken()).some((i) => /[äöüÄÖÜß]/.test(i.message))).toBe(true);
	});

	// Verhältnis statt absoluter Zeit: Die Grenze 500 ms lag unter Gesamtlast nur Faktor 2 bis 3
	// über der Messung. 16-fache Tiefe ergibt linear 27 bis 60 (Allokation und GC wachsen mit),
	// quadratisch (z. B. Vorfahren-Kette je Element) etwa 256. Grenze 128 = Exponent 1,75.
	it('10000 Elemente: 16-fache Tiefe < 128-fache Zeit', () => {
		const small = nested(156);
		const large = nested(2500);
		expect(validateModel(large)).toEqual([]);
		expect(
			growth(
				() => validateModel(small),
				() => validateModel(large)
			)
		).toBeLessThan(128);
	});
});
