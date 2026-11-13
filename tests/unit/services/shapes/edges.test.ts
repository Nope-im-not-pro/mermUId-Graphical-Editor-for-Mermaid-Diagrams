import { describe, expect, it } from 'vitest';
import { Position, getBezierPath, getSmoothStepPath, getStraightPath } from '@xyflow/system';
import {
	BEZIER_CURVATURE,
	SMOOTHSTEP_BORDER_RADIUS,
	SMOOTHSTEP_OFFSET,
	SELF_LOOP_SIZE,
	edgePath,
	linePattern,
	markerFor,
	selfLoopPath
} from '../../../../src/lib/services/shapes';

const cases = [
	{
		from: { x: 0, y: 0, position: Position.Bottom },
		to: { x: 120, y: 200, position: Position.Top }
	},
	{
		from: { x: 50, y: 10, position: Position.Right },
		to: { x: -30, y: 80, position: Position.Left }
	}
];

describe('edgePath', () => {
	it('feste Parameter entsprechen den Svelte-Flow-Standards', () => {
		expect(BEZIER_CURVATURE).toBe(0.25);
		expect(SMOOTHSTEP_BORDER_RADIUS).toBe(5);
		expect(SMOOTHSTEP_OFFSET).toBe(20);
	});

	for (const { from, to } of cases) {
		const ends = {
			sourceX: from.x,
			sourceY: from.y,
			sourcePosition: from.position,
			targetX: to.x,
			targetY: to.y,
			targetPosition: to.position
		};

		it(`bezier ${from.position}->${to.position} wie getBezierPath`, () => {
			const [path, labelX, labelY] = getBezierPath({ ...ends, curvature: BEZIER_CURVATURE });
			expect(edgePath('bezier', from, to)).toEqual({ path, labelX, labelY });
		});

		it(`smoothstep ${from.position}->${to.position} wie getSmoothStepPath`, () => {
			const [path, labelX, labelY] = getSmoothStepPath({
				...ends,
				borderRadius: SMOOTHSTEP_BORDER_RADIUS,
				offset: SMOOTHSTEP_OFFSET
			});
			expect(edgePath('smoothstep', from, to)).toEqual({ path, labelX, labelY });
		});

		it(`straight ${from.position}->${to.position} wie getStraightPath`, () => {
			const [path, labelX, labelY] = getStraightPath(ends);
			expect(edgePath('straight', from, to)).toEqual({ path, labelX, labelY });
		});
	}
});

describe('linePattern', () => {
	it('liefert Breite und Strichmuster je lineStyle', () => {
		expect(linePattern('solid')).toEqual({ width: 2, dasharray: null, visible: true });
		expect(linePattern('thick')).toEqual({ width: 3.5, dasharray: null, visible: true });
		expect(linePattern('dotted')).toEqual({ width: 2, dasharray: '3 3', visible: true });
		expect(linePattern('invisible')).toEqual({ width: 0, dasharray: null, visible: false });
	});

	it('unbekannt fällt auf solid zurück und liefert Kopien', () => {
		expect(linePattern('wavy')).toEqual(linePattern('solid'));
		expect(linePattern('toString')).toEqual(linePattern('solid'));
		const a = linePattern('solid');
		a.width = 99;
		expect(linePattern('solid').width).toBe(2);
	});
});

describe('markerFor', () => {
	it('Modell-Namen: Ende gesetzt, Start leer', () => {
		expect(markerFor('arrow').end?.kind).toBe('point');
		expect(markerFor('circle').end?.kind).toBe('circle');
		expect(markerFor('cross').end?.kind).toBe('cross');
		expect(markerFor('arrow').start).toBeNull();
		expect(markerFor('none')).toEqual({ start: null, end: null });
	});

	it('Mermaid-db-Namen', () => {
		expect(markerFor('arrow_point').end?.kind).toBe('point');
		expect(markerFor('arrow_circle').end?.kind).toBe('circle');
		expect(markerFor('arrow_cross').end?.kind).toBe('cross');
		expect(markerFor('arrow_open')).toEqual({ start: null, end: null });
	});

	it('double_* setzt beide Enden', () => {
		for (const [name, kind] of [
			['double_arrow', 'point'],
			['double_arrow_point', 'point'],
			['double_circle', 'circle'],
			['double_arrow_cross', 'cross']
		]) {
			const m = markerFor(name);
			expect(m.start?.kind).toBe(kind);
			expect(m.end?.kind).toBe(kind);
			expect(m.start).not.toBe(m.end);
		}
		expect(markerFor('double_arrow_open')).toEqual({ start: null, end: null });
	});

	it('unbekannt -> keine Marker', () => {
		expect(markerFor('xyz')).toEqual({ start: null, end: null });
		expect(markerFor('constructor')).toEqual({ start: null, end: null });
	});

	it('Marker sind eigene Pfad-Geometrie ohne Referenzen', () => {
		for (const name of ['arrow', 'circle', 'cross']) {
			const end = markerFor(name).end;
			expect(end?.path).toMatch(/^M/);
			expect(end?.path).not.toMatch(/url|#/);
			expect(end?.inset).toBeGreaterThan(0);
		}
		expect(markerFor('arrow').end?.filled).toBe(true);
		expect(markerFor('cross').end?.filled).toBe(false);
	});
});

describe('selfLoopPath', () => {
	const nums = (path: string) => (path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);

	it('Schleife rechts außerhalb des Knotens, Enden am rechten Rand, endliche Koordinaten', () => {
		const loop = selfLoopPath({ x: 10, y: 20, w: 100, h: 40 });
		const values = nums(loop.path);
		expect(values.length).toBeGreaterThan(0);
		expect(values.every(Number.isFinite)).toBe(true);
		const xs = values.filter((_, i) => i % 2 === 0);
		expect(Math.max(...xs)).toBeGreaterThan(110);
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(110);
		expect(loop.start.tip[0]).toBe(110);
		expect(loop.end.tip[0]).toBe(110);
		expect(loop.start.tip[1]).toBeLessThan(loop.end.tip[1]);
		expect(loop.labelX).toBeGreaterThan(110);
		expect(loop.labelY).toBe(40);
	});

	it('Markerrichtung zeigt in den Knoten; inset kürzt die Linie nach außen', () => {
		const loop = selfLoopPath({ x: 0, y: 0, w: 50, h: 30 }, 8, 4);
		expect(loop.start.dir[0]).toBeLessThan(0);
		expect(loop.end.dir[0]).toBeLessThan(0);
		expect(Math.hypot(...loop.end.dir)).toBeCloseTo(1);
		expect(loop.start.line[0]).toBeCloseTo(50 - loop.start.dir[0] * 8);
		expect(loop.end.line[1]).toBeCloseTo(loop.end.tip[1] - loop.end.dir[1] * 4);
		expect(loop.path.startsWith(`M${loop.start.line[0]},${loop.start.line[1]} C`)).toBe(true);
	});

	it('Index je Knoten staffelt die Ausladung: verschiedene Pfade, wachsende Reichweite', () => {
		const box = { x: 10, y: 20, w: 100, h: 40 };
		const loops = [0, 1, 2].map((i) => selfLoopPath(box, 0, 0, i));
		expect(new Set(loops.map((l) => l.path)).size).toBe(3);
		expect(loops[0].path).toBe(selfLoopPath(box).path);
		expect(loops[0].reach).toBe(SELF_LOOP_SIZE);
		expect(loops[1].reach).toBeGreaterThan(loops[0].reach);
		expect(loops[2].reach).toBeGreaterThan(loops[1].reach);
		for (const l of loops) {
			const xs = nums(l.path).filter((_, i) => i % 2 === 0);
			expect(Math.max(...xs)).toBe(110 + l.reach);
		}
		expect(selfLoopPath(box, 0, 0, Number.NaN).path).toBe(loops[0].path);
		expect(selfLoopPath(box, 0, 0, -3).path).toBe(loops[0].path);
	});

	it('Höhe 0 und nicht-endliche Maße: endlicher Pfad', () => {
		for (const box of [
			{ x: 0, y: 0, w: 0, h: 0 },
			{ x: Number.NaN, y: Infinity, w: -5, h: Number.NaN }
		]) {
			expect(nums(selfLoopPath(box).path).every(Number.isFinite)).toBe(true);
			expect(selfLoopPath(box).path).not.toMatch(/NaN|Infinity/);
		}
	});
});
