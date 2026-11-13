/**
 * Umsortieren im Sequenz-Canvas (reine Logik): Teilnehmer horizontal, Nachrichten, Notizen,
 * Aktivierungen und Blöcke vertikal. Ergebnis sind Commands über `moveToContainer`/`reorder`.
 */
import type { Command } from '../../../controllers/commands/history';
import { moveToContainer, reorder, updateNode } from '../../../model/operations';
import type { DiagramDocument } from '../../../model/types';
import { layoutSequence } from '../../../services/layout';
import { command, isBox, locate, type Point } from './commands';
import { ROW, sectionId, type SeqView } from './mapping';
import { t } from '../../shell/i18n.svelte';

export function participantOrder(doc: DiagramDocument): string[] {
	return Object.keys(layoutSequence(doc, () => ({ width: 1, height: 1 })).participants);
}

/**
 * Deklariert alle Teilnehmer in neuer Reihenfolge am Anfang des Diagramms. Mitglieder einer
 * Gruppe (`box`, T135 C2) bleiben in ihr: die Gruppe steht an der Stelle ihres ersten
 * Mitglieds, darin die Mitglieder in neuer Reihenfolge (Kommentare behalten ihren Platz).
 * Ändert sich die sichtbare Reihenfolge nicht (z. B. über eine Gruppengrenze), bleibt das
 * Modell unverändert.
 */
export function reorderParticipants(next: readonly string[]): Command {
	return command(t('canvas.cmd.reorderParticipants'), (doc) => {
		const current = participantOrder(doc);
		if (next.length !== current.length || current.some((id) => !next.includes(id))) {
			throw new Error(t('canvas.err.reorderIncomplete'));
		}
		const fixed = next.find((id) => doc.nodes.find((n) => n.id === id)!.props.base);
		if (fixed) throw new Error(t('canvas.err.participantNotEditable', { id: fixed }));
		const result = arrange(doc, next);
		return unchanged(doc, result) ? doc : result;
	});
}

function arrange(doc: DiagramDocument, next: readonly string[]): DiagramDocument {
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const boxOf = new Map(
		doc.containers
			.filter((c) => c.kind === 'box')
			.flatMap((c) => c.sections[0].memberIds.map((m) => [m, c.id] as const))
	);
	const units = [...new Set(next.map((id) => boxOf.get(id) ?? id))];
	return units.reduce((d, id, k) => {
		if (isBox(d, id)) return reorder(sortBox(d, id, next), id, k);
		const declared = nodes.get(id)!.props.implicit ? updateNode(d, id, { props: {} }) : d;
		return reorder(moveToContainer(declared, id, null), id, k);
	}, doc);
}

const unchanged = (a: DiagramDocument, b: DiagramDocument) =>
	participantOrder(a).join('\n') === participantOrder(b).join('\n');

/** Teilnehmer der Gruppe in der Reihenfolge `next`, Kommentare an ihrem Platz. */
function sortBox(doc: DiagramDocument, id: string, next: readonly string[]): DiagramDocument {
	const box = doc.containers.find((c) => c.id === id)!;
	const members = box.sections[0].memberIds;
	const sorted = members
		.filter((m) => next.includes(m))
		.sort((a, b) => next.indexOf(a) - next.indexOf(b));
	let k = 0;
	const memberIds = members.map((m) => (next.includes(m) ? sorted[k++] : m));
	if (memberIds.every((m, i) => m === members[i])) return doc;
	return {
		...doc,
		containers: doc.containers.map((c) =>
			c.id === id ? { ...c, sections: [{ ...c.sections[0], memberIds }] } : c
		),
		modelVersion: doc.modelVersion + 1
	};
}

export function stepParticipant(doc: DiagramDocument, id: string, d: -1 | 1): Command | null {
	const order = participantOrder(doc);
	const i = order.indexOf(id);
	const j = i + d;
	if (i < 0 || j < 0 || j >= order.length) return null;
	[order[i], order[j]] = [order[j], order[i]];
	return unchanged(doc, arrange(doc, order)) ? null : reorderParticipants(order);
}

/** Zielindex beim Ziehen: Anzahl der übrigen Teilnehmer links vom Zeiger. */
export function participantIndexAt(view: SeqView, id: string, x: number): number {
	return view.lifelines.filter((l) => l.id !== id && l.x < x).length;
}

type Token = { point: Point } | { item: string };

const VERTICAL = new Set(['message', 'activate', 'deactivate']);

function visible(doc: DiagramDocument, id: string): boolean {
	return (
		doc.containers.some((c) => c.id === id && c.kind !== 'box') ||
		doc.edges.some((e) => e.id === id && VERTICAL.has(e.kind)) ||
		doc.nodes.some((n) => n.id === id && n.kind === 'note')
	);
}

/** Einfügestellen und sichtbare Zeilen in Dokument-Reihenfolge, ohne `moved` samt Inhalt. */
function tokens(doc: DiagramDocument, moved: string): Token[] {
	const containers = new Map(doc.containers.map((c) => [c.id, c]));
	const out: Token[] = [];
	const list = (ids: readonly string[], parent: string | null, section: number) => {
		const rest = ids.filter((id) => id !== moved);
		rest.forEach((id, index) => {
			out.push({ point: { parent, section, index } });
			if (visible(doc, id)) out.push({ item: id });
			// Gruppen (`box`) enthalten nur Teilnehmer: keine Einfügestellen darin.
			if (containers.get(id)?.kind === 'box') return;
			containers.get(id)?.sections.forEach((s, k) => {
				if (k > 0) out.push({ item: sectionId(id, k) });
				list(s.memberIds, id, k);
			});
		});
		out.push({ point: { parent, section, index: rest.length } });
	};
	list(doc.order, null, 0);
	return out;
}

/** Gleichwertige Einfügestellen (gleiche Liste, nur unsichtbare Elemente dazwischen) als Gruppe. */
function grouped(doc: DiagramDocument, moved: string) {
	const groups: { points: Point[]; next: string | null }[] = [];
	let open: Point[] | null = null;
	for (const t of tokens(doc, moved)) {
		if ('item' in t) {
			if (open) groups[groups.length - 1].next = t.item;
			open = null;
		} else if (open && open[0].parent === t.point.parent && open[0].section === t.point.section) {
			open.push(t.point);
		} else {
			open = [t.point];
			groups.push({ points: open, next: null });
		}
	}
	return groups;
}

export function verticalGroups(doc: DiagramDocument, moved: string): Point[][] {
	return grouped(doc, moved).map((g) => g.points);
}

/** Verschiebt ein Element an eine Einfügestelle; ungültige Folgen lehnt `finish` ab. */
export function moveTo(id: string, at: Point): Command {
	return command(t('canvas.cmd.move'), (doc) =>
		reorder(moveToContainer(doc, id, at.parent, at.section), id, at.index)
	);
}

function listLength(doc: DiagramDocument, at: Point, moved: string): number {
	const c = doc.containers.find((x) => x.id === at.parent)!;
	return c.sections[at.section].memberIds.filter((m) => m !== moved).length;
}

const same = (a: Point, b: Point) =>
	a.parent === b.parent && a.section === b.section && a.index === b.index;

export function stepVertical(doc: DiagramDocument, id: string, d: -1 | 1): Command | null {
	const at = visible(doc, id) ? locate(doc, id) : null;
	if (!at) return null;
	const groups = verticalGroups(doc, id);
	const g = groups.findIndex((points) => points.some((p) => same(p, at)));
	const target = groups[g + d];
	return target ? moveTo(id, target[0]) : null;
}

/**
 * Nächste Einfügestelle zur Zeiger-Höhe; Höhe einer Gruppe = Oberkante der folgenden Zeile, am
 * Ende eines Abschnitts eine halbe Zeile darüber (sonst gleich hoch wie hinter dem Block).
 */
export function dropTarget(doc: DiagramDocument, view: SeqView, id: string, y: number): Point {
	const tops = new Map(view.items.map((i) => [i.id, i.box.y]));
	const end = view.height - ROW;
	let best: Point | null = null;
	let dist = Infinity;
	for (const g of grouped(doc, id)) {
		const last = g.points[g.points.length - 1];
		const closing = last.parent !== null && last.index === listLength(doc, last, id);
		const gy = (g.next !== null ? (tops.get(g.next) ?? end) : end) - (closing ? ROW / 2 : 0);
		if (Math.abs(gy - y) < dist) {
			dist = Math.abs(gy - y);
			best = g.points[0];
		}
	}
	return best!;
}
