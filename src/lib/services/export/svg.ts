/**
 * Editor-SVG-Generator (T20 C1, D-04, O-28): reine Funktion `(Modell, Geometrie) -> SVG-String`.
 * Misst nicht selbst (Textmetrik injiziert), kein DOM. Formen, Umbruch, Kanten und Marker
 * ausschließlich über `services/shapes`. Knoten-, Container- und Kantenstile (`style`,
 * `classDef`/`class`, `linkStyle`) über `resolveStyle` wie im Canvas, nur Werte der Allow-Liste
 * (V-06). Ausgabe nur aus festen Elementen (`svg`, `title`, `g`,
 * `path`, `rect`, `text`, `tspan`) mit Präsentationsattributen: keine Fremdobjekte, keine Styles,
 * keine Verweise. Texte sind XML-maskiert; Element-IDs erscheinen nicht im SVG.
 */
import type { DiagramDocument, DiagramEdge, DiagramNode, Position } from '../../model/types';
import {
	edgePath,
	labelArea,
	linePattern,
	markerFor,
	selfLoopPath,
	shapePath,
	wrapLabel,
	type EdgeEnd,
	type EdgeGeometry,
	type EdgeKind,
	type EdgeMarkers,
	type MarkerGeometry
} from '../shapes';
import { isSafeColor, resolveStyle, textColor, type ResolvedStyle } from '../shapes/style';

/** Element-ID -> `[x, y, w, h]` (Knoten und Container). */
export type Geometry = Readonly<Record<string, Position>>;

export interface EditorSvgOptions {
	/** Textbreite in px bei `FONT_SIZE` (Browser: Canvas `measureText`, Test: Stub). */
	measure: (text: string) => number;
	/** Vorrang vor `doc.title`; leer -> `DEFAULT_TITLE`. */
	title?: string;
	/** Kantenart wie im Editor; Standard `bezier`. */
	edgeKind?: EdgeKind;
	/** Farben, z. B. aus dem aktiven Theme; Standard `DEFAULT_PALETTE`. */
	palette?: Partial<Palette>;
	/** Nur diese Elemente (Knoten, Container samt Inhalt); Kanten nur mit beiden Enden darin. */
	only?: ReadonlySet<string>;
}

/** Nur Service-Rückfall (kein i18n hier): die App liefert immer einen Titel (`exportTitle`). */
export const DEFAULT_TITLE = 'Diagramm';
export const FONT_SIZE = 14;
const FONT_FAMILY = 'sans-serif';
const LINE_HEIGHT = 18;
/** Rand um die Zeichnung im viewBox. */
const PADDING = 20;
/** Innenabstand des Labels zur Knotenbox. */
const NODE_PADDING = 8;
/** Maximale Breite eines Kantenlabels. */
const EDGE_LABEL_WIDTH = 200;
const EDGE_LABEL_PADDING = 4;

export interface Palette {
	nodeFill: string;
	nodeStroke: string;
	containerFill: string;
	containerStroke: string;
	line: string;
	text: string;
	labelBackground: string;
	noteFill: string;
	/** Fläche hinter der Zeichnung; ohne Angabe transparent. */
	background?: string;
}

export const DEFAULT_PALETTE: Readonly<Palette> = {
	nodeFill: '#ECECFF',
	nodeStroke: '#9370DB',
	containerFill: '#FFFFDE',
	containerStroke: '#AAAA33',
	line: '#333333',
	text: '#333333',
	labelBackground: '#E8E8E8',
	noteFill: '#FFF5AD'
};

/** Palette mit geprüften Farben; unzulässige Werte fallen auf `DEFAULT_PALETTE` zurück. */
export function safePalette(palette: Partial<Palette> | undefined): Palette {
	const out: Palette = { ...DEFAULT_PALETTE };
	for (const key of Object.keys(DEFAULT_PALETTE) as (keyof Palette)[]) {
		const v = palette?.[key]?.trim();
		if (v && isSafeColor(v)) out[key] = v;
	}
	const bg = palette?.background?.trim();
	if (bg && isSafeColor(bg)) out.background = bg;
	return out;
}

/** In XML 1.0 unzulässige Zeichen und einzelne Surrogate. */
const INVALID_XML =
	// eslint-disable-next-line no-control-regex -- Steuerzeichen sind hier gerade das Ziel.
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const ENTITIES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;',
	'(': '&#40;',
	')': '&#41;',
	'@': '&#64;'
};

/**
 * Text für Inhalt und Attribute: Markup-Zeichen als Entity, ebenso `(`, `)` und `@`, damit
 * Label-Text weder als `url(` noch als Metadaten-Marke im Quelltext des SVG erscheint.
 */
export function escapeXml(text: string): string {
	return text.replace(INVALID_XML, '').replace(/[&<>"'()@]/g, (c) => ENTITIES[c]);
}

/** Zahl auf zwei Nachkommastellen, ohne `-0` (deterministisch). */
function fmt(v: number): string {
	const scaled = v * 100;
	const r = Number.isFinite(scaled) ? Math.round(scaled) / 100 : v;
	return Object.is(r, -0) ? '0' : String(r);
}

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Box aus der Geometrie; nicht-endliche Werte -> 0, negative Maße -> 0. */
function boxOf(geometry: Geometry, id: string): Box | null {
	if (!Object.hasOwn(geometry, id)) return null;
	const [x, y, w, h] = geometry[id];
	return { x: finite(x), y: finite(y), w: Math.max(0, finite(w)), h: Math.max(0, finite(h)) };
}

/** Zeilen als `<text>` mit `<tspan>` je Zeile, vertikal um `cy` zentriert. */
function textBlock(lines: string[], cx: number, cy: number, color: string): string {
	const top = cy - ((lines.length - 1) * LINE_HEIGHT) / 2;
	const spans = lines
		.map(
			(line, i) =>
				`<tspan x="${fmt(cx)}" y="${fmt(top + i * LINE_HEIGHT)}">${escapeXml(line)}</tspan>`
		)
		.join('');
	return (
		`<text text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}"` +
		` font-size="${FONT_SIZE}" fill="${escapeXml(color)}">${spans}</text>`
	);
}

type Side = 'left' | 'top' | 'right' | 'bottom';

/** Richtung aus der Box heraus je Seite. */
const OUTWARD: Record<Side, [number, number]> = {
	left: [-1, 0],
	top: [0, -1],
	right: [1, 0],
	bottom: [0, 1]
};

function sidePoint(box: Box, side: Side): [number, number] {
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	if (side === 'left') return [box.x, cy];
	if (side === 'right') return [box.x + box.w, cy];
	return [cx, side === 'top' ? box.y : box.y + box.h];
}

/** Seiten von Quelle und Ziel nach der überwiegenden Richtung der Mittelpunkte. */
function sides(source: Box, target: Box): [Side, Side] {
	const dx = target.x + target.w / 2 - (source.x + source.w / 2);
	const dy = target.y + target.h / 2 - (source.y + source.h / 2);
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
	return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

/** Kantenende mit Marker: Linienpunkt um `inset` nach außen versetzt, Spitze am Rand. */
interface End {
	line: [number, number];
	tip: [number, number];
	/** Einheitsvektor der Markerrichtung (Spitze zeigt auf den Knoten). */
	dir: [number, number];
}

function endAt(point: [number, number], dir: [number, number], marker: MarkerGeometry | null): End {
	const inset = marker?.inset ?? 0;
	return { line: [point[0] - dir[0] * inset, point[1] - dir[1] * inset], tip: point, dir };
}

function markerPath(marker: MarkerGeometry, end: End, color: string): string {
	const angle = (Math.atan2(end.dir[1], end.dir[0]) * 180) / Math.PI;
	const line = escapeXml(color);
	const fill = marker.filled ? line : 'none';
	return (
		`<path class="marker" d="${marker.path}" transform="translate(${fmt(end.tip[0])} ` +
		`${fmt(end.tip[1])}) rotate(${fmt(angle)})" fill="${fill}" stroke="${line}"` +
		` stroke-width="1.5"/>`
	);
}

/** Kantenpfad zwischen zwei Boxen: Seiten nach Mittelpunkt-Richtung, Pfad über `edgePath`. */
function routedEdge(
	source: Box,
	target: Box,
	kind: EdgeKind,
	markers: EdgeMarkers
): { geo: EdgeGeometry; start: End; end: End } {
	const [sourceSide, targetSide] = sides(source, target);
	const from = sidePoint(source, sourceSide);
	const to = sidePoint(target, targetSide);
	let startDir: [number, number];
	let endDir: [number, number];
	const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
	if (kind === 'straight' && length > 0) {
		endDir = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
		startDir = [-endDir[0], -endDir[1]];
	} else {
		const [sx, sy] = OUTWARD[sourceSide];
		const [tx, ty] = OUTWARD[targetSide];
		startDir = [-sx, -sy];
		endDir = [-tx, -ty];
	}
	const start = endAt(from, startDir, markers.start);
	const end = endAt(to, endDir, markers.end);
	const ends = (point: [number, number], side: Side): EdgeEnd => ({
		x: point[0],
		y: point[1],
		position: side as EdgeEnd['position']
	});
	const geo = edgePath(kind, ends(start.line, sourceSide), ends(end.line, targetSide));
	return { geo, start, end };
}

/** Selbstkanten je Knoten: Anzahl bisher gezeichneter Schleifen, rechter Rand ihrer Labels. */
interface SelfLoopState {
	count: number;
	labelRight: number;
}

function edgeSvg(
	edge: DiagramEdge,
	source: Box,
	target: Box,
	kind: EdgeKind,
	measure: (s: string) => number,
	bounds: Box[],
	loops: Map<string, SelfLoopState>,
	c: Palette,
	style: ResolvedStyle
): { path: string; label: string } {
	const pattern = linePattern(edge.lineStyle);
	if (!pattern.visible) return { path: '', label: '' };
	const markers = markerFor(edge.arrowHead);
	let route: { geo: EdgeGeometry; start: End; end: End };
	let loopState: SelfLoopState | null = null;
	let labelMinX = -Infinity;
	if (edge.sourceId === edge.targetId) {
		// Selbstkante: Schleife außerhalb des Knotens, je Knoten gestaffelt; Ausladung zählt zur viewBox.
		loopState = loops.get(edge.sourceId) ?? { count: 0, labelRight: -Infinity };
		loops.set(edge.sourceId, loopState);
		const loop = selfLoopPath(
			source,
			markers.start?.inset ?? 0,
			markers.end?.inset ?? 0,
			loopState.count++
		);
		route = { geo: loop, start: loop.start, end: loop.end };
		const top = loop.start.tip[1] - loop.reach / 2;
		const bottom = loop.end.tip[1] + loop.reach / 2;
		bounds.push({ x: loop.start.tip[0], y: top, w: loop.reach, h: bottom - top });
		// Label rechts der Schleife und rechts der Labels früherer Schleifen am selben Knoten.
		labelMinX = Math.max(loop.start.tip[0] + loop.reach, loopState.labelRight + EDGE_LABEL_PADDING);
	} else {
		route = routedEdge(source, target, kind, markers);
	}
	const { geo, start, end } = route;
	const line = style.stroke ?? c.line;
	const parts = [
		`<g class="edge"><path d="${geo.path}" fill="none" stroke="${escapeXml(line)}"` +
			` stroke-width="${fmt(style.strokeWidth ?? pattern.width)}"` +
			`${dashAttr(style.strokeDasharray ?? pattern.dasharray)}/>`
	];
	if (markers.start) parts.push(markerPath(markers.start, start, line));
	if (markers.end) parts.push(markerPath(markers.end, end, line));
	parts.push('</g>');
	let label = '';
	if (edge.label) {
		const lines = wrapLabel(edge.label, EDGE_LABEL_WIDTH, measure);
		const w = lines.reduce((m, l) => Math.max(m, finite(measure(l))), 0) + 2 * EDGE_LABEL_PADDING;
		const h = lines.length * LINE_HEIGHT + EDGE_LABEL_PADDING;
		const box = { x: Math.max(geo.labelX - w / 2, labelMinX), y: geo.labelY - h / 2, w, h };
		if (loopState) loopState.labelRight = box.x + w;
		bounds.push(box);
		label =
			`<g class="edge-label"><rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(w)}"` +
			` height="${fmt(h)}" fill="${escapeXml(c.labelBackground)}"/>` +
			`${textBlock(lines, box.x + w / 2, geo.labelY, style.color ?? c.text)}</g>`;
	}
	return { path: parts.join(''), label };
}

/** `stroke-dasharray`-Attribut; leer ohne Muster. */
function dashAttr(dash: string | null | undefined): string {
	return dash ? ` stroke-dasharray="${escapeXml(dash)}"` : '';
}

/** Fläche, Rand, Stärke und Muster einer Form: Stil vor Palette, Standardstärke 1. */
function shapeAttrs(style: ResolvedStyle, fill: string, stroke: string): string {
	return (
		` fill="${escapeXml(style.fill ?? fill)}" stroke="${escapeXml(style.stroke ?? stroke)}"` +
		` stroke-width="${fmt(style.strokeWidth ?? 1)}"${dashAttr(style.strokeDasharray)}`
	);
}

/** Verschachtelungstiefe je Container; Zyklen und fehlende Eltern beenden die Kette. */
function depths(doc: DiagramDocument): Map<string, number> {
	const parent = new Map(doc.containers.map((c) => [c.id, c.parentId]));
	const depth = new Map<string, number>();
	for (const c of doc.containers) {
		const chain: string[] = [];
		const seen = new Set<string>();
		let id: string | null = c.id;
		while (id !== null && parent.has(id) && !depth.has(id) && !seen.has(id)) {
			seen.add(id);
			chain.push(id);
			id = parent.get(id) ?? null;
		}
		let d = id !== null && depth.has(id) ? (depth.get(id) as number) + 1 : 0;
		for (let i = chain.length - 1; i >= 0; i--) depth.set(chain[i], d++);
	}
	return depth;
}

/** Auswahl samt Inhalt ausgewählter Container (über `parentId`, zyklenfest). */
function expandSelection(doc: DiagramDocument, only: ReadonlySet<string>): Set<string> {
	const parent = new Map<string, string | null>();
	for (const c of doc.containers) parent.set(c.id, c.parentId);
	for (const n of doc.nodes) parent.set(n.id, n.parentId);
	const keep = new Set<string>();
	for (const id of parent.keys()) {
		const seen = new Set<string>();
		let cur: string | null = id;
		while (cur !== null && !seen.has(cur)) {
			if (only.has(cur)) {
				keep.add(id);
				break;
			}
			seen.add(cur);
			cur = parent.get(cur) ?? null;
		}
	}
	return keep;
}

/** Hintergrund-Rechteck über die ganze viewBox, falls die Palette eines vorgibt. */
export function backgroundRect(view: string[], color: string | undefined): string {
	if (!color) return '';
	const [x, y, w, h] = view;
	return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(color)}"/>`;
}

/**
 * Erzeugt das Editor-SVG: Container (äußere zuerst), Kantenpfade, Kantenlabels, Knoten. Labels
 * folgen allen Pfaden, damit keine spätere Kante (etwa eine weitere Schleife) ein Label überdeckt. Elemente ohne Geometrie
 * und Kanten mit fehlendem Ende entfallen. viewBox = Hülle aller Boxen plus Rand.
 */
export function editorSvg(
	doc: DiagramDocument,
	geometry: Geometry,
	options: EditorSvgOptions
): string {
	const { measure } = options;
	const kind = options.edgeKind ?? 'bezier';
	const c = safePalette(options.palette);
	const keep = options.only ? expandSelection(doc, options.only) : null;
	const kept = (id: string) => keep === null || keep.has(id);
	const bounds: Box[] = [];
	const body: string[] = [];
	const nodeById = new Map<string, DiagramNode>();
	for (const n of doc.nodes) if (!nodeById.has(n.id)) nodeById.set(n.id, n);

	const depth = depths(doc);
	const containers = doc.containers
		.map((c, i) => ({ c, i, d: depth.get(c.id) ?? 0 }))
		.sort((a, b) => a.d - b.d || a.i - b.i);
	for (const { c: cont } of containers) {
		const box = kept(cont.id) ? boxOf(geometry, cont.id) : null;
		if (!box) continue;
		bounds.push(box);
		const lines = wrapLabel(cont.label, Math.max(1, box.w - 2 * NODE_PADDING), measure);
		// Stil des gleichnamigen Knotens wie im Canvas, ohne `classDef default` (wie Mermaid).
		const own = nodeById.get(cont.id);
		const style = own
			? resolveStyle(own.style, own.cssClasses, doc.classDefs, { withDefault: false })
			: {};
		body.push(
			`<g class="container"><rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.w)}"` +
				` height="${fmt(box.h)}"${shapeAttrs(style, c.containerFill, c.containerStroke)}/>` +
				`${textBlock(lines, box.x + box.w / 2, box.y + NODE_PADDING + (lines.length * LINE_HEIGHT) / 2, textColor(style) ?? c.text)}</g>`
		);
	}

	const loops = new Map<string, SelfLoopState>();
	const labels: string[] = [];
	for (const edge of doc.edges) {
		if (!kept(edge.sourceId) || !kept(edge.targetId)) continue;
		const source = boxOf(geometry, edge.sourceId);
		const target = boxOf(geometry, edge.targetId);
		if (!source || !target) continue;
		const style = resolveStyle(edge.style);
		const { path, label } = edgeSvg(edge, source, target, kind, measure, bounds, loops, c, style);
		body.push(path);
		labels.push(label);
	}
	body.push(...labels);

	// Knoten mit Container-ID zeichnet der Canvas nicht (`mapping.ts`, `rendered`): nur der Container.
	const containerIds = new Set(doc.containers.map((cont) => cont.id));
	for (const node of doc.nodes) {
		if (containerIds.has(node.id)) continue;
		const box = kept(node.id) ? boxOf(geometry, node.id) : null;
		if (!box) continue;
		bounds.push(box);
		// Text in der Label-Fläche der Form wie im Canvas (ShapeNode); Bestandsformen: ganze Box.
		const a = labelArea(node.shape, box.w, box.h);
		const lines = wrapLabel(node.label, Math.max(1, a.w - 2 * NODE_PADDING), measure);
		const style = resolveStyle(node.style, node.cssClasses, doc.classDefs);
		body.push(
			`<g class="node" transform="translate(${fmt(box.x)} ${fmt(box.y)})">` +
				`<path d="${shapePath(node.shape, box.w, box.h)}"` +
				`${shapeAttrs(style, c.nodeFill, c.nodeStroke)}/>` +
				`${textBlock(lines, a.x + a.w / 2, a.y + a.h / 2, textColor(style) ?? c.text)}</g>`
		);
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const b of bounds) {
		minX = Math.min(minX, b.x);
		minY = Math.min(minY, b.y);
		maxX = Math.max(maxX, b.x + b.w);
		maxY = Math.max(maxY, b.y + b.h);
	}
	const view = bounds.length
		? [minX - PADDING, minY - PADDING, maxX - minX + 2 * PADDING, maxY - minY + 2 * PADDING]
		: [0, 0, 0, 0];
	const fv = view.map(fmt);
	const [vx, vy, vw, vh] = fv;
	const title = options.title || doc.title || DEFAULT_TITLE;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}"` +
		` width="${vw}" height="${vh}"><title>${escapeXml(title)}</title>` +
		`${backgroundRect(fv, c.background)}${body.join('')}</svg>`
	);
}
