import { describe, expect, it } from 'vitest';
import { META_SHAPES } from '../../../../src/lib/services/adapters/flowchart/syntax';
import {
	META_SHAPE_NAMES,
	SHAPE_NAMES,
	fitShape,
	labelArea,
	shapePath
} from '../../../../src/lib/services/shapes';

// T138 C2: Pfade und Label-Fläche der fünf `@{ shape }`-Formen (F-07).

const EPS = 0.005;
const boxes: [number, number][] = [
	[120, 60],
	[60, 120],
	[80, 42],
	[40, 40],
	[13.337, 7.1],
	[0, 0]
];

/** Endpunkte (M/L/H/V/A) und Bogenradien liegen in der Box `w` x `h`. */
function inBox(d: string, w: number, h: number): boolean {
	const tokens = d.match(/[MLHVAZ]|-?\d*\.?\d+/g) ?? [];
	const okX = (x: number) => x >= -EPS && x <= w + EPS;
	const okY = (y: number) => y >= -EPS && y <= h + EPS;
	let i = 0;
	const num = () => Number(tokens[i++]);
	while (i < tokens.length) {
		const cmd = tokens[i++];
		if (cmd === 'M' || cmd === 'L') {
			if (!okX(num()) || !okY(num())) return false;
		} else if (cmd === 'H') {
			if (!okX(num())) return false;
		} else if (cmd === 'V') {
			if (!okY(num())) return false;
		} else if (cmd === 'A') {
			if (num() > w / 2 + 0.01 || num() > h / 2 + 0.01) return false;
			i += 3;
			if (!okX(num()) || !okY(num())) return false;
		} else if (cmd !== 'Z') return false;
	}
	return true;
}

describe('META_SHAPE_NAMES', () => {
	it('spiegelt die fünf @{}-Formen des Adapters, getrennt vom Klammer-Katalog', () => {
		expect([...META_SHAPE_NAMES].sort()).toEqual(Object.keys(META_SHAPES).sort());
		expect(META_SHAPE_NAMES.some((s) => (SHAPE_NAMES as readonly string[]).includes(s))).toBe(
			false
		);
	});
});

describe('shapePath der neuen Formen', () => {
	it.each([...META_SHAPE_NAMES])('%s: eigener Pfad, in der Box, deterministisch', (shape) => {
		for (const [w, h] of boxes) {
			const d = shapePath(shape, w, h);
			expect(d.trim()).not.toBe('');
			expect(d).not.toMatch(/NaN|Infinity|-/);
			expect(inBox(d, w, h)).toBe(true);
			expect(shapePath(shape, w, h)).toBe(d);
		}
		// Kein Rückfall auf das Rechteck.
		expect(shapePath(shape, 120, 60)).not.toBe(shapePath('square', 120, 60));
	});

	it('alle fünf Pfade sind verschieden', () => {
		const paths = META_SHAPE_NAMES.map((s) => shapePath(s, 120, 60));
		expect(new Set(paths).size).toBe(5);
	});

	it('Formmerkmale wie mermaid: Welle, Halbrund, schräge Oberkante, Deckel, Linie', () => {
		expect(shapePath('doc', 120, 60)).toMatch(/A/); // Wellen-Unterkante aus Bögen
		expect(shapePath('delay', 120, 60)).toBe('M0 0 H90 A30 30 0 0 1 90 60 H0 Z');
		expect(shapePath('sl-rect', 120, 60)).toBe('M0 20 L120 0 L120 60 L0 60 Z');
		// Zylinder: Teilpfade für Körper und sichtbaren Deckel, lin-cyl mit zusätzlicher Linie.
		expect(shapePath('h-cyl', 120, 60).match(/M/g)).toHaveLength(2);
		expect(shapePath('lin-cyl', 120, 60).match(/M/g)).toHaveLength(3);
	});
});

describe('labelArea', () => {
	it('Bestandsformen: ganze Box (Label wie bisher mittig)', () => {
		for (const shape of [...SHAPE_NAMES, 'default', 'unbekannt'])
			expect(labelArea(shape, 120, 60)).toEqual({ x: 0, y: 0, w: 120, h: 60 });
	});

	it.each([...META_SHAPE_NAMES])('%s: Fläche liegt innerhalb der Box und ist kleiner', (shape) => {
		for (const [w, h] of boxes) {
			const a = labelArea(shape, w, h);
			expect(a.x).toBeGreaterThanOrEqual(0);
			expect(a.y).toBeGreaterThanOrEqual(0);
			expect(a.w).toBeGreaterThanOrEqual(0);
			expect(a.h).toBeGreaterThanOrEqual(0);
			expect(a.x + a.w).toBeLessThanOrEqual(w + EPS);
			expect(a.y + a.h).toBeLessThanOrEqual(h + EPS);
		}
		const a = labelArea(shape, 120, 60);
		expect(a.w * a.h).toBeLessThan(120 * 60);
	});

	it('Fläche wie mermaid: Text oberhalb der Welle, links vom Halbrund, unter der Schräge', () => {
		expect(labelArea('sl-rect', 120, 60)).toEqual({ x: 0, y: 20, w: 120, h: 40 });
		expect(labelArea('delay', 120, 60)).toEqual({ x: 0, y: 0, w: 90, h: 60 });
		const doc = labelArea('doc', 120, 90);
		expect(doc).toMatchObject({ x: 0, y: 0, w: 120 });
		expect(doc.h).toBeCloseTo(70, 5);
		const lin = labelArea('lin-cyl', 120, 90);
		expect(lin.y).toBeGreaterThan(0);
		const hcyl = labelArea('h-cyl', 120, 60);
		expect(hcyl.x).toBeGreaterThan(0);
		expect(hcyl.x + hcyl.w).toBeLessThan(120);
	});
});

describe('fitShape', () => {
	it('Bestandsformen: Box unverändert', () => {
		for (const shape of [...SHAPE_NAMES, 'default'])
			expect(fitShape(shape, 80, 42)).toEqual({ width: 80, height: 42 });
	});

	it.each([...META_SHAPE_NAMES])(
		'%s: Label-Fläche der vergrößerten Box fasst den Inhalt',
		(shape) => {
			for (const [w, h] of [
				[80, 42],
				[216, 60],
				[80, 96]
			]) {
				const box = fitShape(shape, w, h);
				expect(box.width).toBeGreaterThanOrEqual(w);
				expect(box.height).toBeGreaterThanOrEqual(h);
				const a = labelArea(shape, box.width, box.height);
				expect(a.w).toBeGreaterThanOrEqual(w - 0.01);
				expect(a.h).toBeGreaterThanOrEqual(h - 0.01);
				expect(fitShape(shape, w, h)).toEqual(box);
			}
		}
	);
});
