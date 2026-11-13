import { describe, expect, it } from 'vitest';
import { initCounters, nextId } from '../../../src/lib/model/ids';
import { addNode, removeNode } from '../../../src/lib/model/operations';
import { container, edge, emptyDoc, node } from './fixtures';

describe('initCounters (D-03 Auflage a)', () => {
	it('Zeile mit Zähler 5, IDs n1..n3 -> nächste ID n5', () => {
		const doc = emptyDoc({ nodes: [node('n1'), node('n2'), node('n3')] });
		const counters = initCounters(doc, { n: 5 });
		expect(nextId(counters, 'n').id).toBe('n5');
	});

	it('Zeile mit Zähler 2, Nutzer-ID n9 im Code -> nächste ID n10', () => {
		const doc = emptyDoc({ nodes: [node('n1'), node('n9')] });
		expect(nextId(initCounters(doc, { n: 2 }), 'n').id).toBe('n10');
	});

	it('ohne Zeile: max(Suffix)+1 je Präfix, leeres Dokument startet bei 1', () => {
		const doc = emptyDoc({
			nodes: [node('n4'), node('A'), node('n02x'), node('n05'), node('n0'), node('nfoo')],
			edges: [edge('e7', 'n4', 'A')],
			containers: [container('c3')]
		});
		expect(initCounters(doc)).toEqual({ n: 5, e: 8, c: 4 });
		expect(initCounters(emptyDoc())).toEqual({ n: 1, e: 1, c: 1 });
	});

	it('scannt alle Element-IDs für jedes Präfix (gemeinsamer ID-Raum)', () => {
		const doc = emptyDoc({
			nodes: [node('c9'), node('e2')],
			rawBlocks: [{ id: 'n6', rawText: 'click n6 x' }],
			comments: [{ id: 'n7', text: 'x' }]
		});
		expect(initCounters(doc)).toEqual({ n: 8, e: 3, c: 10 });
	});

	it('fehlendes oder ungültiges Zählerfeld zählt als 0', () => {
		const doc = emptyDoc({ nodes: [node('n2')] });
		expect(initCounters(doc, { n: 'x', e: -3, c: 1.5 })).toEqual({ n: 3, e: 1, c: 1 });
		expect(initCounters(doc, { e: Number.NaN })).toEqual({ n: 3, e: 1, c: 1 });
	});
});

describe('nextId', () => {
	it('ist rein und monoton', () => {
		const counters = Object.freeze({ n: 1, e: 1, c: 1 });
		const a = nextId(counters, 'n');
		const b = nextId(a.counters, 'n');
		expect([a.id, b.id]).toEqual(['n1', 'n2']);
		expect(counters).toEqual({ n: 1, e: 1, c: 1 });
		expect(nextId(b.counters, 'c').id).toBe('c1');
		expect(nextId(b.counters, 'e').counters).toEqual({ n: 3, e: 2, c: 1 });
	});

	it('Create n4, Undo, Create -> n5 (Zähler nicht Teil des Undo-Zustands)', () => {
		const start = emptyDoc({ nodes: [node('n1'), node('n2'), node('n3')] });
		let counters = initCounters(start);
		const undoStack = [start];

		const first = nextId(counters, 'n');
		counters = first.counters;
		undoStack.push(addNode(start, node(first.id)));
		expect(first.id).toBe('n4');

		// Undo stellt nur den Dokument-Snapshot wieder her, nicht den Zähler.
		undoStack.pop();
		const restored = undoStack.at(-1)!;
		expect(restored.nodes.map((n) => n.id)).not.toContain('n4');
		// Ein Neuaufbau aus dem Snapshot ergäbe wieder n4; der gehaltene Zähler bleibt bei 5.
		expect(initCounters(restored).n).toBe(4);
		expect(counters.n).toBe(5);

		const second = nextId(counters, 'n');
		expect(second.id).toBe('n5');
		expect(addNode(restored, node(second.id)).nodes.map((n) => n.id)).toEqual([
			'n1',
			'n2',
			'n3',
			'n5'
		]);
	});

	it('Kill-Kriterium eingeengt auf Position: n3 löschen, neues n3 erbt keine alte Position', () => {
		const withPos = emptyDoc({
			order: ['n1', 'n2', 'n3'],
			nodes: [node('n1'), node('n2'), node('n3')],
			layout: {
				mode: 'manual',
				engine: 'dagre',
				positions: { n2: [1, 1, 1, 1], n3: [9, 9, 9, 9] },
				gridSize: 10,
				snap: false
			}
		});
		const deleted = removeNode(withPos, 'n3', 'cascade');
		expect(deleted.layout.positions).toEqual({ n2: [1, 1, 1, 1] });

		// Ohne Zeile wird n3 nach Neuladen wieder vergeben, die alte Position ist aber weg.
		const { id } = nextId(initCounters(deleted), 'n');
		expect(id).toBe('n3');
		expect(addNode(deleted, node(id)).layout.positions).toEqual({ n2: [1, 1, 1, 1] });

		// Mit Zeile (Zähler 4) keine Wiederverwendung.
		expect(nextId(initCounters(deleted, { n: 4 }), 'n').id).toBe('n4');
	});
});
