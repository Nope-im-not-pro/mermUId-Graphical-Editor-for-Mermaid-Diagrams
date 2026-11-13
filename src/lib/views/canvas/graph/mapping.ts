/**
 * Modell -> Svelte-Flow-Mapping für flowchart (O-26). Reine Funktionen ohne Svelte-Zustand:
 * Labels werden nur als Text-Zeilen geliefert (`sanitizeLabel`), Formen über `shapePath`.
 */
import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/svelte';
import type { Container, DiagramDocument, DiagramNode, ParseError } from '../../../model/types';
import { layoutGraph } from '../../../services/layout';
import { sanitizeLabel } from '../../../services/security';
import { fitShape, shapePath, wrapLabel, type MetaShapeName } from '../../../services/shapes';
import { resolveStyle, textColor, type ResolvedStyle } from '../../../services/shapes/style';
import type { ModelIssue } from '../../../services/validator';
import type { Rect } from '../common/grid';
import type { HandleSide } from './edges';
import type { MessageKey } from '../../../services/i18n';
import { t } from '../../shell/i18n.svelte';

export type Measure = (text: string) => number;

/** Ab dieser Knotenzahl rendert der Canvas nur sichtbare Elemente (`onlyRenderVisibleElements`). */
export const VISIBLE_ONLY_FROM = 100;

/** Maximale Zeilenbreite eines Labels vor dem Umbruch. */
export const LABEL_WIDTH = 200;
const PAD_X = 16;
const PAD_Y = 12;
const LINE_HEIGHT = 18;
const MIN_WIDTH = 80;
const CONTAINER_PAD = 16;
const CONTAINER_HEADER = 28;
const CONTAINER_MIN = { width: 120, height: 60 };

const BREAK = /<br\s*\/?>/gi;

/** Anzeige-Zeilen: an `<br>` getrennt, je Teil Markup entfernt, dann umbrochen. */
export function displayLines(label: string, maxWidth: number, measure: Measure): string[] {
	const text = label
		.split(BREAK)
		.map((part) => sanitizeLabel(part).trim())
		.join('\n');
	return wrapLabel(text, maxWidth, measure);
}

/** Namen der `@{ shape }`-Formen (F-07, Wörterbuch `canvas.shape.*`), auch für die Palette. */
export const META_SHAPE_KEYS: Readonly<Record<MetaShapeName, MessageKey>> = {
	doc: 'canvas.shape.doc',
	delay: 'canvas.shape.delay',
	'sl-rect': 'canvas.shape.slRect',
	'h-cyl': 'canvas.shape.hCyl',
	'lin-cyl': 'canvas.shape.linCyl'
};

/** Formnamen (Wörterbuch `panels.shape.*`); `default` wird als Rechteck gezeichnet. */
const SHAPE_NAME: Record<string, MessageKey> = {
	...META_SHAPE_KEYS,
	default: 'panels.shape.square',
	square: 'panels.shape.square',
	round: 'panels.shape.round',
	stadium: 'panels.shape.stadium',
	subroutine: 'panels.shape.subroutine',
	cylinder: 'panels.shape.cylinder',
	circle: 'panels.shape.circle',
	doublecircle: 'panels.shape.doublecircle',
	odd: 'panels.shape.odd',
	diamond: 'panels.shape.diamond',
	hexagon: 'panels.shape.hexagon',
	lean_right: 'panels.shape.leanRight',
	lean_left: 'panels.shape.leanLeft',
	trapezoid: 'panels.shape.trapezoid',
	inv_trapezoid: 'panels.shape.invTrapezoid'
};

/** Label als einzeiliger Klartext: `<br>` wird Leerzeichen, Markup entfernt. */
function plainText(label: string): string {
	return label
		.split(BREAK)
		.map((part) => sanitizeLabel(part).trim())
		.filter(Boolean)
		.join(' ');
}

/**
 * Zugänglicher Name (V-32): "<Form>: <Label>", leeres Label nur Formname. `text` ist der
 * bereinigte Labeltext (in `toFlow` aus dem Mess-Cache); der Formname wird je Aufruf übersetzt.
 */
export function nodeAriaLabel(
	kind: 'shape' | 'container',
	shape: string,
	label: string,
	text = plainText(label)
): string {
	const form =
		kind === 'container'
			? t('panels.title.subgraph')
			: t(Object.hasOwn(SHAPE_NAME, shape) ? SHAPE_NAME[shape] : 'panels.title.node');
	return text ? `${form}: ${text}` : form;
}

/** Label für den Inline-Editor: `<br>` wird Zeilenumbruch. */
export function editorText(label: string): string {
	return label.replace(BREAK, '\n');
}

/** Rückweg aus dem Inline-Editor: Zeilenumbruch wird `<br>`. */
export function labelFromEditor(text: string): string {
	return text.replace(/\r\n|\r|\n/g, '<br>');
}

export function nodeSize(lines: readonly string[], measure: Measure) {
	const text = Math.max(0, ...lines.map(measure));
	return {
		width: Math.max(MIN_WIDTH, text + 2 * PAD_X),
		height: lines.length * LINE_HEIGHT + 2 * PAD_Y
	};
}

type LabelBox = { lines: readonly string[]; text: string; width: number; height: number };

/** Obergrenze je Messfunktion; beim Überlauf wird der Cache geleert (Tippen erzeugt Varianten). */
export const BOX_CACHE_MAX = 5000;
/** Mess-Cache (V-29): je Messfunktion (= Schrift), Schlüssel Art und Label-Text (Größe formunabhängig). */
const boxCache = new WeakMap<Measure, Map<string, LabelBox>>();

/** Anzeige-Zeilen und Größe eines Labels, zwischengespeichert. */
function labelBox(kind: 'shape' | 'container' | 'edge', label: string, measure: Measure): LabelBox {
	let cache = boxCache.get(measure);
	if (!cache) boxCache.set(measure, (cache = new Map()));
	const key = `${kind}\u0000${label}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const lines: readonly string[] = Object.freeze(displayLines(label, LABEL_WIDTH, measure));
	const size =
		kind === 'container'
			? {
					width: Math.max(CONTAINER_MIN.width, Math.max(0, ...lines.map(measure)) + 2 * PAD_X),
					height: CONTAINER_MIN.height
				}
			: nodeSize(lines, measure);
	const text = kind === 'edge' ? '' : plainText(label);
	const box = Object.freeze({ lines, text, ...size });
	if (cache.size >= BOX_CACHE_MAX) cache.clear();
	cache.set(key, box);
	return box;
}

function containerSize(c: Container, measure: Measure) {
	const { width, height } = labelBox('container', c.label, measure);
	return { width, height };
}

function measureElement(el: DiagramNode | Container, measure: Measure) {
	if ('sections' in el) return containerSize(el, measure);
	const { width, height } = labelBox('shape', el.label, measure);
	// Neue Formen (F-07): Box so groß, dass die Label-Fläche neben Welle/Deckel den Text fasst.
	return fitShape(el.shape, width, height);
}

/** Tiefe eines Containers (0 = oberste Ebene), robust gegen Zyklen. */
function depthOf(id: string, parentOf: ReadonlyMap<string, string | null>): number {
	const seen = new Set<string>();
	let depth = 0;
	let p = parentOf.get(id) ?? null;
	while (p !== null && parentOf.has(p) && !seen.has(p)) {
		seen.add(p);
		depth++;
		p = parentOf.get(p) ?? null;
	}
	return depth;
}

function uniqueContainers(doc: DiagramDocument): Container[] {
	const seen = new Set<string>();
	return doc.containers.filter((c) => !seen.has(c.id) && !!seen.add(c.id));
}

/**
 * Container-Rahmen um die Kinder. Ohne gespeicherten Rahmen: Hülle mit Rand und Kopfzeile.
 * Mit eingefrorenem Rahmen `[x, y, w, h]` gilt dieser als Mindestrahmen und wächst nur, wenn
 * Kinder samt Rand herausragen (kein Sprung beim Einfrieren auto -> manuell).
 */
function frameAround(kids: readonly Rect[], frame: readonly number[] | undefined): Rect {
	const left = Math.min(...kids.map((r) => r.x)) - CONTAINER_PAD;
	const top = Math.min(...kids.map((r) => r.y)) - CONTAINER_PAD;
	const right = Math.max(...kids.map((r) => r.x + r.w)) + CONTAINER_PAD;
	const bottom = Math.max(...kids.map((r) => r.y + r.h)) + CONTAINER_PAD;
	if (!frame || !(frame[2] > 0 && frame[3] > 0)) {
		const y = top - CONTAINER_HEADER;
		return { x: left, y, w: right - left, h: bottom - y };
	}
	const x = Math.min(left, frame[0]);
	const y = Math.min(top, frame[1]);
	return {
		x,
		y,
		w: Math.max(right, frame[0] + frame[2]) - x,
		h: Math.max(bottom, frame[1] + frame[3]) - y
	};
}

/**
 * Absolute Rechtecke je Element. Auto-Layout ist stets der Rückfall; im Modus `manual`
 * kommen Knoten-Positionen aus den Metadaten (Größe gemessen), Container umschließen ihre
 * Kinder, mindestens im gespeicherten Rahmen. Richtung nur aus dem Argument (SyncState.direction).
 * Liefert der manuelle Durchlauf für jedes Element ein Rechteck, läuft dagre nicht (V-28).
 */
export function computeGeometry(
	doc: DiagramDocument,
	direction: string,
	measure: Measure
): Record<string, Rect> {
	const auto = () => {
		const out: Record<string, Rect> = {};
		const raw = layoutGraph(doc, (el) => measureElement(el, measure), { direction });
		for (const [id, [x, y, w, h]] of Object.entries(raw)) out[id] = { x, y, w, h };
		return out;
	};
	if (doc.layout.mode !== 'manual') return auto();
	const containers = uniqueContainers(doc);
	const manual = manualGeometry(doc, containers, {}, measure);
	const complete = containers.every((c) => manual[c.id]) && doc.nodes.every((n) => manual[n.id]);
	return complete ? manual : manualGeometry(doc, containers, auto(), measure);
}

/** Manueller Durchlauf über einer Basis (leer oder Auto-Layout als Rückfall); exportiert für den Äquivalenztest. */
export function manualGeometry(
	doc: DiagramDocument,
	containers: readonly Container[],
	geo: Record<string, Rect>,
	measure: Measure
): Record<string, Rect> {
	const positions = doc.layout.positions;
	const containerIds = new Set(containers.map((c) => c.id));
	for (const n of doc.nodes) {
		const pos = positions[n.id];
		if (containerIds.has(n.id) || !pos) continue;
		const size = measureElement(n, measure);
		geo[n.id] = { x: pos[0], y: pos[1], w: size.width, h: size.height };
	}
	const parentOf = new Map(containers.map((c) => [c.id, c.parentId]));
	const deepestFirst = [...containers].sort(
		(a, b) => depthOf(b.id, parentOf) - depthOf(a.id, parentOf)
	);
	for (const c of deepestFirst) {
		const kids = [...doc.nodes, ...containers]
			.filter((el) => el.parentId === c.id && el.id !== c.id && geo[el.id])
			.map((el) => geo[el.id]);
		if (kids.length > 0) {
			geo[c.id] = frameAround(kids, positions[c.id]);
		} else if (positions[c.id]) {
			const size = containerSize(c, measure);
			geo[c.id] = { x: positions[c.id][0], y: positions[c.id][1], w: size.width, h: size.height };
		}
	}
	return geo;
}

/** Handle-Seiten einer Kante aus der Lage der Mittelpunkte. */
export function handleSides(src: Rect, tgt: Rect): { source: HandleSide; target: HandleSide } {
	const dx = tgt.x + tgt.w / 2 - (src.x + src.w / 2);
	const dy = tgt.y + tgt.h / 2 - (src.y + src.h / 2);
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0 ? { source: 'e', target: 'w' } : { source: 'w', target: 'e' };
	}
	return dy >= 0 ? { source: 's', target: 'n' } : { source: 'n', target: 's' };
}

const HANDLE = 8;

/** Handle-Lage je Seite vorab (Kanten ohne DOM-Messung, z. B. vor dem ersten Resize). */
export function sideHandles(w: number, h: number): NodeHandle[] {
	const at = (id: HandleSide, position: Position, x: number, y: number): NodeHandle => ({
		id,
		type: 'source',
		position,
		x: x - HANDLE / 2,
		y: y - HANDLE / 2,
		width: HANDLE,
		height: HANDLE
	});
	return [
		at('n', Position.Top, w / 2, 0),
		at('e', Position.Right, w, h / 2),
		at('s', Position.Bottom, w / 2, h),
		at('w', Position.Left, 0, h / 2)
	];
}

/** Validierungs-Marker: Icon plus Text. */
export type IssueMarker = { severity: 'error' | 'hint'; icon: string; text: string };

const ICON = { error: '⚠', hint: 'ℹ' } as const;

const marker = (severity: 'error' | 'hint', text: string): IssueMarker => ({
	severity,
	icon: ICON[severity],
	text
});

export type GraphNodeData = {
	kind: 'shape' | 'container';
	/** Roh-Label des Modells (nur für den Inline-Editor, nie als Markup). */
	label: string;
	lines: readonly string[];
	shape: string;
	path: string;
	width: number;
	height: number;
	issues: IssueMarker[];
	/** Stil nach Allow-Liste (`resolveStyle`); leer = Theme-Farben. */
	style: ResolvedStyle;
	/** Lesbare Textfarbe (`textColor`): eigene `color`, sonst aus `fill`; leer = Theme. */
	textColor?: string;
	/** Absolutes Rechteck (Flow-Koordinaten). */
	abs: Rect;
};

export type GraphEdgeData = {
	label: string;
	lines: readonly string[];
	lineStyle: string;
	arrowHead: string;
	/** `linkStyle` nach Allow-Liste. */
	style: ResolvedStyle;
	issues: IssueMarker[];
};

export type FlowNode = Node<GraphNodeData>;
export type FlowEdge = Edge<GraphEdgeData>;

export type RawBlockView = { id: string; text: string; note: string };

export interface FlowModel {
	nodes: FlowNode[];
	edges: FlowEdge[];
	geometry: Record<string, Rect>;
	rawBlocks: RawBlockView[];
	canvasIssues: IssueMarker[];
	order: string[];
}

/** RawBlocks ohne Aussage für den Nutzer (Deklaration, Stil-Zeilen, Leerzeilen). */
const TRIVIAL_RAW = /^\s*$|^\s*(flowchart|graph)\b|^\s*(class|style|click)\s|^\s*linkStyle\s+\d/;

/** Tab-Reihenfolge: Container, Knoten (ohne Container-ID-Knoten, ohne Duplikate), Kanten. */
export function documentOrder(doc: DiagramDocument): string[] {
	const seen = new Set<string>();
	const once = (id: string) => !seen.has(id) && !!seen.add(id);
	return [
		...doc.containers.map((c) => c.id).filter(once),
		...doc.nodes.map((n) => n.id).filter(once),
		...doc.edges.map((e) => e.id).filter(once)
	];
}

/** Layout je Dokument-Identität (V-28): gleiches `doc`, gleiche Richtung und Messung -> Treffer. */
type CachedLayout = { direction: string; measure: Measure; geometry: Record<string, Rect> };
const geometryCache = new WeakMap<DiagramDocument, CachedLayout>();

const sameList = <T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean) =>
	a.length === b.length && a.every((x, i) => eq(x, b[i]));
const sameBox = (x: DiagramNode | Container, y: DiagramNode | Container) =>
	x.id === y.id &&
	x.label === y.label &&
	x.parentId === y.parentId &&
	('shape' in x ? x.shape : null) === ('shape' in y ? y.shape : null);

/**
 * Gleiche Layout-Eingabe (O-87/O-102), Allow-Liste der Felder, die `computeGeometry` liest:
 * Modus, Positionen, Knoten/Container (ID, Label, Eltern, Form: `fitShape`), Kanten (ID, Quelle, Ziel).
 * Quelltext-Felder (`sourceText`, `props.stmtText`, `openText`/`endText`/`dirText`) zählen nicht.
 */
function sameLayoutInput(a: DiagramDocument, b: DiagramDocument): boolean {
	const pa = a.layout.positions;
	const pb = b.layout.positions;
	const keys = Object.keys(pa);
	return (
		a.layout.mode === b.layout.mode &&
		keys.length === Object.keys(pb).length &&
		keys.every((k) => Object.hasOwn(pb, k) && sameList(pa[k], pb[k], (x, y) => x === y)) &&
		sameList(a.nodes, b.nodes, sameBox) &&
		sameList(a.containers, b.containers, sameBox) &&
		sameList(
			a.edges,
			b.edges,
			(x, y) => x.id === y.id && x.sourceId === y.sourceId && x.targetId === y.targetId
		)
	);
}

/** Letztes berechnetes Layout: ein Whitespace-Edit im Code ergibt ein inhaltsgleiches Modell (O-87). */
let lastLayout: (CachedLayout & { doc: DiagramDocument }) | null = null;

function cachedGeometry(doc: DiagramDocument, direction: string, measure: Measure) {
	const hit = geometryCache.get(doc);
	if (hit && hit.direction === direction && hit.measure === measure) return hit.geometry;
	const last = lastLayout;
	const geometry =
		last &&
		last.direction === direction &&
		last.measure === measure &&
		sameLayoutInput(last.doc, doc)
			? last.geometry
			: computeGeometry(doc, direction, measure);
	geometryCache.set(doc, { direction, measure, geometry });
	lastLayout = { direction, measure, geometry, doc };
	return geometry;
}

export function toFlow(
	doc: DiagramDocument,
	state: {
		direction: string;
		errors: readonly ParseError[];
		/** Modell-Befunde zu `doc` (T123 C4: von der Shell, toFlow validiert nicht selbst). */
		issues?: readonly ModelIssue[];
	},
	measure: Measure
): FlowModel {
	const geometry = cachedGeometry(doc, state.direction, measure);
	const issuesOf = new Map<string, IssueMarker[]>();
	for (const issue of state.issues ?? []) {
		const list = issuesOf.get(issue.elementId) ?? [];
		list.push(marker(issue.severity, issue.message));
		issuesOf.set(issue.elementId, list);
	}
	const rendered = new Set<string>();
	const rect = (id: string): Rect => geometry[id] ?? { x: 0, y: 0, w: MIN_WIDTH, h: 42 };

	const containers = uniqueContainers(doc);
	const containerIds = new Set(containers.map((c) => c.id));
	const parentOf = new Map(containers.map((c) => [c.id, c.parentId]));
	const placed = (id: string, parentId: string | null) => {
		const abs = rect(id);
		const parent = parentId !== null && containerIds.has(parentId) ? parentId : undefined;
		const base = parent ? rect(parent) : { x: 0, y: 0 };
		return { abs, parent, position: { x: abs.x - base.x, y: abs.y - base.y } };
	};
	const build = (
		kind: GraphNodeData['kind'],
		el: DiagramNode | Container,
		shape: string,
		box: LabelBox,
		style: ResolvedStyle
	): FlowNode => {
		rendered.add(el.id);
		const { abs, parent, position } = placed(el.id, el.parentId);
		return {
			id: el.id,
			type: kind,
			position,
			...(parent ? { parentId: parent } : {}),
			width: abs.w,
			height: abs.h,
			handles: sideHandles(abs.w, abs.h),
			ariaLabel: nodeAriaLabel(kind, shape, el.label, box.text),
			domAttributes: {
				'aria-roledescription': t(
					kind === 'container' ? 'panels.role.container' : 'panels.role.node'
				)
			},
			data: {
				kind,
				label: el.label,
				lines: box.lines,
				shape,
				path: shapePath(shape, abs.w, abs.h),
				width: abs.w,
				height: abs.h,
				issues: issuesOf.get(el.id) ?? [],
				style,
				textColor: textColor(style),
				abs
			}
		};
	};

	const nodeById = new Map<string, DiagramNode>();
	for (const n of doc.nodes) if (!nodeById.has(n.id)) nodeById.set(n.id, n);
	const nodes: FlowNode[] = [];
	const sorted = [...containers].sort((a, b) => depthOf(a.id, parentOf) - depthOf(b.id, parentOf));
	for (const c of sorted) {
		// Container tragen keinen eigenen Stil; `style S ...` landet am gleichnamigen Knoten.
		// `classDef default` gilt nicht für Subgraphen (wie Mermaid).
		const own = nodeById.get(c.id);
		const style = own
			? resolveStyle(own.style, own.cssClasses, doc.classDefs, { withDefault: false })
			: {};
		nodes.push(build('container', c, 'rect', labelBox('container', c.label, measure), style));
	}
	for (const n of doc.nodes) {
		if (rendered.has(n.id)) continue;
		nodes.push(
			build(
				'shape',
				n,
				n.shape,
				labelBox('shape', n.label, measure),
				resolveStyle(n.style, n.cssClasses, doc.classDefs)
			)
		);
	}

	const edges: FlowEdge[] = [];
	for (const e of doc.edges) {
		if (!rendered.has(e.sourceId) || !rendered.has(e.targetId) || rendered.has(e.id)) continue;
		rendered.add(e.id);
		const sides = handleSides(rect(e.sourceId), rect(e.targetId));
		edges.push({
			id: e.id,
			type: 'typed',
			source: e.sourceId,
			target: e.targetId,
			sourceHandle: sides.source,
			targetHandle: sides.target,
			data: {
				label: e.label,
				lines: e.label ? labelBox('edge', e.label, measure).lines : [],
				lineStyle: e.lineStyle,
				arrowHead: e.arrowHead,
				style: resolveStyle(e.style),
				issues: issuesOf.get(e.id) ?? []
			}
		});
	}

	const canvasIssues = state.errors.map((err) =>
		marker('error', t('canvas.lineIssue', { line: err.line, message: err.message }))
	);
	for (const [id, list] of issuesOf) {
		if (rendered.has(id)) continue;
		for (const m of list) canvasIssues.push({ ...m, text: `${id}: ${m.text}` });
	}

	const rawBlocks = doc.rawBlocks
		.filter((b) => !TRIVIAL_RAW.test(b.rawText))
		.map((b) => ({ id: b.id, text: b.rawText.trim(), note: t('canvas.rawNote') }));

	return { nodes, edges, geometry, rawBlocks, canvasIssues, order: documentOrder(doc) };
}

/**
 * Textbreite über Canvas `measureText` (14px sans-serif wie die Knoten-Labels). Breiten werden
 * je Schrift und Text zwischengespeichert (V-29); der Rückfall ohne Kontext nicht.
 */
export function canvasMeasure(font = '14px sans-serif'): Measure {
	let ctx: CanvasRenderingContext2D | null = null;
	const widths = new Map<string, number>();
	return (text) => {
		ctx ??= document.createElement('canvas').getContext('2d');
		if (!ctx) return text.length * 8;
		const key = `${font}\u0000${text}`;
		const hit = widths.get(key);
		if (hit !== undefined) return hit;
		ctx.font = font;
		const width = ctx.measureText(text).width;
		if (widths.size >= BOX_CACHE_MAX) widths.clear();
		widths.set(key, width);
		return width;
	};
}
