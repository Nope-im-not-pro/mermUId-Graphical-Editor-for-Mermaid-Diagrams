/**
 * PNG-Export (T20 C2, KONZEPT §6.3): Maßstab 1x/2x/3x, transparent oder mit Hintergrund,
 * Rand in px (T127 C2).
 * Gerastert wird über einen injizierten `Rasterizer` (Browser: `canvasRasterizer`); diese
 * Datei ist DOM-frei. Gesperrt: foreignObject (Canvas-Tainting) und Metadaten (§6.2).
 */
import { msg } from '../i18n';
import { marginOf } from './background';
import { openTagEnd } from './source';

export type PngScale = 1 | 2 | 3;

export interface RasterRequest {
	/** SVG mit festen `width`/`height` am Root. */
	svg: string;
	width: number;
	height: number;
	scale: PngScale;
	/** CSS-Farbe; `null` = transparent. */
	background: string | null;
}

export type Rasterizer = (request: RasterRequest) => Promise<Blob>;

export interface PngOptions {
	scale?: PngScale;
	background?: string | null;
	/** Rand in px um die Zeichnung (Ganzzahl 0..512, sonst 0); wächst mit dem Maßstab. */
	margin?: number;
}

export type PngResult = { ok: true; blob: Blob } | { ok: false; error: { message: string } };

/** Canvas-Grenzen der Browser (Chromium/Firefox): Kantenlänge und Fläche in Pixel. */
export const MAX_CANVAS_EDGE = 32767;
export const MAX_CANVAS_PIXELS = 268435456;

/**
 * Fehlermeldung, wenn `width`/`height` in `scale` die Canvas-Grenzen überschreiten; sonst
 * `null`. Rechnet wie die Canvas-Anlage mit aufgerundeten Pixelmaßen.
 */
export function canvasLimitError(width: number, height: number, scale: number): string | null {
	const w = Math.ceil(width * scale);
	const h = Math.ceil(height * scale);
	if (w <= MAX_CANVAS_EDGE && h <= MAX_CANVAS_EDGE && w * h <= MAX_CANVAS_PIXELS) return null;
	return msg('services.export.pngTooLarge', {
		w,
		h,
		edge: MAX_CANVAS_EDGE,
		pixels: MAX_CANVAS_PIXELS
	});
}

/** Breite und Höhe aus der `viewBox` des Root-Start-Tags; `null` ohne gültige Angabe. */
export function sizeOf(svg: string): { width: number; height: number } | null {
	const end = openTagEnd(svg);
	if (end === -1) return null;
	const box = /\sviewBox="([^"]*)"/
		.exec(svg.slice(0, end))?.[1]
		.trim()
		.split(/[\s,]+/);
	if (!box || box.length !== 4) return null;
	const [width, height] = box.slice(2).map(Number);
	return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
		? { width, height }
		: null;
}

/**
 * Ersetzt `width`/`height` am Root durch feste Werte (mermaid setzt `width="100%"`) und
 * entfernt `max-width` aus dem Root-`style` (mermaid `useMaxWidth`): sonst bliebe die
 * Zeichnung bei Rand auf der alten Breite, verkleinert und asymmetrisch. Übrige
 * Deklarationen bleiben; ein leerer `style` entfällt.
 */
function withSize(svg: string, width: number, height: number): string {
	const end = openTagEnd(svg);
	const start = svg.indexOf('<svg');
	const attrs = svg
		.slice(start + 4, end)
		.replace(/\s(?:width|height)="[^"]*"/g, '')
		.replace(/\sstyle="([^"]*)"/, (_all, style: string) => {
			const kept = style
				.replace(/(^|;)\s*max-width\s*:[^;]*;?/i, '$1')
				.trim()
				.replace(/^;$/, '');
			return kept ? ` style="${kept}"` : '';
		});
	return `${svg.slice(0, start)}<svg width="${width}" height="${height}"${attrs}${svg.slice(end)}`;
}

/** Erweitert die `viewBox` des Root um `margin` je Seite (gültige viewBox vorausgesetzt). */
function withMargin(svg: string, margin: number): string {
	if (margin === 0) return svg;
	const end = openTagEnd(svg);
	return (
		svg.slice(0, end).replace(/(\sviewBox=")([^"]*)"/, (_all, head: string, box: string) => {
			const [x, y, w, h] = box
				.trim()
				.split(/[\s,]+/)
				.map(Number);
			return `${head}${x - margin} ${y - margin} ${w + 2 * margin} ${h + 2 * margin}"`;
		}) + svg.slice(end)
	);
}

function fail(message: string): PngResult {
	return { ok: false, error: { message } };
}

/** Rastert ein exportiertes SVG zu PNG. */
export async function exportPng(
	svg: string,
	rasterize: Rasterizer,
	{ scale = 1, background = null, margin = 0 }: PngOptions = {}
): Promise<PngResult> {
	if (![1, 2, 3].includes(scale)) return fail(msg('services.export.scale'));
	if (/<foreignObject[\s>/]/i.test(svg)) return fail(msg('services.export.foreignObject'));
	if (/@mermuid/i.test(svg)) return fail(msg('services.export.metadata'));
	if (!sizeOf(svg)) return fail(msg('services.export.viewBox'));
	svg = withMargin(svg, marginOf(margin));
	const size = sizeOf(svg)!;
	const tooLarge = canvasLimitError(size.width, size.height, scale);
	if (tooLarge) return fail(tooLarge);
	try {
		const blob = await rasterize({
			svg: withSize(svg, size.width, size.height),
			...size,
			scale,
			background
		});
		return { ok: true, blob };
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
}
