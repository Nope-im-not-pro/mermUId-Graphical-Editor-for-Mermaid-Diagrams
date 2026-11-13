/**
 * Flowchart-Serializer: DiagramDocument -> Text. Reihenfolge nach `order`/`memberIds`.
 * Unveränderte Anweisungen kommen byte-gleich aus `sourceText`/`rawText`. Ein geänderter Knoten
 * wird zuerst in place nachgezogen (V-12): Form/Label im Knoten-Token seiner Anweisungen,
 * `style`/`click` in ihrer Zeile, sonst genau eine angehängte Zeile. Gelingt das nicht, entfällt
 * jede Anweisung, die ihn definiert oder deren Kanten sich geändert haben, und wird kanonisch neu
 * geschrieben (Fixpunkt). Neue Elemente stehen am Ende ihres Containers.
 * `linkStyle` bleibt nur erhalten, wenn es die Kanten-Styles exakt ergibt, sonst Neuaufbau.
 */
import type {
	Container,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	StyleMap
} from '../../../model/types';
import {
	META_SHAPES,
	SHAPES,
	classify,
	contentOf,
	edgeCount,
	nodeUse,
	sourceSpan,
	styleText,
	type NodeRef,
	type Stmt
} from './syntax';

interface Unit {
	/** Quelltext der Anweisung; nach einem Edit in place der nachgezogene Text. */
	text: string;
	st: Stmt;
	use: { refs: string[]; defs: string[] };
	dropped: boolean;
	marked: boolean;
}

interface Part {
	text: string;
	/** Nur Zeilenumbruch, falls der bisherige Text nicht mit einem endet (entfallenes Stück). */
	soft?: boolean;
	/** Numerische linkStyle-Zeile; gilt nur, wenn linkStyle unverändert bleibt. */
	link?: boolean;
	/** Kanonisch geschriebene Zeile: beginnt auch nach `;` in einer eigenen Zeile (O-102). */
	own?: boolean;
}

const INDENT = '    ';
const LEAD_WS = /^[ \t]*/;
const COMMENT = /^[ \t]*%%/;
const START: Record<string, string> = { arrow: '<', circle: 'o', cross: 'x' };
const END: Record<string, string> = { arrow: '>', circle: 'o', cross: 'x' };

function quote(label: string): string {
	return /^[\p{L}\p{N}_ .,!?'-]+$/u.test(label) && label.trim() === label
		? label
		: `"${label.replaceAll('"', '#quot;')}"`;
}

/**
 * `@{}`-Form (F-07): Label immer in `"`, `\\` und Zeilenumbruch als YAML-Escape (`\\n`), `"` als
 * `#quot;`; gleich ID ohne.
 */
function metaToken(n: DiagramNode): string {
	const text = n.label.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '#quot;');
	const label = n.label === n.id || n.label === '' ? '' : `, label: "${text}"`;
	return `${n.id}@{ shape: ${n.shape}${label} }`;
}

function nodeToken(n: DiagramNode): string {
	if (n.shape === 'default' && n.label === n.id) return n.id;
	if (Object.hasOwn(META_SHAPES, n.shape)) return metaToken(n);
	const [open, close] = SHAPES.find(([, , name]) => name === n.shape) ?? ['[', ']'];
	return `${n.id}${open}${quote(n.label)}${close}`;
}

function linkToken(e: DiagramEdge): string {
	if (e.lineStyle === 'invisible') return '~~~';
	const n = Math.max(1, Number(e.props.length ?? 1));
	const base = e.arrowHead.replace(/^double_/, '');
	const head = END[base] ?? '';
	const start = e.arrowHead.startsWith('double_') ? (START[base] ?? '') : '';
	if (e.lineStyle === 'dotted') return `${start}-${'.'.repeat(n)}-${head}`;
	const ch = e.lineStyle === 'thick' ? '=' : '-';
	return start + ch.repeat(head ? n + 1 : n + 2) + head;
}

function edgeLine(e: DiagramEdge): string {
	const id = e.props.explicitId ? `${e.id}@` : '';
	const label = e.label ? `|${quote(e.label)}|` : '';
	return `${e.sourceId} ${id}${linkToken(e)}${label} ${e.targetId}`;
}

function nodeLines(n: DiagramNode): string[] {
	const lines = [nodeToken(n), ...n.cssClasses.map((c) => `class ${n.id} ${c}`)];
	if (Object.keys(n.style).length > 0) lines.push(`style ${n.id} ${styleText(n.style)}`);
	if (typeof n.props.click === 'string') lines.push(n.props.click);
	return lines;
}

/** Kopfzeile; ohne explizite ID vergibt mermaid `subGraph<N>` in Schließreihenfolge `index`. */
function containerHead(c: Container, index: number): string {
	const text = c.props.openText;
	if (typeof text === 'string') {
		const st = classify(contentOf(text));
		if (st.kind === 'subgraph' && (st.id ?? `subGraph${index}`) === c.id && st.label === c.label)
			return text;
	}
	return c.label === c.id ? `subgraph ${c.id}` : `subgraph ${c.id} [${quote(c.label)}]`;
}

const sameStyle = (a: StyleMap, b: StyleMap) =>
	Object.keys(a).length === Object.keys(b).length &&
	Object.entries(a).every(([k, v]) => b[k] === v);

function pickEol(doc: DiagramDocument): string {
	const texts = [
		doc.header.frontmatter,
		...doc.header.directives,
		...[...doc.nodes, ...doc.edges, ...doc.containers, ...doc.classDefs].map((el) => el.sourceText),
		...doc.containers.flatMap((c) => [c.props.openText, c.props.endText, c.props.dirText]),
		...doc.rawBlocks.map((r) => r.rawText),
		...doc.comments.map((c) => c.text)
	];
	return texts.some((t) => typeof t === 'string' && t.includes('\r\n')) ? '\r\n' : '\n';
}

export function serialize(doc: DiagramDocument): string {
	const eol = pickEol(doc);
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const containers = new Map(doc.containers.map((c) => [c.id, c]));
	const raws = new Map(doc.rawBlocks.map((r) => [r.id, r]));
	const comments = new Map(doc.comments.map((c) => [c.id, c]));
	const exists = (id: string) => nodes.has(id) || containers.has(id);

	// Kanten-Gruppen: eine Anweisung; ohne Leader führt der erste verbliebene Nachfolger.
	const edgeIds = new Set(doc.edges.map((e) => e.id));
	const groups = new Map<string, DiagramEdge[]>();
	const leadOf = new Map<string, string>();
	const substitute = new Map<string, string>();
	for (const e of doc.edges) {
		const stmt = e.props.stmt;
		let lead = e.id;
		if (typeof stmt === 'string') {
			if (edgeIds.has(stmt)) lead = stmt;
			else lead = substitute.get(stmt) ?? (substitute.set(stmt, e.id), e.id);
		}
		leadOf.set(e.id, lead);
		const group = groups.get(lead);
		if (group) group.push(e);
		else groups.set(lead, [e]);
	}

	const boxKey = (parent: string | null) =>
		parent !== null && containers.has(parent) ? parent : null;
	/** Ein Container steht genau einmal: an seiner ersten Nennung im Eltern-Container. */
	const homed = (c: Container, box: string | null, seen: Set<string>) =>
		!seen.has(c.id) && boxKey(c.parentId) === box;

	// Über order erreichbare IDs mit ihrem Container in der Ausgabe (null = oberste Ebene).
	// Weitere Nennungen einer Container-ID meinen den gleichnamigen Knoten.
	const reached = new Set<string>();
	const boxOf = new Map<string, string | null>();
	/** Gleichnamiger Knoten einer Container-ID: Container seiner ersten Nennung laut parentId. */
	const nodeBox = new Map<string, string | null>();
	/** Stelle in der Ausgabe (Quellreihenfolge): spätere Anweisungen gelten in `provided` zuletzt. */
	const rank = new Map<string, number>();
	const reach = (ids: string[], box: string | null) => {
		for (const id of ids) {
			const c = containers.get(id);
			if (c && !homed(c, box, reached)) {
				const n = nodes.get(id);
				if (n && !nodeBox.has(id) && boxKey(n.parentId) === box) {
					nodeBox.set(id, box);
					rank.set(`node:${id}`, rank.size);
				}
				continue;
			}
			reached.add(id);
			rank.set(id, rank.size);
			boxOf.set(id, box);
			if (c)
				reach(
					c.sections.flatMap((s) => s.memberIds),
					id
				);
		}
	};
	reach(doc.order, null);
	// Nicht erreichte Container stehen am Ende ihres Eltern-Containers; ihre Mitglieder mit ihnen.
	for (const c of doc.containers)
		if (!reached.has(c.id))
			reach(
				c.sections.flatMap((s) => s.memberIds),
				c.id
			);
	/** Gleiche ID wie ein Container: der order-Eintrag meint den Container. */
	const ordered = (n: DiagramNode) => reached.has(n.id) && !containers.has(n.id);

	// Schließreihenfolge der Container in der Ausgabe (nicht erreichte am Ende ihres Eltern-Containers).
	const closeRank = new Map<string, number>();
	const lateBoxes = new Map<string | null, string[]>();
	for (const c of doc.containers)
		if (!reached.has(c.id))
			lateBoxes.set(boxKey(c.parentId), [...(lateBoxes.get(boxKey(c.parentId)) ?? []), c.id]);
	const ranked = new Set<string>();
	const rankWalk = (ids: string[], box: string | null) => {
		for (const id of ids) {
			const c = containers.get(id);
			if (!c || !homed(c, box, ranked)) continue;
			ranked.add(id);
			rankWalk(
				c.sections.flatMap((s) => s.memberIds),
				id
			);
			rankWalk(lateBoxes.get(id) ?? [], id);
			closeRank.set(id, closeRank.size);
		}
	};
	rankWalk(doc.order, null);
	rankWalk(lateBoxes.get(null) ?? [], null);
	/** mermaid ordnet einen Knoten dem zuerst schließenden Container mit Nennung zu (makeUniq). */
	const misplaces = (box: string | null, id: string) => {
		const n = nodes.get(id);
		if (!n || box === null) return false;
		const home = boxKey(n.parentId);
		return home === null || closeRank.get(box)! < closeRank.get(home)!;
	};
	const chain = (box: string | null) => {
		const ids: (string | null)[] = [];
		for (let b = box; b !== null && !ids.includes(b); b = boxKey(containers.get(b)!.parentId))
			ids.push(b);
		return [...ids, null];
	};
	const homeOf = (id: string) => boxKey((nodes.get(id) ?? containers.get(id))?.parentId ?? null);
	/** Container, in dem eine neu geschriebene Kante steht: ihr eigener, sonst gemeinsamer Vorfahr. */
	const edgeBox = (e: DiagramEdge, box: string | null) => {
		if (!misplaces(box, e.sourceId) && !misplaces(box, e.targetId)) return box;
		const up = new Set(chain(homeOf(e.targetId)));
		return chain(homeOf(e.sourceId)).find((b) => up.has(b)) ?? null;
	};

	// Anweisungs-Einheiten.
	const groupUnit = new Map<string, Unit>();
	const rawUnit = new Map<string, Unit>();
	const units: Unit[] = [];
	const byNode = new Map<string, Unit[]>();
	const unitBox = new Map<Unit, string | null>();
	const unitRank = new Map<Unit, number>();
	const unit = (text: string, dropped: boolean, box: string | null, at?: number): Unit => {
		const st = classify(contentOf(text));
		const u = register({ text, st, use: nodeUse(st), dropped, marked: false }, box);
		unitRank.set(u, at ?? Infinity);
		return u;
	};
	const register = (u: Unit, box: string | null): Unit => {
		units.push(u);
		unitBox.set(u, box);
		for (const id of new Set(u.use.refs)) {
			const list = byNode.get(id);
			if (list) list.push(u);
			else byNode.set(id, [u]);
		}
		return u;
	};
	for (const [lead, group] of groups) {
		const text = group[0].sourceText;
		const st = classify(contentOf(text));
		const broken =
			text === '' || edgeCount(st) !== group.length || group.some((e) => e.sourceText !== text);
		const at = group.find((e) => reached.has(e.id));
		const box = at ? boxOf.get(at.id)! : boxKey(group[0].parentId);
		groupUnit.set(lead, unit(text, broken, box, at && rank.get(at.id)));
	}
	// Nicht erreichte RawBlocks gehörten zu einem gelöschten Container und entfallen mit ihm.
	for (const r of doc.rawBlocks)
		rawUnit.set(r.id, unit(r.rawText, !reached.has(r.id), boxOf.get(r.id) ?? null, rank.get(r.id)));
	const nodeUnit = new Map<string, Unit>();
	for (const n of doc.nodes) {
		const text = stmtOf(n);
		if (ordered(n) && text) nodeUnit.set(n.id, unit(text, false, boxOf.get(n.id)!, rank.get(n.id)));
		else if (nodeBox.has(n.id) && text)
			nodeUnit.set(n.id, unit(text, false, nodeBox.get(n.id)!, rank.get(`node:${n.id}`)));
	}
	// Mehrfach-Definitionen: in Quellreihenfolge, wie mermaid (letzte Nennung gilt).
	for (const list of byNode.values()) list.sort((a, b) => unitRank.get(a)! - unitRank.get(b)!);

	// Edit in place (V-12): Knoten, deren Eigenschaften die Anweisungen nicht mehr ergeben.
	/** Angehängte Zeilen (Stil, Klasse, click) am Ende der obersten Ebene. */
	const appended: Unit[] = [];
	const patched = new Set<string>();
	for (const n of doc.nodes) {
		// Eigenständige Knoten-Anweisung ohne Quelltext (neuer Knoten): kanonisch an ihrer Stelle.
		if (ordered(n) && !nodeUnit.has(n.id)) continue;
		const list = byNode.get(n.id) ?? [];
		if (provides(list, n)) continue;
		const extra = patchInPlace(n, list);
		if (!extra) continue;
		patched.add(n.id);
		for (const u of extra) appended.push(register(u, null));
	}

	// Fixpunkt als Arbeitsliste: entfallene Anweisung -> definierte Knoten dirty -> deren
	// definierende Anweisungen entfallen; Knoten, deren Eigenschaften die verbleibenden
	// Anweisungen nicht mehr ergeben, werden dirty.
	const dirty = new Set(
		doc.nodes.filter((n) => n.sourceText === '' && !patched.has(n.id)).map((n) => n.id)
	);
	// Eine Graph-Anweisung, über die mermaid einen Knoten einem falschen Container zuordnete, entfällt.
	const unitQueue = units.filter(
		(u) =>
			u.dropped ||
			u.use.defs.some((d) => dirty.has(d)) ||
			u.use.refs.some((r) => !exists(r)) ||
			(u.st.kind === 'graph' && u.use.refs.some((r) => misplaces(unitBox.get(u)!, r)))
	);
	// Zu prüfende Knoten ohne Duplikate, in Einfügereihenfolge: ein Hub wird so nicht je
	// entfallener Anweisung erneut geprüft (sonst quadratisch). Der Fixpunkt ist monoton.
	const pending = new Set(doc.nodes.map((n) => n.id));
	const markDirty = (id: string) => {
		if (dirty.has(id)) return;
		dirty.add(id);
		for (const u of byNode.get(id) ?? [])
			if (!u.marked && u.use.defs.includes(id)) unitQueue.push(u);
	};
	while (unitQueue.length > 0 || pending.size > 0) {
		const u = unitQueue.pop();
		if (u) {
			if (u.marked) continue;
			u.dropped = u.marked = true;
			u.use.defs.forEach(markDirty);
			u.use.refs.forEach((r) => pending.add(r));
			continue;
		}
		const id = pending.values().next().value!;
		pending.delete(id);
		const n = nodes.get(id);
		if (n && !dirty.has(id) && !provides(byNode.get(id) ?? [], n)) markDirty(id);
	}

	// Nennungen gesamt und je Container der Ausgabe; einen Subgraphen-Knoten ordnet mermaid nur
	// über eine Graph-Anweisung direkt in diesem Subgraphen zu (makeUniq).
	const mentioned = new Set<string>();
	/** Neu geschriebene Kanten, die nicht an der Stelle ihrer Anweisung stehen dürfen -> Container. */
	const movedEdges = new Map<string, string | null>();
	const boxMentions = new Map<string | null, Set<string>>();
	const mention = (box: string | null, id: string, graph: boolean) => {
		mentioned.add(id);
		if (!graph) return;
		const set = boxMentions.get(box);
		if (set) set.add(id);
		else boxMentions.set(box, new Set([id]));
	};
	for (const u of units)
		if (!u.dropped) for (const r of u.use.refs) mention(unitBox.get(u)!, r, u.st.kind === 'graph');
	// Hängende Kanten (mark-Modus) stehen nur als Kommentar an ihrer Stelle und nennen nichts.
	const dangling = (e: DiagramEdge) => !exists(e.sourceId) || !exists(e.targetId);
	for (const [lead, group] of groups) {
		const u = groupUnit.get(lead)!;
		if (u.dropped)
			for (const e of group) {
				if (dangling(e)) continue;
				const box = edgeBox(e, unitBox.get(u)!);
				mention(box, e.sourceId, true);
				mention(box, e.targetId, true);
				if (box !== unitBox.get(u)) movedEdges.set(e.id, box);
			}
	}

	// Nicht über order erreichte Elemente, je Eltern-Container (null = oberste Ebene).
	const extras = new Map<string | null, string[]>();
	const extra = (parent: string | null, id: string) => {
		const key = boxKey(parent);
		const list = extras.get(key);
		if (list) list.push(id);
		else extras.set(key, [id]);
	};
	// Nur noch im Modell vorhandene Knoten kanonisch: ihr `sourceText` ist ein Teil einer Anweisung.
	// Ein Knoten mit Eltern-Container muss dort genannt sein, sonst fiele er beim Re-Parse heraus.
	const loose = (n: DiagramNode) => {
		if (ordered(n)) return false;
		if (dirty.has(n.id) || !mentioned.has(n.id)) return true;
		const box = boxKey(n.parentId);
		return box !== null && !boxMentions.get(box)?.has(n.id);
	};
	// Knoten mit der ID eines Containers: `emit(id)` meinte den Container, daher eigene Liste.
	const shadows = new Map<string | null, DiagramNode[]>();
	for (const n of doc.nodes)
		if (loose(n)) {
			dirty.add(n.id);
			if (!containers.has(n.id)) extra(n.parentId, n.id);
			else if (shadows.has(boxKey(n.parentId))) shadows.get(boxKey(n.parentId))!.push(n);
			else shadows.set(boxKey(n.parentId), [n]);
		}
	for (const [lead, group] of groups)
		if (!group.some((e) => reached.has(e.id))) extra(group[0].parentId, lead);
	for (const c of doc.containers) if (!reached.has(c.id)) extra(c.parentId, c.id);
	for (const cd of doc.classDefs)
		if (!reached.has(`classDef:${cd.name}`)) extra(null, `classDef:${cd.name}`);

	const parts: Part[] = [];
	const emitted: { edge: DiagramEdge; clean: boolean }[] = [];
	const linkUnits: Extract<Stmt, { kind: 'linkStyle' }>[] = [];
	const indent = indentOf(doc.order, containers, (id) => {
		const lead = leadOf.get(id);
		return (
			nodes.get(id)?.sourceText ??
			(lead === undefined ? undefined : groups.get(lead)?.[0].sourceText) ??
			raws.get(id)?.rawText
		);
	});
	const canon = (depth: number, line: string) =>
		parts.push({ text: indent.repeat(depth) + line + eol, own: true });
	const done = new Set<string>();
	const opened = new Set<string>();
	const placed = new Set<string>();
	const source = (text: string, keep: boolean) =>
		parts.push(keep ? { text } : { text: '', soft: text.endsWith('\n') });

	const emit = (id: string, depth: number, parent: string | null) => {
		const box = containers.get(id);
		if (box && !homed(box, parent, opened)) {
			// Nennung des gleichnamigen Knotens; sein Container steht an anderer Stelle.
			const n = nodes.get(id);
			if (!n || boxKey(n.parentId) !== parent) return;
			// Erste Nennung aus der Quelle, solange die verbleibenden Anweisungen den Knoten ergeben;
			// weitere nur als Knoten-Token (Klassen, Style, click stehen bei der ersten).
			if (placed.has(id)) canon(depth, nodeToken(n));
			else if (!dirty.has(id)) source(nodeUnit.get(id)?.text ?? n.sourceText, true);
			else for (const line of nodeLines(n)) canon(depth, line);
			placed.add(id);
			return;
		}
		const node = box ? undefined : nodes.get(id);
		const lead = leadOf.get(id);
		const group = lead === undefined ? undefined : groups.get(lead);
		const raw = raws.get(id);
		if (node) {
			if (placed.has(id)) return;
			if (dirty.has(id)) for (const line of nodeLines(node)) canon(depth, line);
			else source(nodeUnit.get(id)?.text ?? node.sourceText, true);
		} else if (group && lead !== undefined) {
			if (done.has(lead)) return;
			done.add(lead);
			const keep = !groupUnit.get(lead)!.dropped;
			if (keep) source(groupUnit.get(lead)!.text, true);
			else if (group[0].sourceText) source(group[0].sourceText, false);
			// Knoten, die nur diese Anweisung nannte, bleiben an ihrem Platz.
			if (!keep)
				for (const ref of new Set(groupUnit.get(lead)!.use.refs)) {
					const n = nodes.get(ref);
					if (!n || placed.has(ref) || !loose(n) || n.parentId !== group[0].parentId) continue;
					placed.add(ref);
					for (const line of nodeLines(n)) canon(depth, line);
				}
			for (const e of group) {
				// mark-Modus: Kante mit gelöschtem Endpunkt nur als Kommentar, sonst legte mermaid
				// den Endpunkt neu an; der Fehler bleibt über danglingEdges sichtbar (O-12).
				if (movedEdges.has(e.id)) continue;
				if (!keep) canon(depth, dangling(e) ? `%% ${edgeLine(e)}` : edgeLine(e));
				if (!dangling(e)) emitted.push({ edge: e, clean: keep });
			}
		} else if (box) {
			opened.add(id);
			emitContainer(box, depth);
		} else if (raw) {
			const u = rawUnit.get(id)!;
			if (u.st.kind === 'linkStyle') {
				linkUnits.push(u.st);
				parts.push({ text: raw.rawText, link: true });
			} else source(u.text, !u.dropped);
		} else if (comments.has(id)) source(comments.get(id)!.text, true);
		else if (id.startsWith('classDef:')) {
			const cd = doc.classDefs.find((c) => `classDef:${c.name}` === id);
			if (cd?.sourceText) source(cd.sourceText, true);
			else if (cd) canon(depth, `classDef ${cd.name} ${styleText(cd.style)}`);
		}
	};
	const emitAll = (ids: string[], depth: number, parent: string | null) =>
		ids.forEach((id) => emit(id, depth, parent));
	const movedTo = new Map<string | null, DiagramEdge[]>();
	for (const e of doc.edges)
		if (movedEdges.has(e.id)) {
			const box = movedEdges.get(e.id)!;
			if (movedTo.has(box)) movedTo.get(box)!.push(e);
			else movedTo.set(box, [e]);
		}
	const emitMoved = (box: string | null, depth: number) => {
		for (const n of shadows.get(box) ?? [])
			if (!placed.has(n.id)) {
				placed.add(n.id);
				for (const line of nodeLines(n)) canon(depth, line);
			}
		for (const e of movedTo.get(box) ?? []) {
			canon(depth, edgeLine(e));
			emitted.push({ edge: e, clean: false });
		}
	};

	let boxes = 0;
	function emitContainer(c: Container, depth: number) {
		const slot = parts.push({ text: '' }) - 1;
		const members = c.sections.flatMap((s) => s.memberIds);
		const dirText = c.props.dirText;
		const dirSt = typeof dirText === 'string' ? classify(contentOf(dirText)) : null;
		const reuse = dirSt?.kind === 'direction' && dirSt.direction === c.direction;
		const index = Number(c.props.dirIndex);
		const at = reuse && Number.isInteger(index) && index <= members.length ? index : 0;
		emitAll(members.slice(0, at), depth + 1, c.id);
		if (reuse) source(dirText as string, true);
		else if (c.direction) canon(depth + 1, `direction ${c.direction}`);
		emitAll(members.slice(at), depth + 1, c.id);
		emitAll(extras.get(c.id) ?? [], depth + 1, c.id);
		emitMoved(c.id, depth + 1);
		const head = containerHead(c, boxes++);
		parts[slot] = {
			text: head === c.props.openText ? head : indent.repeat(depth) + head + eol
		};
		const end = c.props.endText;
		if (typeof end === 'string' && contentOf(end) === 'end') source(end, true);
		else canon(depth, 'end');
	}

	emitAll(doc.order, 1, null);
	emitAll(extras.get(null) ?? [], 1, null);
	emitMoved(null, 1);
	for (const u of appended) if (!u.dropped) canon(1, u.text);

	const keepLinks = linkStylesHold(linkUnits, emitted, doc.header.parsedEdgeIds ?? []);
	if (!keepLinks)
		emitted.forEach(({ edge }, i) => {
			if (Object.keys(edge.style).length > 0) canon(1, `linkStyle ${i} ${styleText(edge.style)}`);
		});

	let out = doc.header.frontmatter + doc.header.directives.join('');
	// Prüfungen am zuletzt angehängten Stück: `endsWith` auf `out` flachte den Text je Teil ab (quadratisch).
	let last = out;
	const add = (text: string) => {
		out += text;
		last = text;
	};
	const open = () => last !== '' && !last.endsWith('\n');
	for (const p of parts) {
		if (p.link && !keepLinks) {
			if (p.text.endsWith('\n') && open()) add(eol);
			continue;
		}
		if (p.soft) {
			if (open()) add(eol);
			continue;
		}
		if (p.text === '') continue;
		// Nach `;` darf nur eine Anweisung folgen; ein Kommentar braucht eine eigene Zeile.
		if (open() && (p.own || !last.endsWith(';') || COMMENT.test(p.text))) add(eol);
		add(p.text);
	}
	return out;
}

/** Ergeben die numerischen linkStyle-Zeilen genau die Styles der Kanten in Ausgabe-Reihenfolge? */
function linkStylesHold(
	links: Extract<Stmt, { kind: 'linkStyle' }>[],
	emitted: { edge: DiagramEdge; clean: boolean }[],
	parsed: string[]
): boolean {
	const edges = emitted.map((e) => e.edge);
	// Indizes jenseits der Modellkanten (Kanten in RawBlocks) nur bei unveränderter Kantenfolge.
	const untouched =
		parsed.length === edges.length &&
		emitted.every(({ edge, clean }, i) => clean && parsed[i] === edge.id);
	const styles: StyleMap[] = edges.map(() => ({}));
	for (const st of links)
		for (const i of st.indices) {
			if (i < edges.length) Object.assign(styles[i], st.style);
			else if (!untouched || edges.length === 0) return false;
		}
	return edges.every((e, i) => sameStyle(e.style, styles[i]));
}

/** Einrückungs-Einheit der Quelle: erster Einzug einer Zeile gegenüber ihrer Ebene; rückt die Quelle nie ein, keiner; ohne Anhalt vier Leerzeichen. */
function indentOf(
	order: string[],
	containers: Map<string, Container>,
	textOf: (id: string) => string | undefined
): string {
	let lines = 0;
	const seen = new Set<string>();
	const walk = (ids: string[], base: string, prev: string): string | null => {
		for (const id of ids) {
			// Weitere Nennungen einer Container-ID meinen den gleichnamigen Knoten (kein Zyklus).
			const box = seen.has(id) ? undefined : containers.get(id);
			if (box) seen.add(id);
			const first = box ? box.props.openText : textOf(id);
			if (typeof first !== 'string' || first === '') continue;
			const ws = LEAD_WS.exec(first)![0];
			if (prev.endsWith('\n') && ws.length > base.length && ws.startsWith(base))
				return ws.slice(base.length);
			if (prev.endsWith('\n') && first.endsWith('\n')) lines++;
			if (box) {
				const inner = walk(
					box.sections.flatMap((s) => s.memberIds),
					ws,
					first
				);
				if (inner) return inner;
			}
			const last = box ? box.props.endText : first;
			prev = typeof last === 'string' ? last : '';
		}
		return null;
	};
	// Ganze Zeilen über die Deklaration hinaus, alle ohne Einzug: die Quelle rückt nicht ein.
	return walk(order, '', '\n') ?? (lines > 1 ? '' : INDENT);
}

/**
 * Text der eigenständigen Knoten-Anweisung: `sourceText`, nach einer Änderung `props.stmtText`
 * (Parser), solange der Knoten im Container des Parsens steht (sonst Einzug des alten Containers,
 * O-102). Eine Kopie (`duplicateNodes`) erbt `stmtText` des Originals; die Anweisung nennt nur das
 * Original, die Kopie hat darin keine Nennung und wird kanonisch geschrieben.
 */
function stmtOf(n: DiagramNode): string {
	if (n.sourceText) return n.sourceText;
	const text = n.props.stmtText;
	return typeof text === 'string' && n.props.stmtParent === n.parentId ? text : '';
}

/** Form, Label, Klassen, Style und click, die die nicht entfallenen Anweisungen ergeben. */
function provided(units: Unit[], id: string) {
	// `units` sind die Anweisungen, die den Knoten erwähnen (Index je Knoten-ID).
	let shape = 'default';
	let label = id;
	const classes = new Set<string>();
	const style: StyleMap = {};
	let click: unknown = undefined;
	for (const { st, dropped } of units) {
		if (dropped) continue;
		if (st.kind === 'graph')
			for (const ref of st.groups.flat()) {
				if (ref.id !== id) continue;
				if (ref.shape !== null) [shape, label] = [ref.shape, ref.label ?? label];
				ref.classes.forEach((c) => classes.add(c));
			}
		else if (st.kind === 'class' && st.ids.includes(id)) classes.add(st.cls);
		else if (st.kind === 'style' && st.id === id) Object.assign(style, st.style);
		else if (st.kind === 'click' && st.id === id) click = st.text;
	}
	return { shape, label, classes, style, click };
}

/** Ergeben die nicht entfallenen Anweisungen Form, Label, Klassen, Style und click des Knotens? */
function provides(units: Unit[], n: DiagramNode): boolean {
	const p = provided(units, n.id);
	return (
		p.shape === n.shape &&
		p.label === n.label &&
		p.classes.size === new Set(n.cssClasses).size &&
		n.cssClasses.every((c) => p.classes.has(c)) &&
		sameStyle(p.style, n.style) &&
		p.click === n.props.click
	);
}

/** Setzt den Text einer Anweisung neu (Klassifikation folgt); `refs` bleiben gleich. */
function retext(u: Unit, text: string): void {
	u.text = text;
	u.st = classify(contentOf(text));
	u.use = nodeUse(u.st);
}

/** Ersetzt in `u.text` die Quelltext-Bereiche der Inhalts-Spannen `spans` durch `token`. */
function replaceSpans(u: Unit, spans: [number, number][], token: string): string {
	let text = u.text;
	const ranges = spans.map(([a, b]) => sourceSpan(u.text, a, b)).sort((x, y) => y[0] - x[0]);
	// Nach `@{...}` kein Leerraum vor `;` (mermaid: Parse-Fehler); Raute/Sechseck bleiben.
	const after = (rest: string) => (token.includes('@{') ? rest.replace(/^[ \t]+(?=;)/, '') : rest);
	for (const [a, b] of ranges) text = text.slice(0, a) + token + after(text.slice(b));
	return text;
}

const bracketsOf = (shape: string | null) => SHAPES.find(([, , name]) => name === shape);

/**
 * Nur Formänderung (O-102): tauscht in den Nennungen `refs` nur Öffner und Schließer, damit
 * Label-Text samt `%%`-Zeilen bleibt. `null`, wenn eine Nennung ein anderes Label trägt oder
 * die getauschten Klammern nicht genau Form und Label von `n` ergeben (Rückfall ganzes Token).
 */
function swapBrackets(u: Unit, refs: NodeRef[], n: DiagramNode): string | null {
	const next = bracketsOf(n.shape);
	if (!next || refs.some((r) => r.label !== n.label || !bracketsOf(r.shape))) return null;
	const ranges: [[number, number], string][] = [];
	for (const r of refs) {
		const [open, close] = bracketsOf(r.shape)!;
		const [a, b] = r.span!;
		const from = a + r.id.length;
		ranges.push([sourceSpan(u.text, from, from + open.length), next[0]]);
		ranges.push([sourceSpan(u.text, b - close.length, b), next[1]]);
	}
	let text = u.text;
	for (const [[a, b], token] of ranges.sort((x, y) => y[0][0] - x[0][0]))
		text = text.slice(0, a) + token + text.slice(b);
	const st = classify(contentOf(text));
	const got =
		st.kind === 'graph' ? st.groups.flat().filter((r) => r.id === n.id && r.shape !== null) : [];
	return got.length === refs.length && got.every((r) => r.shape === n.shape && r.label === n.label)
		? text
		: null;
}

/** Ersetzt den Inhalt einer Zeilen-Anweisung (`style`, `click`); Einrückung, `;`, Zeilenende bleiben. */
const replaceContent = (u: Unit, content: string) =>
	replaceSpans(u, [[0, contentOf(u.text).length]], content);

/**
 * Edit in place (V-12): Form/Label im Knoten-Token jeder formgebenden Nennung (gibt es keine,
 * in der ersten Nennung), eine vorhandene einzelne `style`-/`click`-Zeile ersetzt, sonst je eine
 * Zeile (`class`, `style`, `click`) angehängt. Ergibt das Ergebnis den Knoten, liefert die
 * Funktion die anzuhängenden Anweisungen; sonst bleiben alle Texte unverändert und sie liefert
 * `null` (Rückfall: Fixpunkt schreibt kanonisch). Entfernte Klassen, geleerter Style und mehrere
 * `style`-/`click`-Zeilen gehen immer in den Rückfall.
 */
function patchInPlace(n: DiagramNode, list: Unit[]): Unit[] | null {
	const live = list.filter((u) => !u.dropped);
	const refsOf = (u: Unit, shaped: boolean): NodeRef[] =>
		u.st.kind === 'graph'
			? u.st.groups.flat().filter((r) => r.id === n.id && r.span && (!shaped || r.shape !== null))
			: [];
	// Ohne Nennung in einer Graph-Anweisung (neuer Knoten) fiele der Knoten aus der Ausgabe.
	const first = live.find((u) => refsOf(u, false).length > 0);
	if (!first) return null;
	const has = provided(live, n.id);
	const styles = live.filter((u) => u.st.kind === 'style' && u.st.id === n.id);
	const clicks = live.filter((u) => u.st.kind === 'click' && u.st.id === n.id);
	const restyle = !sameStyle(has.style, n.style);
	const reclick = has.click !== n.props.click;
	if (
		[...has.classes].some((c) => !n.cssClasses.includes(c)) ||
		(restyle && (Object.keys(n.style).length === 0 || styles.length > 1)) ||
		(reclick && (typeof n.props.click !== 'string' || clicks.length > 1))
	)
		return null;

	const before = live.map((u) => u.text);
	const extra: Unit[] = [];
	const line = (text: string) => {
		const st = classify(text);
		extra.push({ text, st, use: nodeUse(st), dropped: false, marked: false });
	};
	if (has.shape !== n.shape || has.label !== n.label) {
		const shaped = live.map((u) => [u, refsOf(u, true)] as const).filter(([, r]) => r.length > 0);
		const targets =
			shaped.length > 0 ? shaped : [[first, refsOf(first, false).slice(0, 1)] as const];
		for (const [u, refs] of targets)
			retext(
				u,
				swapBrackets(u, refs, n) ??
					replaceSpans(
						u,
						refs.map((r) => r.span!),
						nodeToken(n)
					)
			);
	}
	for (const c of new Set(n.cssClasses)) if (!has.classes.has(c)) line(`class ${n.id} ${c}`);
	if (restyle) {
		const text = `style ${n.id} ${styleText(n.style)}`;
		if (styles.length === 1) retext(styles[0], replaceContent(styles[0], text));
		else line(text);
	}
	if (reclick) {
		const text = n.props.click as string;
		if (clicks.length === 1) retext(clicks[0], replaceContent(clicks[0], text));
		else line(text);
	}
	if (provides([...live, ...extra], n)) return extra;
	live.forEach((u, i) => {
		if (u.text !== before[i]) retext(u, before[i]);
	});
	return null;
}
