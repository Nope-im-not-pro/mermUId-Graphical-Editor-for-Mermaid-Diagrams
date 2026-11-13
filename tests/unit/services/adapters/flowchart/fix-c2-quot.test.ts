// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { updateContainer, updateEdge, updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const LABEL = 'Sag "hallo" #1';
const BASE = 'flowchart LR\nsubgraph S [Box]\nA[Alt] -->|alt| B\nend\n';

describe('#quot; Roundtrip Modell -> Text -> Modell (T23 C2 E1)', () => {
	it.each([
		['Knoten', (d: DiagramDocument) => updateNode(d, 'A', { label: LABEL })],
		['Kante', (d: DiagramDocument) => updateEdge(d, d.edges[0].id, { label: LABEL })],
		['Subgraph', (d: DiagramDocument) => updateContainer(d, 'S', { label: LABEL })]
	])('%s: Label mit " bleibt identisch, Text gültig', async (_n, edit) => {
		const edited = edit(parseOk(BASE));
		const out = serialize(edited);
		expect(out).toContain('#quot;');
		await expect(mermaid.parse(out)).resolves.toBeTruthy();
		const again = parseOk(out);
		expect(again.nodes.map((n) => n.label)).toEqual(edited.nodes.map((n) => n.label));
		expect(again.edges.map((e) => e.label)).toEqual(edited.edges.map((e) => e.label));
		expect(again.containers.map((c) => [c.id, c.label])).toEqual(
			edited.containers.map((c) => [c.id, c.label])
		);
		expect(serialize(again)).toBe(out);
	});

	it('Quelltext mit #quot; wird decodiert, unverändert byte-gleich', () => {
		const text =
			'flowchart LR\n  A["a #quot;b#quot;"] -- "c #quot;d" --> B\n  subgraph "x#quot;y"\n  C\n  end\n';
		const doc = parseOk(text);
		expect(doc.nodes.find((n) => n.id === 'A')!.label).toBe('a "b"');
		expect(doc.edges[0].label).toBe('c "d');
		expect(doc.containers[0]).toMatchObject({ id: 'x#quot;y', label: 'x"y' });
		expect(serialize(doc)).toBe(text);
	});
});
