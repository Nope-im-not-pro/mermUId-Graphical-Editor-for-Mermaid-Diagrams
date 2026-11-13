import { describe, expect, it, vi } from 'vitest';
import { canvasRasterizer, type RasterEnv } from '../../../../src/lib/services/export/rasterizer';

const blob = new Blob(['png'], { type: 'image/png' });

/** Attrappen für `<img>` und Canvas; `src` löst `onload` bzw. `onerror` aus. */
function env(opts: { loads?: boolean; ctx?: boolean; blob?: Blob | null } = {}) {
	const ctx = { scale: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn(() => (opts.ctx === false ? null : ctx)),
		toBlob: vi.fn((cb: (b: Blob | null) => void, type: string) => {
			expect(type).toBe('image/png');
			cb(opts.blob === undefined ? blob : opts.blob);
		})
	};
	const img = {
		onload: null as null | (() => void),
		onerror: null as null | (() => void),
		_src: '',
		set src(value: string) {
			this._src = value;
			queueMicrotask(() => (opts.loads === false ? this.onerror?.() : this.onload?.()));
		},
		get src() {
			return this._src;
		}
	};
	const e = {
		createImage: () => img,
		createCanvas: () => canvas
	} as unknown as RasterEnv;
	return { e, img, canvas, ctx };
}

const req = { svg: '<svg>ä#</svg>', width: 10.2, height: 5, scale: 2 as const, background: null };

describe('canvasRasterizer', () => {
	it('lädt das SVG als data-URL, skaliert und liefert PNG', async () => {
		const { e, img, canvas, ctx } = env();
		expect(await canvasRasterizer(e)(req)).toBe(blob);
		expect(img.src).toBe('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(req.svg));
		expect([canvas.width, canvas.height]).toEqual([21, 10]);
		expect(ctx.scale).toHaveBeenCalledWith(2, 2);
		expect(ctx.fillRect).not.toHaveBeenCalled();
		expect(ctx.drawImage).toHaveBeenCalledWith(img, 0, 0, 10.2, 5);
	});

	it('Hintergrund deckt die ganze Canvas (Bruchteil-Maße, ungeskaliert) vor dem Bild', async () => {
		const { e, ctx } = env();
		await canvasRasterizer(e)({ ...req, background: '#fff' });
		expect(ctx.fillStyle).toBe('#fff');
		expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 21, 10);
		expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
			ctx.scale.mock.invocationCallOrder[0]
		);
		expect(ctx.scale.mock.invocationCallOrder[0]).toBeLessThan(
			ctx.drawImage.mock.invocationCallOrder[0]
		);
	});

	it.each([
		['Bild lädt nicht', { loads: false }],
		['kein 2D-Kontext', { ctx: false }],
		['toBlob ohne Ergebnis', { blob: null }]
	])('%s: Fehler', async (_n, opts) => {
		await expect(canvasRasterizer(env(opts).e)(req)).rejects.toThrow();
	});

	it('Pixelobergrenze: Fehler mit Maßen vor Bild- und Canvas-Anlage', async () => {
		const { e } = env();
		const createImage = vi.spyOn(e, 'createImage');
		const createCanvas = vi.spyOn(e, 'createCanvas');
		await expect(
			canvasRasterizer(e)({ ...req, width: 20000, height: 20000, scale: 1 })
		).rejects.toThrow('PNG zu groß: 20000 x 20000 px');
		expect(createImage).not.toHaveBeenCalled();
		expect(createCanvas).not.toHaveBeenCalled();
	});
});
