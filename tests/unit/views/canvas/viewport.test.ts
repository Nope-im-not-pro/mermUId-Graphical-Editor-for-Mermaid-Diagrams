import { describe, expect, it } from 'vitest';
import {
	clampZoom,
	FIT_MARGIN,
	fitZoom,
	FLOW_INPUT,
	MAX_ZOOM,
	MIN_ZOOM,
	ZOOM_STEP,
	zoomPercent,
	zoomScroll
} from '../../../../src/lib/views/canvas/common/viewport';

describe('Zoom', () => {
	it('25 bis 400 %', () => {
		expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.25, 4]);
		expect(zoomPercent(1)).toBe('100 %');
		expect(zoomPercent(0.254)).toBe('25 %');
		expect(zoomPercent(9)).toBe('400 %');
		expect(zoomPercent(0.1)).toBe('25 %');
	});
});

describe('Maus und Tastatur (FA-03, FA-05)', () => {
	it('Shift, Strg und Meta fügen hinzu; Lasso per Links-Drag; Pan per Mitte, Leertaste, Scroll', () => {
		expect(FLOW_INPUT.multiSelectionKey).toEqual(['Shift', 'Control', 'Meta']);
		expect(FLOW_INPUT.selectionOnDrag).toBe(true);
		expect(FLOW_INPUT.panOnDrag).toEqual([1]);
		expect(FLOW_INPUT.panActivationKey).toBe(' ');
		expect(FLOW_INPUT.panOnScroll).toBe(true);
	});
});

describe('Zoom-Hilfen (T124)', () => {
	it('clampZoom begrenzt auf 25 bis 400 %', () => {
		expect(ZOOM_STEP).toBe(1.2);
		expect(clampZoom(0.1)).toBe(MIN_ZOOM);
		expect(clampZoom(9)).toBe(MAX_ZOOM);
		expect(clampZoom(1.5)).toBe(1.5);
	});

	it('fitZoom passt den Inhalt mit Rand in den Rahmen; leerer Rahmen gibt 100 %', () => {
		expect(FIT_MARGIN).toBe(0.95);
		expect(fitZoom({ width: 400, height: 200 }, { width: 200, height: 200 })).toBeCloseTo(0.475);
		expect(fitZoom({ width: 100, height: 100 }, { width: 300, height: 200 })).toBeCloseTo(1.9);
		// Kein Rest-Scroll durch Rundung: Anzeigegröße bleibt sichtbar unter dem Rahmen.
		const z = fitZoom({ width: 333, height: 777 }, { width: 1000, height: 999 });
		expect(Math.ceil(333 * z)).toBeLessThan(1000);
		expect(Math.ceil(777 * z)).toBeLessThan(999);
		expect(fitZoom({ width: 100, height: 100 }, { width: 10000, height: 10000 })).toBe(MAX_ZOOM);
		expect(fitZoom({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
		expect(fitZoom({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(1);
	});

	it('zoomScroll hält die Mitte des Ausschnitts fest', () => {
		// Ausschnitt 100 breit bei Scroll 50 und Zoom 1: Mitte bei 100; Zoom 2 -> Mitte 200.
		expect(zoomScroll(50, 100, 1, 2)).toBe(150);
		expect(zoomScroll(150, 100, 2, 1)).toBe(50);
		expect(zoomScroll(0, 100, 1, 0.5)).toBe(0);
	});
});
