import { describe, expect, it } from 'vitest';
import { parse } from '../../../../../src/lib/services/adapters/sequence';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

describe('Aktivierungen', () => {
	it('liest activate und deactivate als Kanten', () => {
		const doc = ok('sequenceDiagram\n    activate A\n    A->>B: x\n    Deactivate A\n');
		expect(doc.edges.map((e) => [e.kind, e.sourceId, e.targetId])).toEqual([
			['activate', 'A', 'A'],
			['message', 'A', 'B'],
			['deactivate', 'A', 'A']
		]);
		expect(doc.order).toHaveLength(3);
	});

	it('liest + und - an Pfeilen', () => {
		const doc = ok('sequenceDiagram\n    A->>+B: an\n    B-->>-A: aus\n');
		expect(doc.edges.map((e) => [e.props.activation, e.targetId])).toEqual([
			['+', 'B'],
			['-', 'A']
		]);
	});
});

describe('Blöcke', () => {
	it.each(['loop', 'opt', 'rect', 'Loop'])('%s wird Container mit einer Section', (kw) => {
		const doc = ok(`sequenceDiagram\n    ${kw} Jede Minute\n        A->>B: x\n    end\n`);
		expect(doc.containers).toHaveLength(1);
		const c = doc.containers[0];
		expect(c).toMatchObject({ kind: kw.toLowerCase(), label: 'Jede Minute', parentId: null });
		expect(c.sections).toEqual([{ label: 'Jede Minute', memberIds: [doc.edges[0].id] }]);
		expect(c.sourceText).toBe(`    ${kw} Jede Minute\n`);
		expect(c.props.sourceEnd).toBe('    end\n');
		expect(doc.order).toEqual([c.id]);
		expect(doc.edges[0].parentId).toBe(c.id);
	});

	it.each([
		['alt', 'else'],
		['par', 'and'],
		['critical', 'option']
	])('%s mit %s bildet mehrere Sections', (kw, sep) => {
		const doc = ok(
			`sequenceDiagram\n    ${kw} a\n        A->>B: 1\n    ${sep} b\n        A->>B: 2\n    ${sep}\n        A->>B: 3\n    end\n`
		);
		const c = doc.containers[0];
		expect(c.sections.map((s) => [s.label, s.memberIds])).toEqual([
			['a', [doc.edges[0].id]],
			['b', [doc.edges[1].id]],
			['', [doc.edges[2].id]]
		]);
		expect(c.props.sourceSections).toEqual([`    ${sep} b\n`, `    ${sep}\n`]);
	});

	it('verschachtelt Blöcke mit parentId und Container-IDs über ids.ts', () => {
		const doc = ok(
			'sequenceDiagram\n    loop L\n        participant A\n        alt X\n            Note over A: n\n        end\n    end\n'
		);
		const [outer, inner] = doc.containers;
		expect([outer.id, inner.id]).toEqual(['c1', 'c2']);
		expect(inner.parentId).toBe('c1');
		expect(outer.sections[0].memberIds).toEqual(['A', 'c2']);
		expect(doc.nodes.find((n) => n.id === 'A')?.parentId).toBe('c1');
		expect(doc.order).toEqual(['c1']);
	});

	// T135 C2: box mit browserabhängiger Farbe (`currentcolor`) bleibt RawBlock.
	it('hält box und par_over samt Inhalt als einen RawBlock, break ist ein Block (T135)', () => {
		const box = '    box currentcolor Gruppe\n        participant A\n    end\n';
		const parOver = '    par_over p\n        A->>B: z\n    end\n';
		const text = `${box}    break Abbruch\n        loop x\n            A->>B: y\n        end\n    end\n${parOver}`;
		const doc = ok(`sequenceDiagram\n${text}`);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([box, parOver]);
		expect(doc.containers.map((c) => c.kind)).toEqual(['break', 'loop']);
	});

	it.each([
		['sequenceDiagram\n    loop x\n        A->>B: y\n', 3],
		['sequenceDiagram\n    end\n', 2],
		['sequenceDiagram\n    loop x\n    else\n    end\n', 3],
		['sequenceDiagram\n    else\n', 2],
		['sequenceDiagram\n    box x\n', 2]
	])('meldet Blockfehler in %j', (text, line) => {
		const result = parse(text);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].line).toBe(line);
	});

	it('behandelt Namen mit Schlüsselwort-Präfix als Teilnehmer', () => {
		const doc = ok('sequenceDiagram\n    loop->>endpoint: x\n');
		expect(doc.containers).toHaveLength(0);
		expect(doc.edges[0]).toMatchObject({ sourceId: 'loop', targetId: 'endpoint' });
	});
});
