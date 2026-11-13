/**
 * Modell -> Darstellung des Sequenz-Canvas (reine Logik). Alle Koordinaten stammen aus
 * `layoutSequence`; Labels nur als Text-Zeilen (`sanitizeLabel`).
 */
import { sequenceGrammar, type RawEvents } from '../../../controllers/sync';
import type { Container, DiagramDocument, DiagramEdge, DiagramNode } from '../../../model/types';
import type { ParseError } from '../../../model/types';
import { layoutSequence } from '../../../services/layout';
import { sanitizeLabel } from '../../../services/security';
import { wrapLabel } from '../../../services/shapes';
import type { MessageKey } from '../../../services/i18n';
import { t } from '../../shell/i18n.svelte';

export type Measure = (text: string) => number;

/** Feste Textmetrik (8 px je Zeichen); unabhängig von Canvas und Schrift. */
export const textMeasure: Measure = (s) => s.length * 8;

export const ROW = 40;
const LINE = 18;
const LABEL_WIDTH = 200;
const PAD_X = 16;
const PAD_Y = 12;
const MIN_W = 80;
const NOTE_GAP = 8;
const NOTE_OVER = 30;
const BAR_W = 10;
const MARK = 12;
const SELF_LOOP = 30;
const MARGIN = 10;

const TRIVIAL_RAW = /^\s*$|^\s*sequenceDiagram\s*$/i;

/** Section-Schlüsselwort ab der zweiten Section. */
export const SECTION_KEYWORD: Readonly<Record<string, string>> = {
	alt: 'else',
	par: 'and',
	critical: 'option'
};

const BREAK = /<br\s*\/?>/gi;

/** Sequenz-Erkennung des Adapters über den Sync-Controller (T128, V-25). */
const { isBoxColor, rawEvents } = sequenceGrammar;

/** Rand der Teilnehmer-Gruppe (`box`) um ihre Teilnehmer; Kopfzeile für den Titel darüber. */
const BOX_PAD = 8;
const BOX_HEAD = LINE + 6;

/**
 * Dokument ohne Teilnehmer-Gruppen (Mitglieder an deren Stelle) für `layoutSequence`: eine
 * Gruppe ist keine Zeile, nur ein Rahmen um Teilnehmer-Spalten (T135 C2).
 */
function withoutBoxes(doc: DiagramDocument): DiagramDocument {
	const boxes = new Map(doc.containers.filter((c) => c.kind === 'box').map((c) => [c.id, c]));
	if (boxes.size === 0) return doc;
	return {
		...doc,
		order: doc.order.flatMap((id) => boxes.get(id)?.sections[0].memberIds ?? [id]),
		containers: doc.containers.filter((c) => !boxes.has(c.id)),
		nodes: doc.nodes.map((n) =>
			n.parentId && boxes.has(n.parentId) ? { ...n, parentId: null } : n
		)
	};
}

/** Anzeige-Zeilen: an `<br>` getrennt, je Teil `sanitizeLabel`, dann Umbruch. */
export function displayLines(label: string, measure: Measure, maxWidth = LABEL_WIDTH): string[] {
	const text = label
		.split(BREAK)
		.map((part) => sanitizeLabel(part).trim())
		.join('\n');
	return wrapLabel(text, maxWidth, measure);
}

export function editorText(label: string): string {
	return label.replace(BREAK, '\n');
}

/** Editor-Text -> Modell-Label: getrimmt, Zeilenumbrüche als `<br>` (Round-Trip im Serializer). */
export function labelFromEditor(text: string): string {
	return text.trim().replace(/\r\n|\r|\n/g, '<br>');
}

export const sectionId = (containerId: string, index: number) => `${containerId}:${index}`;

export function parseSectionId(id: string): { containerId: string; index: number } | null {
	const m = /^(.+):(\d+)$/.exec(id);
	return m ? { containerId: m[1], index: Number(m[2]) } : null;
}

export type ItemType =
	| 'participant'
	| 'actor'
	| 'message'
	| 'note'
	| 'activate'
	| 'deactivate'
	| 'container'
	| 'section'
	| 'box';

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SeqItem {
	id: string;
	type: ItemType;
	aria: string;
	lines: string[];
	box: Box;
	/** Label per Editor änderbar. */
	editable: boolean;
	/** Nachricht: SVG-Pfad, Strichelung, Marker an Ende bzw. Anfang, Label-Anker. */
	path?: string;
	dashed?: boolean;
	head?: string;
	tail?: string;
	labelX?: number;
	labelY?: number;
	/** Nachricht mit sichtbarer Nummer (`autonumber`, T135) und deren Anker am Pfeilanfang. */
	number?: string;
	numberX?: number;
	numberY?: number;
	/** Gruppe (`box`): Füllfarbe nur aus der Allow-Liste (`isBoxColor`). */
	fill?: string;
}

export interface OutlineEntry {
	id: string;
	aria: string;
	children: OutlineEntry[];
}

export interface SeqView {
	items: SeqItem[];
	/** Teilnehmer-IDs links nach rechts. */
	participants: string[];
	lifelines: { id: string; x: number; y1: number; y2: number }[];
	bars: (Box & { id: string })[];
	outline: OutlineEntry[];
	rawBlocks: { id: string; text: string; note: string }[];
	/** Schalter "Nummerierung": eine sichtbare `autonumber`-Anweisung steht im Dokument. */
	autonumber: boolean;
	/** Schalter gesperrt: eine `autonumber`-Anweisung steht in einer Mischzeile (O-175). */
	autonumberFixed: boolean;
	issues: string[];
	minX: number;
	minY: number;
	width: number;
	height: number;
}

const TYPE_NAME: Record<ItemType, MessageKey> = {
	participant: 'canvas.type.participant',
	actor: 'canvas.type.actor',
	message: 'canvas.type.message',
	note: 'canvas.type.note',
	activate: 'canvas.type.activate',
	deactivate: 'canvas.type.deactivate',
	container: 'canvas.type.container',
	section: 'canvas.type.section',
	box: 'services.sequence.type.box'
};

function participantSize(node: DiagramNode, measure: Measure) {
	const lines = displayLines(node.label, measure);
	return {
		lines,
		width: Math.max(MIN_W, Math.max(...lines.map(measure)) + 2 * PAD_X),
		height: lines.length * LINE + 2 * PAD_Y
	};
}

/** Pfeilspitzen je Ende: `both` an beiden Enden, sonst nur am Ziel. */
function markers(edge: DiagramEdge): { head?: string; tail?: string } {
	if (edge.arrowHead === 'none' || !edge.arrowHead) return {};
	if (edge.arrowHead === 'both') return { head: 'arrow', tail: 'arrow' };
	return { head: edge.arrowHead };
}

type Event =
	| { kind: 'row'; id: string; y: number }
	| { kind: 'on' | 'off'; participant: string; itemId?: string; y?: number };

/**
 * Nachrichtennummern wie mermaids Renderer: Zähler ab 1 in Schritten von 1, `autonumber N [M]`
 * setzt Start (0 lässt ihn) und Schritt, `off`/ohne Anweisung blendet aus; jede Nachricht zählt,
 * auch in RawBlocks. Rundung auf zwei Nachkommastellen wie mermaid.
 */
function messageNumbers(
	doc: DiagramDocument,
	raws: ReadonlyMap<string, RawEvents>
): Map<string, string> {
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const containers = new Map(doc.containers.map((c) => [c.id, c]));
	const out = new Map<string, string>();
	const visited = new Set<string>();
	let index = 1;
	let step = 1;
	let visible = false;
	const next = () => (index = Math.round((index + step) * 100) / 100);
	const visit = (ids: readonly string[]) => {
		for (const id of ids) {
			const e = edges.get(id);
			const c = containers.get(id);
			const raw = raws.get(id);
			if (e?.kind === 'message') {
				if (visible) out.set(id, String(index));
				next();
			} else if (c && !visited.has(id)) {
				visited.add(id);
				c.sections.forEach((s) => visit(s.memberIds));
			} else if (raw) {
				for (const s of raw.steps) {
					if (s.type === 'message') next();
					else if (s.type === 'autonumber') {
						index = s.set.start || index;
						step = s.set.step || step;
						visible = s.set.visible;
					}
				}
			}
		}
	};
	visit(doc.order);
	return out;
}

export function toSequence(
	doc: DiagramDocument,
	errors: readonly ParseError[],
	measure: Measure
): SeqView {
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const containers = new Map(doc.containers.map((c) => [c.id, c]));
	// rawEvents je RawBlock einmal (Nummern, Hinweisliste, Schalter).
	const rawInfo = new Map(doc.rawBlocks.map((r) => [r.id, rawEvents(r.rawText)]));
	const numbers = messageNumbers(doc, rawInfo);
	const layout = layoutSequence(withoutBoxes(doc), (el) => {
		const { width, height } = participantSize(el as DiagramNode, measure);
		return { width, height };
	});

	const participants = Object.keys(layout.participants);
	const head = Math.max(0, ...participants.map((id) => layout.participants[id][3]));
	const offset = head + ROW;
	const center = (id: string) => {
		const p = layout.participants[id];
		return p ? p[0] + p[2] / 2 : 0;
	};
	const text = (lines: string[]) => lines.join(' ');
	const labelOf = (id: string) => {
		const n = nodes.get(id);
		return n ? text(displayLines(n.label, measure)) : id;
	};

	/** Rahmen um die Spalten der Mitglieder; leere Gruppe rechts neben allen Teilnehmern. */
	function boxItem(c: Container): SeqItem {
		const xs = c.sections[0].memberIds
			.map((m) => layout.participants[m])
			.filter((p) => p !== undefined);
		const right = Math.max(
			0,
			...participants.map((id) => layout.participants[id]).map((p) => p[0] + p[2])
		);
		const x = xs.length ? Math.min(...xs.map((p) => p[0])) - BOX_PAD : right + 2 * BOX_PAD;
		const x2 = xs.length ? Math.max(...xs.map((p) => p[0] + p[2])) + BOX_PAD : x + MIN_W;
		const lines = displayLines(c.label, measure);
		const label = text(lines);
		const color = String(c.props.color ?? '');
		return {
			id: c.id,
			type: 'box',
			aria: t('services.sequence.aria.box', { label, count: String(xs.length) }),
			lines: [label],
			box: { x, y: -BOX_HEAD, w: x2 - x, h: layout.height - MARGIN + BOX_HEAD },
			editable: true,
			...(color && isBoxColor(color) ? { fill: color } : {})
		};
	}

	// Teilnehmer zuerst (links nach rechts), dann Zeilen in Dokument-Reihenfolge: `items` und damit
	// die Tab-Reihenfolge folgen der sichtbaren Anordnung, Teilnehmer stehen oben über allen Zeilen.
	const boxItems = doc.containers.filter((c) => c.kind === 'box').map((c) => boxItem(c));
	const items: SeqItem[] = participants.map((id) => {
		const n = nodes.get(id)!;
		const [x, y, w, h] = layout.participants[id];
		const lines = displayLines(n.label, measure);
		const type: ItemType = n.kind === 'actor' ? 'actor' : 'participant';
		const editable = !n.props.base;
		return {
			id,
			type,
			aria: `${t(TYPE_NAME[type])}: ${text(lines)}${editable ? '' : ` (${t('canvas.rawNote')})`}`,
			lines,
			box: { x, y, w, h },
			editable
		};
	});

	items.unshift(...boxItems);

	const events: Event[] = [];
	const activations: { item: SeqItem; event: Event & { kind: 'on' | 'off' } }[] = [];
	const visited = new Set<string>();
	let yRel = 0;

	const message = (e: DiagramEdge): SeqItem => {
		const y = layout.rows[e.id];
		const x1 = center(e.sourceId);
		const x2 = center(e.targetId);
		const lines = displayLines(e.label, measure);
		const self = e.sourceId === e.targetId;
		const left = Math.min(x1, x2);
		const width = self ? SELF_LOOP + 8 : Math.abs(x2 - x1);
		const number = numbers.get(e.id);
		return {
			id: e.id,
			type: 'message',
			aria: number
				? t('services.sequence.aria.numbered', { number, label: text(lines) })
				: `${t('canvas.type.message')}: ${text(lines)}`,
			lines: [text(lines)],
			box: { x: left, y: y - ROW / 2, w: Math.max(width, MARK), h: ROW },
			editable: true,
			path: self
				? `M ${x1} ${y - 6} H ${x1 + SELF_LOOP} V ${y + 8} H ${x1}`
				: `M ${x1} ${y} H ${x2}`,
			dashed: e.lineStyle === 'dotted',
			...markers(e),
			labelX: self ? x1 + 4 : (x1 + x2) / 2,
			labelY: y - 10,
			...(number ? { number, numberX: x1, numberY: y } : {})
		};
	};

	const note = (n: DiagramNode): SeqItem => {
		const y = layout.rows[n.id];
		const ps = ((n.props.participants as string[] | undefined) ?? []).filter(
			(p) => layout.participants[p]
		);
		const lines = displayLines(n.label, measure);
		const need = Math.max(...lines.map(measure)) + 2 * PAD_X;
		const xs = ps.map(center);
		const lo = xs.length ? Math.min(...xs) : 0;
		const hi = xs.length ? Math.max(...xs) : 0;
		let x: number;
		let w: number;
		if (n.props.placement === 'left of') {
			w = Math.max(MIN_W, need);
			x = lo - NOTE_GAP - w;
		} else if (n.props.placement === 'right of') {
			w = Math.max(MIN_W, need);
			x = hi + NOTE_GAP;
		} else {
			w = Math.max(hi - lo + 2 * NOTE_OVER, need);
			x = (lo + hi) / 2 - w / 2;
		}
		return {
			id: n.id,
			type: 'note',
			aria: `${t('canvas.type.note')}: ${text(lines)}`,
			lines: [text(lines)],
			box: { x, y: y - ROW / 2 + 4, w, h: ROW - 8 },
			editable: true
		};
	};

	const activation = (e: DiagramEdge): SeqItem => {
		const item: SeqItem = {
			id: e.id,
			type: e.kind as ItemType,
			aria: `${t(TYPE_NAME[e.kind as ItemType])}: ${labelOf(e.sourceId)}`,
			lines: [],
			box: { x: center(e.sourceId) - MARK / 2, y: 0, w: MARK, h: MARK },
			editable: false
		};
		const event = {
			kind: e.kind === 'activate' ? ('on' as const) : ('off' as const),
			participant: e.sourceId,
			itemId: e.id
		};
		events.push(event);
		activations.push({ item, event });
		return item;
	};

	const outlineOf = (ids: readonly string[]): OutlineEntry[] => {
		const out: OutlineEntry[] = [];
		for (const id of ids) {
			const e = edges.get(id);
			const c = containers.get(id);
			const n = nodes.get(id);
			if (e) {
				const item: SeqItem =
					e.kind === 'activate' || e.kind === 'deactivate' ? activation(e) : message(e);
				if (item.type === 'message') {
					events.push({ kind: 'row', id, y: layout.rows[id] });
					if (e.props.activation === '+')
						events.push({ kind: 'on', participant: e.targetId, y: layout.rows[id] });
					if (e.props.activation === '-')
						events.push({ kind: 'off', participant: e.sourceId, y: layout.rows[id] });
					yRel += ROW;
				}
				items.push(item);
				out.push({ id, aria: item.aria, children: [] });
			} else if (c?.kind === 'box') {
				const item = boxItems.find((b) => b.id === id)!;
				out.push({ id, aria: item.aria, children: [] });
			} else if (c && !visited.has(id)) {
				visited.add(id);
				out.push(container(c));
			} else if (n?.kind === 'note') {
				const item = note(n);
				events.push({ kind: 'row', id, y: layout.rows[id] });
				yRel += ROW;
				items.push(item);
				out.push({ id, aria: item.aria, children: [] });
			}
		}
		return out;
	};

	const container = (c: Container): OutlineEntry => {
		const [x, y, w, h] = layout.containers[c.id];
		const label = text(displayLines(c.label, measure));
		const aria = t('canvas.aria.block', { kind: c.kind, label });
		items.push({
			id: c.id,
			type: 'container',
			aria,
			lines: [label ? `${c.kind} [${label}]` : c.kind],
			box: { x, y, w, h },
			editable: true
		});
		yRel += ROW;
		const children = c.sections.map((s, i) => {
			const sLabel = text(displayLines(s.label, measure));
			let sAria = `${t('canvas.type.section')}: ${sLabel}`;
			if (i > 0) {
				const keyword = SECTION_KEYWORD[c.kind] ?? 'else';
				sAria = t('canvas.aria.sectionKeyword', { keyword, label: sLabel });
				items.push({
					id: sectionId(c.id, i),
					type: 'section',
					aria: sAria,
					lines: [sLabel ? `${keyword} [${sLabel}]` : keyword],
					box: { x, y: yRel + offset - ROW / 2, w, h: ROW },
					editable: true
				});
				yRel += ROW;
			}
			return { id: sectionId(c.id, i), aria: sAria, children: outlineOf(s.memberIds) };
		});
		return { id: c.id, aria, children };
	};

	const outline = outlineOf(doc.order);
	const end = layout.height - ROW;

	// Aktivierungs-y: activate am Beginn der nächsten Zeile, deactivate am Ende der vorigen.
	const rowYs = events.map((ev) => (ev.kind === 'row' ? ev.y : null));
	events.forEach((ev, i) => {
		if (ev.kind === 'row' || ev.y !== undefined) return;
		if (ev.kind === 'on') {
			const next = rowYs.slice(i + 1).find((y) => y !== null);
			ev.y = next != null ? next - ROW / 4 : end;
		} else {
			const prev = rowYs
				.slice(0, i)
				.reverse()
				.find((y) => y !== null);
			ev.y = prev != null ? prev + ROW / 4 : offset - ROW / 2;
		}
	});
	for (const { item, event } of activations) item.box.y = event.y! - MARK / 2;

	const stacks = new Map<string, number[]>();
	const bars: SeqView['bars'] = [];
	const close = (id: string, y0: number, y1: number, depth: number) =>
		bars.push({
			id,
			x: center(id) - BAR_W / 2 + (depth * BAR_W) / 2,
			y: y0,
			w: BAR_W,
			h: Math.max(y1 - y0, 4)
		});
	for (const ev of events) {
		if (ev.kind === 'row') continue;
		const stack = stacks.get(ev.participant) ?? [];
		stacks.set(ev.participant, stack);
		if (ev.kind === 'on') stack.push(ev.y!);
		else if (stack.length > 0) close(ev.participant, stack.pop()!, ev.y!, stack.length);
	}
	for (const [id, stack] of stacks) {
		while (stack.length > 0) close(id, stack.pop()!, end, stack.length);
	}
	bars.sort((a, b) => a.y - b.y);

	const lifelines = participants.map((id) => {
		const [x, , w, h] = layout.participants[id];
		return { id, x: x + w / 2, y1: h, y2: layout.height - MARGIN };
	});

	/** Kopfzeile der Gruppen über den Teilnehmern. */
	const boxTop = boxItems.length ? BOX_HEAD : 0;
	const boxes = items.map((i) => i.box);
	const minX = Math.min(0, ...boxes.map((b) => b.x)) - MARGIN;
	const maxX = Math.max(MIN_W, ...boxes.map((b) => b.x + b.w)) + MARGIN;
	return {
		items,
		participants,
		lifelines,
		bars,
		outline,
		rawBlocks: doc.rawBlocks
			.filter((b) => !TRIVIAL_RAW.test(b.rawText) && !rawInfo.get(b.id)!.autonumber)
			.map((b) => ({ id: b.id, text: b.rawText.trim(), note: t('canvas.rawNote') })),
		autonumber: [...rawInfo.values()].some((e) => e.numbering?.visible),
		autonumberFixed: [...rawInfo.values()].some((e) => e.numbering?.fixed),
		issues: errors.map((e) => t('canvas.lineIssue', { line: e.line, message: e.message })),
		minX,
		minY: -MARGIN - boxTop,
		width: maxX - minX,
		height: layout.height + boxTop
	};
}
