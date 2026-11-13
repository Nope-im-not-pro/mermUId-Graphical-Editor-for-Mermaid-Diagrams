import { describe, expect, it } from 'vitest';
import {
	GRID_SIZE,
	gridSettings,
	guidesFor,
	snapGridOf,
	snapIf,
	snapPoint,
	snapValue
} from '../../../../src/lib/views/canvas/common/grid';

const r = (x: number, y: number, w = 20, h = 10) => ({ x, y, w, h });

describe('Raster', () => {
	it('8 px, rundet auf das nächste Vielfache', () => {
		expect(GRID_SIZE).toBe(8);
		expect([snapValue(3), snapValue(4), snapValue(-5), snapValue(17)]).toEqual([0, 8, -8, 16]);
		expect(snapPoint({ x: 11, y: 21 })).toEqual({ x: 8, y: 24 });
	});
});

describe('Hilfslinien', () => {
	it('Kanten und Mitten innerhalb der Toleranz', () => {
		const g = guidesFor(r(102, 300), [r(100, 0), r(500, 303)]);
		expect(g.vertical).toEqual([100, 110, 120]);
		expect(g.horizontal).toEqual([303, 308, 313]);
	});

	it('nichts außerhalb der Toleranz', () => {
		expect(guidesFor(r(0, 0), [r(50, 50)])).toEqual({ vertical: [], horizontal: [] });
	});
});

describe('Raster-Einstellungen aus doc.layout (FA-05)', () => {
	it('Größe aus dem Modell, sonst 8 px; Snap nur bei true', () => {
		expect(gridSettings({ gridSize: 10, snap: false })).toEqual({ size: 10, snap: false });
		expect(gridSettings({ gridSize: 0, snap: true })).toEqual({ size: 8, snap: true });
		expect(gridSettings({ gridSize: Number.NaN, snap: true }).size).toBe(8);
		expect(gridSettings({}).snap).toBe(false);
	});

	it('snapGrid und Einrasten nur bei aktivem Snap', () => {
		expect(snapGridOf({ size: 10, snap: true })).toEqual([10, 10]);
		expect(snapGridOf({ size: 10, snap: false })).toBeUndefined();
		expect(snapIf({ x: 11, y: 14 }, { size: 10, snap: true })).toEqual({ x: 10, y: 10 });
		expect(snapIf({ x: 11, y: 14 }, { size: 10, snap: false })).toEqual({ x: 11, y: 14 });
	});
});
