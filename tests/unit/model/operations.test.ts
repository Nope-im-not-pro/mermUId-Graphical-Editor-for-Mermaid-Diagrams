import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	addContainer,
	addEdge,
	addNode,
	danglingEdges,
	moveToContainer,
	removeContainer,
	removeEdge,
	removeNode,
	reorder,
	updateContainer,
	updateEdge,
	updateNode
} from '../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../src/lib/model/types';
import { container, deepFreeze, edge, node, sampleDoc } from './fixtures';

/** Zyklus-Fehler der Model-Schicht (T128 C3: Code statt übersetzter Meldung). */
const CYCLE = expect.objectContaining({ name: 'ModelError', code: 'cycle' });

/** Führt op auf eingefrorener Eingabe aus und prüft, dass die Eingabe unverändert bleibt. */
function pure(
	op: (doc: DiagramDocument) => DiagramDocument,
	input: DiagramDocument = sampleDoc()
): DiagramDocument {
	const snapshot = structuredClone(input);
	deepFreeze(input);
	const out = op(input);
	expect(input).toEqual(snapshot);
	expect(out).not.toBe(input);
	expect(out.modelVersion).toBe(input.modelVersion + 1);
	return out;
}

const members = (doc: DiagramDocument, id: string, section = 0) =>
	doc.containers.find((c) => c.id === id)!.sections[section].memberIds;

describe('Knoten', () => {
	it('addNode top-level hängt an order an', () => {
		const out = pure((d) => addNode(d, node('n4')));
		expect(out.nodes.at(-1)!.id).toBe('n4');
		expect(out.order).toEqual(['n1', 'n2', 'e1', 'c1', 'n4']);
	});

	it('addNode mit parentId hängt an Section.memberIds an', () => {
		const out = pure((d) => addNode(d, node('n4', { parentId: 'c1' })));
		expect(out.order).not.toContain('n4');
		expect(members(out, 'c1')).toEqual(['n3', 'e2', 'n4']);
		expect(out.containers[0].sourceText).toBe('');
	});

	it('addNode in gewählte Section', () => {
		const twoSections = sampleDoc();
		twoSections.containers[0].sections = [
			{ label: 'a', memberIds: ['n3', 'e2'] },
			{ label: 'b', memberIds: [] }
		];
		const out = pure((d) => addNode(d, node('n4', { parentId: 'c1' }), 1), twoSections);
		expect(members(out, 'c1', 0)).toEqual(['n3', 'e2']);
		expect(members(out, 'c1', 1)).toEqual(['n4']);
	});

	it('addNode lehnt doppelte ID und unbekannten Container ab', () => {
		const doc = sampleDoc();
		expect(() => addNode(doc, node('n1'))).toThrow(/n1/);
		expect(() => addNode(doc, node('e1'))).toThrow(/e1/);
		expect(() => addNode(doc, node('n9', { parentId: 'cX' }))).toThrow(/cX/);
		expect(() => addNode(doc, node('n9', { parentId: 'c1' }), 3)).toThrow(/Section/);
	});

	it('updateNode leert sourceText und lässt andere Elemente unberührt', () => {
		const out = pure((d) => updateNode(d, 'n2', { label: 'Neu', props: { depth: 2 } }));
		const n2 = out.nodes.find((n) => n.id === 'n2')!;
		expect(n2.label).toBe('Neu');
		expect(n2.props).toEqual({ depth: 2 });
		expect(n2.sourceText).toBe('');
		expect(out.nodes.find((n) => n.id === 'n1')!.sourceText).toBe('n1[n1]');
	});

	it('updateNode mit unverändertem Wert behält sourceText (keine Schein-Änderung, V-13)', () => {
		const out = pure((d) => updateNode(d, 'n1', { label: 'n1', props: {} }));
		expect(out.nodes[0].sourceText).toBe('n1[n1]');
	});

	it('O-47: leeres oder Leerraum-Label wird zu label := id (Flowchart)', () => {
		for (const label of ['', '  ', '\t']) {
			const named = updateNode(sampleDoc(), 'n2', { label: 'x' });
			const out = pure((d) => updateNode(d, 'n2', { label }), named);
			expect(out.nodes[1]).toMatchObject({ label: 'n2', sourceText: '' });
		}
		const c = pure((d) => updateContainer(d, 'c1', { label: ' ' }));
		expect(c.containers[0].label).toBe('c1');
	});

	it('O-97: Label wird wie mermaid getrimmt (Knoten, Kanten, Subgraphen im Flowchart)', () => {
		const out = pure((d) => updateNode(d, 'n2', { label: ' \n Fertig \t\n' }));
		expect(out.nodes[1]).toMatchObject({ label: 'Fertig', sourceText: '' });
		expect(pure((d) => updateNode(d, 'n2', { label: 'a\n b' })).nodes[1].label).toBe('a\n b');
		expect(pure((d) => updateEdge(d, 'e1', { label: 'ja ' })).edges[0].label).toBe('ja');
		expect(pure((d) => updateEdge(d, 'e1', { label: ' ' })).edges[0].label).toBe('');
		expect(pure((d) => updateContainer(d, 'c1', { label: '\nTitel ' })).containers[0].label).toBe(
			'Titel'
		);
		const seq = { ...sampleDoc(), diagramType: 'sequence' };
		expect(pure((d) => updateContainer(d, 'c1', { label: ' x ' }), seq).containers[0].label).toBe(
			' x '
		);
	});

	it('O-47 gilt nicht für Sequenz-Blöcke und Kanten (leeres Label dort gültig)', () => {
		const seq = { ...sampleDoc(), diagramType: 'sequence' };
		expect(pure((d) => updateContainer(d, 'c1', { label: '' }), seq).containers[0].label).toBe('');
		expect(pure((d) => updateEdge(d, 'e1', { label: '' })).edges[0].label).toBe('');
	});

	it('updateNode auf unbekannte ID wirft', () => {
		expect(() => updateNode(sampleDoc(), 'nX', { label: 'x' })).toThrow(/nX/);
	});

	it('removeNode "cascade" entfernt Knoten und referenzierende Kanten samt order, memberIds, Positionen', () => {
		const out = pure((d) => removeNode(d, 'n2', 'cascade'));
		expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
		expect(out.edges).toEqual([]);
		expect(out.order).toEqual(['n1', 'c1']);
		expect(members(out, 'c1')).toEqual(['n3']);
		expect(out.layout.positions).toEqual({ n1: [0, 0, 10, 10], n3: [5, 5, 10, 10] });
		expect(out.containers[0].sourceText).toBe('');
	});

	it('removeNode "mark" behält Kanten unverändert, danglingEdges leitet sie ab', () => {
		const out = pure((d) => removeNode(d, 'n3', 'mark'));
		expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
		expect(members(out, 'c1')).toEqual(['e2']);
		expect(out.edges).toEqual(sampleDoc().edges);
		expect(danglingEdges(out).map((e) => e.id)).toEqual(['e2']);
		expect(out.layout.positions).not.toHaveProperty('n3');
	});

	it('danglingEdges: Neuanlage der ID hebt den Befund auf', () => {
		const marked = removeNode(sampleDoc(), 'n3', 'mark');
		expect(danglingEdges(marked).map((e) => e.id)).toEqual(['e2']);
		const recreated = addNode(marked, node('n3', { parentId: 'c1' }));
		expect(danglingEdges(recreated)).toEqual([]);
		const retargeted = updateEdge(marked, 'e2', { targetId: 'n1' });
		expect(danglingEdges(retargeted)).toEqual([]);
		expect(danglingEdges(sampleDoc())).toEqual([]);
	});

	it('removeNode auf unbekannte ID wirft', () => {
		expect(() => removeNode(sampleDoc(), 'nX', 'cascade')).toThrow(/nX/);
	});
});

describe('Kanten', () => {
	it('addEdge top-level und in Container', () => {
		const top = pure((d) => addEdge(d, edge('e3', 'n1', 'n3')));
		expect(top.order.at(-1)).toBe('e3');
		const inner = pure((d) => addEdge(d, edge('e3', 'n3', 'n3', { parentId: 'c1' })));
		expect(members(inner, 'c1')).toEqual(['n3', 'e2', 'e3']);
	});

	it('addEdge lehnt unbekannte Endpunkte ab, Container als Endpunkt erlaubt', () => {
		const doc = sampleDoc();
		expect(() => addEdge(doc, edge('e3', 'nX', 'n1'))).toThrow(/nX/);
		expect(() => addEdge(doc, edge('e3', 'n1', 'nY'))).toThrow(/nY/);
		expect(() => addEdge(doc, edge('e3', 'n1', 'e1'))).toThrow(/e1/);
		expect(pure((d) => addEdge(d, edge('e3', 'n1', 'c1'))).edges.at(-1)!.targetId).toBe('c1');
	});

	it('updateEdge prüft nur geänderte Endpunkte, Dangling-Kante bleibt editierbar', () => {
		expect(() => updateEdge(sampleDoc(), 'e1', { sourceId: 'nX' })).toThrow(/nX/);
		expect(() => updateEdge(sampleDoc(), 'e1', { targetId: 'nY' })).toThrow(/nY/);
		const marked = removeNode(sampleDoc(), 'n3', 'mark');
		const out = updateEdge(marked, 'e2', { label: 'x', targetId: 'n3' });
		expect(out.edges[1]).toMatchObject({ label: 'x', targetId: 'n3', sourceText: '' });
		expect(() => updateEdge(marked, 'e2', { sourceId: 'n3' })).toThrow(/n3/);
	});

	it('updateEdge leert sourceText', () => {
		const out = pure((d) => updateEdge(d, 'e1', { label: 'ja', targetId: 'n3' }));
		expect(out.edges[0]).toMatchObject({ label: 'ja', targetId: 'n3', sourceText: '' });
		expect(out.edges[1].sourceText).toBe('n2 --> n3');
	});

	it('removeEdge entfernt aus edges, order, memberIds und Positionen', () => {
		const top = pure((d) => removeEdge(d, 'e1'));
		expect(top.edges.map((e) => e.id)).toEqual(['e2']);
		expect(top.order).toEqual(['n1', 'n2', 'c1']);
		expect(top.layout.positions).not.toHaveProperty('e1');
		const inner = pure((d) => removeEdge(d, 'e2'));
		expect(members(inner, 'c1')).toEqual(['n3']);
	});

	it('removeEdge auf unbekannte ID wirft', () => {
		expect(() => removeEdge(sampleDoc(), 'eX')).toThrow(/eX/);
	});
});

describe('Container', () => {
	it('addContainer top-level und verschachtelt', () => {
		const top = pure((d) => addContainer(d, container('c2')));
		expect(top.containers.map((c) => c.id)).toEqual(['c1', 'c2']);
		expect(top.order.at(-1)).toBe('c2');
		const nested = pure((d) => addContainer(d, container('c2', { parentId: 'c1' })));
		expect(members(nested, 'c1')).toEqual(['n3', 'e2', 'c2']);
	});

	it('updateContainer leert sourceText', () => {
		const out = pure((d) => updateContainer(d, 'c1', { label: 'X', direction: 'LR' }));
		expect(out.containers[0]).toMatchObject({ label: 'X', direction: 'LR', sourceText: '' });
	});

	it('updateContainer erlaubt keine sections im Patch', () => {
		expectTypeOf<Parameters<typeof updateContainer>[2]>().not.toHaveProperty('sections');
	});
});

/** sampleDoc plus c2 in c1 (mit n4), Kanten e3 n1->n4 und e4 n2->c2 auf oberster Ebene. */
function nestedDoc(): DiagramDocument {
	let doc = addContainer(sampleDoc(), container('c2', { parentId: 'c1' }));
	doc = addNode(doc, node('n4', { parentId: 'c2' }));
	doc = addEdge(doc, edge('e3', 'n1', 'n4'));
	doc = addEdge(doc, edge('e4', 'n2', 'c2'));
	doc.layout = { ...doc.layout, positions: { ...doc.layout.positions, n4: [2, 2, 2, 2] } };
	return { ...doc, modelVersion: 0 };
}

describe('removeContainer', () => {
	it('"cascade" löscht Kinder rekursiv und Kanten mit gelöschtem Endpunkt', () => {
		const out = pure((d) => removeContainer(d, 'c1', 'cascade'), nestedDoc());
		expect(out.containers).toEqual([]);
		expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
		expect(out.edges.map((e) => e.id)).toEqual(['e1']);
		expect(out.order).toEqual(['n1', 'n2', 'e1']);
		expect(out.layout.positions).toEqual({ n1: [0, 0, 10, 10], e1: [1, 1, 1, 1] });
		expect(danglingEdges(out)).toEqual([]);
	});

	it('entfernt rawBlocks und comments des Containers (V-10)', () => {
		const doc = sampleDoc();
		doc.rawBlocks = [
			{ id: 'r1', rawText: '' },
			{ id: 'r2', rawText: '' }
		];
		doc.comments = [
			{ id: 'k1', text: '%% x' },
			{ id: 'k2', text: '%% y' }
		];
		doc.order = [...doc.order, 'r2', 'k2'];
		doc.containers[0].sections[0].memberIds.push('r1', 'k1');
		for (const mode of ['cascade', 'mark'] as const) {
			const out = pure((d) => removeContainer(d, 'c1', mode), structuredClone(doc));
			expect(out.rawBlocks.map((r) => r.id)).toEqual(['r2']);
			expect(out.comments.map((k) => k.id)).toEqual(['k2']);
		}
	});

	it('"mark" löscht Kinder rekursiv und behält Kanten von außen', () => {
		const out = pure((d) => removeContainer(d, 'c1', 'mark'), nestedDoc());
		expect(out.containers).toEqual([]);
		expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
		expect(out.edges.map((e) => e.id)).toEqual(['e1', 'e3', 'e4']);
		expect(out.order).toEqual(['n1', 'n2', 'e1', 'e3', 'e4']);
		expect(danglingEdges(out).map((e) => e.id)).toEqual(['e3', 'e4']);
	});

	it('Unter-Container entfernen bereinigt memberIds des Eltern-Containers', () => {
		const out = pure((d) => removeContainer(d, 'c2', 'cascade'), nestedDoc());
		expect(out.containers.map((c) => c.id)).toEqual(['c1']);
		expect(members(out, 'c1')).toEqual(['n3', 'e2']);
		expect(out.containers[0].sourceText).toBe('');
		expect(out.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
		expect(out.order).toEqual(['n1', 'n2', 'e1', 'c1']);
	});

	it('nimmt auch Mitglieder aus memberIds mit, deren parentId fehlt', () => {
		const loose = sampleDoc();
		loose.nodes[2].parentId = null;
		const out = pure((d) => removeContainer(d, 'c1', 'cascade'), loose);
		expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
		expect(out.edges.map((e) => e.id)).toEqual(['e1']);
	});

	it('wirft bei unbekannter ID oder Knoten-ID, removeNode wirft bei Container-ID', () => {
		expect(() => removeContainer(sampleDoc(), 'cX', 'cascade')).toThrow(/cX/);
		expect(() => removeContainer(sampleDoc(), 'n1', 'cascade')).toThrow(/n1/);
		expect(() => removeNode(sampleDoc(), 'c1', 'cascade')).toThrow(/c1/);
	});
});

describe('moveToContainer', () => {
	it('verschiebt Knoten von top-level in Container', () => {
		const out = pure((d) => moveToContainer(d, 'n1', 'c1'));
		expect(out.order).toEqual(['n2', 'e1', 'c1']);
		expect(members(out, 'c1')).toEqual(['n3', 'e2', 'n1']);
		const n1 = out.nodes.find((n) => n.id === 'n1')!;
		expect(n1.parentId).toBe('c1');
		expect(n1.sourceText).toBe('');
		expect(out.containers[0].sourceText).toBe('');
	});

	it('verschiebt Kante aus Container nach top-level', () => {
		const out = pure((d) => moveToContainer(d, 'e2', null));
		expect(out.order).toEqual(['n1', 'n2', 'e1', 'c1', 'e2']);
		expect(members(out, 'c1')).toEqual(['n3']);
		expect(out.edges[1]).toMatchObject({ parentId: null, sourceText: '' });
	});

	it('verschiebt Container in Container', () => {
		const out = pure((d) => {
			const withC2 = addContainer(d, container('c2'));
			return moveToContainer({ ...withC2, modelVersion: d.modelVersion }, 'c2', 'c1');
		});
		expect(out.order).toEqual(['n1', 'n2', 'e1', 'c1']);
		expect(members(out, 'c1')).toEqual(['n3', 'e2', 'c2']);
		expect(out.containers[1]).toMatchObject({ parentId: 'c1', sourceText: '' });
	});

	it('lehnt Zyklen und unbekannte IDs ab', () => {
		let doc = addContainer(sampleDoc(), container('c2', { parentId: 'c1' }));
		expect(() => moveToContainer(doc, 'c1', 'c1')).toThrow(CYCLE);
		expect(() => moveToContainer(doc, 'c1', 'c2')).toThrow(CYCLE);
		doc = sampleDoc();
		expect(() => moveToContainer(doc, 'xX', null)).toThrow(/xX/);
		expect(() => moveToContainer(doc, 'n1', 'cX')).toThrow(/cX/);
	});

	it('lehnt Nachfahren als Ziel ab, auch über mehrere Ebenen', () => {
		let doc = addContainer(sampleDoc(), container('c2', { parentId: 'c1' }));
		doc = addContainer(doc, container('c3', { parentId: 'c2' }));
		expect(() => moveToContainer(doc, 'c1', 'c3')).toThrow(CYCLE);
		expect(() => moveToContainer(doc, 'c2', 'c3')).toThrow(CYCLE);
		expect(moveToContainer(doc, 'c3', 'c1').containers[2].parentId).toBe('c1');
	});

	it('bricht bei bereits zyklischer parentId-Kette mit Fehler ab statt endlos zu laufen', () => {
		const doc = {
			...sampleDoc(),
			containers: [
				...sampleDoc().containers,
				container('ca', { parentId: 'cb' }),
				container('cb', { parentId: 'ca' })
			]
		};
		expect(() => moveToContainer(doc, 'n1', 'ca')).toThrow(CYCLE);
	});
});

describe('reorder', () => {
	it('ordnet top-level um', () => {
		const out = pure((d) => reorder(d, 'c1', 0));
		expect(out.order).toEqual(['c1', 'n1', 'n2', 'e1']);
		expect(out.containers[0].sourceText).toBe('subgraph c1');
	});

	it('ordnet innerhalb einer Section um und leert sourceText des Containers', () => {
		const out = pure((d) => reorder(d, 'e2', 0));
		expect(members(out, 'c1')).toEqual(['e2', 'n3']);
		expect(out.containers[0].sourceText).toBe('');
	});

	it('klemmt Index auf gültigen Bereich und wirft bei unbekannter ID', () => {
		const out = pure((d) => reorder(d, 'n1', 99));
		expect(out.order).toEqual(['n2', 'e1', 'c1', 'n1']);
		expect(() => reorder(sampleDoc(), 'xX', 0)).toThrow(/xX/);
	});
});
