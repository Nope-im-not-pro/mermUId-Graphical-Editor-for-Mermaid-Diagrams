// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../../../../../src/lib/services/adapters/sequence';
import { removeNode, updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface SequenceDb {
	getActors(): Map<string, { type: string; description: string }>;
}

async function mermaidActors(text: string): Promise<[string, string, string][]> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as SequenceDb;
	return [...db.getActors()].map(([id, a]) => [id, a.type, a.description]);
}

const modelActors = (doc: DiagramDocument): [string, string, string][] =>
	doc.nodes.filter((n) => n.kind !== 'note').map((n) => [n.id, n.kind, n.label]);

const CASES = [
	// `#` im Namen vor `as`
	'sequenceDiagram\nparticipant B#k as Bob\nA->>B#k: x\n',
	// `as` am Zeilenende
	'sequenceDiagram\nparticipant B as\nA->>B: x\n',
	// Erstanlage über RawBlocks
	'sequenceDiagram\nbox Aqua G\nactor C\nend\nA->>C: x\n',
	'sequenceDiagram\nlink A: x @ https://a.b\nactor A\nB->>A: x\n',
	'sequenceDiagram\ncreate participant C\nA->>C: x\nactor C\n',
	'sequenceDiagram\ncreate actor C as Cc\nA->>C: x\n',
	'sequenceDiagram\nA->>B: x; C->>D: y\n',
	'sequenceDiagram\nbreak z\nNote over E,F: n\nend\nA->>F: x\n',
	'sequenceDiagram\nA->>C: x\nbox G\nactor C as Cee\nend\n',
	'sequenceDiagram\nA->>C: x\nbox G\nactor C\nend\n',
	'sequenceDiagram\nlinks Z: {"a":"https://b.c"}\nproperties Y: {"a":"b"}\ndetails X: {"a":"b"}\nA->>B: x\n',
	'sequenceDiagram\nbox G\nparticipant P#q as Q\nend\n'
];

describe('W03-Close-out: Teilnehmer wie mermaid', () => {
	it.each(CASES)('Modell = mermaid-db, Roundtrip byte-gleich: %j', async (text) => {
		const doc = ok(text);
		expect(modelActors(doc)).toEqual(await mermaidActors(text));
		expect(serialize(doc)).toBe(text);
		expect(serialize(ok(serialize(doc)))).toBe(text);
	});

	it.each([
		['sequenceDiagram\nbox G\nactor C\nend\nA->>C: x\n', 'C'],
		['sequenceDiagram\ncreate actor C as Cc\nA->>C: x\n', 'C'],
		['sequenceDiagram\nlink A: x @ https://a.b\nB->>A: x\n', 'A'],
		['sequenceDiagram\nparticipant B#k as Bob\nA->>B#k: x\n', 'B#k']
	])('Label-Änderung bleibt nach Re-Parse = mermaid-db: %j', async (text, id) => {
		const next = serialize(updateNode(ok(text), id, { label: 'Neu' }));
		const doc = ok(next);
		expect(doc.nodes.find((n) => n.id === id)?.label).toBe('Neu');
		expect(modelActors(doc)).toEqual(await mermaidActors(next));
	});
});

describe('W03-Close-out: removeNode cascade und Notizen', () => {
	it('entfernt Notiz nur mit gelöschtem Teilnehmer, kürzt gemeinsame Notizen', async () => {
		const doc = ok('sequenceDiagram\nA->>B: x\nNote over A: a\nNote over A,B: ab\n');
		const out = serialize(removeNode(doc, 'A', 'cascade'));
		expect(out).toBe('sequenceDiagram\n    Note over B: ab\n');
		expect(modelActors(ok(out))).toEqual(await mermaidActors(out));
	});

	it('"mark" lässt Notizen unverändert', () => {
		const doc = ok('sequenceDiagram\nA->>B: x\nNote over A: a\n');
		expect(serialize(removeNode(doc, 'A', 'mark'))).toContain('Note over A: a');
	});
});
