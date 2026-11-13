/**
 * Command-Erzeugung des Graph-Canvas (O-27). Jede Canvas-Aktion wird ein `Command`, das der
 * Sync-Controller ausführt; Positionen gehen nur so in die Metadaten.
 */
import type { Command, CommandContext } from '../../../controllers/commands/history';
import { fragmentText, type Fragment } from '../../../controllers/sync/fragment';
import { t } from '../../shell/i18n.svelte';
import {
	addContainer,
	addEdge,
	addNode,
	autoSubgraphId,
	moveToContainer,
	removeContainer,
	renameContainer,
	removeEdge,
	removeNode,
	updateContainer,
	updateEdge,
	updateNode
} from '../../../model/operations';
import type {
	ClassDef,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	LayoutMeta,
	Position
} from '../../../model/types';
import type { Move } from '../common/align';
import type { Rect } from '../common/grid';
import { reconnectEnds, type EdgeEndType } from './edges';
import { nodeSize } from './mapping';

export type { Move };

const DUPLICATE_OFFSET = 16;

/** Standardgröße eines neuen Knotens (einzeilig, Mindestbreite), damit `pos` nie 0x0 trägt. */
const NEW_NODE = nodeSize([''], () => 0);

/**
 * Positionen setzen; mit `geometry` wird vorher das Auto-Layout eingefroren und auf manuell
 * geschaltet. Vorhandene (zuletzt manuelle) Positionen gehen dem Auto-Layout vor (KONZEPT 5).
 * Unbenannte Subgraphen (`subGraph<N>`), deren Position dieses Command schreibt (`positions`
 * oder eingefrorenes Auto-Layout), erhalten im selben Command eine Editor-ID, die beim Einfügen
 * weiterer Subgraphen stabil bleibt (V-13, O-104). Aus Meta geladene Positionen anderer
 * Container bleiben unter ihrer ID (O-111 (1)).
 */
function withPositions(
	doc: DiagramDocument,
	positions: Record<string, Position>,
	ctx: CommandContext,
	geometry?: Record<string, Rect>
): DiagramDocument {
	const frozen =
		geometry && doc.layout.mode !== 'manual'
			? Object.fromEntries(
					Object.entries(geometry).map(([id, r]) => [id, [r.x, r.y, r.w, r.h] as Position])
				)
			: {};
	let next: DiagramDocument = {
		...doc,
		layout: {
			...doc.layout,
			mode: geometry ? 'manual' : doc.layout.mode,
			positions: { ...frozen, ...doc.layout.positions, ...positions }
		},
		modelVersion: doc.modelVersion + 1
	};
	for (const c of next.containers) {
		if ((c.id in positions || c.id in frozen) && autoSubgraphId(c)) {
			next = renameContainer(next, c.id, ctx.newId('c'));
		}
	}
	return next;
}

/**
 * Umbenennungen alt -> neu per Index-Vergleich der Container-Liste vor/nach einem Command
 * (`renameContainer` erhält den Index). Nur bei gleicher Länge; die alte ID darf danach, die neue
 * davor nicht vorkommen (O-111 (5)).
 */
export function containerRenames(
	before: readonly { id: string }[],
	after: readonly { id: string }[]
): Map<string, string> {
	const out = new Map<string, string>();
	if (before.length !== after.length) return out;
	const was = new Set(before.map((c) => c.id));
	const now = new Set(after.map((c) => c.id));
	before.forEach((c, i) => {
		const to = after[i].id;
		if (to !== c.id && !now.has(c.id) && !was.has(to)) out.set(c.id, to);
	});
	return out;
}

/**
 * Auswahl und DOM-Messung über Umbenennungen tragen: Einträge mit alter ID (Resync noch
 * ausstehend) erhalten die neue ID; Einträge mit neuer ID (Resync gelaufen) übernehmen
 * `selected`/`measured` des alten Eintrags aus `previous`.
 */
export function carryRenames<T extends { id: string; selected?: boolean; measured?: unknown }>(
	current: T[],
	previous: readonly T[],
	renames: ReadonlyMap<string, string>
): T[] {
	if (renames.size === 0) return current;
	const back = new Map([...renames].map(([from, to]) => [to, from]));
	const prev = new Map(previous.map((n) => [n.id, n]));
	return current.map((n) => {
		const to = renames.get(n.id);
		if (to !== undefined) return { ...n, id: to };
		const old = prev.get(back.get(n.id) ?? '');
		if (!old) return n;
		const carried = { ...n, selected: old.selected };
		return old.measured === undefined ? carried : { ...carried, measured: old.measured };
	});
}

/** Eltern-Map aller Knoten und Container (Container gehen vor); je Command einmal gebaut (V-29). */
function parentMap(doc: DiagramDocument): Map<string, string | null> {
	const parent = new Map<string, string | null>();
	for (const el of [...doc.nodes, ...doc.containers]) {
		if (!parent.has(el.id) || 'sections' in el) parent.set(el.id, el.parentId);
	}
	return parent;
}

/** Vorfahren-Container eines Elements (ohne sich selbst), robust gegen Zyklen. */
function ancestors(parent: ReadonlyMap<string, string | null>, id: string): string[] {
	const out: string[] = [];
	let p = parent.get(id) ?? null;
	while (p !== null && p !== id && !out.includes(p)) {
		out.push(p);
		p = parent.get(p) ?? null;
	}
	return out;
}

/**
 * Neuer Knoten. Im Modus `manual` mit Klickposition; im Auto-Layout ohne Position, dagre
 * platziert ihn (M-08, O-48): die Datei trägt keine wirkungslose Klickposition.
 */
export function createNode(at: { x: number; y: number }, shape = 'square'): Command {
	return {
		label: t('canvas.cmd.createNode'),
		do(doc, ctx) {
			const id = ctx.newId('n');
			const next = addNode(doc, {
				id,
				kind: 'node',
				label: id,
				shape,
				cssClasses: [],
				style: {},
				props: {},
				parentId: null,
				sourceText: ''
			});
			if (doc.layout.mode !== 'manual') return next;
			return withPositions(next, { [id]: [at.x, at.y, NEW_NODE.width, NEW_NODE.height] }, ctx);
		}
	};
}

/**
 * Verschiebt Elemente auf neue absolute Positionen; Nachfahren bewegter Container folgen.
 * Ein Element, dessen Vorfahre mitbewegt wird, folgt nur dem Vorfahren.
 */
export function moveElements(moves: readonly Move[], geometry: Record<string, Rect>): Command {
	return {
		label: t('canvas.cmd.move'),
		do(doc, ctx) {
			const known = moves.filter((m) => geometry[m.id]);
			const ids = new Set(known.map((m) => m.id));
			const positions: Record<string, Position> = {};
			const parent = parentMap(doc);
			// Vorfahren je Geometrie-Element einmal (bewegte IDs sind Teilmenge der Geometrie).
			const ancOf = new Map(Object.keys(geometry).map((id) => [id, ancestors(parent, id)]));
			const anc = (id: string) => ancOf.get(id) ?? [];
			for (const m of known) {
				if (anc(m.id).some((a) => ids.has(a))) continue;
				const r = geometry[m.id];
				const dx = m.x - r.x;
				const dy = m.y - r.y;
				if (dx === 0 && dy === 0) continue;
				positions[m.id] = [m.x, m.y, r.w, r.h];
				for (const [id, g] of Object.entries(geometry)) {
					if (id !== m.id && anc(id).includes(m.id)) {
						positions[id] = [g.x + dx, g.y + dy, g.w, g.h];
					}
				}
			}
			if (Object.keys(positions).length === 0) return doc;
			return withPositions(doc, positions, ctx, geometry);
		}
	};
}

/** Label ändern; Container-ID-Knoten werden über ihren Container benannt. */
export function renameElement(id: string, label: string): Command {
	return {
		label: t('canvas.cmd.rename'),
		do(doc) {
			if (doc.containers.some((c) => c.id === id)) return updateContainer(doc, id, { label });
			if (doc.nodes.some((n) => n.id === id)) return updateNode(doc, id, { label });
			if (doc.edges.some((e) => e.id === id)) return updateEdge(doc, id, { label });
			return doc;
		}
	};
}

/** Löscht Container (rekursiv, inkl. Container-ID-Knoten), Knoten und Kanten kaskadierend. */
export function deleteElements(ids: readonly string[]): Command {
	return {
		label: t('canvas.cmd.delete'),
		do(doc) {
			let d = doc;
			for (const id of ids) {
				if (d.containers.some((c) => c.id === id)) d = removeContainer(d, id, 'cascade');
				if (d.nodes.some((n) => n.id === id)) d = removeNode(d, id, 'cascade');
				else if (d.edges.some((e) => e.id === id)) d = removeEdge(d, id);
			}
			return d;
		}
	};
}

/** Statement-gebundene Props: gehören zum Quelltext des Originals, nicht zur Kopie. */
const NODE_STMT_PROPS = ['click'];
const EDGE_STMT_PROPS = ['stmt', 'idx', 'of', 'explicitId'];

function withoutProps<T extends DiagramNode | DiagramEdge>(el: T, keys: readonly string[]): T {
	const props = { ...el.props };
	for (const k of keys) delete props[k];
	return { ...el, props };
}

/** Kopiert Knoten (keine Container) versetzt; Kanten zwischen kopierten Knoten werden mitkopiert. */
export function duplicateNodes(
	ids: readonly string[],
	geometry: Record<string, Rect>,
	offset = DUPLICATE_OFFSET
): Command {
	return {
		label: t('canvas.cmd.duplicate'),
		do(doc, ctx) {
			const containers = new Set(doc.containers.map((c) => c.id));
			const wanted = new Set(ids.filter((id) => !containers.has(id)));
			const sources = doc.nodes.filter((n) => wanted.has(n.id));
			if (sources.length === 0) return doc;
			const copyOf = new Map<string, string>();
			const positions: Record<string, Position> = {};
			let d = doc;
			for (const n of sources) {
				if (copyOf.has(n.id)) continue;
				const id = ctx.newId('n');
				copyOf.set(n.id, id);
				d = addNode(d, { ...withoutProps(n, NODE_STMT_PROPS), id, sourceText: '' });
				const r = geometry[n.id];
				if (r) positions[id] = [r.x + offset, r.y + offset, r.w, r.h];
			}
			for (const e of doc.edges) {
				const s = copyOf.get(e.sourceId);
				const t = copyOf.get(e.targetId);
				if (s && t) {
					const edge = withoutProps(e, EDGE_STMT_PROPS);
					d = addEdge(d, { ...edge, id: ctx.newId('e'), sourceId: s, targetId: t, sourceText: '' });
				}
			}
			return withPositions(d, positions, ctx, geometry);
		}
	};
}

/** Command, das nach `do` die IDs der eingefügten Knoten nennt (für die Auswahl danach). */
export interface PasteCommand extends Command {
	readonly pasted: readonly string[];
}

/** `click <id> ...` auf die neue ID umgeschrieben; nennt die Zeile eine andere ID, entfällt sie. */
function movedClick(props: DiagramNode['props'], from: string, to: string) {
	const { click, ...rest } = props;
	if (typeof click !== 'string') return rest;
	const m = /^(\s*click[ \t]+)(\S+)/.exec(click);
	return m && m[2] === from ? { ...rest, click: m[1] + to + click.slice(m[0].length) } : rest;
}

/**
 * Kleinster Versatz `k * step` (k >= 1), bei dem keine eingefügte Position auf der linken oberen
 * Ecke einer vorhandenen liegt: wiederholtes Einfügen rückt so jeweils weiter. `step` <= 0 (oder
 * NaN) gilt als `DUPLICATE_OFFSET`, sonst liefe die Suche endlos.
 */
function pasteShift(
	taken: DiagramDocument['layout']['positions'],
	placed: Position[],
	offset: number
) {
	const step = offset > 0 ? offset : DUPLICATE_OFFSET;
	const corners = new Set(Object.values(taken).map(([x, y]) => `${x},${y}`));
	let shift = step;
	while (placed.some(([x, y]) => corners.has(`${x + shift},${y + shift}`))) shift += step;
	return shift;
}

/** Abstand der Spalte für Knoten ohne Position zu allem Vorhandenen und untereinander. */
const PASTE_GAP = 40;

/**
 * `count` Plätze in Standardgröße für eingefügte Knoten ohne Position (Ziel `manual`): eine Spalte
 * rechts neben allen Rechtecken `rects`, oben bündig mit dem obersten; ohne Rechtecke am Ursprung.
 * Ohne Platz fiele der Knoten auf das Auto-Layout zurück und läge auf manuell platzierten.
 */
function freeColumn(rects: readonly Position[], count: number): Position[] {
	const x = rects.length ? Math.max(...rects.map(([rx, , w]) => rx + w)) + PASTE_GAP : 0;
	const y = rects.length ? Math.min(...rects.map(([, ry]) => ry)) : 0;
	const step = NEW_NODE.height + PASTE_GAP;
	return Array.from({ length: count }, (_, i) => [
		x,
		y + i * step,
		NEW_NODE.width,
		NEW_NODE.height
	]);
}

/**
 * Fügt ein Fragment (T133, `readFragment`) als ein Undo-Schritt ein: neue Editor-IDs für Knoten
 * und Kanten (D-03), Kanten auf die neuen Knoten umgehängt, Anweisungs-Props entfernt bzw.
 * `click` umgeschrieben. Fehlende `classDef`s kommen hinzu; gleichnamige des Ziels bleiben, eine
 * `default` der Quelle nie (wirkte auf alle Knoten des Ziels). Im Modus `manual` Positionen mit
 * Versatz, Knoten ohne Position in einer freien Spalte (`freeColumn`); im Auto-Layout ohne
 * Position wie `createNode`.
 */
export function pasteFragment(fragment: Fragment, offset = DUPLICATE_OFFSET): PasteCommand {
	let pasted: string[] = [];
	return {
		label: t('canvas.cmd.paste'),
		get pasted() {
			return pasted;
		},
		do(doc, ctx) {
			pasted = [];
			if (fragment.nodes.length === 0) return doc;
			const idOf = new Map<string, string>();
			let d = doc;
			for (const n of fragment.nodes) {
				if (idOf.has(n.id)) continue;
				const id = ctx.newId('n');
				idOf.set(n.id, id);
				pasted.push(id);
				const props = movedClick(n.props, n.id, id);
				d = addNode(d, { ...n, id, props, parentId: null, sourceText: '' });
			}
			for (const e of fragment.edges) {
				const s = idOf.get(e.sourceId);
				const t = idOf.get(e.targetId);
				if (!s || !t) continue;
				const edge = withoutProps(e, EDGE_STMT_PROPS);
				d = addEdge(d, {
					...edge,
					id: ctx.newId('e'),
					sourceId: s,
					targetId: t,
					parentId: null,
					sourceText: ''
				});
			}
			const names = new Set(doc.classDefs.map((c) => c.name));
			const added: ClassDef[] = fragment.classDefs
				.filter((c) => c.name !== 'default' && !names.has(c.name))
				.map((c) => ({ ...c, sourceText: '' }));
			if (added.length > 0) d = { ...d, classDefs: [...d.classDefs, ...added] };
			if (doc.layout.mode !== 'manual') return d;
			const own = [...idOf].filter(([old]) => fragment.positions[old]);
			const loose = [...idOf].filter(([old]) => !fragment.positions[old]).map(([, id]) => id);
			const shift = pasteShift(
				doc.layout.positions,
				own.map(([old]) => fragment.positions[old]),
				offset
			);
			const positions: Record<string, Position> = {};
			for (const [old, id] of own) {
				const [x, y, w, h] = fragment.positions[old];
				positions[id] = [x + shift, y + shift, w, h];
			}
			const taken = [...Object.values(doc.layout.positions), ...Object.values(positions)];
			freeColumn(taken, loose.length).forEach((p, i) => (positions[loose[i]] = p));
			return withPositions(d, positions, ctx);
		}
	};
}

/** Command, das nach `do` den Fragment-Text der ausgeschnittenen Knoten nennt (`null`: nichts). */
export interface CutCommand extends Command {
	readonly text: string | null;
}

/**
 * Ausschneiden als ein Undo-Schritt: Fragment-Text der Auswahl (`fragmentText`), dann Löschen
 * der ausgewählten Knoten und Kanten. Container gehören nicht zum Fragment und bleiben stehen;
 * ohne Knoten im Fragment ändert sich nichts.
 */
export function cutElements(ids: readonly string[]): CutCommand {
	let text: string | null = null;
	return {
		label: t('canvas.cmd.cut'),
		get text() {
			return text;
		},
		do(doc, ctx) {
			text = fragmentText(doc, ids);
			if (text === null) return doc;
			const boxes = new Set(doc.containers.map((c) => c.id));
			return deleteElements(ids.filter((id) => !boxes.has(id))).do(doc, ctx);
		}
	};
}

/** Raster/Snap des Diagramms ändern (Layout-Feld, undo-bar). */
export function setLayoutOption(patch: Partial<Pick<LayoutMeta, 'snap' | 'gridSize'>>): Command {
	return {
		label: t('canvas.cmd.grid'),
		do(doc) {
			return { ...doc, layout: { ...doc.layout, ...patch }, modelVersion: doc.modelVersion + 1 };
		}
	};
}

export function connectNodes(sourceId: string, targetId: string): Command {
	return {
		label: t('canvas.cmd.connect'),
		do(doc, ctx) {
			const edge: DiagramEdge = {
				id: ctx.newId('e'),
				kind: 'edge',
				sourceId,
				targetId,
				label: '',
				lineStyle: 'solid',
				arrowHead: 'arrow',
				style: {},
				props: {},
				parentId: null,
				sourceText: ''
			};
			return addEdge(doc, edge);
		}
	};
}

/**
 * Hängt ein Kantenende auf einen anderen Knoten oder Container um (F-03). Nur Quelle bzw. Ziel
 * ändern sich; ID, Label, Pfeil, Linien- und Kantenstil bleiben, damit auch der linkStyle-Index
 * (Kantenreihenfolge) gleich bleibt. Unbekannte Kante oder Endpunkt, unverändertes Ende und
 * Selbstkante liefern das Dokument unverändert (kein Undo-Schritt).
 */
export function reconnectEdge(edgeId: string, end: EdgeEndType, nodeId: string): Command {
	return {
		label: t('canvas.cmd.reconnect'),
		do(doc) {
			const edge = doc.edges.find((e) => e.id === edgeId);
			const known =
				doc.nodes.some((n) => n.id === nodeId) || doc.containers.some((c) => c.id === nodeId);
			const ends = edge && known ? reconnectEnds(edge, end, nodeId) : null;
			return ends ? updateEdge(doc, edgeId, ends) : doc;
		}
	};
}

/**
 * Fasst Knoten und Container in einen neuen Subgraph. Ein Element, dessen Vorfahre mit
 * ausgewählt ist, bleibt in diesem. Gemeinsamer Elterncontainer wird übernommen.
 */
export function groupIntoSubgraph(ids: readonly string[]): Command {
	return {
		label: t('canvas.cmd.group'),
		do(doc, ctx) {
			const parentOf = parentMap(doc);
			const picked = new Set(ids.filter((id) => parentOf.has(id)));
			const members = [...picked].filter(
				(id) => !ancestors(parentOf, id).some((a) => picked.has(a))
			);
			if (members.length === 0) return doc;
			const parents = new Set(members.map((id) => parentOf.get(id) ?? null));
			const parentId = parents.size === 1 ? [...parents][0] : null;
			const id = ctx.newId('c');
			let d = addContainer(doc, {
				id,
				kind: 'subgraph',
				label: id,
				direction: '',
				parentId,
				sections: [{ label: '', memberIds: [] }],
				props: {},
				sourceText: ''
			});
			for (const m of members) d = moveToContainer(d, m, id);
			return d;
		}
	};
}
