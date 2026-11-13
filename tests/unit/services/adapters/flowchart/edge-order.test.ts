import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

describe('Kanten-ID-Folge statt props.idx/props.of (T142)', () => {
	it('trägt die Kantenfolge am Dokument, nicht an den Kanten', () => {
		const doc = parseOk('flowchart TD\nA-->B\nB-->C & D\n');
		expect(doc.header.parsedEdgeIds).toEqual(doc.edges.map((e) => e.id));
		for (const e of doc.edges) {
			expect(e.props).not.toHaveProperty('idx');
			expect(e.props).not.toHaveProperty('of');
		}
	});

	it('baut linkStyle jenseits der Modellkanten neu auf, wenn sich die Kantenfolge ändert', () => {
		const text = 'flowchart TD\nA-->B\nA@{shape: rect} --> C\nlinkStyle 1 stroke:red\n';
		const doc = parseOk(text);
		expect(serialize(doc)).toBe(text);
		const ids = doc.header.parsedEdgeIds ?? [];
		const swapped = { ...doc, header: { ...doc.header, parsedEdgeIds: ['x', ...ids.slice(1)] } };
		expect(serialize(swapped)).not.toBe(text);
	});

	it('wertet den Tausch zweier Kanten gleicher ID als Änderung der Kantenfolge', () => {
		const text =
			'flowchart TD\nA e1@-->B\nA@{shape: rect} --> C\nC e1@-->D\nlinkStyle 1 stroke:red\n';
		const doc = parseOk(text);
		expect(doc.header.parsedEdgeIds).toEqual(['e1', 'e1']);
		const swapped = { ...doc, edges: [doc.edges[1], doc.edges[0]] };
		expect(serialize(swapped)).not.toBe(serialize(doc));
	});
});
