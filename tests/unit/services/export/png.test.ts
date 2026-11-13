import { describe, expect, it, vi } from 'vitest';
import {
	MAX_CANVAS_EDGE,
	MAX_CANVAS_PIXELS,
	canvasLimitError,
	exportPng,
	sizeOf,
	type Rasterizer
} from '../../../../src/lib/services/export/png';

const SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="-5 0 120.5 40"><g/></svg>';
const blob = new Blob(['png'], { type: 'image/png' });

function fake() {
	return vi.fn<Rasterizer>(async () => blob);
}

describe('sizeOf', () => {
	it('liest Breite und Höhe aus viewBox des Start-Tags', () => {
		expect(sizeOf(SVG)).toEqual({ width: 120.5, height: 40 });
		expect(sizeOf('<svg viewBox="0,0,10,20"><g viewBox="0 0 99 99"/></svg>')).toEqual({
			width: 10,
			height: 20
		});
	});

	it('ohne gültige viewBox: null', () => {
		expect(sizeOf('<svg><g viewBox="0 0 9 9"/></svg>')).toBeNull();
		expect(sizeOf('<svg viewBox="0 0 0 10"/>')).toBeNull();
		expect(sizeOf('<svg viewBox="0 0 x 10"/>')).toBeNull();
		expect(sizeOf('kein svg')).toBeNull();
	});
});

describe('exportPng', () => {
	it('Standard 1x, transparent; Root mit festen Abmessungen statt 100%', async () => {
		const rasterize = fake();
		const result = await exportPng(SVG, rasterize);
		expect(result).toEqual({ ok: true, blob });
		const req = rasterize.mock.calls[0][0];
		expect(req).toMatchObject({ width: 120.5, height: 40, scale: 1, background: null });
		expect(req.svg).toBe(
			'<svg width="120.5" height="40" xmlns="http://www.w3.org/2000/svg" viewBox="-5 0 120.5 40"><g/></svg>'
		);
	});

	it.each([1, 2, 3] as const)('Maßstab %ix mit Hintergrund', async (scale) => {
		const rasterize = fake();
		await exportPng(SVG, rasterize, { scale, background: '#ffffff' });
		expect(rasterize.mock.calls[0][0]).toMatchObject({ scale, background: '#ffffff' });
	});

	it('ungültiger Maßstab, foreignObject, Metadaten, fehlende Größe: Fehler ohne Rasterung', async () => {
		const rasterize = fake();
		const bad = [
			exportPng(SVG, rasterize, { scale: 4 as 1 }),
			exportPng('<svg viewBox="0 0 1 1"><foreignObject/></svg>', rasterize),
			exportPng('<svg viewBox="0 0 1 1"><text>%% @MermUId: {}</text></svg>', rasterize),
			exportPng('<svg><g/></svg>', rasterize)
		];
		for (const result of await Promise.all(bad)) expect(result.ok).toBe(false);
		expect(rasterize).not.toHaveBeenCalled();
	});

	it('Rand in px (T127 C2): viewBox und Maße wachsen um 2x Rand, ungültig -> Standard 0', async () => {
		const rasterize = fake();
		await exportPng(SVG, rasterize, { margin: 10, background: '#ffffff' });
		const req = rasterize.mock.calls[0][0];
		expect(req).toMatchObject({ width: 140.5, height: 60, background: '#ffffff' });
		expect(req.svg).toBe(
			'<svg width="140.5" height="60" xmlns="http://www.w3.org/2000/svg" viewBox="-15 -10 140.5 60"><g/></svg>'
		);
		for (const margin of [-1, 600, 2.5]) {
			await exportPng(SVG, rasterize, { margin });
			expect(rasterize.mock.calls.at(-1)![0]).toMatchObject({ width: 120.5, height: 40 });
		}
	});

	it('max-width im Wurzel-style entfällt (Mermaid useMaxWidth), übrige Deklarationen bleiben', async () => {
		const rasterize = fake();
		const only = SVG.replace(' width="100%"', ' width="100%" style="max-width: 120.5px;"');
		await exportPng(only, rasterize, { margin: 10 });
		expect(rasterize.mock.calls[0][0].svg).toBe(
			'<svg width="140.5" height="60" xmlns="http://www.w3.org/2000/svg" viewBox="-15 -10 140.5 60"><g/></svg>'
		);
		const mixed = SVG.replace(
			' width="100%"',
			' width="100%" style="background-color: white; max-width: 120.5px; color: red"'
		);
		await exportPng(mixed, rasterize, { scale: 2 });
		expect(rasterize.mock.calls[1][0].svg).toBe(
			'<svg width="120.5" height="40" xmlns="http://www.w3.org/2000/svg" style="background-color: white; color: red" viewBox="-5 0 120.5 40"><g/></svg>'
		);
		const entity = SVG.replace(
			' width="100%"',
			' width="100%" style="font-family: &quot;a;b&quot;; max-width: 120.5px; color: red"'
		);
		await exportPng(entity, rasterize);
		expect(rasterize.mock.calls[2][0].svg).toBe(
			'<svg width="120.5" height="40" xmlns="http://www.w3.org/2000/svg" style="font-family: &quot;a;b&quot;; color: red" viewBox="-5 0 120.5 40"><g/></svg>'
		);
	});

	it('Rand über die Canvas-Grenze: Fehler ohne Rasterung', async () => {
		const rasterize = fake();
		const wide = `<svg viewBox="0 0 ${MAX_CANVAS_EDGE - 100} 10"></svg>`;
		expect((await exportPng(wide, rasterize, { margin: 0 })).ok).toBe(true);
		expect((await exportPng(wide, rasterize, { margin: 100 })).ok).toBe(false);
		expect(rasterize).toHaveBeenCalledTimes(1);
	});

	it('Rasterizer-Fehler wird als Ergebnis gemeldet', async () => {
		const rasterize = vi.fn(async () => {
			throw new Error('tainted');
		});
		expect(await exportPng(SVG, rasterize)).toEqual({ ok: false, error: { message: 'tainted' } });
	});

	it('Pixelobergrenze je Kante und gesamt: Fehler mit Maßen ohne Rasterung', async () => {
		const rasterize = fake();
		const wide = `<svg viewBox="0 0 ${MAX_CANVAS_EDGE / 2 + 1} 10"><g/></svg>`;
		const result = await exportPng(wide, rasterize, { scale: 2 });
		expect(result).toEqual({
			ok: false,
			error: {
				message: `PNG zu groß: ${MAX_CANVAS_EDGE + 2} x 20 px (Grenze ${MAX_CANVAS_EDGE} px je Kante, ${MAX_CANVAS_PIXELS} px gesamt).`
			}
		});
		const area = await exportPng('<svg viewBox="0 0 20000 20000"><g/></svg>', rasterize);
		expect(area.ok).toBe(false);
		if (!area.ok) expect(area.error.message).toContain('20000 x 20000 px');
		expect(rasterize).not.toHaveBeenCalled();
		const edge = `<svg viewBox="0 0 ${MAX_CANVAS_EDGE} 1"><g/></svg>`;
		expect((await exportPng(edge, rasterize)).ok).toBe(true);
	});
});

describe('canvasLimitError', () => {
	it('null innerhalb der Grenzen, aufgerundete Maße wie die Canvas-Anlage', () => {
		expect(MAX_CANVAS_EDGE).toBe(32767);
		expect(MAX_CANVAS_PIXELS).toBe(268435456);
		expect(canvasLimitError(10.2, 5, 2)).toBeNull();
		expect(canvasLimitError(MAX_CANVAS_EDGE, 1, 1)).toBeNull();
		expect(canvasLimitError(MAX_CANVAS_EDGE + 0.5, 1, 1)).toContain(
			`${MAX_CANVAS_EDGE + 1} x 1 px`
		);
		expect(canvasLimitError(16384, 16385, 1)).toContain('16384 x 16385 px');
		expect(canvasLimitError(16384, 16384, 1)).toBeNull();
	});
});
