/**
 * Layout-Service (KONZEPT §6.2, §6.3): dagre für Layout-Klasse "Graph", eigener
 * Sequenz-Layouter. Reine Funktionen, kein DOM, kein Svelte. Größen liefert eine injizierte
 * `measure`-Funktion (D-04). Ergebnisse sind berechnet und werden nie in
 * `LayoutMeta.positions` geschrieben (D-02 Auflage d); Snap und Raster wirken hier nicht.
 */
import { Graph, layout } from '@dagrejs/dagre';
import type { Container, DiagramDocument, DiagramNode, Position } from '../../model/types';

export type Size = { width: number; height: number };
export type MeasureElement = (el: DiagramNode | Container) => Size;
export type Rankdir = 'TB' | 'BT' | 'LR' | 'RL';

export interface GraphLayoutOptions {
	/** Mermaid-Richtung (`TD`, `TB`, `BT`, `LR`, `RL`); sonst `TB`. */
	direction?: string;
	nodesep?: number;
	ranksep?: number;
}

/** Mermaid-Richtung auf dagre `rankdir`; `TD` ist Synonym für `TB`. */
export function toRankdir(direction: string): Rankdir {
	if (direction === 'TD') return 'TB';
	return direction === 'BT' || direction === 'LR' || direction === 'RL' ? direction : 'TB';
}

/**
 * dagre-Layout inkl. Container (compound). Liefert `[x, y, w, h]` (linke obere Ecke) je
 * Knoten und Container. Kanten zu Containern mit Kindern und dangling Kanten unterstützt
 * dagre im compound-Modus nicht; sie gehen nicht ins Layout ein.
 */
export function layoutGraph(
	doc: DiagramDocument,
	measure: MeasureElement,
	options: GraphLayoutOptions = {}
): Record<string, Position> {
	const g = new Graph({ compound: true, multigraph: true });
	g.setGraph({
		rankdir: toRankdir(options.direction ?? 'TB'),
		nodesep: options.nodesep ?? 50,
		ranksep: options.ranksep ?? 50
	});
	g.setDefaultEdgeLabel(() => ({}));

	// Doppelte IDs: nur das erste Vorkommen (Container vor Knoten) geht ins Layout.
	const seen = new Set<string>();
	const unique = <T extends { id: string }>(els: readonly T[]) =>
		els.filter((el) => !seen.has(el.id) && seen.add(el.id));
	const containers = unique(doc.containers);
	const nodes = unique(doc.nodes);
	const elements = [...containers, ...nodes];

	// Parent nur, wenn er ein Container ist und keinen Zyklus (inkl. Selbstverweis) schließt.
	const containerIds = new Set(containers.map((c) => c.id));
	const parentOf = new Map<string, string>();
	for (const el of elements) {
		if (el.parentId === null || !containerIds.has(el.parentId)) continue;
		let p: string | undefined = el.parentId;
		while (p !== undefined && p !== el.id) p = parentOf.get(p);
		if (p === undefined) parentOf.set(el.id, el.parentId);
	}
	const parents = new Set(parentOf.values());
	const leaves = new Set<string>();
	for (const c of containers) {
		if (parents.has(c.id)) {
			g.setNode(c.id, {});
		} else {
			g.setNode(c.id, { ...measure(c) });
			leaves.add(c.id);
		}
	}
	for (const n of nodes) {
		g.setNode(n.id, { ...measure(n) });
		leaves.add(n.id);
	}
	for (const [id, parentId] of parentOf) g.setParent(id, parentId);
	for (const e of doc.edges) {
		if (leaves.has(e.sourceId) && leaves.has(e.targetId)) {
			g.setEdge(e.sourceId, e.targetId, {}, e.id);
		}
	}

	layout(g);

	return Object.fromEntries(
		elements.map((el) => {
			const { x = 0, y = 0, width = 0, height = 0 } = g.node(el.id);
			return [el.id, [x - width / 2, y - height / 2, width, height] as Position];
		})
	);
}

export interface SequenceLayoutOptions {
	/** Abstand zwischen Teilnehmern. */
	gap?: number;
	/** Höhe einer Zeile (Nachricht, Notiz, Container-Kopf, Section-Trenner). */
	rowHeight?: number;
	/** Innenabstand der Container-Rahmen. */
	padding?: number;
}

export interface SequenceLayout {
	/** Kopf-Box je Teilnehmer. */
	participants: Record<string, Position>;
	/** y je Nachricht und Notiz. */
	rows: Record<string, number>;
	/** Rahmen je Container (loop, alt, opt, par, critical, rect). */
	containers: Record<string, Position>;
	/** Gesamthöhe inkl. Lebenslinien-Ende. */
	height: number;
}

/**
 * Sequenz-Layouter: Teilnehmer-Reihenfolge = erstes Auftreten in `order` bzw.
 * `Section.memberIds` (Deklaration oder Nachricht), übrige Teilnehmer danach in
 * Modell-Reihenfolge. Zeilen ausschließlich aus dieser Reihenfolge, keine freien Koordinaten.
 */
export function layoutSequence(
	doc: DiagramDocument,
	measure: MeasureElement,
	options: SequenceLayoutOptions = {}
): SequenceLayout {
	const gap = options.gap ?? 40;
	const rowHeight = options.rowHeight ?? 40;
	const padding = options.padding ?? 10;
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const containers = new Map(doc.containers.map((c) => [c.id, c]));

	const order = new Set<string>();
	const relRows: Record<string, number> = {};
	const spans: { id: string; top: number; bottom: number; members: Set<string> }[] = [];
	const visited = new Set<string>();
	let y = 0;

	/** Offener Container mit aktueller Section; Stapel statt Rekursion (tiefe Verschachtelung). */
	interface Frame {
		id: string;
		top: number;
		members: Set<string>;
		sections: readonly { memberIds: readonly string[] }[];
		section: number;
		pos: number;
	}
	const stack: Frame[] = [];

	const addParticipant = (id: string) => {
		const n = nodes.get(id);
		if (!n || n.kind === 'note') return;
		order.add(id);
		for (const frame of stack) frame.members.add(id);
	};

	const visit = (id: string) => {
		const e = edges.get(id);
		const c = containers.get(id);
		if (e) {
			addParticipant(e.sourceId);
			addParticipant(e.targetId);
			// activate/deactivate (Sequence-Adapter T11) sind Kanten ohne eigene Zeile.
			if (e.kind === 'activate' || e.kind === 'deactivate') return;
			relRows[id] = y;
			y += rowHeight;
		} else if (c) {
			// Selbstverweis/Zyklus über Section.memberIds: jeder Container nur einmal.
			if (visited.has(id)) return;
			visited.add(id);
			stack.push({ id, top: y, members: new Set(), sections: c.sections, section: 0, pos: 0 });
			y += rowHeight;
		} else if (nodes.get(id)?.kind === 'note') {
			relRows[id] = y;
			y += rowHeight;
		} else {
			addParticipant(id);
		}
	};

	const root = { memberIds: doc.order };
	let rootPos = 0;
	for (;;) {
		const frame = stack[stack.length - 1];
		if (!frame) {
			if (rootPos >= root.memberIds.length) break;
			visit(root.memberIds[rootPos++]);
			continue;
		}
		const ids = frame.sections[frame.section]?.memberIds;
		if (ids && frame.pos < ids.length) {
			visit(ids[frame.pos++]);
		} else if (ids && frame.section + 1 < frame.sections.length) {
			frame.section++;
			frame.pos = 0;
			y += rowHeight;
		} else {
			stack.pop();
			spans.push({ id: frame.id, top: frame.top, bottom: y, members: frame.members });
		}
	}
	for (const n of doc.nodes) addParticipant(n.id);

	const participants: Record<string, Position> = {};
	let x = 0;
	let head = 0;
	for (const id of order) {
		const { width, height } = measure(nodes.get(id)!);
		participants[id] = [x, 0, width, height];
		x += width + gap;
		head = Math.max(head, height);
	}
	const right = Math.max(0, x - gap);
	const offset = head + rowHeight;

	const rows = Object.fromEntries(Object.entries(relRows).map(([id, r]) => [id, r + offset]));
	const boxes: Record<string, Position> = {};
	for (const { id, top, bottom, members } of spans) {
		const inner = [...members].map((m) => participants[m]);
		const left = inner.length ? Math.min(...inner.map((p) => p[0])) : 0;
		const end = inner.length ? Math.max(...inner.map((p) => p[0] + p[2])) : right;
		boxes[id] = [
			left - padding,
			top + offset - rowHeight / 2,
			end - left + 2 * padding,
			bottom - top
		];
	}
	return { participants, rows, containers: boxes, height: y + offset + rowHeight };
}
