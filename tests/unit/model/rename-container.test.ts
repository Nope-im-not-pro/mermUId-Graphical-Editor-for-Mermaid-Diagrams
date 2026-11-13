import { describe, expect, it } from 'vitest';
import { autoSubgraphId, renameContainer } from '../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../src/lib/model/types';
import { container, deepFreeze, edge, emptyDoc, node } from './fixtures';

// T111 C3 (V-13, O-104): stabile Editor-ID für unbenannte Subgraphen mit gespeicherter Position.

const auto = (id: string, head: string, extra = {}) =>
	container(id, { label: head, props: { openText: `    subgraph ${head}\n` }, ...extra });

/** subGraph0 (aussen) > subGraph1 (innen, B) ; A aussen; Kante B -> subGraph1, Container-ID-Knoten. */
function nested(): DiagramDocument {
	return emptyDoc({
		order: ['A', 'subGraph0', 'e1'],
		nodes: [
			node('A', { parentId: 'subGraph0', props: { stmtParent: 'subGraph0' } }),
			node('B', { parentId: 'subGraph1', props: { stmtText: '  B\n', stmtParent: 'subGraph1' } }),
			node('subGraph1')
		],
		edges: [edge('e1', 'B', 'subGraph1'), edge('e2', 'A', 'B', { parentId: 'subGraph0' })],
		containers: [
			auto('subGraph1', 'Innen Teil', {
				parentId: 'subGraph0',
				sections: [{ label: '', memberIds: ['B'] }]
			}),
			auto('subGraph0', 'Aussen Teil', {
				sections: [{ label: '', memberIds: ['A', 'subGraph1', 'e2'] }]
			})
		],
		layout: {
			mode: 'manual',
			engine: 'dagre',
			positions: { A: [0, 0, 1, 1], subGraph1: [5, 5, 50, 50], B: [6, 6, 1, 1] },
			gridSize: 10,
			snap: false
		}
	});
}

describe('autoSubgraphId', () => {
	it('mermaid-Auto-ID ohne ID im Kopftext', () => {
		expect(autoSubgraphId(auto('subGraph0', 'Erste Gruppe'))).toBe(true);
		expect(autoSubgraphId(auto('subGraph12', '"Mit Leer zeichen"'))).toBe(true);
		// Label beginnt mit dem Auto-ID-Text, ist aber keine ID (Leerraum ohne `[`).
		expect(autoSubgraphId(auto('subGraph1', 'subGraph1 foo'))).toBe(true);
	});

	it('explizite ID im Kopftext, andere ID oder ohne Kopftext: nein', () => {
		expect(autoSubgraphId(auto('subGraph1', 'subGraph1'))).toBe(false);
		expect(autoSubgraphId(auto('subGraph1', '"subGraph1"'))).toBe(false);
		expect(autoSubgraphId(auto('subGraph1', 'subGraph1 [Titel]'))).toBe(false);
		expect(autoSubgraphId(auto('subGraph1', 'subGraph1[Titel]'))).toBe(false);
		expect(autoSubgraphId(auto('subGraph1', 'subGraph1;'))).toBe(false);
		expect(autoSubgraphId(auto('S1', 'S1 Gruppe'))).toBe(false);
		expect(autoSubgraphId(auto('c3', 'Gruppe x'))).toBe(false);
		expect(autoSubgraphId(container('subGraph1'))).toBe(false);
		// Mehrzeiliger Klammer-Titel nennt die ID ebenfalls (O-111 (4)).
		expect(autoSubgraphId(auto('subGraph1', 'subGraph1 ["zwei\n Zeilen"]'))).toBe(false);
	});
});

describe('renameContainer', () => {
	it('benennt alle Bezüge um, Eingabe unverändert, ein modelVersion-Schritt', () => {
		const input = deepFreeze(nested());
		const snapshot = structuredClone(input);
		const out = renameContainer(input, 'subGraph1', 'c7');
		expect(input).toEqual(snapshot);
		expect(out.modelVersion).toBe(input.modelVersion + 1);
		expect(out.containers.map((c) => [c.id, c.parentId, c.sections[0].memberIds])).toEqual([
			['c7', 'subGraph0', ['B']],
			['subGraph0', null, ['A', 'c7', 'e2']]
		]);
		expect(out.nodes.map((n) => [n.id, n.parentId, n.props.stmtParent])).toEqual([
			['A', 'subGraph0', 'subGraph0'],
			['B', 'c7', 'c7'],
			['c7', null, undefined]
		]);
		expect(out.edges.map((e) => [e.id, e.sourceId, e.targetId])).toEqual([
			['e1', 'B', 'c7'],
			['e2', 'A', 'B']
		]);
		expect(out.layout.positions).toEqual({
			A: [0, 0, 1, 1],
			c7: [5, 5, 50, 50],
			B: [6, 6, 1, 1]
		});
	});

	it('geänderte Elemente verlieren sourceText, Kopftext des Containers entfällt', () => {
		const out = renameContainer(nested(), 'subGraph1', 'c7');
		const box = out.containers.find((c) => c.id === 'c7')!;
		expect(box.sourceText).toBe('');
		expect(box.props.openText).toBeUndefined();
		expect(out.containers.find((c) => c.id === 'subGraph0')!.sourceText).toBe('');
		expect(out.edges.find((e) => e.id === 'e1')!.sourceText).toBe('');
		expect(out.nodes.find((n) => n.id === 'c7')!.sourceText).toBe('');
		// Mitglieder: Anweisung unverändert (gleiche Bedeutung), nur Bezug umbenannt.
		expect(out.nodes.find((n) => n.id === 'B')!.props.stmtText).toBe('  B\n');
		// Unbeteiligte bleiben dieselben Objekte.
		const before = nested();
		const kept = renameContainer(before, 'subGraph1', 'c7');
		expect(kept.edges[1]).toBe(before.edges[1]);
		expect(kept.nodes[0]).toBe(before.nodes[0]);
	});

	it('oberste Ebene: order wird umbenannt', () => {
		const out = renameContainer(nested(), 'subGraph0', 'c8');
		expect(out.order).toEqual(['A', 'c8', 'e1']);
		expect(out.containers.find((c) => c.id === 'subGraph1')!.parentId).toBe('c8');
		expect(out.edges.find((e) => e.id === 'e2')!.parentId).toBe('c8');
		expect(out.nodes.find((n) => n.id === 'A')!.props.stmtParent).toBe('c8');
	});

	it('unbekannter Container oder vergebene Ziel-ID: Error', () => {
		expect(() => renameContainer(nested(), 'xX', 'c7')).toThrow(/xX/);
		expect(() => renameContainer(nested(), 'subGraph1', 'A')).toThrow(/A/);
	});

	it('Container-ID-Knoten mit Label = alte ID erhält die neue ID als Label (O-111 (3))', () => {
		const doc = nested();
		const named = {
			...doc,
			nodes: doc.nodes.map((n) => (n.id === 'subGraph1' ? { ...n, label: 'Eigen' } : n))
		};
		expect(renameContainer(doc, 'subGraph1', 'c7').nodes[2].label).toBe('c7');
		expect(renameContainer(named, 'subGraph1', 'c7').nodes[2].label).toBe('Eigen');
	});
});

describe('renameContainer: style/class/click-Zeilen (O-111 (2))', () => {
	const raw = (...lines: string[]) => lines.map((rawText, i) => ({ id: `r${i}`, rawText }));
	const withRaw = (...lines: string[]) => ({ ...nested(), rawBlocks: raw(...lines) });

	it('schreibt den exakten Ziel-Token um, Teiltreffer und andere IDs bleiben', () => {
		const out = renameContainer(
			withRaw(
				'    style subGraph1 fill:#f00\n',
				'    class subGraph1 foo\r\n',
				'    class A, subGraph1 ,subGraph10 foo\n',
				'    click subGraph1 cb "Tipp"\n',
				'    style subGraph10 fill:#0f0\n',
				'    click subGraph10 cb\n',
				'    style xsubGraph1 fill:#00f\n'
			),
			'subGraph1',
			'c7'
		);
		expect(out.rawBlocks.map((r) => r.rawText)).toEqual([
			'    style c7 fill:#f00\n',
			'    class c7 foo\r\n',
			'    class A, c7 ,subGraph10 foo\n',
			'    click c7 cb "Tipp"\n',
			'    style subGraph10 fill:#0f0\n',
			'    click subGraph10 cb\n',
			'    style xsubGraph1 fill:#00f\n'
		]);
		expect(out.rawBlocks.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
	});

	it('weitere Nennung, die nicht sicher umschreibbar ist: keine Umbenennung', () => {
		for (const line of [
			'    click subGraph1 call(subGraph1)\n',
			'    style A fill:#f00 %% subGraph1\n',
			'    subGraph1 --> A; style subGraph1 fill:#f00\n',
			'    class subGraph1\n'
		]) {
			const doc = withRaw('    style subGraph1 fill:#f00\n', line);
			expect(renameContainer(doc, 'subGraph1', 'c7'), line).toBe(doc);
		}
	});
});
