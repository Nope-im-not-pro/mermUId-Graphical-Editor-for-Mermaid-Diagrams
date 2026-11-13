/** Raster und Hilfslinien des Canvas (reine Logik, Flow-Koordinaten). */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Rückfall-Raster, falls `doc.layout` keine gültige Größe hat. */
export const GRID_SIZE = 8;
/** Abstand in Pixeln, ab dem eine Hilfslinie erscheint. */
export const GUIDE_TOLERANCE = 4;

export function snapValue(v: number, size = GRID_SIZE): number {
	return Math.round(v / size) * size;
}

export function snapPoint(p: { x: number; y: number }, size = GRID_SIZE) {
	return { x: snapValue(p.x, size), y: snapValue(p.y, size) };
}

export interface GridSettings {
	size: number;
	snap: boolean;
}

/** Raster und Snap aus `doc.layout`; ungültige Größe fällt auf `GRID_SIZE` zurück. */
export function gridSettings(layout: { gridSize?: number; snap?: boolean }): GridSettings {
	const size = layout.gridSize;
	return {
		size: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : GRID_SIZE,
		snap: layout.snap === true
	};
}

/** `snapGrid` für Svelte Flow: nur bei aktivem Snap. */
export function snapGridOf(s: GridSettings): [number, number] | undefined {
	return s.snap ? [s.size, s.size] : undefined;
}

export function snapIf(p: { x: number; y: number }, s: GridSettings) {
	return s.snap ? snapPoint(p, s.size) : p;
}

const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

/** Kanten- und Mittellinien anderer Rechtecke, an denen `moving` (fast) anliegt. */
export function guidesFor(moving: Rect, others: readonly Rect[], tolerance = GUIDE_TOLERANCE) {
	const near = (own: number[], theirs: number[]) =>
		theirs.filter((t) => own.some((o) => Math.abs(o - t) <= tolerance));
	const vertical = new Set<number>();
	const horizontal = new Set<number>();
	for (const o of others) {
		for (const v of near(xs(moving), xs(o))) vertical.add(v);
		for (const h of near(ys(moving), ys(o))) horizontal.add(h);
	}
	const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
	return { vertical: sorted(vertical), horizontal: sorted(horizontal) };
}
