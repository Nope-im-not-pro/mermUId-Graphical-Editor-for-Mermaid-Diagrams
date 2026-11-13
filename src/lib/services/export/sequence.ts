/**
 * Editor-SVG für Sequenzdiagramme: reine Funktion `(Szene) -> SVG-String`. Die Szene ist die
 * Darstellung des Sequenz-Canvas (Koordinaten aus `layoutSequence`), hier nur strukturell
 * typisiert, damit kein Import aus der View-Schicht nötig ist. Gleiche Ausgaberegeln wie
 * `editorSvg`: feste Elemente, Präsentationsattribute, keine Verweise (Marker inline), Texte
 * XML-maskiert, keine Element-IDs.
 */
import {
	DEFAULT_TITLE,
	FONT_SIZE,
	backgroundRect,
	escapeXml,
	safePalette,
	type Palette
} from './svg';

interface SceneBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SceneItem {
	type: string;
	lines: string[];
	box: SceneBox;
	path?: string;
	dashed?: boolean;
	head?: string;
	tail?: string;
	labelX?: number;
	labelY?: number;
}

export interface SequenceScene {
	items: readonly SceneItem[];
	lifelines: readonly { x: number; y1: number; y2: number }[];
	bars: readonly SceneBox[];
	minX: number;
	minY: number;
	width: number;
	height: number;
}

export interface SequenceSvgOptions {
	title?: string;
	palette?: Partial<Palette>;
}

const FONT_FAMILY = 'sans-serif';
/** Zeilenabstand mehrzeiliger Teilnehmer-Labels wie im Canvas. */
const LINE = 18;

/** Marker mit Spitze im Ursprung, Richtung +x (Maße wie die Canvas-Marker, 8 px). */
const MARKERS: Record<string, { d: string; filled: boolean }> = {
	arrow: { d: 'M-8 -4 L0 0 L-8 4 Z', filled: true },
	open: { d: 'M-8 -4 L0 0 L-8 4', filled: false },
	cross: { d: 'M-8 -4 L0 4 M0 -4 L-8 4', filled: false },
	half: { d: 'M-8 -4 L0 0 L-8 0 Z', filled: true }
};

function fmt(v: number): string {
	const r = Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
	return Object.is(r, -0) ? '0' : String(r);
}

/** Punkte eines Pfads aus `M x y`, `H x`, `V y` (Form der Canvas-Nachrichten). */
export function pathPoints(path: string): [number, number][] {
	const tokens = path.trim().split(/[\s,]+/);
	const pts: [number, number][] = [];
	let x = 0;
	let y = 0;
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === 'M' || t === 'L') {
			x = Number(tokens[++i]);
			y = Number(tokens[++i]);
		} else if (t === 'H') x = Number(tokens[++i]);
		else if (t === 'V') y = Number(tokens[++i]);
		else continue;
		pts.push([x, y]);
	}
	return pts.filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py));
}

/** Pfad nur aus Zahlen neu aufgebaut: kein Fremdtext aus der Szene im `d`-Attribut. */
function cleanPath(pts: [number, number][]): string {
	return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join(' ');
}

function marker(
	kind: string | undefined,
	tip: [number, number],
	from: [number, number],
	color: string
) {
	const m = kind ? MARKERS[kind] : undefined;
	if (!m) return '';
	const angle = (Math.atan2(tip[1] - from[1], tip[0] - from[0]) * 180) / Math.PI;
	return (
		`<path d="${m.d}" transform="translate(${fmt(tip[0])} ${fmt(tip[1])}) rotate(${fmt(angle)})"` +
		` fill="${m.filled ? color : 'none'}" stroke="${color}" stroke-width="1"/>`
	);
}

function text(
	content: string,
	x: number,
	y: number,
	color: string,
	anchor: 'middle' | 'start' = 'middle'
): string {
	return (
		`<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}" font-family="${FONT_FAMILY}"` +
		` font-size="${FONT_SIZE}" fill="${color}">${escapeXml(content)}</text>`
	);
}

function rect(b: SceneBox, fill: string, stroke: string, extra = ''): string {
	return (
		`<rect x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}"` +
		` fill="${fill}" stroke="${stroke}" stroke-width="1"${extra}/>`
	);
}

/**
 * Erzeugt das Sequenz-SVG: Container und Sections, Lebenslinien, Aktivierungsbalken,
 * Nachrichten, Notizen, Teilnehmer. Aktivierungs-Marken des Canvas (Bedienelemente) entfallen.
 */
export function sequenceSvg(scene: SequenceScene, options: SequenceSvgOptions = {}): string {
	const p = safePalette(options.palette);
	const c = Object.fromEntries(
		Object.entries(p).map(([k, v]) => [k, escapeXml(String(v))])
	) as unknown as Palette;
	const blocks: string[] = [];
	const front: string[] = [];

	for (const item of scene.items) {
		const label = item.lines[0] ?? '';
		if (item.type === 'container') {
			blocks.push(
				`<g class="container">${rect(item.box, 'none', c.containerStroke, ' stroke-dasharray="2 2"')}` +
					`${text(label, item.box.x + 4, item.box.y + 14, c.text, 'start')}</g>`
			);
		} else if (item.type === 'section') {
			const { x, y, w } = item.box;
			blocks.push(
				`<g class="section"><path d="M${fmt(x)} ${fmt(y)} H${fmt(x + w)}" fill="none"` +
					` stroke="${c.line}" stroke-width="1" stroke-dasharray="4 2"/>` +
					`${text(label, x + 4, y + 14, c.text, 'start')}</g>`
			);
		} else if (item.type === 'message' && item.path) {
			const pts = pathPoints(item.path);
			if (pts.length < 2) continue;
			const dash = item.dashed ? ' stroke-dasharray="4 3"' : '';
			front.push(
				`<g class="message"><path d="${cleanPath(pts)}" fill="none" stroke="${c.line}"` +
					` stroke-width="1"${dash}/>` +
					marker(item.head, pts[pts.length - 1], pts[pts.length - 2], c.line) +
					marker(item.tail, pts[0], pts[1], c.line) +
					(label ? text(label, item.labelX ?? 0, item.labelY ?? 0, c.text) : '') +
					'</g>'
			);
		} else if (item.type === 'note') {
			front.push(
				`<g class="note">${rect(item.box, c.noteFill, c.nodeStroke)}` +
					`${text(label, item.box.x + item.box.w / 2, item.box.y + item.box.h / 2 + 5, c.text)}</g>`
			);
		} else if (item.type === 'participant' || item.type === 'actor') {
			const { x, y, w, h } = item.box;
			const rx = item.type === 'actor' ? ' rx="12"' : '';
			const lines = item.lines
				.map((line, i) =>
					text(line, x + w / 2, y + h / 2 + (i - (item.lines.length - 1) / 2) * LINE + 5, c.text)
				)
				.join('');
			front.push(
				`<g class="${item.type}">${rect(item.box, c.nodeFill, c.nodeStroke, rx)}${lines}</g>`
			);
		}
	}

	const lifelines = scene.lifelines.map(
		(l) =>
			`<path class="lifeline" d="M${fmt(l.x)} ${fmt(l.y1)} V${fmt(l.y2)}" fill="none"` +
			` stroke="${c.line}" stroke-width="1" stroke-dasharray="3 3"/>`
	);
	const bars = scene.bars.map((b) => rect(b, c.labelBackground, c.nodeStroke));

	const view = [scene.minX, scene.minY, scene.width, scene.height].map(fmt);
	const [vx, vy, vw, vh] = view;
	const title = options.title || DEFAULT_TITLE;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}"` +
		` width="${vw}" height="${vh}"><title>${escapeXml(title)}</title>` +
		`${backgroundRect(view, p.background)}${blocks.join('')}${lifelines.join('')}` +
		`${bars.join('')}${front.join('')}</svg>`
	);
}
