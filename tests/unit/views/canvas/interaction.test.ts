// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	dragGuides,
	dragMoves,
	editTarget,
	nudgeMoves,
	revealViewport
} from '../../../../src/lib/views/canvas/graph/interaction';
import { toFlow } from '../../../../src/lib/views/canvas/graph/mapping';
import { SAMPLE, measure, parseOk } from './helpers';

const flow = toFlow(parseOk(SAMPLE), { direction: 'LR', errors: [] }, measure);
const g = flow.geometry;

describe('dragMoves', () => {
	it('relative Flow-Position wird über den Container absolut', () => {
		const moves = dragMoves(
			[
				{ id: 'C', position: { x: 5, y: 6 }, parentId: 'S1' },
				{ id: 'A', position: { x: 1, y: 2 } }
			],
			g
		);
		expect(moves).toEqual([
			{ id: 'C', x: g.S1.x + 5, y: g.S1.y + 6 },
			{ id: 'A', x: 1, y: 2 }
		]);
	});

	it('unbekannter Container: Position bleibt relativ zum Ursprung', () => {
		expect(dragMoves([{ id: 'X', position: { x: 3, y: 4 }, parentId: 'Q' }], g)).toEqual([
			{ id: 'X', x: 3, y: 4 }
		]);
	});
});

describe('nudgeMoves', () => {
	it('verschiebt bekannte Elemente um dx/dy', () => {
		expect(nudgeMoves(['A', 'nix'], g, 8, -8)).toEqual([{ id: 'A', x: g.A.x + 8, y: g.A.y - 8 }]);
	});
});

describe('editTarget', () => {
	it('Knoten: Roh-Label als Editor-Text, Rechteck aus der Geometrie', () => {
		expect(editTarget(flow, 'A')).toEqual({ id: 'A', text: 'Start\nzwei', box: g.A });
	});

	it('Container und Kante', () => {
		expect(editTarget(flow, 'S1')!.text).toBe('Gruppe');
		const e = editTarget(flow, 'e1')!;
		expect(e.text).toBe('');
		const mid = (g.A.x + g.A.w / 2 + g.B.x + g.B.w / 2) / 2;
		expect(e.box.x + e.box.w / 2).toBeCloseTo(mid);
	});

	it('unbekannt: null', () => {
		expect(editTarget(flow, 'nix')).toBeNull();
	});
});

describe('dragGuides', () => {
	it('Hilfslinien gegen nicht gezogene Elemente außer dem eigenen Container', () => {
		const g2 = { ...g, A: { x: 0, y: 0, w: 80, h: 42 } };
		const f = { ...flow, geometry: g2 };
		const guides = dragGuides({ id: 'B', position: { x: 2, y: 300 } }, ['B'], f);
		expect(guides.vertical).toContain(0);
		const inner = dragGuides({ id: 'C', position: { x: 0, y: 0 }, parentId: 'S1' }, ['C'], flow);
		expect(inner.vertical).not.toContain(g.S1.x);
		expect(dragGuides({ id: 'nix', position: { x: 0, y: 0 } }, ['nix'], f)).toEqual({
			vertical: [],
			horizontal: []
		});
	});
});

// T122 (V-21): neuer Knoten im Auto-Layout in den Sichtbereich holen, ohne Zoom-Sprung.
describe('revealViewport', () => {
	const size = { width: 400, height: 300 };
	const box = { x: 0, y: 0, w: 80, h: 42 };

	it('vollständig sichtbar: null (kein Sprung)', () => {
		expect(revealViewport(box, { x: 10, y: 10, zoom: 1 }, size)).toBeNull();
		expect(revealViewport(box, { x: 320, y: 258, zoom: 1 }, size)).toBeNull();
	});

	it('rechts/unten außerhalb: minimal verschieben mit Rand, Zoom bleibt', () => {
		const v = revealViewport({ x: 500, y: 400, w: 80, h: 42 }, { x: 0, y: 0, zoom: 1 }, size)!;
		expect(v.zoom).toBe(1);
		expect(500 + v.x).toBe(400 - 24 - 80);
		expect(400 + v.y).toBe(300 - 24 - 42);
	});

	it('links/oben außerhalb, mit Zoom', () => {
		const v = revealViewport(box, { x: -100, y: -50, zoom: 2 }, size)!;
		expect(v).toEqual({ x: 24, y: 24, zoom: 2 });
	});

	it('nur eine Achse außerhalb: andere Achse unverändert', () => {
		const v = revealViewport({ x: 390, y: 10, w: 80, h: 42 }, { x: 0, y: 5, zoom: 1 }, size)!;
		expect(v.y).toBe(5);
		expect(390 + v.x + 80).toBe(400 - 24);
	});

	it('größer als der Sichtbereich: zentriert', () => {
		const v = revealViewport({ x: 0, y: 0, w: 1000, h: 42 }, { x: 900, y: 0, zoom: 1 }, size)!;
		expect(v.x).toBe(200 - 500);
		expect(v.y).toBe(0);
	});

	it('ohne gemessene Fläche: null', () => {
		expect(revealViewport(box, { x: -900, y: 0, zoom: 1 }, { width: 0, height: 0 })).toBeNull();
	});
});
