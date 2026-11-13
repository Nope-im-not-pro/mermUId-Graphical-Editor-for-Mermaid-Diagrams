import { describe, expect, it } from 'vitest';
import { shareUnchanged } from '../../../src/lib/model/share';
import type { DiagramDocument } from '../../../src/lib/model/types';
import { flowchartAdapter } from '../../../src/lib/services/adapters/flowchart';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const BASE =
	'flowchart TD\n' +
	'    A[Alpha]\n' +
	'    B[Beta]\n' +
	'    A --> B\n' +
	'    B -.-> C\n' +
	'    C ==> D\n' +
	'    %% Notiz\n' +
	'    classDef hot fill:#f00\n' +
	'    style A fill:#0f0\n' +
	'    linkStyle 1 stroke:#00f\n';

describe('shareUnchanged (T142, O-121)', () => {
	it('(a) liefert bei identischem Inhalt prev selbst', () => {
		const prev = parseOk(BASE);
		const next = parseOk(BASE);
		expect(next).not.toBe(prev);
		expect(shareUnchanged(prev, next)).toBe(prev);
	});

	it('(b) teilt bei geändertem Label alle anderen Knoten und Kanten', () => {
		const prev = parseOk(BASE);
		const next = parseOk(BASE.replace('A[Alpha]', 'A[Anders]'));
		const out = shareUnchanged(prev, next);
		expect(out).toEqual(next);
		expect(out).not.toBe(prev);
		const a = out.nodes.find((n) => n.id === 'A')!;
		expect(a.label).toBe('Anders');
		expect(a).not.toBe(prev.nodes.find((n) => n.id === 'A'));
		// Unterobjekte des geänderten Knotens bleiben geteilt.
		expect(a.style).toBe(prev.nodes.find((n) => n.id === 'A')!.style);
		for (const n of out.nodes.filter((n) => n.id !== 'A'))
			expect(n).toBe(prev.nodes.find((p) => p.id === n.id));
		expect(out.edges).toBe(prev.edges);
		expect(out.order).toBe(prev.order);
		expect(out.classDefs).toBe(prev.classDefs);
		expect(out.comments).toBe(prev.comments);
		expect(out.rawBlocks).toBe(prev.rawBlocks);
		expect(out.layout).toBe(prev.layout);
	});

	it('(c) teilt nach einer oben eingefügten Kantenzeile alle Knoten und props/style verschobener Kanten', () => {
		const prev = parseOk(BASE);
		const next = parseOk(BASE.replace('flowchart TD\n', 'flowchart TD\n    D --> A\n'));
		const out = shareUnchanged(prev, next);
		expect(out).toEqual(next);
		expect(out.edges).toHaveLength(prev.edges.length + 1);
		for (const n of out.nodes) expect(n).toBe(prev.nodes.find((p) => p.id === n.id));
		const shifted = out.edges.filter((e) => prev.edges.some((p) => p.id === e.id));
		expect(shifted).toHaveLength(prev.edges.length);
		for (const e of shifted) {
			const old = prev.edges.find((p) => p.id === e.id)!;
			expect(e).not.toBe(old);
			expect(e.props).toBe(old.props);
			expect(e.style).toBe(old.style);
		}
	});

	it('(d) teilt unveränderte layout.positions', () => {
		const prev = parseOk(BASE);
		prev.layout = { ...prev.layout, mode: 'manual', positions: { A: [0, 0, 80, 40] } };
		const next = parseOk(BASE.replace('A[Alpha]', 'A[Anders]'));
		next.layout = { ...next.layout, mode: 'manual', positions: { A: [0, 0, 80, 40] } };
		const out = shareUnchanged(prev, next);
		expect(out.layout).toBe(prev.layout);
		expect(out.layout.positions).toBe(prev.layout.positions);
		next.layout.positions.B = [10, 10, 80, 40];
		const moved = shareUnchanged(prev, next);
		expect(moved.layout.positions).not.toBe(prev.layout.positions);
		expect(moved.layout.positions.A).toBe(prev.layout.positions.A);
	});

	it('(e) verändert weder prev noch next', () => {
		const prev = parseOk(BASE);
		const next = parseOk(BASE.replace('flowchart TD\n', 'flowchart TD\n    D --> A\n'));
		const before = structuredClone({ prev, next });
		shareUnchanged(prev, next);
		expect({ prev, next }).toStrictEqual(before);
	});

	it('teilt NaN-Werte (Object.is statt !==)', () => {
		const prev = parseOk(BASE);
		const next = parseOk(BASE);
		prev.nodes[0].props.w = NaN;
		next.nodes[0].props.w = NaN;
		expect(shareUnchanged(prev, next)).toBe(prev);
	});

	it('ordnet doppelte Kanten-IDs positionsgleich zu', () => {
		const text = 'flowchart TD\n    A e1@--> B\n    C e1@--> D\n    E e1@--> F\n';
		const prev = parseOk(text);
		expect(prev.edges.map((e) => e.id)).toEqual(['e1', 'e1', 'e1']);
		expect(shareUnchanged(prev, parseOk(text))).toBe(prev);
		const next = parseOk(text.replace('C e1@--> D', 'C e1@--> X'));
		const out = shareUnchanged(prev, next);
		expect(out).toStrictEqual(next);
		expect(out.edges[0]).toBe(prev.edges[0]);
		expect(out.edges[1]).not.toBe(prev.edges[1]);
		expect(out.edges[2]).toBe(prev.edges[2]);
	});
	it('Schlüssel __proto__ bleibt eigene Eigenschaft, Prototyp bleibt erhalten', () => {
		const positions = (entries: [string, number[]][]) => {
			const map = Object.create(null) as Record<string, unknown>;
			for (const [k, v] of entries) {
				Object.defineProperty(map, k, {
					value: v,
					enumerable: true,
					writable: true,
					configurable: true
				});
			}
			return map;
		};
		const prev = parseOk(BASE);
		const next = parseOk(BASE);
		const keep = [1, 2, 0, 0];
		prev.layout.positions = positions([
			['__proto__', keep],
			['A', [0, 0, 0, 0]]
		]) as never;
		next.layout.positions = positions([
			['__proto__', [1, 2, 0, 0]],
			['A', [5, 5, 0, 0]]
		]) as never;
		const out = shareUnchanged(prev, next).layout.positions as Record<string, unknown>;
		expect(Object.getPrototypeOf(out)).toBeNull();
		expect(Object.hasOwn(out, '__proto__')).toBe(true);
		expect(Object.keys(out)).toEqual(['__proto__', 'A']);
		expect(out['__proto__']).toBe(keep);
		expect(out.A).toEqual([5, 5, 0, 0]);
	});
});
