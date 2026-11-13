/**
 * Einpassen und Knotengrößen des Graph-Canvas (reine Logik, aus GraphFlow ausgelagert, O-141);
 * `fitFrame` teilt die Rand-Logik mit dem Sequenz-Canvas (T126 C3).
 */
import type { FitViewOptions } from '@xyflow/svelte';

type Size = { width?: number; height?: number };
type Padding = NonNullable<FitViewOptions['padding']>;

/** Standard-Abstand beim Einpassen (Bruchteil wie @xyflow `fitView`). */
export const FIT_PADDING = 0.1;
/** Von der Vorschau-Karte belegter Rand der Fläche in px, gemessen ab rechter/unterer Kante. */
export type Reserve = { right: number; bottom: number };

/**
 * Beim Einpassen ausgesparte Seite (M-12 a): die Karte liegt in der Ecke unten rechts;
 * ausgespart wird nur die Seite, die anteilig weniger Fläche kostet (flache Karte unten, hohe
 * Karte bei breiter Fläche rechts). Ohne Rand, ohne Flächenmaße oder wenn auch die günstigere
 * Seite mehr als die Hälfte der Fläche kostet (schmale Fläche): keine.
 */
function reserveSide(
	reserve: Reserve | null | undefined,
	frame: { width: number; height: number }
): keyof Reserve | null {
	if (!reserve || reserve.right <= 0 || reserve.bottom <= 0) return null;
	if (frame.width <= 0 || frame.height <= 0) return null;
	const right = reserve.right / frame.width;
	const bottom = reserve.bottom / frame.height;
	if (Math.min(right, bottom) > 0.5) return null;
	return right < bottom ? 'right' : 'bottom';
}

/** `fitView`-Padding mit reserviertem Rand (Seitenwahl `reserveSide`), sonst Standard-Abstand. */
export function fitPadding(
	reserve: Reserve | null | undefined,
	frame: { width: number; height: number }
): Padding {
	const side = reserveSide(reserve, frame);
	if (!side) return FIT_PADDING;
	return {
		top: FIT_PADDING,
		left: FIT_PADDING,
		right: FIT_PADDING,
		bottom: FIT_PADDING,
		[side]: `${Math.ceil(reserve![side])}px`
	};
}

/**
 * Rahmen ohne den reservierten Rand (gleiche Seitenwahl wie `fitPadding`), für Einpassen per
 * Zoom und Scrollen (Sequenz-Canvas, T126 C3).
 */
export function fitFrame(
	frame: { width: number; height: number },
	reserve: Reserve | null | undefined
): { width: number; height: number } {
	const side = reserveSide(reserve, frame);
	if (!side) return { width: frame.width, height: frame.height };
	const cut = Math.ceil(reserve![side]);
	return side === 'right'
		? { width: frame.width - cut, height: frame.height }
		: { width: frame.width, height: frame.height - cut };
}

/**
 * `measured` ab `VISIBLE_ONLY_FROM` Knoten (O-87): eine von der berechneten Größe abweichende
 * DOM-Messung hat Vorrang, aber nur solange sich die berechnete Größe nicht geändert hat;
 * sonst gilt die neue berechnete Größe (die alte Messung gehört zur alten Beschriftung).
 */
export function presetMeasured(next: Size, prev?: Size & { measured?: Size }): Size {
	const m = prev?.measured;
	const same = prev && next.width === prev.width && next.height === prev.height;
	const dom = same && m && (m.width !== prev.width || m.height !== prev.height) ? m : undefined;
	return dom ?? { width: next.width, height: next.height };
}
