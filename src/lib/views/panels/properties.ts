/**
 * Eigenschaften-Panel (T19 C1, FA-04): reine Logik ohne DOM. `panelFor` bildet die Auswahl auf
 * Formularfelder ab, `commandFor` erzeugt aus einer Feldänderung einen Command, den die View
 * über den Sync-Controller ausführt. Werte-Kataloge spiegeln die SUBSET-Dokumente der
 * flowchart- und sequence-Adapter; die Views importieren die Adapter nicht (O-27).
 * Was das Panel nicht abbildet, steht als benannte Lücke in `gaps` (KONZEPT §4).
 */
import type { Command } from '../../controllers/commands/history';
import { updateContainer, updateEdge, updateNode } from '../../model/operations';
import type {
	Container,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	StyleMap
} from '../../model/types';
import type { MessageKey, Params } from '../../services/i18n';
import { MERMAID_THEMES } from '../../services/security';
import { isSafeColor, safeStyle } from '../../services/shapes/style';
import { t } from '../shell/i18n.svelte';

export interface Option {
	readonly value: string;
	readonly label: string;
}

export interface Field {
	readonly key: string;
	readonly label: string;
	/** `color`: Textfeld plus nativer Farbwähler, beide schreiben denselben Wert (V-20). */
	readonly kind: 'text' | 'select' | 'number' | 'readonly' | 'color';
	readonly value: string;
	readonly options?: readonly Option[];
	readonly hint?: string;
}

export interface PanelModel {
	readonly title: string;
	readonly fields: readonly Field[];
	/** Werte, die nur im Code-Panel änderbar sind (benannte Lücken). */
	readonly gaps: readonly string[];
}

/** Wörterbuch-Schlüssel, optional mit Platzhaltern. */
type Label = MessageKey | readonly [MessageKey, Params];
const say = (l: Label) => (typeof l === 'string' ? t(l) : t(l[0], l[1]));
/** Labels als Getter: Konstanten folgen dem Sprachwechsel beim nächsten Lesen. */
const opts = (pairs: readonly (readonly [string, Label])[]): Option[] =>
	pairs.map(([value, l]) => ({
		value,
		get label() {
			return say(l);
		}
	}));

export const FLOW_SHAPES = opts([
	['default', 'panels.shape.default'],
	['square', 'panels.shape.square'],
	['round', 'panels.shape.round'],
	['stadium', 'panels.shape.stadium'],
	['subroutine', 'panels.shape.subroutine'],
	['cylinder', 'panels.shape.cylinder'],
	['circle', 'panels.shape.circle'],
	['doublecircle', 'panels.shape.doublecircle'],
	['odd', 'panels.shape.odd'],
	['diamond', 'panels.shape.diamond'],
	['hexagon', 'panels.shape.hexagon'],
	['lean_right', 'panels.shape.leanRight'],
	['lean_left', 'panels.shape.leanLeft'],
	['trapezoid', 'panels.shape.trapezoid'],
	['inv_trapezoid', 'panels.shape.invTrapezoid'],
	// Neue Formen (F-07): Serializer schreibt `@{ shape: ... }`.
	['doc', 'canvas.shape.doc'],
	['delay', 'canvas.shape.delay'],
	['sl-rect', 'canvas.shape.slRect'],
	['h-cyl', 'canvas.shape.hCyl'],
	['lin-cyl', 'canvas.shape.linCyl']
]);

export const FLOW_LINES = opts([
	['solid', 'panels.line.solid'],
	['dotted', 'panels.line.dotted'],
	['thick', 'panels.line.thick'],
	['invisible', 'panels.line.invisible']
]);

export const FLOW_HEADS = opts([
	['arrow', 'panels.head.arrow'],
	['none', 'panels.head.none'],
	['circle', 'panels.head.circle'],
	['cross', 'panels.head.cross'],
	['double_arrow', 'panels.head.doubleArrow'],
	['double_circle', 'panels.head.doubleCircle'],
	['double_cross', 'panels.head.doubleCross']
]);

export const DIRECTIONS = opts([
	['TB', 'panels.dir.TB'],
	['TD', 'panels.dir.TD'],
	['BT', 'panels.dir.BT'],
	['LR', 'panels.dir.LR'],
	['RL', 'panels.dir.RL']
]);

/** Mermaid-Themes der Allow-Liste (F-09); `default` = kein Eintrag im Frontmatter. */
export const THEMES = opts(MERMAID_THEMES.map((v) => [v, `panels.theme.${v}` as MessageKey]));

/** Gestricheltes Halbpfeil-Token: zweiter Strich auf der Seite des vorhandenen. */
const dotted = (token: string) => (token.startsWith('-') ? `-${token}` : `${token}-`);

/** Sequence-Pfeil-Token zu Linie und Spitze (SUBSET sequence, inkl. Halbpfeile). */
const SEQ_ARROWS: [string, string, string, Label][] = [
	['->>', 'solid', 'arrow', 'panels.seqArrow.arrow'],
	['-->>', 'dotted', 'arrow', 'panels.seqArrow.arrowDotted'],
	['->', 'solid', 'none', 'panels.seqArrow.line'],
	['-->', 'dotted', 'none', 'panels.seqArrow.lineDotted'],
	['-x', 'solid', 'cross', 'panels.seqArrow.cross'],
	['--x', 'dotted', 'cross', 'panels.seqArrow.crossDotted'],
	['-)', 'solid', 'open', 'panels.seqArrow.open'],
	['--)', 'dotted', 'open', 'panels.seqArrow.openDotted'],
	['<<->>', 'solid', 'both', 'panels.seqArrow.both'],
	['<<-->>', 'dotted', 'both', 'panels.seqArrow.bothDotted'],
	...['-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-'].flatMap(
		(token): [string, string, string, Label][] => [
			[token, 'solid', 'half', ['panels.seqArrow.half', { token }]],
			[dotted(token), 'dotted', 'half', ['panels.seqArrow.halfDotted', { token: dotted(token) }]]
		]
	)
];

export const SEQ_ARROW_OPTIONS = opts(SEQ_ARROWS.map(([t, , , label]) => [t, label]));

const SEQ_KINDS = opts([
	['participant', 'panels.seqKind.participant'],
	['actor', 'panels.seqKind.actor']
]);
const PLACEMENTS = opts([
	['left of', 'panels.placement.leftOf'],
	['right of', 'panels.placement.rightOf'],
	['over', 'panels.placement.over']
]);
const ACTIVATIONS = opts([
	['', 'panels.activation.none'],
	['+', 'panels.activation.plus'],
	['-', 'panels.activation.minus']
]);
const SINGLE_BLOCKS: [string, MessageKey][] = [
	['loop', 'panels.block.loop'],
	['opt', 'panels.block.opt'],
	['rect', 'panels.block.rect'],
	['break', 'panels.block.break']
];
const MULTI_BLOCKS: [string, MessageKey][] = [
	['alt', 'panels.block.alt'],
	['par', 'panels.block.par'],
	['critical', 'panels.block.critical']
];
const SECTION_WORD: Record<string, string> = { alt: 'else', par: 'and', critical: 'option' };

/** Stil-Schlüssel mit eigenem Feld (Farbe, Linie, Stärke). */
const STYLE_KEYS: [string, MessageKey][] = [
	['fill', 'panels.style.fill'],
	['stroke', 'panels.style.stroke'],
	['stroke-width', 'panels.style.strokeWidth'],
	['stroke-dasharray', 'panels.style.strokeDasharray'],
	['color', 'panels.style.color']
];
const EDGE_STYLE_KEYS = STYLE_KEYS.filter(([k]) => k !== 'fill');
const COLOR_KEYS = new Set(['fill', 'stroke', 'color']);
const DASH_KEY = 'stroke-dasharray';
const DASHES = opts([
	['', 'panels.dash.default'],
	['5 5', 'panels.dash.dashed'],
	['2 2', 'panels.dash.dotted'],
	['10 5', 'panels.dash.long']
]);

const FLOW_GAPS: MessageKey[] = [
	'panels.gap.flowMetadata',
	'panels.gap.flowClassDef',
	'panels.gap.flowCss',
	'panels.gap.flowAcc',
	'panels.gap.flowClick'
];
const SEQ_GAPS: MessageKey[] = [
	'panels.gap.seqStatements',
	'panels.gap.seqAcc',
	'panels.gap.seqNesting'
];

type Found =
	| { type: 'node'; el: DiagramNode }
	| { type: 'edge'; el: DiagramEdge }
	| { type: 'container'; el: Container }
	| { type: 'raw' }
	| { type: 'diagram' };

function find(doc: DiagramDocument, id: string | null): Found | null {
	if (id === null) return { type: 'diagram' };
	const node = doc.nodes.find((n) => n.id === id);
	if (node) return { type: 'node', el: node };
	const edge = doc.edges.find((e) => e.id === id);
	if (edge) return { type: 'edge', el: edge };
	const container = doc.containers.find((c) => c.id === id);
	if (container) return { type: 'container', el: container };
	if (doc.rawBlocks.some((r) => r.id === id)) return { type: 'raw' };
	return null;
}

const text = (key: string, label: string, value: string, hint?: string): Field => ({
	key,
	label,
	kind: 'text',
	value,
	...(hint ? { hint } : {})
});
const select = (key: string, label: string, value: string, options: readonly Option[]): Field => ({
	key,
	label,
	kind: 'select',
	value,
	options
});
const fixed = (key: string, label: string, value: string, hint?: string): Field => ({
	key,
	label,
	kind: 'readonly',
	value,
	...(hint ? { hint } : {})
});

function styleField(style: StyleMap, k: string, label: string): Field {
	const value = style[k] ?? '';
	if (COLOR_KEYS.has(k)) return { key: `style:${k}`, label, kind: 'color', value };
	if (k !== DASH_KEY) return text(`style:${k}`, label, value);
	const known = DASHES.some((o) => o.value === value);
	const options = known
		? DASHES
		: [...DASHES, { value, label: t('panels.dash.custom', { value }) }];
	return select(`style:${k}`, label, value, options);
}

const styleFields = (style: StyleMap, keys: [string, MessageKey][]) =>
	keys.map(([k, label]) => styleField(style, k, t(label)));

/**
 * Farbwert für flowchart-Stile: Allow-Liste `isSafeColor` (Regel 3), zusätzlich nur Hex -
 * mermaid lehnt `rgb()`/`rgba()` in flowchart-`style`/`linkStyle` als Syntaxfehler ab (O-117).
 */
const isFlowColor = (v: string) => v.startsWith('#') && isSafeColor(v);
/** Nur zum Zerlegen in `pickerValue`, nach `isSafeColor`. */
const RGB = /^rgba?\( *(\d{1,3}) *, *(\d{1,3}) *, *(\d{1,3}) *(?:,[^)]*)?\)$/i;

/** Wert für `<input type="color">` (nur `#rrggbb`); nicht darstellbar -> Schwarz. */
export function pickerValue(value: string): string {
	const v = value.trim();
	if (!isSafeColor(v)) return '#000000';
	if (v.startsWith('#')) {
		const h = v.slice(1).toLowerCase();
		return h.length <= 4
			? `#${[...h.slice(0, 3)].map((c) => c + c).join('')}`
			: `#${h.slice(0, 6)}`;
	}
	const m = RGB.exec(v);
	const parts = m ? m.slice(1, 4).map(Number) : [];
	if (parts.length !== 3 || parts.some((n) => n > 255)) return '#000000';
	return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Farbpalette des Dokuments (F-02, T137 C1): Farben aus Knoten-`style`, `linkStyle` und jedem
 * `classDef` (auch `default`), je Ebene über `safeStyle` (Allow-Liste T106); Klassenfarben am
 * Knoten stammen so aus ihrem `classDef`, ohne Auflösung je Knoten (O(N+C)). Reihenfolge des
 * ersten Auftretens je Ebene: Knoten-`style`, dann `linkStyle`, dann `classDef` in
 * Definitions-Reihenfolge (nicht in der Reihenfolge der Knoten, die die Klasse tragen); getrimmt, klein geschrieben, ohne Duplikate; nur Werte, die das Farbfeld als
 * Eingabe annimmt (flowchart: nur Hex, O-117). Andere Diagrammtypen haben keine Farbfelder.
 */
export function paletteFor(doc: DiagramDocument): string[] {
	if (doc.diagramType !== 'flowchart') return [];
	const styles = [...doc.nodes, ...doc.edges, ...doc.classDefs].map((el) => safeStyle(el.style));
	const colors = styles.flatMap((s) => [s.fill, s.stroke, s.color]);
	const clean = colors.map((c) => c?.trim().toLowerCase() ?? '').filter(isFlowColor);
	return [...new Set(clean)];
}

/** Endpunkte für Kanten: Knoten (ohne Notizen) und Container. */
function endpoints(doc: DiagramDocument, withContainers: boolean): Option[] {
	const list = doc.nodes
		.filter((n) => n.kind !== 'note')
		.map((n) => ({
			value: n.id,
			label: n.label && n.label !== n.id ? `${n.id} (${n.label})` : n.id
		}));
	const boxes = withContainers ? doc.containers.map((c) => ({ value: c.id, label: c.id })) : [];
	const seen = new Set<string>();
	return [...list, ...boxes].filter((o) => !seen.has(o.value) && seen.add(o.value));
}

/** Diagrammrichtung aus der Deklarationszeile (RawBlock). */
const DECL =
	/^(\s*(?:flowchart-elk|flowchart|graph))(?:([ \t]+)(TB|TD|BT|RL|LR|<|>|\^|v)(?![\w-]))?/;
const ARROW_DIR: Record<string, string> = { '>': 'LR', '<': 'RL', '^': 'BT', v: 'TB' };

function declaration(doc: DiagramDocument) {
	for (const block of doc.rawBlocks) {
		const m = DECL.exec(block.rawText);
		if (m) return { block, m };
	}
	return null;
}

/** `click`-Zeile ohne Schlüsselwort und ID (Ziel und Tooltip als Text). */
export function clickTail(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	return /^\s*click\s+\S+[ \t]*(.*)$/s.exec(raw)?.[1].trim() ?? raw.trim();
}

function flowNode(n: DiagramNode): Field[] {
	return [
		fixed('id', t('panels.field.id'), n.id),
		text('label', t('panels.field.label'), n.label),
		select('shape', t('panels.field.shape'), n.shape, FLOW_SHAPES),
		text(
			'classes',
			t('panels.field.classes'),
			n.cssClasses.join(' '),
			t('panels.field.classesHint')
		),
		...styleFields(n.style, STYLE_KEYS),
		text('click', t('panels.field.click'), clickTail(n.props.click), t('panels.field.clickHint'))
	];
}

function flowEdge(doc: DiagramDocument, e: DiagramEdge): Field[] {
	const ends = endpoints(doc, true);
	return [
		fixed('id', t('panels.field.id'), e.id),
		select('source', t('panels.field.from'), e.sourceId, ends),
		select('target', t('panels.field.to'), e.targetId, ends),
		text('label', t('panels.field.label'), e.label),
		select('lineStyle', t('panels.field.line'), e.lineStyle, FLOW_LINES),
		select('arrowHead', t('panels.field.head'), e.arrowHead, FLOW_HEADS),
		{
			key: 'length',
			label: t('panels.field.length'),
			kind: 'number',
			value: String(e.props.length ?? 1)
		},
		...styleFields(e.style, EDGE_STYLE_KEYS)
	];
}

function flowContainer(c: Container): Field[] {
	return [
		fixed('id', t('panels.field.id'), c.id),
		text('label', t('panels.field.title'), c.label),
		select('direction', t('panels.field.direction'), c.direction, [
			{ value: '', label: t('panels.field.asDiagram') },
			...DIRECTIONS
		])
	];
}

function seqNode(doc: DiagramDocument, n: DiagramNode): Field[] {
	if (n.kind !== 'note') {
		return [
			fixed('id', t('panels.field.name'), n.id),
			select('kind', t('panels.field.kind'), n.kind, SEQ_KINDS),
			text('label', t('panels.field.displayName'), n.label)
		];
	}
	const placement = String(n.props.placement ?? 'over');
	const parts = (n.props.participants as string[] | undefined) ?? [];
	const people = endpoints(doc, false);
	return [
		text('label', t('panels.field.text'), n.label),
		select('placement', t('panels.field.placement'), placement, PLACEMENTS),
		select('noteFrom', t('panels.field.participant'), parts[0] ?? '', people),
		...(placement === 'over'
			? [
					select('noteTo', t('panels.field.toParticipant'), parts[1] ?? '', [
						{ value: '', label: t('panels.field.noParticipant') },
						...people
					])
				]
			: [])
	];
}

function seqEdge(doc: DiagramDocument, e: DiagramEdge): Field[] {
	const people = endpoints(doc, false);
	if (e.kind === 'activate' || e.kind === 'deactivate') {
		return [
			select(
				'activationKind',
				t('panels.field.kind'),
				e.kind,
				opts([
					['activate', 'panels.field.activate'],
					['deactivate', 'panels.field.deactivate']
				])
			),
			select('participant', t('panels.field.participant'), e.sourceId, people)
		];
	}
	return [
		select('source', t('panels.field.from'), e.sourceId, people),
		select('target', t('panels.field.to'), e.targetId, people),
		text('label', t('panels.field.text'), e.label),
		select('arrow', t('panels.field.arrow'), arrowOf(e), SEQ_ARROW_OPTIONS),
		select(
			'activation',
			t('panels.field.activation'),
			String(e.props.activation ?? ''),
			ACTIVATIONS
		)
	];
}

function arrowOf(e: DiagramEdge): string {
	const token = e.props.arrow;
	if (typeof token === 'string' && SEQ_ARROWS.some(([t]) => t === token)) return token;
	return SEQ_ARROWS.find(([, l, h]) => l === e.lineStyle && h === e.arrowHead)?.[0] ?? '->>';
}

function seqContainer(c: Container): Field[] {
	const kinds = c.sections.length > 1 ? MULTI_BLOCKS : [...SINGLE_BLOCKS, ...MULTI_BLOCKS];
	return [
		select('kind', t('panels.field.kind'), c.kind, opts(kinds)),
		text('label', t(c.kind === 'rect' ? 'panels.field.color' : 'panels.field.condition'), c.label),
		...c.sections
			.slice(1)
			.map((s, i) =>
				text(
					`section:${i + 1}`,
					t('panels.field.section', { n: i + 2, word: SECTION_WORD[c.kind] ?? 'else' }),
					s.label
				)
			)
	];
}

/** Formular für die Auswahl; `null` ohne bearbeitbares Ziel oder im Modus "nur Code". */
export function panelFor(doc: DiagramDocument, id: string | null): PanelModel | null {
	const flow = doc.diagramType === 'flowchart';
	if (!flow && doc.diagramType !== 'sequence') return null;
	const found = find(doc, id);
	if (!found) return null;
	const gaps = (flow ? FLOW_GAPS : SEQ_GAPS).map((k) => t(k));
	switch (found.type) {
		case 'raw':
			return {
				title: t('panels.title.raw'),
				fields: [],
				gaps: [t('panels.gap.raw')]
			};
		case 'diagram': {
			if (!flow) return { title: t('panels.title.diagram'), fields: [themeField(doc)], gaps };
			const decl = declaration(doc);
			const dir = decl ? (ARROW_DIR[decl.m[3]] ?? decl.m[3] ?? '') : '';
			const fields = decl
				? [select('docDirection', t('panels.field.direction'), dir || 'TB', DIRECTIONS)]
				: [];
			return { title: t('panels.title.diagram'), fields: [...fields, themeField(doc)], gaps };
		}
		case 'node': {
			const note = found.el.kind === 'note';
			const title = t(
				flow ? 'panels.title.node' : note ? 'panels.title.note' : 'panels.title.participant'
			);
			return { title, fields: flow ? flowNode(found.el) : seqNode(doc, found.el), gaps };
		}
		case 'edge':
			return {
				title: t(
					flow
						? 'panels.title.edge'
						: found.el.kind === 'message'
							? 'panels.title.message'
							: 'panels.title.activation'
				),
				fields: flow ? flowEdge(doc, found.el) : seqEdge(doc, found.el),
				gaps
			};
		case 'container':
			return {
				title: t(flow ? 'panels.title.subgraph' : 'panels.title.block'),
				fields: flow ? flowContainer(found.el) : seqContainer(found.el),
				gaps
			};
	}
}

/** Zeichen, die Mermaid-Stilwerte aufbrechen würden. */
const STYLE_BREAK = /[,;:{}\r\n]/g;
/** Klassennamen (Klassen-Feld und "Als Klasse speichern"); `--` liest der Lexer als Kantenbeginn. */
const CLASS_NAME = /^(?!.*--)[A-Za-z0-9_-]+$/;
/** Einzeilige Texte: Zeilenumbrüche würden eine Anweisung beenden. */
const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ');

const LINK_TARGETS = ['_self', '_blank', '_parent', '_top'];
const CALLBACK = /^[A-Za-z_$][\w$]*$/;
/** Lexer-Schlüsselwörter (groß-/kleinschreibungsgenau), die mermaid nicht als Callback-Namen parst. */
const RESERVED = [
	'call',
	'end',
	'graph',
	'flowchart',
	'subgraph',
	'style',
	'click',
	'class',
	'classDef',
	'linkStyle',
	'interpolate',
	'default',
	...LINK_TARGETS
];
/**
 * Der Lexer matcht Schlüsselwörter mit `\b`; `$` ist kein Wortzeichen, also scheitert auch
 * `end$`. Ausnahme laut Probe: `call$` und `click$` parst mermaid.
 */
const RESERVED_PREFIX = new RegExp(
	`^(?:${RESERVED.filter((w) => w !== 'call' && w !== 'click').join('|')})(?!\\w)`
);
const CALL = /^call\s+([A-Za-z_$][\w$.]*)\s*\(([^()"]*)\)(.*)$/;

/**
 * `click`-Rest in mermaid-Form: `href "url" ["tip"] [ziel]` (auch ohne `href`),
 * `call f(args) ["tip"]` oder `f ["tip"]`. `''` entfernt click, `null` lehnt ab: `;`, `%%`,
 * Zeilenumbrüche und Anführungszeichen außerhalb von Texten beenden Anweisungen oder brechen
 * den Code. Texte enthalten danach kein `"` mehr; die Ausgabe wird neu zusammengesetzt.
 */
function clickNormal(raw: string): string | null {
	const v = raw.trim();
	if (!v) return '';
	if (/[;\r\n]|%%/.test(v) || (v.match(/"/g)?.length ?? 0) % 2 === 1) return null;
	const call = CALL.exec(v);
	const tokens = [...(call ? call[3] : v).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => ({
		str: m[1] as string | undefined,
		word: m[2] as string | undefined
	}));
	if (tokens.some((t) => t.word?.includes('"'))) return null;
	/** Nur nicht-leere Texte ohne Backtick: mermaid parst `""` und `` ` `` in Texten nicht. */
	const strs = (list: typeof tokens) =>
		list.every((t) => t.str && !t.str.includes('`')) ? list : null;
	const quoted = (list: typeof tokens) => list.map((t) => ` "${t.str}"`).join('');
	if (call) {
		const tip = strs(tokens);
		return tip && tip.length <= 1 ? `call ${call[1]}(${call[2]})${quoted(tip)}` : null;
	}
	const [first, ...rest] = tokens;
	if (first.word !== undefined && first.word !== 'href') {
		if (
			!CALLBACK.test(first.word) ||
			RESERVED.includes(first.word) ||
			RESERVED_PREFIX.test(first.word)
		)
			return null;
		const tip = strs(rest);
		return tip && tip.length <= 1 ? `${first.word}${quoted(tip)}` : null;
	}
	const args = first.word === 'href' ? rest : tokens;
	const last = args.at(-1)?.word;
	const target = last !== undefined && LINK_TARGETS.includes(last) ? ` ${last}` : '';
	const texts = strs(target ? args.slice(0, -1) : args);
	if (!texts || texts.length < 1 || texts.length > 2) return null;
	return `href${quoted(texts)}${target}`;
}

/** Stilwert nach Feld-Regel: Farben per Allow-Liste, Strichmuster aus der Auswahl. */
function styleValue(key: string, value: string): string | null {
	const v = value.trim();
	if (COLOR_KEYS.has(key)) return v === '' || isFlowColor(v) ? v : null;
	if (key === DASH_KEY) return DASHES.some((o) => o.value === v) ? v : null;
	return value.replace(STYLE_BREAK, '').trim();
}

function withStyle(style: StyleMap, key: string, value: string): StyleMap | null {
	const clean = styleValue(key, value);
	if (clean === null) return null;
	const next = { ...style };
	if (clean) next[key] = clean;
	else delete next[key];
	return next;
}

type NodePatch = Parameters<typeof updateNode>[2];
type EdgePatch = Parameters<typeof updateEdge>[2];

function nodePatch(
	doc: DiagramDocument,
	n: DiagramNode,
	key: string,
	value: string
): NodePatch | null {
	if (key === 'label') return { label: oneLine(value) };
	if (key.startsWith('style:')) {
		const style = withStyle(n.style, key.slice(6), value);
		return style && { style };
	}
	if (doc.diagramType === 'flowchart') {
		if (key === 'shape')
			return FLOW_SHAPES.some((o) => o.value === value) ? { shape: value } : null;
		if (key === 'classes') {
			return { cssClasses: [...new Set(value.split(/[\s,]+/).filter((c) => CLASS_NAME.test(c)))] };
		}
		if (key === 'click') {
			const tail = clickNormal(value);
			if (tail === null) return null;
			const props = { ...n.props };
			if (tail) props.click = `click ${n.id} ${tail}`;
			else delete props.click;
			return { props };
		}
		return null;
	}
	if (key === 'kind')
		return SEQ_KINDS.some((o) => o.value === value) ? { kind: value, shape: value } : null;
	const parts = (n.props.participants as string[] | undefined) ?? [];
	const known = endpoints(doc, false).some((o) => o.value === value);
	if (key === 'placement') {
		if (!PLACEMENTS.some((o) => o.value === value)) return null;
		const participants = value === 'over' ? parts : parts.slice(0, 1);
		return { props: { ...n.props, placement: value, participants } };
	}
	if (key === 'noteFrom' && known) {
		return { props: { ...n.props, participants: [value, ...parts.slice(1)] } };
	}
	if (key === 'noteTo' && (known || value === '')) {
		const participants = value ? [parts[0] ?? value, value] : parts.slice(0, 1);
		return { props: { ...n.props, participants } };
	}
	return null;
}

function edgePatch(
	doc: DiagramDocument,
	e: DiagramEdge,
	key: string,
	value: string
): EdgePatch | null {
	const flow = doc.diagramType === 'flowchart';
	if (key === 'label') return { label: oneLine(value) };
	if (key === 'source' || key === 'target' || key === 'participant') {
		if (!endpoints(doc, flow).some((o) => o.value === value)) return null;
		if (key === 'participant') return { sourceId: value, targetId: value };
		return key === 'source' ? { sourceId: value } : { targetId: value };
	}
	if (flow) {
		if (key.startsWith('style:')) {
			const style = withStyle(e.style, key.slice(6), value);
			return style && { style };
		}
		if (key === 'lineStyle' && FLOW_LINES.some((o) => o.value === value)) {
			return value === 'invisible' ? { lineStyle: value, arrowHead: 'none' } : { lineStyle: value };
		}
		if (key === 'arrowHead' && FLOW_HEADS.some((o) => o.value === value))
			return { arrowHead: value };
		if (key === 'length') {
			const n = Math.trunc(Number(value));
			if (!Number.isFinite(n) || n < 1) return null;
			const props = { ...e.props };
			if (n > 1) props.length = Math.min(n, 10);
			else delete props.length;
			return { props };
		}
		return null;
	}
	if (key === 'arrow') {
		const hit = SEQ_ARROWS.find(([t]) => t === value);
		if (!hit) return null;
		return { lineStyle: hit[1], arrowHead: hit[2], props: { ...e.props, arrow: hit[0] } };
	}
	if (key === 'activation' && ACTIVATIONS.some((o) => o.value === value)) {
		return { props: { ...e.props, activation: value } };
	}
	if (key === 'activationKind' && (value === 'activate' || value === 'deactivate')) {
		return { kind: value };
	}
	return null;
}

function containerCommand(c: Container, key: string, value: string): Command | null {
	const label = t('panels.props.command', { key });
	if (key === 'label') {
		const v = oneLine(value);
		return {
			label,
			do: (d) => relabel(updateContainer(d, c.id, { label: v }), c.id, 0, v)
		};
	}
	if (key === 'direction') {
		if (value !== '' && !DIRECTIONS.some((o) => o.value === value)) return null;
		return { label, do: (d) => updateContainer(d, c.id, { direction: value }) };
	}
	if (key === 'kind') {
		const allowed = c.sections.length > 1 ? MULTI_BLOCKS : [...SINGLE_BLOCKS, ...MULTI_BLOCKS];
		if (!allowed.some(([k]) => k === value)) return null;
		return { label, do: (d) => updateContainer(d, c.id, { kind: value }) };
	}
	const section = /^section:(\d+)$/.exec(key);
	if (section) {
		const index = Number(section[1]);
		if (index < 1 || index >= c.sections.length) return null;
		const v = oneLine(value);
		return { label, do: (d) => relabel(updateContainer(d, c.id, {}), c.id, index, v) };
	}
	return null;
}

/** Ändert nur das Label einer Section; Mitglieder bleiben (parentId/order konsistent). */
function relabel(doc: DiagramDocument, id: string, index: number, label: string): DiagramDocument {
	return {
		...doc,
		containers: doc.containers.map((c) =>
			c.id === id
				? { ...c, sections: c.sections.map((s, i) => (i === index ? { ...s, label } : s)) }
				: c
		)
	};
}

function directionCommand(value: string): Command | null {
	if (!DIRECTIONS.some((o) => o.value === value)) return null;
	return {
		label: t('panels.props.command', { key: 'docDirection' }),
		do(d) {
			const decl = declaration(d);
			if (!decl) return d;
			const rawText = decl.block.rawText.replace(
				DECL,
				(_all, head: string, gap?: string) => `${head}${gap ?? ' '}${value}`
			);
			return {
				...d,
				rawBlocks: d.rawBlocks.map((r) => (r.id === decl.block.id ? { ...r, rawText } : r)),
				modelVersion: d.modelVersion + 1
			};
		}
	};
}

/** Top-Level `config:` überhaupt bzw. als Block (nur Kommentar dahinter). */
const CONFIG_ANY = /^config[ \t]*:/;
const CONFIG_BLOCK = /^config[ \t]*:[ \t]*(?:#.*)?$/;
/** Eingerückte `theme`-Zeile: Präfix, Wert (ggf. gequotet), Rest (Kommentar). */
const THEME_LINE = /^([ \t]+theme[ \t]*:[ \t]*)("[^"]*"|'[^']*'|[^\s#]*)(.*)$/;
/** Ersetzbarer Wert: einfaches Wort oder vollständig gequotet, dahinter höchstens Kommentar. */
const PLAIN_VALUE = /^(?:[\w.-]+|"[^"]*"|'[^']*')$/;
const TAIL = /^(?:[ \t]+#.*|[ \t]*)$/;
const VOID = /^\s*(?:#.*)?$/;
const bare = (line: string) => line.replace(/\r?\n$/, '');
/** Einfacher (ungequoteter, ankerloser) Mapping-Schlüssel am Zeilenanfang. */
const PLAIN_KEY = /^[A-Za-z_][\w-]*[ \t]*:(?:[ \t]|$)/;

/**
 * Anzeige-Wert von `config.theme` im Frontmatter (nur Block-Form, sicherheitlich nicht relevant:
 * die Sperre liest mermaid selbst, O-174). `null` ohne Eintrag; `undefined`, wenn die
 * Schreibweise nicht einfach ist (Einrückung, Quotes, `?`, Anker, Fluss-`config`); dann bleibt
 * das Feld nur lesend, damit kein doppelter Schlüssel entsteht.
 */
function frontmatterTheme(frontmatter: string): string | null | undefined {
	if (!frontmatter) return null;
	const lines = frontmatter.split(/\r?\n/);
	if (/^\s/.test(lines[0])) return undefined;
	let theme: string | null = null;
	let inConfig = false;
	let indent: string | null = null;
	for (const line of lines.slice(1)) {
		if (/^[ \t]*---[ \t]*$/.test(line)) break;
		if (VOID.test(line)) continue;
		const own = /^[ \t]*/.exec(line)![0];
		if (!own) {
			if (!PLAIN_KEY.test(line)) return undefined;
			inConfig = CONFIG_ANY.test(line);
			if (inConfig && !CONFIG_BLOCK.test(line)) return undefined;
			continue;
		}
		if (!inConfig) continue;
		indent ??= own;
		if (own.length < indent.length) return undefined;
		if (own !== indent) continue;
		if (!PLAIN_KEY.test(line.slice(own.length))) return undefined;
		const value = THEME_LINE.exec(line)?.[2];
		if (value !== undefined) theme ??= value.replace(/^(["'])(.*)\1$/, '$2');
	}
	return theme;
}

/** Theme der letzten init-Direktive mit `theme` (nur Anzeige; ungültiges JSON zählt nicht). */
function directiveTheme(text: string): string | undefined {
	let theme: string | undefined;
	for (const part of text.split('%%{').slice(1)) {
		const head = /^\s*init(?:ialize)?\b\s*:?/.exec(part);
		const end = part.indexOf('}%%');
		if (!head || end < 0) continue;
		try {
			const args: unknown = JSON.parse(part.slice(head[0].length, end).replace(/'/g, '"'));
			if (typeof args === 'object' && args !== null && 'theme' in args && args.theme != null)
				theme = String(args.theme);
		} catch {
			// mermaid ignoriert ungültige Direktiven
		}
	}
	return theme;
}

/**
 * Frontmatter mit `config.theme = theme`; `default` entfernt die Zeile, ein dadurch leeres
 * `config` (keine Zeile mehr im Block) und ein dadurch leeres Frontmatter (keine Zeile zwischen
 * `---`) ebenfalls; Leerzeilen und Kommentare des Nutzers bleiben stehen. Alle übrigen Zeilen
 * bleiben byte-gleich. Gleiche Lese-Regeln wie `frontmatterTheme`; `null`, wenn die Schreibweise
 * nicht sicher ersetzbar ist (Fluss-`config`, Block-Skalar, Folgezeile, Anker, offene Quotes).
 */
function withTheme(frontmatter: string, theme: string, eol: string): string | null {
	const off = theme === 'default';
	if (!frontmatter) return off ? '' : `---${eol}config:${eol}  theme: ${theme}${eol}---${eol}`;
	const lines = frontmatter.split(/(?<=\n)/);
	const close = lines.length - 1;
	const nl = /\r?\n$/.exec(lines[0])?.[0] ?? eol;
	const at = lines.findIndex((l, i) => i > 0 && i < close && CONFIG_ANY.test(l));
	if (at < 0) {
		if (!off) lines.splice(close, 0, `config:${nl}`, `  theme: ${theme}${nl}`);
		return lines.join('');
	}
	if (!CONFIG_BLOCK.test(bare(lines[at]))) return null;
	let indent: string | null = null;
	let hit = -1;
	/** Nicht leere eingerückte Zeilen im Block (Kinder und Kommentare). */
	let kept = 0;
	for (let end = at + 1, prev = -1; end < close; end++) {
		const line = bare(lines[end]);
		if (line.trim() === '') continue;
		const own = /^[ \t]*/.exec(line)![0];
		if (!own && !VOID.test(line)) break;
		if (!own) continue;
		kept++;
		if (VOID.test(line)) continue;
		if (prev === hit && hit >= 0 && own.length > indent!.length) return null;
		prev = end;
		indent ??= own;
		if (hit < 0 && own === indent && THEME_LINE.test(line)) {
			const [, , value, rest] = THEME_LINE.exec(line)!;
			if (!PLAIN_VALUE.test(value) || !TAIL.test(rest)) return null;
			hit = end;
		}
	}
	if (!off) {
		if (hit < 0) lines.splice(at + 1, 0, `${indent ?? '  '}theme: ${theme}${nl}`);
		else {
			const line = bare(lines[hit]);
			const [, head, , rest] = THEME_LINE.exec(line)!;
			lines[hit] = `${head}${theme}${rest}${lines[hit].slice(line.length)}`;
		}
		return lines.join('');
	}
	if (hit < 0) return frontmatter;
	lines.splice(hit, 1);
	if (kept === 1) lines.splice(at, 1);
	return lines.length === 2 ? '' : lines.join('');
}

/** Zeilenende für neues Frontmatter: CRLF, wenn der Code CRLF nutzt. */
const eolOf = (d: DiagramDocument) =>
	[
		...d.header.directives,
		...d.rawBlocks.map((r) => r.rawText),
		...d.nodes.map((n) => n.sourceText)
	].some((text) => text.includes('\r\n'))
		? '\r\n'
		: '\n';

/**
 * Theme-Feld: Auswahl schreibt `config.theme` im Frontmatter. Setzt eine init-Direktive das
 * Theme (geht bei mermaid vor), zeigt das Feld deren Wert schreibgeschützt; ebenso bei einer
 * Frontmatter-Schreibweise, die `withTheme` nicht sicher ersetzen kann.
 */
function themeField(doc: DiagramDocument): Field {
	const label = t('panels.field.theme');
	const code = [...doc.header.directives, ...doc.rawBlocks.map((r) => r.rawText)].join('\n');
	const directive = directiveTheme(code);
	if (directive !== undefined)
		return fixed('theme', label, String(directive), t('panels.theme.directive'));
	const read = frontmatterTheme(doc.header.frontmatter);
	const raw = read === undefined ? t('panels.theme.unknown') : read || 'default';
	if (read === undefined || withTheme(doc.header.frontmatter, 'default', '\n') === null)
		return fixed('theme', label, raw, t('panels.theme.codeOnly'));
	const known = THEMES.some((o) => o.value === raw);
	const custom = { value: raw, label: t('panels.theme.custom', { value: raw }) };
	return select('theme', label, raw, known ? THEMES : [...THEMES, custom]);
}

/** Nur Allow-Listen-Werte (Regel 3); Frontmatter-Text aus dem aktuellen Dokument. */
function themeCommand(value: string): Command | null {
	if (!THEMES.some((o) => o.value === value)) return null;
	return {
		label: t('panels.props.command', { key: 'theme' }),
		do(d) {
			const frontmatter = withTheme(d.header.frontmatter, value, eolOf(d));
			if (frontmatter === null || frontmatter === d.header.frontmatter) return d;
			return { ...d, header: { ...d.header, frontmatter }, modelVersion: d.modelVersion + 1 };
		}
	};
}

/**
 * Command für eine Feldänderung oder `null` (ungültiger Wert, unbekanntes Ziel, keine Änderung).
 * Die Prüfung nutzt `doc`; den Patch berechnet `do` aus dem aktuellen Dokument, damit ein
 * zwischenzeitlich übernommener Code-Edit erhalten bleibt. Fehlt das Element dort oder ist der
 * Wert dort ungültig, bleibt das Dokument unverändert.
 */
export function commandFor(
	doc: DiagramDocument,
	id: string | null,
	key: string,
	value: string
): Command | null {
	const panel = panelFor(doc, id);
	const field = panel?.fields.find((f) => f.key === key);
	if (!field || field.kind === 'readonly' || field.value === value) return null;
	const found = find(doc, id);
	const label = t('panels.props.command', { key });
	if (found?.type === 'diagram') {
		if (key === 'theme') return themeCommand(value);
		return key === 'docDirection' ? directionCommand(value) : null;
	}
	if (found?.type === 'node') {
		if (!nodePatch(doc, found.el, key, value)) return null;
		const nodeId = found.el.id;
		return {
			label,
			do(d) {
				const n = d.nodes.find((x) => x.id === nodeId);
				const patch = n && nodePatch(d, n, key, value);
				return patch ? updateNode(d, nodeId, patch) : d;
			}
		};
	}
	if (found?.type === 'edge') {
		if (!edgePatch(doc, found.el, key, value)) return null;
		const edgeId = found.el.id;
		return {
			label,
			do(d) {
				const e = d.edges.find((x) => x.id === edgeId);
				const patch = e && edgePatch(d, e, key, value);
				return patch ? updateEdge(d, edgeId, patch) : d;
			}
		};
	}
	if (found?.type === 'container') return containerCommand(found.el, key, value);
	return null;
}

/** Klasse in der Klassen-Liste (T137 C2): Vorschau nur mit Allow-Listen-Werten (T106). */
export interface ClassEntry {
	readonly name: string;
	readonly fill?: string;
	readonly stroke?: string;
	readonly color?: string;
	/** Klasse ist dem gewählten Knoten zugewiesen. */
	readonly assigned: boolean;
}

export interface ClassPanel {
	readonly entries: readonly ClassEntry[];
	/** Knoten trägt Stilwerte, die "Als Klasse speichern" übernehmen kann. */
	readonly saveable: boolean;
}

const BREAKS = /[,;:{}\r\n]/;

/**
 * Stilwerte, die in ein `classDef` wandern: Schlüssel der Stilfelder, Wert in der Allow-Liste
 * (Farben nur Hex, O-117) und ohne Zeichen, die die Anweisung aufbrechen. Quell-Reihenfolge.
 */
function classStyle(style: StyleMap): StyleMap | null {
	const keys = new Set(STYLE_KEYS.map(([k]) => k));
	const moved = Object.entries(style).filter(([k, raw]) => {
		const v = raw.trim();
		if (!keys.has(k) || !v || BREAKS.test(v)) return false;
		return COLOR_KEYS.has(k) ? isFlowColor(v) : Object.keys(safeStyle({ [k]: v })).length > 0;
	});
	return moved.length > 0 ? Object.fromEntries(moved) : null;
}

const flowNodeOf = (doc: DiagramDocument, id: string | null) =>
	doc.diagramType === 'flowchart' && id !== null ? doc.nodes.find((n) => n.id === id) : undefined;

/**
 * Fehlermeldung für einen neuen Klassennamen oder `null`: Zeichen wie das Klassen-Feld, keine
 * mermaid-Schlüsselwörter (auch `default`, `href` und Präfixe wie `end-x`, Probe), kein Duplikat.
 */
export function classNameError(doc: DiagramDocument, name: string): string | null {
	const v = name.trim();
	if (!v) return t('panels.classes.errEmpty');
	if (v.includes('--')) return t('panels.classes.errDashes');
	if (!CLASS_NAME.test(v)) return t('panels.classes.errChars');
	if (v === 'href' || RESERVED.includes(v) || RESERVED_PREFIX.test(v))
		return t('panels.classes.errReserved', { name: v });
	if (doc.classDefs.some((d) => d.name === v)) return t('panels.classes.errDuplicate', { name: v });
	return null;
}

/** Klassen-Liste für einen flowchart-Knoten, sonst `null`; `default` gilt für alle Knoten. */
export function classPanelFor(doc: DiagramDocument, id: string | null): ClassPanel | null {
	const n = flowNodeOf(doc, id);
	if (!n) return null;
	const entries = doc.classDefs
		.filter((d) => d.name !== 'default')
		.map((d) => {
			const { fill, stroke, color } = safeStyle(d.style);
			return {
				name: d.name,
				...(fill ? { fill } : {}),
				...(stroke ? { stroke } : {}),
				...(color ? { color } : {}),
				assigned: n.cssClasses.includes(d.name)
			};
		});
	return { entries, saveable: classStyle(n.style) !== null };
}

/**
 * "Als Klasse speichern" (F-02): übertragbare Stilwerte des Knotens als neues `classDef`, Klasse
 * am Knoten zugewiesen - ein Command, also ein Undo-Schritt. Die übertragenen Werte verlassen den
 * Inline-Stil: `style` hat Vorrang vor Klassen, eine spätere Änderung der Klasse wirkte sonst am
 * Knoten nicht. Andere Werte bleiben inline. Prüfung und Ausführung je am übergebenen Dokument.
 */
export function saveClassCommand(
	doc: DiagramDocument,
	id: string | null,
	name: string
): Command | null {
	const v = name.trim();
	const build = (d: DiagramDocument): DiagramDocument | null => {
		const n = flowNodeOf(d, id);
		const moved = n && classStyle(n.style);
		if (!n || !moved || classNameError(d, v) !== null) return null;
		const style = { ...n.style };
		for (const k of Object.keys(moved)) delete style[k];
		const cssClasses = [...n.cssClasses.filter((c) => c !== v), v];
		const next = updateNode(d, n.id, { cssClasses, style });
		return {
			...next,
			classDefs: [...next.classDefs, { name: v, style: moved, sourceText: '' }],
			order: [...next.order, `classDef:${v}`]
		};
	};
	if (!build(doc)) return null;
	return { label: t('panels.classes.save'), do: (d) => build(d) ?? d };
}

/** Klasse zuweisen (`assign`) oder entfernen; `null` ohne Wirkung oder bei unbekannter Klasse. */
export function classCommand(
	doc: DiagramDocument,
	id: string | null,
	name: string,
	assign: boolean
): Command | null {
	const entry = classPanelFor(doc, id)?.entries.find((e) => e.name === name);
	if (!entry || entry.assigned === assign) return null;
	return {
		label: t('panels.props.command', { key: 'class' }),
		do(d) {
			const n = flowNodeOf(d, id);
			if (!n || n.cssClasses.includes(name) === assign) return d;
			const cssClasses = assign ? [...n.cssClasses, name] : n.cssClasses.filter((c) => c !== name);
			return updateNode(d, n.id, { cssClasses });
		}
	};
}
