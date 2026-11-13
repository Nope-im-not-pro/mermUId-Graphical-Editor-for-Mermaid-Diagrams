import { describe, expect, it } from 'vitest';
import {
	ALIGN_MIN,
	alignRects,
	arrangeable,
	DISTRIBUTE_MIN,
	distributeRects
} from '../../../../src/lib/views/canvas/common/align';

const geo = {
	a: { x: 0, y: 0, w: 20, h: 10 },
	b: { x: 50, y: 40, w: 40, h: 30 },
	c: { x: 200, y: 10, w: 10, h: 10 }
};

describe('Ausrichten', () => {
	it('links, rechts, zentriert', () => {
		expect(alignRects(['a', 'b'], geo, 'left')).toEqual([{ id: 'b', x: 0, y: 40 }]);
		expect(alignRects(['a', 'b'], geo, 'right')).toEqual([{ id: 'a', x: 70, y: 0 }]);
		expect(alignRects(['a', 'b'], geo, 'center')).toEqual([
			{ id: 'a', x: 35, y: 0 },
			{ id: 'b', x: 25, y: 40 }
		]);
	});

	it('oben, unten, Mitte', () => {
		expect(alignRects(['a', 'b'], geo, 'top')).toEqual([{ id: 'b', x: 50, y: 0 }]);
		expect(alignRects(['a', 'b'], geo, 'bottom')).toEqual([{ id: 'a', x: 0, y: 60 }]);
		expect(alignRects(['a', 'b'], geo, 'middle')).toEqual([
			{ id: 'a', x: 0, y: 30 },
			{ id: 'b', x: 50, y: 20 }
		]);
	});

	it('weniger als zwei bekannte: nichts', () => {
		expect(alignRects(['a', 'x'], geo, 'left')).toEqual([]);
	});
});

describe('Verteilen', () => {
	it('gleiche Abstände horizontal, äußere bleiben', () => {
		// Gesamt 0..210, Breiten 70 -> Lücke 70
		expect(distributeRects(['c', 'a', 'b'], geo, 'horizontal')).toEqual([
			{ id: 'b', x: 90, y: 40 }
		]);
	});

	it('vertikal', () => {
		// Reihenfolge nach y: a(0), c(10), b(40); Gesamt 0..70, Höhen 50 -> Lücke 10
		expect(distributeRects(['a', 'b', 'c'], geo, 'vertical')).toEqual([{ id: 'c', x: 200, y: 20 }]);
	});

	it('unter drei: nichts', () => {
		expect(distributeRects(['a', 'b'], geo, 'horizontal')).toEqual([]);
	});
});

describe('Aktivierungsregel (T126 C2, F-04)', () => {
	it('zählt nur Elemente mit Geometrie (Knoten/Container, keine Kanten)', () => {
		expect(arrangeable(['a', 'e1', 'b'], geo)).toBe(2);
		expect(arrangeable([], geo)).toBe(0);
	});

	it('Schwellen: Ausrichten ab 2, Verteilen ab 3 - wie alignRects/distributeRects', () => {
		expect(ALIGN_MIN).toBe(2);
		expect(DISTRIBUTE_MIN).toBe(3);
		expect(alignRects(['a', 'c'], geo, 'left')).not.toEqual([]);
		expect(distributeRects(['c', 'a', 'b'], geo, 'horizontal')).not.toEqual([]);
	});
});
