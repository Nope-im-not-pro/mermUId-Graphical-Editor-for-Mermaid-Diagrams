/**
 * Kantengeometrie (D-04 d, e): einzige Stelle, die die Pfadfunktionen aus `@xyflow/system`
 * aufruft, mit festen Parametern. Linienmuster und Pfeilspitzen als reine Daten; Marker als
 * eigene Pfad-Geometrie (keine Referenzen auf SVG-Marker-Definitionen).
 */
import { getBezierPath, getSmoothStepPath, getStraightPath, type Position } from '@xyflow/system';

export type EdgeKind = 'bezier' | 'smoothstep' | 'straight';

/** Kantenende: Punkt und Seite des Handles. */
export interface EdgeEnd {
	x: number;
	y: number;
	position: Position;
}

export interface EdgeGeometry {
	path: string;
	labelX: number;
	labelY: number;
}

/** Krümmung der Bezier-Kanten (Svelte-Flow-Standard). */
export const BEZIER_CURVATURE = 0.25;
/** Eckradius der Smoothstep-Kanten (Svelte-Flow-Standard). */
export const SMOOTHSTEP_BORDER_RADIUS = 5;
/** Mindestabstand der Smoothstep-Kanten vom Handle (Svelte-Flow-Standard). */
export const SMOOTHSTEP_OFFSET = 20;

/** Kantenpfad und Label-Mittelpunkt für `kind` von `from` nach `to`. */
export function edgePath(kind: EdgeKind, from: EdgeEnd, to: EdgeEnd): EdgeGeometry {
	const ends = {
		sourceX: from.x,
		sourceY: from.y,
		sourcePosition: from.position,
		targetX: to.x,
		targetY: to.y,
		targetPosition: to.position
	};
	const [path, labelX, labelY] =
		kind === 'straight'
			? getStraightPath(ends)
			: kind === 'smoothstep'
				? getSmoothStepPath({
						...ends,
						borderRadius: SMOOTHSTEP_BORDER_RADIUS,
						offset: SMOOTHSTEP_OFFSET
					})
				: getBezierPath({ ...ends, curvature: BEZIER_CURVATURE });
	return { path, labelX, labelY };
}

/** Ausladung der Selbstkanten-Schleife rechts neben dem Knoten in px. */
export const SELF_LOOP_SIZE = 40;

/** Knotenbox in absoluten Koordinaten. */
export interface LoopBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Ende einer Selbstkante: Spitze am Rand, Linienpunkt um `inset` nach außen versetzt. */
export interface LoopEnd {
	tip: [number, number];
	line: [number, number];
	/** Einheitsvektor in den Knoten hinein (Richtung der Pfeilspitze). */
	dir: [number, number];
}

export interface SelfLoopGeometry extends EdgeGeometry {
	start: LoopEnd;
	end: LoopEnd;
	/** Ausladung rechts vom Knotenrand in px (`SELF_LOOP_SIZE` plus Staffelung je Index). */
	reach: number;
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/**
 * Selbstkante A-->A als kubische Schleife rechts außerhalb der Box: beide Enden am rechten Rand
 * (oberhalb und unterhalb der Mitte), Kontrollpunkte `SELF_LOOP_SIZE` weiter rechts. Alle
 * x-Werte der Kurve liegen damit rechts vom Rand. `startInset`/`endInset` kürzen die Linie vor
 * einer Pfeilspitze; nicht-endliche Maße zählen als 0. `index` (0-basiert je Knoten) staffelt
 * mehrere Selbstkanten: jede weitere lädt um `SELF_LOOP_SIZE / 2` weiter aus.
 */
export function selfLoopPath(
	box: LoopBox,
	startInset = 0,
	endInset = 0,
	index = 0
): SelfLoopGeometry {
	const reach = SELF_LOOP_SIZE + (Math.max(0, Math.floor(finite(index))) * SELF_LOOP_SIZE) / 2;
	const h = Math.max(0, finite(box.h));
	const right = finite(box.x) + Math.max(0, finite(box.w));
	const cy = finite(box.y) + h / 2;
	const spread = Math.min(h / 4, 10);
	const norm = Math.sqrt(5);
	const loopEnd = (y: number, dy: number, inset: number): LoopEnd => {
		const dir: [number, number] = [-2 / norm, dy / norm];
		return { tip: [right, y], line: [right - dir[0] * inset, y - dir[1] * inset], dir };
	};
	const start = loopEnd(cy - spread, 1, startInset);
	const end = loopEnd(cy + spread, -1, endInset);
	const c1 = [right + reach, cy - spread - reach / 2];
	const c2 = [right + reach, cy + spread + reach / 2];
	const path =
		`M${start.line[0]},${start.line[1]} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ` +
		`${end.line[0]},${end.line[1]}`;
	return {
		path,
		labelX: (start.line[0] + 3 * c1[0] + 3 * c2[0] + end.line[0]) / 8,
		labelY: (start.line[1] + 3 * c1[1] + 3 * c2[1] + end.line[1]) / 8,
		start,
		end,
		reach
	};
}

export interface LinePattern {
	/** Strichbreite in px; 0 bei `invisible`. */
	width: number;
	/** Wert für `stroke-dasharray` oder `null` für durchgezogen. */
	dasharray: string | null;
	visible: boolean;
}

const LINE_PATTERNS: Record<string, LinePattern> = {
	solid: { width: 2, dasharray: null, visible: true },
	thick: { width: 3.5, dasharray: null, visible: true },
	dotted: { width: 2, dasharray: '3 3', visible: true },
	invisible: { width: 0, dasharray: null, visible: false }
};

/** Linienmuster je `lineStyle` des Modells; unbekannt -> solid. */
export function linePattern(lineStyle: string): LinePattern {
	return { ...LINE_PATTERNS[Object.hasOwn(LINE_PATTERNS, lineStyle) ? lineStyle : 'solid'] };
}

export type MarkerKind = 'point' | 'circle' | 'cross';

/**
 * Pfeilspitze in lokalen Koordinaten: Spitze im Ursprung, Richtung +x. Der Nutzer verschiebt
 * sie an das Kantenende und dreht sie in Kantenrichtung; `inset` kürzt die Linie davor.
 */
export interface MarkerGeometry {
	kind: MarkerKind;
	path: string;
	filled: boolean;
	inset: number;
}

const MARKERS: Record<MarkerKind, MarkerGeometry> = {
	point: { kind: 'point', path: 'M0 0 L-10 -5 L-10 5 Z', filled: true, inset: 8 },
	circle: {
		kind: 'circle',
		path: 'M-8 0 A4 4 0 1 0 0 0 A4 4 0 1 0 -8 0 Z',
		filled: true,
		inset: 8
	},
	cross: { kind: 'cross', path: 'M-8 -4 L0 4 M-8 4 L0 -4', filled: false, inset: 4 }
};

/** Modell-Namen (`arrow`, `circle`, `cross`, `none`) und Mermaid-db-Namen (`arrow_point` ...). */
const HEAD_KIND: Record<string, MarkerKind | null> = {
	arrow: 'point',
	point: 'point',
	circle: 'circle',
	cross: 'cross',
	open: null,
	none: null
};

export interface EdgeMarkers {
	start: MarkerGeometry | null;
	end: MarkerGeometry | null;
}

/** Marker an Start und Ende je `arrowHead`; `double_*` setzt beide Enden, unbekannt -> keine. */
export function markerFor(arrowHead: string): EdgeMarkers {
	const double = arrowHead.startsWith('double_');
	const base = arrowHead.replace(/^double_/, '').replace(/^arrow_/, '');
	const kind = Object.hasOwn(HEAD_KIND, base) ? HEAD_KIND[base] : null;
	const end = kind ? { ...MARKERS[kind] } : null;
	return { start: double && kind ? { ...MARKERS[kind] } : null, end };
}
