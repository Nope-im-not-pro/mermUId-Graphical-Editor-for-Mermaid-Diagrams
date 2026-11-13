import { describe, expect, it } from 'vitest';
import { initCounters } from '../../../../src/lib/model/ids';
import type {
	Container,
	DiagramDocument,
	DiagramNode,
	Position
} from '../../../../src/lib/model/types';
import {
	layoutGraph,
	layoutSequence,
	toRankdir,
	type MeasureElement
} from '../../../../src/lib/services/layout';
import { joinMeta, readMeta, splitMeta, writeMeta } from '../../../../src/lib/services/meta';
import { container, deepFreeze, edge, emptyDoc, node } from '../../model/fixtures';

/** Deterministischer Stub statt DOM-Messung (D-04). */
const measure: MeasureElement = (el: DiagramNode | Container) => ({
	width: 20 + el.label.length * 7,
	height: 30
});

function inside(inner: Position, outer: Position): boolean {
	return (
		inner[0] >= outer[0] &&
		inner[1] >= outer[1] &&
		inner[0] + inner[2] <= outer[0] + outer[2] &&
		inner[1] + inner[3] <= outer[1] + outer[3]
	);
}

function chain(): DiagramDocument {
	return emptyDoc({
		order: ['A', 'B', 'C', 'e1', 'e2'],
		nodes: [node('A'), node('B', { label: 'Breites Label' }), node('C')],
		edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')]
	});
}

describe('toRankdir', () => {
	it.each([
		['TD', 'TB'],
		['TB', 'TB'],
		['BT', 'BT'],
		['LR', 'LR'],
		['RL', 'RL'],
		['', 'TB'],
		['xy', 'TB']
	])('%s -> %s', (dir, expected) => expect(toRankdir(dir)).toBe(expected));
});

describe('layoutGraph (dagre)', () => {
	it('liefert [x, y, w, h] je Knoten mit gemessener Größe, Reihenfolge entlang der Kanten', () => {
		const pos = layoutGraph(chain(), measure);
		expect(Object.keys(pos).sort()).toEqual(['A', 'B', 'C']);
		expect(pos.B[2]).toBe(20 + 'Breites Label'.length * 7);
		expect(pos.B[3]).toBe(30);
		expect(pos.A[1]).toBeLessThan(pos.B[1]);
		expect(pos.B[1]).toBeLessThan(pos.C[1]);
	});

	it('Richtung LR ordnet horizontal', () => {
		const pos = layoutGraph(chain(), measure, { direction: 'LR' });
		expect(pos.A[0]).toBeLessThan(pos.B[0]);
		expect(pos.B[0]).toBeLessThan(pos.C[0]);
	});

	it('Container (compound, verschachtelt) umschließen ihre Kinder', () => {
		const doc = emptyDoc({
			nodes: [
				node('A'),
				node('B', { parentId: 'c1' }),
				node('C', { parentId: 'c2' }),
				node('D', { parentId: 'c2' })
			],
			edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'C', 'D')],
			containers: [container('c1'), container('c2', { parentId: 'c1' }), container('leer')]
		});
		const pos = layoutGraph(doc, measure);
		expect(Object.keys(pos).sort()).toEqual(['A', 'B', 'C', 'D', 'c1', 'c2', 'leer']);
		expect(inside(pos.B, pos.c1)).toBe(true);
		expect(inside(pos.c2, pos.c1)).toBe(true);
		expect(inside(pos.C, pos.c2)).toBe(true);
		expect(inside(pos.D, pos.c2)).toBe(true);
		expect(inside(pos.A, pos.c1)).toBe(false);
		// leerer Container ist ein Blatt mit gemessener Größe
		expect(pos.leer.slice(2)).toEqual([20 + 'leer'.length * 7, 30]);
	});

	it('Kanten zu Containern mit Kindern, dangling Kanten und Mehrfachkanten brechen nicht', () => {
		const doc = emptyDoc({
			nodes: [node('A'), node('B', { parentId: 'c1' })],
			edges: [
				edge('e1', 'A', 'c1'),
				edge('e2', 'A', 'weg'),
				edge('e3', 'A', 'B'),
				edge('e4', 'A', 'B'),
				edge('e5', 'A', 'A')
			],
			containers: [container('c1')]
		});
		expect(Object.keys(layoutGraph(doc, measure)).sort()).toEqual(['A', 'B', 'c1']);
	});

	it('Container-Parent-Zyklus und Selbstverweis brechen nicht (R1-P2)', () => {
		const doc = emptyDoc({
			nodes: [node('A', { parentId: 'c1' })],
			containers: [
				container('c1', { parentId: 'c2' }),
				container('c2', { parentId: 'c1' }),
				container('s', { parentId: 's' })
			]
		});
		const pos = layoutGraph(doc, measure);
		expect(Object.keys(pos).sort()).toEqual(['A', 'c1', 'c2', 's']);
		expect(Object.values(pos).flat().every(Number.isFinite)).toBe(true);
		expect(pos.s.slice(2)).toEqual([20 + 's'.length * 7, 30]);
	});

	it('Knoten und Container mit gleicher ID: zweites Vorkommen entfällt (R1-P2)', () => {
		const doc = emptyDoc({
			nodes: [node('X', { parentId: 'X' }), node('A'), node('A')],
			edges: [edge('e1', 'A', 'X')],
			containers: [container('X')]
		});
		const pos = layoutGraph(doc, measure);
		expect(Object.keys(pos).sort()).toEqual(['A', 'X']);
		expect(pos.X.slice(2)).toEqual([20 + 'X'.length * 7, 30]);
	});

	it('ignoriert Snap und Raster', () => {
		const doc = chain();
		const snapped = { ...doc, layout: { ...doc.layout, snap: true, gridSize: 37 } };
		const free = { ...doc, layout: { ...doc.layout, snap: false, gridSize: 10 } };
		const a = layoutGraph(snapped, measure);
		expect(a).toEqual(layoutGraph(free, measure));
		expect(Object.values(a).some((p) => p[0] % 37 !== 0 || p[1] % 37 !== 0)).toBe(true);
	});

	it('rein: Eingabe bleibt unverändert, Ergebnis deterministisch', () => {
		const doc = deepFreeze(chain());
		expect(layoutGraph(doc, measure)).toEqual(layoutGraph(doc, measure));
	});

	it('dagre-Positionen werden nie in die Metadaten geschrieben', () => {
		const doc = chain();
		const computed = layoutGraph(doc, measure);
		expect(Object.keys(computed)).toHaveLength(3);
		expect(doc.layout.positions).toEqual({});
		const { metaLine } = writeMeta({
			loaded: null,
			doc,
			counters: initCounters(doc),
			embed: true
		});
		expect(metaLine).toBeNull();
	});
});

describe('manuell -> auto -> manuell (D-02)', () => {
	it('erhält alle Positionen über Speichern und Laden', () => {
		const manual: Record<string, Position> = {
			A: [40, 60, 80, 40],
			B: [220.5, 60, 120, 40],
			C: [400, 60, 80, 40]
		};
		const base = chain();
		const doc1: DiagramDocument = {
			...base,
			layout: { ...base.layout, mode: 'manual', positions: manual }
		};
		const body = 'flowchart TD\n  A --> B\n  B --> C\n';

		// manuell speichern
		const save1 = writeMeta({ loaded: null, doc: doc1, counters: initCounters(doc1), embed: true });
		const text1 = joinMeta({ ...splitMeta(body), metaLine: save1.metaLine });

		// laden, auf auto schalten, dagre rechnen, speichern
		const read1 = readMeta(splitMeta(text1).metaLine);
		const doc2: DiagramDocument = {
			...base,
			layout: { ...base.layout, mode: 'auto', positions: { ...read1.loaded!.positions } }
		};
		const auto = layoutGraph(doc2, measure);
		expect(auto.A).not.toEqual(manual.A);
		const save2 = writeMeta({
			loaded: read1.loaded,
			doc: doc2,
			counters: initCounters(doc2, read1.loaded!.storedIds),
			embed: true
		});
		expect(save2.metaLine).toContain('"layout":"auto"');
		const text2 = joinMeta({ ...splitMeta(text1), metaLine: save2.metaLine });

		// laden, zurück auf manuell
		const read2 = readMeta(splitMeta(text2).metaLine);
		expect(read2.loaded!.mode).toBe('auto');
		expect(read2.loaded!.positions).toEqual(manual);
		const doc3: DiagramDocument = {
			...base,
			layout: { ...base.layout, mode: 'manual', positions: { ...read2.loaded!.positions } }
		};
		expect(doc3.layout.positions).toEqual(manual);
		const save3 = writeMeta({
			loaded: read2.loaded,
			doc: doc3,
			counters: initCounters(doc3, read2.loaded!.storedIds),
			embed: true
		});
		expect(joinMeta({ ...splitMeta(text2), metaLine: save3.metaLine })).toBe(text1);
	});
});

function sequenceDoc(): DiagramDocument {
	return emptyDoc({
		diagramType: 'sequence',
		order: ['Alice', 'Bob', 'm1', 'loop1', 'note1', 'm4'],
		nodes: [
			node('Alice', { kind: 'participant' }),
			node('Bob', { kind: 'actor' }),
			node('Carol', { kind: 'participant', label: 'Carol Lang' }),
			node('note1', { kind: 'note', label: 'Hinweis' })
		],
		edges: [
			edge('m1', 'Alice', 'Bob', { kind: 'message' }),
			edge('m2', 'Bob', 'Carol', { kind: 'message', parentId: 'loop1' }),
			edge('m3', 'Carol', 'Bob', { kind: 'message', parentId: 'loop1' }),
			edge('m4', 'Bob', 'Alice', { kind: 'message' })
		],
		containers: [
			container('loop1', {
				kind: 'alt',
				sections: [
					{ label: 'ja', memberIds: ['m2'] },
					{ label: 'nein', memberIds: ['m3'] }
				]
			})
		]
	});
}

describe('layoutSequence', () => {
	it('Teilnehmer nebeneinander in Reihenfolge des Auftretens, Breite gemessen', () => {
		const out = layoutSequence(sequenceDoc(), measure);
		expect(Object.keys(out.participants)).toEqual(['Alice', 'Bob', 'Carol']);
		const { Alice, Bob, Carol } = out.participants;
		expect(Alice[0]).toBe(0);
		expect(Bob[0]).toBeGreaterThan(Alice[0] + Alice[2]);
		expect(Carol[0]).toBeGreaterThan(Bob[0] + Bob[2]);
		expect(Carol[2]).toBe(20 + 'Carol Lang'.length * 7);
		expect(out.participants.note1).toBeUndefined();
	});

	it('Nachrichten und Notizen in Zeilen streng nach order/Section.memberIds', () => {
		const out = layoutSequence(sequenceDoc(), measure);
		const ys = ['m1', 'm2', 'm3', 'note1', 'm4'].map((id) => out.rows[id]);
		for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
		const head = Math.max(...Object.values(out.participants).map((p) => p[1] + p[3]));
		expect(ys[0]).toBeGreaterThan(head);
		expect(out.height).toBeGreaterThan(ys[ys.length - 1]);
	});

	it('Container umfasst seine Zeilen und die beteiligten Teilnehmer', () => {
		const out = layoutSequence(sequenceDoc(), measure);
		const box = out.containers.loop1;
		expect(box[1]).toBeLessThan(out.rows.m2);
		expect(box[1] + box[3]).toBeGreaterThan(out.rows.m3);
		expect(box[1] + box[3]).toBeLessThan(out.rows.note1);
		const { Bob, Carol, Alice } = out.participants;
		expect(box[0]).toBeLessThanOrEqual(Bob[0]);
		expect(box[0] + box[2]).toBeGreaterThanOrEqual(Carol[0] + Carol[2]);
		expect(box[0]).toBeGreaterThan(Alice[0] + Alice[2] / 2);
	});

	it('Umsortieren in order tauscht die Zeilen', () => {
		const doc = sequenceDoc();
		const swapped = { ...doc, order: ['Alice', 'Bob', 'm4', 'loop1', 'note1', 'm1'] };
		const a = layoutSequence(doc, measure);
		const b = layoutSequence(swapped, measure);
		expect(b.rows.m4).toBe(a.rows.m1);
		expect(b.rows.m1).toBe(a.rows.m4);
	});

	it('keine freien Koordinaten: Positionen im Modell, Snap und Raster wirken nicht', () => {
		const doc = sequenceDoc();
		const noisy = {
			...doc,
			layout: {
				...doc.layout,
				mode: 'manual' as const,
				snap: true,
				gridSize: 33,
				positions: { Alice: [500, 500, 1, 1] as Position, m1: [9, 9, 9, 9] as Position }
			}
		};
		expect(layoutSequence(noisy, measure)).toEqual(layoutSequence(deepFreeze(doc), measure));
	});

	it('Section-Selbstverweis und Container-Zyklus terminieren (R1-P2)', () => {
		const doc = emptyDoc({
			order: ['A', 'B', 'l1'],
			nodes: [node('A'), node('B')],
			edges: [edge('m1', 'A', 'B', { kind: 'message' })],
			containers: [
				container('l1', { sections: [{ label: '', memberIds: ['l1', 'm1', 'l2'] }] }),
				container('l2', { sections: [{ label: '', memberIds: ['l1'] }] })
			]
		});
		const out = layoutSequence(doc, measure);
		expect(Object.keys(out.containers).sort()).toEqual(['l1', 'l2']);
		expect(out.rows.m1).toBeGreaterThan(out.containers.l1[1]);
	});

	it('activate/deactivate belegen keine Zeile, Teilnehmer werden registriert (E1-P3)', () => {
		const base = emptyDoc({
			order: ['m1', 'm2'],
			nodes: [node('A'), node('B'), node('C')],
			edges: [edge('m1', 'A', 'B', { kind: 'message' }), edge('m2', 'B', 'A', { kind: 'message' })]
		});
		const withAct = {
			...base,
			order: ['m1', 'a1', 'd1', 'm2'],
			edges: [
				...base.edges,
				edge('a1', 'C', 'C', { kind: 'activate' }),
				edge('d1', 'C', 'C', { kind: 'deactivate' })
			]
		};
		const plain = layoutSequence(base, measure);
		const out = layoutSequence(withAct, measure);
		expect(out.rows.m2 - out.rows.m1).toBe(plain.rows.m2 - plain.rows.m1);
		expect(out.rows.a1).toBeUndefined();
		expect(out.rows.d1).toBeUndefined();
		expect(out.height).toBe(plain.height);
		expect(Object.keys(out.participants)).toEqual(['A', 'B', 'C']);
	});

	it('Container ohne Teilnehmer spannt die volle Breite, unbekannte IDs werden übergangen', () => {
		const doc = emptyDoc({
			order: ['A', 'B', 'x', 'opt1'],
			nodes: [node('A'), node('B')],
			containers: [container('opt1', { sections: [{ label: '', memberIds: ['fehlt'] }] })]
		});
		const out = layoutSequence(doc, measure);
		const right = out.participants.B[0] + out.participants.B[2];
		expect(out.containers.opt1[0]).toBeLessThanOrEqual(0);
		expect(out.containers.opt1[0] + out.containers.opt1[2]).toBeGreaterThanOrEqual(right);
	});
});

describe('layoutSequence W03-Close-out', () => {
	it('verkraftet 20000 verschachtelte Container ohne Stack-Überlauf', () => {
		const depth = 20000;
		const containers = Array.from({ length: depth }, (_, i) =>
			container(`c${i}`, {
				kind: 'loop',
				parentId: i === 0 ? null : `c${i - 1}`,
				sections: [{ label: '', memberIds: i + 1 < depth ? [`c${i + 1}`] : ['m1'] }]
			})
		);
		const doc = emptyDoc({
			diagramType: 'sequence',
			order: ['c0'],
			nodes: [node('A', { kind: 'participant' }), node('B', { kind: 'participant' })],
			edges: [edge('m1', 'A', 'B', { kind: 'message', parentId: `c${depth - 1}` })],
			containers
		});
		const out = layoutSequence(doc, measure);
		expect(Object.keys(out.participants)).toEqual(['A', 'B']);
		expect(Object.keys(out.containers)).toHaveLength(depth);
	});
});
