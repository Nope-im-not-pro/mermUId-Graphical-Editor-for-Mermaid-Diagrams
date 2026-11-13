import { describe, expect, it } from 'vitest';
import { SHAPES } from '../../../../src/lib/services/adapters/flowchart/syntax';
import { SHAPE_NAMES, shapePath } from '../../../../src/lib/services/shapes';

/** Toleranz für die Rundung auf zwei Nachkommastellen. */
const EPS = 0.005;

/** Prüft alle Endpunkte (M/L/H/V/A) und Bogenradien gegen die Box. */
function assertInBox(d: string, w: number, h: number): void {
	const tokens = d.match(/[MLHVAZ]|-?\d*\.?\d+/g) ?? [];
	const inX = (x: number) => {
		expect(x).toBeGreaterThanOrEqual(-EPS);
		expect(x).toBeLessThanOrEqual(w + EPS);
	};
	const inY = (y: number) => {
		expect(y).toBeGreaterThanOrEqual(-EPS);
		expect(y).toBeLessThanOrEqual(h + EPS);
	};
	let i = 0;
	const num = () => Number(tokens[i++]);
	while (i < tokens.length) {
		const cmd = tokens[i++];
		if (cmd === 'M' || cmd === 'L') {
			inX(num());
			inY(num());
		} else if (cmd === 'H') inX(num());
		else if (cmd === 'V') inY(num());
		else if (cmd === 'A') {
			expect(num()).toBeLessThanOrEqual(w / 2 + 0.01);
			expect(num()).toBeLessThanOrEqual(h / 2 + 0.01);
			i += 3;
			inX(num());
			inY(num());
		} else expect(cmd).toBe('Z');
	}
}

describe('SHAPE_NAMES', () => {
	it('deckt genau den flowchart-Katalog ab', () => {
		expect([...SHAPE_NAMES].sort()).toEqual(SHAPES.map(([, , name]) => name).sort());
		expect(SHAPE_NAMES).toHaveLength(14);
	});
});

describe('shapePath', () => {
	const boxes: [number, number][] = [
		[120, 60],
		[60, 120],
		[40, 40],
		[13.337, 7.1]
	];

	for (const shape of SHAPE_NAMES) {
		it(`${shape}: nicht leer, in der Box, deterministisch`, () => {
			for (const [w, h] of boxes) {
				const d = shapePath(shape, w, h);
				expect(d.trim()).not.toBe('');
				expect(d).not.toMatch(/NaN|Infinity|-/);
				assertInBox(d, w, h);
				expect(shapePath(shape, w, h)).toBe(d);
			}
			expect(shapePath(shape, 120, 60)).toMatchSnapshot();
		});
	}

	it('mehrteilige Formen haben mehrere Teilpfade', () => {
		const subpaths = (d: string) => (d.match(/M/g) ?? []).length;
		expect(subpaths(shapePath('subroutine', 100, 40))).toBe(3);
		expect(subpaths(shapePath('cylinder', 100, 40))).toBe(2);
		expect(subpaths(shapePath('doublecircle', 100, 40))).toBe(2);
	});

	it('unbekannte Form und default fallen auf square zurück', () => {
		const square = shapePath('square', 50, 20);
		expect(shapePath('default', 50, 20)).toBe(square);
		expect(shapePath('gibtsnicht', 50, 20)).toBe(square);
		expect(shapePath('constructor', 50, 20)).toBe(square);
	});

	it('negative Maße zählen als 0', () => {
		for (const shape of SHAPE_NAMES) {
			const d = shapePath(shape, -5, -5);
			expect(d).toBe(shapePath(shape, 0, 0));
			expect(d).not.toMatch(/NaN|-/);
		}
	});

	it('nicht-endliche und sehr große Maße je Achse: kein NaN/Infinity', () => {
		const bad = [NaN, Infinity, -Infinity, 1e307, Number.MAX_VALUE];
		for (const shape of SHAPE_NAMES) {
			for (const v of bad) {
				for (const [w, h] of [
					[v, 40],
					[40, v],
					[v, v]
				]) {
					expect(shapePath(shape, w, h)).not.toMatch(/NaN|Infinity/);
				}
			}
			expect(shapePath(shape, NaN, Infinity)).toBe(shapePath(shape, 0, 0));
			expect(shapePath(shape, -Infinity, 40)).toBe(shapePath(shape, 0, 40));
		}
	});
});
