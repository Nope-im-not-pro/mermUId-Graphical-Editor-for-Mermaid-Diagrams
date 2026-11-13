import { Position } from '@xyflow/svelte';
import { describe, expect, it } from 'vitest';
import { edgePath, markerFor } from '../../../../src/lib/services/shapes';
import {
	anchorPoint,
	edgeGeometry,
	reconnectEnds,
	sideOf
} from '../../../../src/lib/views/canvas/graph/edges';

const from = { x: 0, y: 0, position: Position.Right };
const to = { x: 100, y: 0, position: Position.Left };

describe('edgeGeometry', () => {
	it('Pfad über edgePath, Linie vor Pfeilspitze gekürzt', () => {
		const g = edgeGeometry(from, to, 'arrow');
		const inset = markerFor('arrow').end!.inset;
		expect(g.path).toBe(edgePath('bezier', from, { ...to, x: 100 - inset }).path);
		expect(g.markers).toEqual([
			{ path: markerFor('arrow').end!.path, transform: 'translate(100 0) rotate(0)', filled: true }
		]);
	});

	it('double_* setzt beide Enden, Start zeigt in den Quellknoten', () => {
		const g = edgeGeometry(from, to, 'double_circle');
		expect(g.markers.map((m) => m.transform)).toEqual([
			'translate(0 0) rotate(180)',
			'translate(100 0) rotate(0)'
		]);
	});

	it('ohne Spitze keine Marker, Linie ungekürzt', () => {
		const g = edgeGeometry(from, to, 'none');
		expect(g.markers).toEqual([]);
		expect(g.path).toBe(edgePath('bezier', from, to).path);
	});

	it('Drehung je Seite', () => {
		const at = (position: Position) =>
			edgeGeometry(from, { x: 0, y: 0, position }, 'arrow').markers[0].transform;
		expect(at(Position.Top)).toContain('rotate(90)');
		expect(at(Position.Right)).toContain('rotate(180)');
		expect(at(Position.Bottom)).toContain('rotate(270)');
	});

	it('Handle-Kürzel auf Position', () => {
		expect([sideOf('n'), sideOf('e'), sideOf('s'), sideOf('w')]).toEqual([
			Position.Top,
			Position.Right,
			Position.Bottom,
			Position.Left
		]);
	});
});

// T130 (F-03): Kantenende umhängen; unverändertes Ende und Selbstkante sind kein Schritt.
describe('reconnectEnds', () => {
	const edge = { sourceId: 'A', targetId: 'B' };

	it('Ziel umhängen: Quelle bleibt', () => {
		expect(reconnectEnds(edge, 'target', 'C')).toEqual({ sourceId: 'A', targetId: 'C' });
	});

	it('Quelle umhängen: Ziel bleibt', () => {
		expect(reconnectEnds(edge, 'source', 'C')).toEqual({ sourceId: 'C', targetId: 'B' });
	});

	it('unveränderter Endpunkt: null', () => {
		expect(reconnectEnds(edge, 'target', 'B')).toBeNull();
		expect(reconnectEnds(edge, 'source', 'A')).toBeNull();
	});

	it('Selbstkante: null', () => {
		expect(reconnectEnds(edge, 'target', 'A')).toBeNull();
		expect(reconnectEnds(edge, 'source', 'B')).toBeNull();
	});
});

describe('anchorPoint', () => {
	it('liegt entlang der Außennormale vor dem Kantenende', () => {
		expect(anchorPoint({ x: 10, y: 20, position: Position.Left }, 12)).toEqual({ x: -2, y: 20 });
		expect(anchorPoint({ x: 10, y: 20, position: Position.Bottom }, 12)).toEqual({ x: 10, y: 32 });
		expect(anchorPoint({ x: 10, y: 20, position: Position.Top }, 12)).toEqual({ x: 10, y: 8 });
		expect(anchorPoint({ x: 10, y: 20, position: Position.Right }, 12)).toEqual({ x: 22, y: 20 });
	});
});
