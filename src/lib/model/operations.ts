/**
 * Rein funktionale Modell-Operationen. Jede Operation liefert ein neues Dokument (Eingabe
 * unverändert), erhöht `modelVersion` um 1, leert `sourceText` geänderter Elemente und
 * pflegt `order` (oberste Ebene) sowie `Section.memberIds` (innerhalb von Containern).
 * Container, deren Mitgliederliste sich ändert, gelten als geändert.
 * Ungültige IDs führen zu einem `ModelError` (Code + Parameter, übersetzt im Controller). Dangling-Kanten (Endpunkt weder Knoten noch
 * Container) werden nicht gespeichert, sondern über `danglingEdges` abgeleitet (O-12).
 */
import { ModelError } from './errors';
import type { Container, DiagramDocument, DiagramEdge, DiagramNode } from './types';

type Patch<T, X extends keyof T = never> = Partial<Omit<T, 'id' | 'parentId' | 'sourceText' | X>>;

/**
 * Löschregel §8: "cascade" entfernt Kanten mit gelöschtem Endpunkt, "mark" behält sie
 * unverändert; der Validierungs-Fehler ergibt sich dann aus `danglingEdges` (O-12).
 */
export type RemoveNodeMode = 'cascade' | 'mark';

function bump(doc: DiagramDocument, changes: Partial<DiagramDocument>): DiagramDocument {
	return { ...doc, ...changes, modelVersion: doc.modelVersion + 1 };
}

function hasId(doc: DiagramDocument, id: string): boolean {
	return [doc.nodes, doc.edges, doc.containers, doc.rawBlocks, doc.comments].some((list) =>
		list.some((el) => el.id === id)
	);
}

function requireContainer(containers: readonly Container[], id: string): Container {
	const found = containers.find((c) => c.id === id);
	if (!found) throw new ModelError('unknownContainer', { id });
	return found;
}

/** Entfernt IDs aus `order` und allen `memberIds`; betroffene Container verlieren `sourceText`. */
function detach(
	doc: DiagramDocument,
	ids: ReadonlySet<string>
): Pick<DiagramDocument, 'order' | 'containers'> {
	return {
		order: doc.order.filter((id) => !ids.has(id)),
		containers: doc.containers.map((c) =>
			c.sections.some((s) => s.memberIds.some((m) => ids.has(m)))
				? {
						...c,
						sourceText: '',
						sections: c.sections.map((s) => ({
							...s,
							memberIds: s.memberIds.filter((m) => !ids.has(m))
						}))
					}
				: c
		)
	};
}

/** Hängt `id` an `order` (parentId null) oder an die Section des Containers an. */
function attach(
	doc: Pick<DiagramDocument, 'order' | 'containers'>,
	id: string,
	parentId: string | null,
	sectionIndex: number
): Pick<DiagramDocument, 'order' | 'containers'> {
	if (parentId === null) return { order: [...doc.order, id], containers: doc.containers };
	const parent = requireContainer(doc.containers, parentId);
	if (!parent.sections[sectionIndex]) {
		throw new ModelError('unknownSection', { index: sectionIndex, parent: String(parentId) });
	}
	return {
		order: doc.order,
		containers: doc.containers.map((c) =>
			c.id === parentId
				? {
						...c,
						sourceText: '',
						sections: c.sections.map((s, i) =>
							i === sectionIndex ? { ...s, memberIds: [...s.memberIds, id] } : s
						)
					}
				: c
		)
	};
}

function withoutPositions(doc: DiagramDocument, ids: ReadonlySet<string>) {
	const positions = Object.fromEntries(
		Object.entries(doc.layout.positions).filter(([id]) => !ids.has(id))
	);
	return { ...doc.layout, positions };
}

function addElement<K extends 'nodes' | 'edges' | 'containers'>(
	doc: DiagramDocument,
	key: K,
	element: DiagramDocument[K][number],
	sectionIndex: number
): DiagramDocument {
	if (hasId(doc, element.id)) throw new ModelError('idTaken', { id: element.id });
	const placed = attach(doc, element.id, element.parentId, sectionIndex);
	const list: { id: string }[] = key === 'containers' ? placed.containers : doc[key];
	return bump(doc, { ...placed, [key]: [...list, element] });
}

/** Strukturelle Gleichheit (JSON-artige Werte); gleiche Referenzen werden nicht durchlaufen. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const rb = b as Record<string, unknown>;
	return (
		ka.length === Object.keys(b).length &&
		ka.every((k) => Object.hasOwn(rb, k) && sameValue((a as Record<string, unknown>)[k], rb[k]))
	);
}

/**
 * O-47/D4: Im Flowchart wird ein leeres oder reines Leerraum-Label von Knoten und Subgraphen zu
 * `label := id`, damit der Serializer ohne Sonderfall gültigen Code schreibt (`A`, `A((A))`,
 * `subgraph id`). Sequenz-Blöcke und Kanten dürfen leer sein.
 * O-97: Flowchart-Labels (auch Kanten) ohne führenden/abschließenden Leerraum, wie mermaid und
 * der Adapter sie lesen (`trim()`); sonst ergäbe der Re-Parse ein anderes Label als das Modell.
 */
function normalizeLabel(doc: DiagramDocument, key: string, id: string, patch: object): object {
	const label = (patch as { label?: unknown }).label;
	if (doc.diagramType !== 'flowchart' || typeof label !== 'string') return patch;
	const trimmed = label.trim();
	if (trimmed === '' && key !== 'edges') return { ...patch, label: id };
	return trimmed === label ? patch : { ...patch, label: trimmed };
}

function updateElement<K extends 'nodes' | 'edges' | 'containers'>(
	doc: DiagramDocument,
	key: K,
	id: string,
	raw: object
): DiagramDocument {
	const list = doc[key] as DiagramDocument[K][number][];
	if (!list.some((el) => el.id === id)) throw new ModelError('unknownId', { id });
	const patch = normalizeLabel(doc, key, id, raw);
	// Patch ohne Wirkung behält das Element samt `sourceText` (V-13: keine Schein-Änderung).
	const changes = (el: object) =>
		Object.entries(patch).some(([k, v]) => !sameValue((el as Record<string, unknown>)[k], v));
	return bump(doc, {
		[key]: list.map((el) =>
			el.id === id && changes(el) ? { ...el, ...patch, sourceText: '' } : el
		)
	});
}

export function addNode(doc: DiagramDocument, node: DiagramNode, sectionIndex = 0) {
	return addElement(doc, 'nodes', node, sectionIndex);
}

export function updateNode(doc: DiagramDocument, id: string, patch: Patch<DiagramNode>) {
	return updateElement(doc, 'nodes', id, patch);
}

/** Kanten, deren Quelle oder Ziel weder Knoten noch Container ist. */
export function danglingEdges(doc: DiagramDocument): DiagramEdge[] {
	const ends = new Set([...doc.nodes, ...doc.containers].map((el) => el.id));
	return doc.edges.filter((e) => !ends.has(e.sourceId) || !ends.has(e.targetId));
}

function requireEndpoint(doc: DiagramDocument, id: string): void {
	if (!doc.nodes.some((n) => n.id === id) && !doc.containers.some((c) => c.id === id)) {
		throw new ModelError('unknownEndpoint', { id });
	}
}

/** Bezugs-Teilnehmer einer Notiz (`props.participants`, Sequence), sonst `undefined`. */
function noteParticipants(node: DiagramNode): string[] | undefined {
	const list = node.props.participants;
	return node.kind === 'note' && Array.isArray(list) ? (list as string[]) : undefined;
}

/**
 * Entfernt Knoten und Container in `gone` samt `order`, `memberIds` und Positionen.
 * Kanten mit gelöschtem Endpunkt: "cascade" löscht sie, "mark" behält sie.
 * Notizen verlieren bei "cascade" gelöschte Bezugs-Teilnehmer; ohne verbleibenden entfallen sie.
 * Kanten in `gone` (Kinder gelöschter Container) entfallen in beiden Modi.
 */
function removeElements(
	doc: DiagramDocument,
	gone: ReadonlySet<string>,
	mode: RemoveNodeMode
): DiagramDocument {
	const removed = new Set(gone);
	const notes = new Map<string, string[]>();
	if (mode === 'cascade') {
		for (const e of doc.edges) {
			if (gone.has(e.sourceId) || gone.has(e.targetId)) removed.add(e.id);
		}
		for (const n of doc.nodes) {
			const list = noteParticipants(n);
			if (removed.has(n.id) || !list?.some((p) => gone.has(p))) continue;
			const rest = list.filter((p) => !gone.has(p));
			if (rest.length === 0) removed.add(n.id);
			else notes.set(n.id, rest);
		}
	}
	const rest = detach(doc, removed);
	return bump(doc, {
		order: rest.order,
		containers: rest.containers.filter((c) => !removed.has(c.id)),
		nodes: doc.nodes
			.filter((n) => !removed.has(n.id))
			.map((n) =>
				notes.has(n.id)
					? { ...n, props: { ...n.props, participants: notes.get(n.id) }, sourceText: '' }
					: n
			),
		edges: doc.edges.filter((e) => !removed.has(e.id)),
		rawBlocks: doc.rawBlocks.filter((r) => !removed.has(r.id)),
		comments: doc.comments.filter((c) => !removed.has(c.id)),
		layout: withoutPositions(doc, removed)
	});
}

export function removeNode(
	doc: DiagramDocument,
	id: string,
	mode: RemoveNodeMode
): DiagramDocument {
	if (!doc.nodes.some((n) => n.id === id)) throw new ModelError('unknownId', { id });
	return removeElements(doc, new Set([id]), mode);
}

/** Löscht Container mit allen Kindern (Knoten, Kanten, Unter-Container) rekursiv. */
export function removeContainer(
	doc: DiagramDocument,
	id: string,
	mode: RemoveNodeMode
): DiagramDocument {
	requireContainer(doc.containers, id);
	const gone = new Set([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const el of [...doc.containers, ...doc.nodes, ...doc.edges]) {
			if (!gone.has(el.id) && el.parentId !== null && gone.has(el.parentId)) {
				gone.add(el.id);
				grew = true;
			}
		}
		for (const c of doc.containers) {
			if (!gone.has(c.id)) continue;
			for (const m of c.sections.flatMap((s) => s.memberIds)) {
				if (!gone.has(m)) {
					gone.add(m);
					grew = true;
				}
			}
		}
	}
	return removeElements(doc, gone, mode);
}

export function addEdge(doc: DiagramDocument, edge: DiagramEdge, sectionIndex = 0) {
	requireEndpoint(doc, edge.sourceId);
	requireEndpoint(doc, edge.targetId);
	return addElement(doc, 'edges', edge, sectionIndex);
}

/** Prüft nur im Patch geänderte Endpunkte, damit behaltene Dangling-Kanten editierbar bleiben. */
export function updateEdge(doc: DiagramDocument, id: string, patch: Patch<DiagramEdge>) {
	const current = doc.edges.find((e) => e.id === id);
	for (const key of ['sourceId', 'targetId'] as const) {
		const end = patch[key];
		if (current && end !== undefined && end !== current[key]) requireEndpoint(doc, end);
	}
	return updateElement(doc, 'edges', id, patch);
}

export function removeEdge(doc: DiagramDocument, id: string): DiagramDocument {
	if (!doc.edges.some((e) => e.id === id)) throw new ModelError('unknownId', { id });
	const removed = new Set([id]);
	return bump(doc, {
		...detach(doc, removed),
		edges: doc.edges.filter((e) => e.id !== id),
		layout: withoutPositions(doc, removed)
	});
}

export function addContainer(doc: DiagramDocument, container: Container, sectionIndex = 0) {
	return addElement(doc, 'containers', container, sectionIndex);
}

/** `sections` nur über addNode/moveToContainer/reorder, damit parentId und order konsistent bleiben. */
export function updateContainer(
	doc: DiagramDocument,
	id: string,
	patch: Patch<Container, 'sections'>
) {
	return updateElement(doc, 'containers', id, patch);
}

/** Verschiebt Knoten, Kante oder Container ans Ende von `order` bzw. einer Section. */
export function moveToContainer(
	doc: DiagramDocument,
	id: string,
	containerId: string | null,
	sectionIndex = 0
): DiagramDocument {
	const key = (['nodes', 'edges', 'containers'] as const).find((k) =>
		doc[k].some((el) => el.id === id)
	);
	if (!key) throw new ModelError('unknownId', { id });
	if (containerId !== null) {
		// Ziel darf weder das Element selbst noch ein Nachfahre sein; `visited` fängt eine
		// bereits zyklische parentId-Kette ab (T05-P3).
		const visited = new Set<string>();
		let cursor: string | null = containerId;
		while (cursor !== null) {
			if (cursor === id || visited.has(cursor)) {
				throw new ModelError('cycle', { id, container: containerId });
			}
			visited.add(cursor);
			cursor = requireContainer(doc.containers, cursor).parentId;
		}
	}
	const placed = attach(detach(doc, new Set([id])), id, containerId, sectionIndex);
	const move = <T extends { id: string }>(list: T[]) =>
		list.map((el) => (el.id === id ? { ...el, parentId: containerId, sourceText: '' } : el));
	return bump(doc, {
		...placed,
		[key]: move<{ id: string }>(key === 'containers' ? placed.containers : doc[key])
	});
}

/**
 * V-13/O-104: mermaid vergibt unbenannten Subgraphen `subGraph<N>` nach Schließreihenfolge über
 * alle Subgraphen; Einfügen davor verschiebt die ID. Wahr, wenn `c` diese Auto-ID trägt und der
 * Kopftext (`props.openText`) keine ID nennt (`subgraph Zwei Worte`).
 */
export function autoSubgraphId(c: Container): boolean {
	const text = c.props.openText;
	if (!/^subGraph\d+$/.test(c.id) || typeof text !== 'string') return false;
	const head = text.trim().replace(/;$/, '');
	return !new RegExp(`^subgraph\\s+("?)${c.id}\\1\\s*(\\[[\\s\\S]*)?$`).test(head);
}

/**
 * Benennt Container `from` in `to` um: `order`/`memberIds`, `parentId` (auch `props.stmtParent`)
 * von Knoten, Kanten und Containern, Kanten-Endpunkte, gleichnamiger Container-ID-Knoten und
 * `layout.positions`. Kopftext und `sourceText` des Containers entfallen (Serializer schreibt die
 * ID explizit); Kanten mit geändertem Endpunkt verlieren `sourceText`. `style`/`class`/`click`-
 * Zeilen (RawBlocks) erhalten den exakten Ziel-Token; nennt ein RawBlock `from` anders, bleibt
 * `doc` unverändert (gleiche Referenz), weil die Nennung sonst ins Leere zeigte (O-111 (2)).
 */
export function renameContainer(doc: DiagramDocument, from: string, to: string): DiagramDocument {
	requireContainer(doc.containers, from);
	if (hasId(doc, to)) throw new ModelError('idTaken', { id: to });
	const rawBlocks = doc.rawBlocks.map((r) => ({
		...r,
		rawText: renameRawRef(r.rawText, from, to)
	}));
	if (rawBlocks.some((r) => mentions(r.rawText, from))) return doc;
	const swap = (id: string) => (id === from ? to : id);
	const swapParent = <T extends { parentId: string | null; props: Record<string, unknown> }>(
		el: T
	): T => {
		const stmtParent = el.props.stmtParent === from ? { ...el.props, stmtParent: to } : el.props;
		if (el.parentId !== from && stmtParent === el.props) return el;
		return { ...el, parentId: el.parentId === from ? to : el.parentId, props: stmtParent };
	};
	return bump(doc, {
		order: doc.order.map(swap),
		containers: doc.containers.map((c) => {
			if (c.id === from) {
				const props = { ...c.props };
				delete props.openText;
				return { ...swapParent(c), id: to, props, sourceText: '' };
			}
			const own = swapParent(c);
			if (!c.sections.some((s) => s.memberIds.includes(from))) return own;
			const sections = c.sections.map((s) => ({ ...s, memberIds: s.memberIds.map(swap) }));
			return { ...own, sections, sourceText: '' };
		}),
		nodes: doc.nodes.map((n) =>
			n.id === from
				? {
						...swapParent(n),
						id: to,
						label: n.label === from ? to : n.label,
						// Reine Nennung (`subGraph0 --> A`) bleibt Nennung; sonst neu schreiben.
						sourceText: n.sourceText === from ? to : ''
					}
				: swapParent(n)
		),
		edges: doc.edges.map((e) => {
			const own = swapParent(e);
			if (e.sourceId !== from && e.targetId !== from) return own;
			return { ...own, sourceId: swap(e.sourceId), targetId: swap(e.targetId), sourceText: '' };
		}),
		rawBlocks: rawBlocks.map((r, i) =>
			r.rawText === doc.rawBlocks[i].rawText ? doc.rawBlocks[i] : r
		),
		layout: {
			...doc.layout,
			positions: Object.fromEntries(
				Object.entries(doc.layout.positions).map(([id, p]) => [swap(id), p])
			)
		}
	});
}

/** Zeichen einer Flowchart-ID (vgl. `NODE_ID` im Adapter); Grenze gegen Teiltreffer. */
const ID_CHAR = 'A-Za-z0-9_.\\-\\u00C0-\\uFFFF';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wahr, wenn `text` die ID `id` als ganzen Token nennt. */
function mentions(text: string, id: string): boolean {
	return new RegExp(`(?<![${ID_CHAR}])${escapeRe(id)}(?![${ID_CHAR}])`).test(text);
}

/**
 * Schreibt in einer `style`/`click`-Zeile die Ziel-ID, in einer `class`-Zeile jeden Eintrag der
 * Komma-Liste exakt von `from` auf `to` um; andere Zeilen bleiben.
 */
function renameRawRef(text: string, from: string, to: string): string {
	const swap = (id: string) => (id === from ? to : id);
	const single = /^(\s*(?:style|click)\s+)(\S+)(\s[\s\S]*)?$/.exec(text);
	if (single) return single[1] + swap(single[2]) + (single[3] ?? '');
	const list = /^(\s*class\s+)([^\s,]+(?:\s*,\s*[^\s,]+)*)(\s+[\w-]+;?[ \t]*\r?\n?)$/.exec(text);
	if (list) return list[1] + list[2].replace(/[^\s,]+/g, swap) + list[3];
	return text;
}

/** Setzt `id` innerhalb seiner Liste (`order` oder Section) auf `index` (geklemmt). */
export function reorder(doc: DiagramDocument, id: string, index: number): DiagramDocument {
	const move = (list: string[]) => {
		const rest = list.filter((m) => m !== id);
		const at = Math.max(0, Math.min(index, rest.length));
		return [...rest.slice(0, at), id, ...rest.slice(at)];
	};
	if (doc.order.includes(id)) return bump(doc, { order: move(doc.order) });
	const parent = doc.containers.find((c) => c.sections.some((s) => s.memberIds.includes(id)));
	if (!parent) throw new ModelError('unknownId', { id });
	return bump(doc, {
		containers: doc.containers.map((c) =>
			c === parent
				? {
						...c,
						sourceText: '',
						sections: c.sections.map((s) =>
							s.memberIds.includes(id) ? { ...s, memberIds: move(s.memberIds) } : s
						)
					}
				: c
		)
	});
}
