/** Ausrichten und Verteilen ausgewählter Rechtecke (reine Logik, absolute Ziele). */
import type { Rect } from './grid';

export type Move = { id: string; x: number; y: number };
export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';

/** Mindestzahl ausgewählter Knoten: Ausrichten ab 2, Verteilen ab 3 (F-04, CanvasBar). */
export const ALIGN_MIN = 2;
export const DISTRIBUTE_MIN = 3;

const known = (ids: readonly string[], geometry: Record<string, Rect>) =>
	ids.filter((id) => geometry[id]).map((id) => ({ id, r: geometry[id] }));

/** Anzahl ausrichtbarer Elemente (mit Geometrie; Kanten zählen nicht). */
export const arrangeable = (ids: readonly string[], geometry: Record<string, Rect>) =>
	known(ids, geometry).length;

const changed = (moves: Move[], geometry: Record<string, Rect>) =>
	moves.filter((m) => m.x !== geometry[m.id].x || m.y !== geometry[m.id].y);

export function alignRects(
	ids: readonly string[],
	geometry: Record<string, Rect>,
	mode: AlignMode
): Move[] {
	const items = known(ids, geometry);
	if (items.length < ALIGN_MIN) return [];
	const minX = Math.min(...items.map(({ r }) => r.x));
	const maxX = Math.max(...items.map(({ r }) => r.x + r.w));
	const minY = Math.min(...items.map(({ r }) => r.y));
	const maxY = Math.max(...items.map(({ r }) => r.y + r.h));
	const target = (r: Rect): [number, number] => {
		switch (mode) {
			case 'left':
				return [minX, r.y];
			case 'center':
				return [(minX + maxX) / 2 - r.w / 2, r.y];
			case 'right':
				return [maxX - r.w, r.y];
			case 'top':
				return [r.x, minY];
			case 'middle':
				return [r.x, (minY + maxY) / 2 - r.h / 2];
			case 'bottom':
				return [r.x, maxY - r.h];
		}
	};
	const moves = items.map(({ id, r }) => {
		const [x, y] = target(r);
		return { id, x, y };
	});
	return changed(moves, geometry);
}

/** Gleiche Lücken zwischen mindestens drei Rechtecken; die äußeren bleiben stehen. */
export function distributeRects(
	ids: readonly string[],
	geometry: Record<string, Rect>,
	axis: Axis
): Move[] {
	const items = known(ids, geometry);
	if (items.length < DISTRIBUTE_MIN) return [];
	const h = axis === 'horizontal';
	const pos = (r: Rect) => (h ? r.x : r.y);
	const size = (r: Rect) => (h ? r.w : r.h);
	items.sort((a, b) => pos(a.r) - pos(b.r));
	const start = pos(items[0].r);
	const end = Math.max(...items.map(({ r }) => pos(r) + size(r)));
	const gap = (end - start - items.reduce((s, { r }) => s + size(r), 0)) / (items.length - 1);
	let cursor = start;
	const moves = items.map(({ id, r }) => {
		const at = cursor;
		cursor += size(r) + gap;
		return h ? { id, x: at, y: r.y } : { id, x: r.x, y: at };
	});
	return changed(moves, geometry);
}
