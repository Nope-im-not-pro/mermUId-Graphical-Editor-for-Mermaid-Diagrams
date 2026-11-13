/**
 * Knotenformen als SVG-Pfad (`d`) in einer Box `w` x `h`, Ursprung links oben.
 * Formnamen wie der flowchart-Katalog (Mermaid-db-Typen) und die `@{ shape }`-Formen; unbekannte
 * Form -> square.
 */

/** Alle Formnamen des flowchart-Katalogs. */
export const SHAPE_NAMES = [
	'doublecircle',
	'circle',
	'stadium',
	'subroutine',
	'cylinder',
	'lean_right',
	'trapezoid',
	'lean_left',
	'inv_trapezoid',
	'hexagon',
	'round',
	'square',
	'diamond',
	'odd'
] as const;

export type ShapeName = (typeof SHAPE_NAMES)[number];

/**
 * Formen über `A@{ shape: ... }` (F-07), kanonische Kurznamen wie der Adapter (`META_SHAPES`);
 * bewusst getrennt vom Klammer-Katalog `SHAPE_NAMES`.
 */
export const META_SHAPE_NAMES = ['doc', 'delay', 'sl-rect', 'h-cyl', 'lin-cyl'] as const;

export type MetaShapeName = (typeof META_SHAPE_NAMES)[number];

/** Freie Ränder einer Form zur Box: dort liegen Welle, Rundung, Schräge oder Deckel, kein Label. */
export type Insets = { top: number; right: number; bottom: number; left: number };

/** Eckradius der Form `round`. */
const ROUND_RADIUS = 5;
/** Abstand der Innenlinien bei `subroutine`. */
const SUBROUTINE_INSET = 8;
/** Abstand des Innenkreises bei `doublecircle`. */
const DOUBLE_GAP = 5;

/**
 * Zahl auf zwei Nachkommastellen, ohne `-0` (deterministische Ausgabe). Läuft `v * 100` über
 * (sehr große Werte), bleibt `v` ungerundet; solche Werte haben ohnehin keine Nachkommastellen.
 */
function fmt(v: number): string {
	const scaled = v * 100;
	const r = Number.isFinite(scaled) ? Math.round(scaled) / 100 : v;
	return Object.is(r, -0) ? '0' : String(r);
}

function poly(points: [number, number][]): string {
	return points.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join(' ') + ' Z';
}

function circlePath(cx: number, cy: number, r: number): string {
	const a = `A${fmt(r)} ${fmt(r)} 0 1 0`;
	return `M${fmt(cx - r)} ${fmt(cy)} ${a} ${fmt(cx + r)} ${fmt(cy)} ${a} ${fmt(cx - r)} ${fmt(cy)} Z`;
}

/** Rechteck mit Eckradius `r` (Bögen im Uhrzeigersinn). */
function roundRect(w: number, h: number, r: number): string {
	const a = `A${fmt(r)} ${fmt(r)} 0 0 1`;
	return [
		`M${fmt(r)} 0`,
		`H${fmt(w - r)}`,
		`${a} ${fmt(w)} ${fmt(r)}`,
		`V${fmt(h - r)}`,
		`${a} ${fmt(w - r)} ${fmt(h)}`,
		`H${fmt(r)}`,
		`${a} 0 ${fmt(h - r)}`,
		`V${fmt(r)}`,
		`${a} ${fmt(r)} 0`,
		'Z'
	].join(' ');
}

const BUILDERS: Record<ShapeName | MetaShapeName, (w: number, h: number) => string> = {
	square: (w, h) =>
		poly([
			[0, 0],
			[w, 0],
			[w, h],
			[0, h]
		]),
	round: (w, h) => roundRect(w, h, Math.min(ROUND_RADIUS, w / 2, h / 2)),
	stadium: (w, h) => roundRect(w, h, Math.min(w, h) / 2),
	circle: (w, h) => circlePath(w / 2, h / 2, Math.min(w, h) / 2),
	doublecircle: (w, h) => {
		const r = Math.min(w, h) / 2;
		const inner = Math.max(0, r - Math.min(DOUBLE_GAP, r / 4));
		return `${circlePath(w / 2, h / 2, r)} ${circlePath(w / 2, h / 2, inner)}`;
	},
	diamond: (w, h) =>
		poly([
			[w / 2, 0],
			[w, h / 2],
			[w / 2, h],
			[0, h / 2]
		]),
	hexagon: (w, h) => {
		const m = Math.min(h / 4, w / 4);
		return poly([
			[m, 0],
			[w - m, 0],
			[w, h / 2],
			[w - m, h],
			[m, h],
			[0, h / 2]
		]);
	},
	lean_right: (w, h) => {
		const s = slant(w, h);
		return poly([
			[s, 0],
			[w, 0],
			[w - s, h],
			[0, h]
		]);
	},
	lean_left: (w, h) => {
		const s = slant(w, h);
		return poly([
			[0, 0],
			[w - s, 0],
			[w, h],
			[s, h]
		]);
	},
	trapezoid: (w, h) => {
		const s = slant(w, h);
		return poly([
			[s, 0],
			[w - s, 0],
			[w, h],
			[0, h]
		]);
	},
	inv_trapezoid: (w, h) => {
		const s = slant(w, h);
		return poly([
			[0, 0],
			[w, 0],
			[w - s, h],
			[s, h]
		]);
	},
	subroutine: (w, h) => {
		const i = Math.min(SUBROUTINE_INSET, w / 4);
		return `${BUILDERS.square(w, h)} M${fmt(i)} 0 V${fmt(h)} M${fmt(w - i)} 0 V${fmt(h)}`;
	},
	cylinder: (w, h) => {
		const rx = w / 2;
		const ry = cylinderRy(w, h);
		const a = `A${fmt(rx)} ${fmt(ry)} 0 0`;
		const top = fmt(ry);
		const bottom = fmt(h - ry);
		// Körper (Oberkante = hintere Deckelhälfte), danach vordere Deckelhälfte als eigener Teilpfad.
		return (
			`M0 ${top} ${a} 1 ${fmt(w)} ${top} V${bottom} ${a} 1 0 ${bottom} Z` +
			` M0 ${top} ${a} 0 ${fmt(w)} ${top}`
		);
	},
	odd: (w, h) =>
		poly([
			[0, 0],
			[w, 0],
			[w, h],
			[0, h],
			[Math.min(h / 2, w / 4), h / 2]
		]),
	// Dokument: Unterkante als volle Welle (rechts hoch, links tief) aus zwei Halbellipsen.
	doc: (w, h) => {
		const a = docWave(h);
		const base = fmt(h - a);
		return (
			`M0 0 H${fmt(w)} V${base} A${fmt(w / 4)} ${fmt(a)} 0 0 0 ${fmt(w / 2)} ${base}` +
			` A${fmt(w / 4)} ${fmt(a)} 0 0 1 0 ${base} Z`
		);
	},
	// Verzögerung: links gerade, rechts Halbrund.
	delay: (w, h) => {
		const r = delayRadius(w, h);
		return `M0 0 H${fmt(w - r)} A${fmt(r)} ${fmt(h / 2)} 0 0 1 ${fmt(w - r)} ${fmt(h)} H0 Z`;
	},
	// Manuelle Eingabe: Oberkante steigt nach rechts an (mermaid: linke Ecke um ein Drittel tiefer).
	'sl-rect': (w, h) =>
		poly([
			[0, h / 3],
			[w, 0],
			[w, h],
			[0, h]
		]),
	// Liegender Zylinder: Körper mit hinterer linker Hälfte, vorderer Deckel rechts als Teilpfad.
	'h-cyl': (w, h) => {
		const rx = hCylRadius(w, h);
		const a = `A${fmt(rx)} ${fmt(h / 2)} 0 0`;
		const right = fmt(w - rx);
		return (
			`M${fmt(rx)} 0 H${right} ${a} 1 ${right} ${fmt(h)} H${fmt(rx)} ${a} 1 ${fmt(rx)} 0 Z` +
			` M${right} 0 ${a} 0 ${right} ${fmt(h)}`
		);
	},
	// Zylinder mit zusätzlicher Linie unter dem Deckel (mermaid: Abstand ein Zehntel der Höhe).
	'lin-cyl': (w, h) => {
		const ry = cylinderRy(w, h);
		const y = fmt(ry + h * LINE_OFFSET);
		return `${BUILDERS.cylinder(w, h)} M0 ${y} A${fmt(w / 2)} ${fmt(ry)} 0 0 0 ${fmt(w)} ${y}`;
	}
};

/** Abstand der Linie bei `lin-cyl` unter dem Deckel, Anteil der Höhe (mermaid `outerOffset`). */
const LINE_OFFSET = 0.1;

/** Halbachse des Deckels bei `cylinder`/`lin-cyl` (mermaid `ry = rx / (2.5 + w / 50)`). */
function cylinderRy(w: number, h: number): number {
	return Math.min(h / 4, w / 2 / (2.5 + w / 50));
}

/** Seitliche Halbachse bei `h-cyl` (mermaid `rx = ry / (2.5 + h / 50)`, `ry = h / 2`). */
function hCylRadius(w: number, h: number): number {
	return Math.min(w / 4, h / 2 / (2.5 + h / 50));
}

/** Wellenhöhe bei `doc`: ein Neuntel der Box (mermaid: ein Achtel der Höhe ohne Welle). */
function docWave(h: number): number {
	return h / 9;
}

function delayRadius(w: number, h: number): number {
	return Math.min(h / 2, w / 2);
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const INSETS: Record<MetaShapeName, (w: number, h: number) => Insets> = {
	doc: (_, h) => ({ ...NO_INSETS, bottom: 2 * docWave(h) }),
	delay: (w, h) => ({ ...NO_INSETS, right: delayRadius(w, h) }),
	'sl-rect': (_, h) => ({ ...NO_INSETS, top: h / 3 }),
	'h-cyl': (w, h) => ({ ...NO_INSETS, left: hCylRadius(w, h), right: 2 * hCylRadius(w, h) }),
	'lin-cyl': (w, h) => {
		const ry = cylinderRy(w, h);
		return { ...NO_INSETS, top: 2 * ry + h * LINE_OFFSET, bottom: ry };
	}
};

function isMetaShape(shape: string): shape is MetaShapeName {
	return (META_SHAPE_NAMES as readonly string[]).includes(shape);
}

/**
 * Ränder ohne Label in der Box `w` x `h`; Bestandsformen 0 (Label mittig in der Box wie bisher).
 * Negative und nicht-endliche Maße zählen als 0.
 */
export function shapeInsets(shape: string, w: number, h: number): Insets {
	return isMetaShape(shape) ? INSETS[shape](dim(w), dim(h)) : NO_INSETS;
}

/** Neigung der Parallelogramm- und Trapezformen. */
function slant(w: number, h: number): number {
	return Math.min(h / 2, w / 4);
}

function isShapeName(shape: string): shape is ShapeName {
	return (SHAPE_NAMES as readonly string[]).includes(shape);
}

/** Maß für die Box: negative und nicht-endliche Werte (NaN, ±Infinity) zählen als 0. */
function dim(v: number): number {
	return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** SVG-`d` der Form `shape` in der Box `w` x `h`; negative und nicht-endliche Maße zählen als 0. */
export function shapePath(shape: string, w: number, h: number): string {
	const build = BUILDERS[isShapeName(shape) || isMetaShape(shape) ? shape : 'square'];
	return build(dim(w), dim(h));
}
