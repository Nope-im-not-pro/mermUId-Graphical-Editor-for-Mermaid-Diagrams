/**
 * Flowchart-Parser: eigener Zeilen-Mapper (O-15), Text -> DiagramDocument.
 * Jedes Anweisungs-Stück wird genau ein Element in `order` bzw. `memberIds`; die Stücke
 * zerlegen den Text lückenlos, damit der Serializer unverändert byte-gleich ausgeben kann.
 */
import { msg } from '../../i18n';
import { initCounters, nextId, type IdCounters, type IdPrefix } from '../../../model/ids';
import type {
	Container,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	ParseResult
} from '../../../model/types';
import {
	META_SHAPES,
	classify,
	splitLines,
	splitPieces,
	type NodeRef,
	type Piece,
	type Stmt
} from './syntax';

class SyntaxFailure extends Error {
	constructor(
		readonly line: number,
		message: string
	) {
		super(message);
	}
}

interface HeaderPart {
	frontmatter: string;
	directives: string[];
	title: string;
	body: string;
	bodyLine: number;
}

function readHeader(text: string): HeaderPart {
	const lines = splitLines(text);
	let i = 0;
	let frontmatter = '';
	let title = '';
	if (lines[0]?.trim() === '---') {
		const close = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
		if (close < 0) throw new SyntaxFailure(1, msg('services.syntax.frontmatterUnclosed'));
		frontmatter = lines.slice(0, close + 1).join('');
		const m = /^title:\s*(.*?)\s*$/m.exec(lines.slice(1, close).join(''));
		if (m) title = m[1].replace(/^"(.*)"$/, '$1');
		i = close + 1;
	}
	const directives: string[] = [];
	while (i < lines.length && /^%%\{.*\}%%$/.test(lines[i].trim())) directives.push(lines[i++]);
	return { frontmatter, directives, title, body: lines.slice(i).join(''), bodyLine: i + 1 };
}

function emptyDoc(header: HeaderPart): DiagramDocument {
	return {
		id: 'doc',
		diagramType: 'flowchart',
		title: header.title,
		header: { frontmatter: header.frontmatter, directives: [...header.directives] },
		order: [],
		nodes: [],
		edges: [],
		containers: [],
		classDefs: [],
		rawBlocks: [],
		comments: [],
		layout: { mode: 'auto', engine: 'dagre', positions: {}, gridSize: 8, snap: false },
		modelVersion: 0
	};
}

type Gen = (prefix: IdPrefix) => string;

/** Offener Subgraph; ID und Knoten-Zuordnung entstehen erst beim `end` (mermaid addSubGraph). */
interface Frame {
	box: Container;
	line: number;
	/** In direkten Anweisungen genannte Knoten-IDs (Kandidaten für makeUniq). */
	mentioned: Set<string>;
	/** Elemente mit `parentId` dieses Rahmens, die beim Schließen die endgültige ID erhalten. */
	kids: { parentId: string | null }[];
	slot: { list: string[]; index: number };
}

class Builder {
	private readonly nodes = new Map<string, DiagramNode>();
	private readonly ordered = new Set<string>();
	private readonly stack: Frame[] = [];
	/** Knoten, die ein bereits geschlossener Subgraph beansprucht hat (makeUniq). */
	private readonly claimed = new Set<string>();
	/** class/style/click/linkStyle wirken erst nach dem letzten Stück (Vorwärts-Referenzen). */
	private readonly deferred: Stmt[] = [];
	private subgraphs = 0;
	private declSeen = false;

	constructor(
		private readonly doc: DiagramDocument,
		private readonly gen: Gen,
		/** IDs aller Subgraphen der Quelle; `@{}` darauf hängt mermaid an den Subgraphen. */
		private readonly subgraphIds: Set<string>
	) {}

	private get parent(): Container | null {
		return this.stack.at(-1)?.box ?? null;
	}

	private push(id: string): void {
		const parent = this.parent;
		if (parent) parent.sections[0].memberIds.push(id);
		else this.doc.order.push(id);
	}

	private raw(piece: Piece): void {
		const id = this.gen('c');
		this.doc.rawBlocks.push({ id, rawText: piece.text });
		this.push(id);
	}

	private touch(ref: NodeRef): DiagramNode {
		let n = this.nodes.get(ref.id);
		if (!n) {
			n = {
				id: ref.id,
				kind: 'node',
				label: ref.label ?? ref.id,
				shape: ref.shape ?? 'default',
				cssClasses: [],
				style: {},
				props: {},
				parentId: null,
				sourceText: ref.text
			};
			this.nodes.set(ref.id, n);
			this.doc.nodes.push(n);
		} else if (ref.shape !== null) {
			n.shape = ref.shape;
			n.label = ref.label ?? n.label;
		}
		for (const cls of ref.classes) if (!n.cssClasses.includes(cls)) n.cssClasses.push(cls);
		this.stack.at(-1)?.mentioned.add(ref.id);
		return n;
	}

	private graph(st: Extract<Stmt, { kind: 'graph' }>, piece: Piece): void {
		const onSubgraph = (r: NodeRef) =>
			r.shape !== null && Object.hasOwn(META_SHAPES, r.shape) && this.subgraphIds.has(r.id);
		if (st.groups.flat().some(onSubgraph)) {
			// Weitere Knoten der Anweisung legt mermaid an; ohne sie hätte der RawBlock unbekannte Refs.
			for (const r of st.groups.flat()) if (!this.subgraphIds.has(r.id)) this.touch(r);
			return this.raw(piece);
		}
		const refs = st.groups.map((g) => g.map((r) => this.touch(r)));
		if (st.links.length === 0) {
			const n = refs[0][0];
			if (refs[0].length === 1 && !this.ordered.has(n.id)) {
				n.sourceText = piece.text;
				// Bleibt nach einer Änderung (leeres `sourceText`) für den Edit in place (V-12).
				n.props.stmtText = piece.text;
				this.ordered.add(n.id);
				this.push(n.id);
			} else this.raw(piece);
			return;
		}
		let leader: DiagramEdge | null = null;
		st.links.forEach((link, i) => {
			for (const s of refs[i])
				for (const t of refs[i + 1]) {
					const explicit = leader === null && link.explicitId !== null;
					const edge: DiagramEdge = {
						id: explicit ? link.explicitId! : this.gen('e'),
						kind: 'edge',
						sourceId: s.id,
						targetId: t.id,
						label: link.label,
						lineStyle: link.lineStyle,
						arrowHead: link.arrowHead,
						style: {},
						props: {},
						parentId: this.parent?.id ?? null,
						sourceText: piece.text
					};
					if (link.length > 1) edge.props.length = link.length;
					if (explicit) edge.props.explicitId = true;
					this.stack.at(-1)?.kids.push(edge);
					if (leader) edge.props.stmt = leader.id;
					else leader = edge;
					this.push(edge.id);
					this.doc.edges.push(edge);
				}
		});
	}

	add(piece: Piece): void {
		const st = classify(piece.content);
		if (!this.declSeen) {
			if (st.kind === 'decl') this.declSeen = true;
			else if (st.kind === 'comment') return this.comment(piece);
			else if (st.kind !== 'blank' && st.kind !== 'directive')
				throw new SyntaxFailure(piece.line, msg('services.syntax.expectedFlowchart'));
			return this.raw(piece);
		}
		switch (st.kind) {
			case 'comment':
				return this.comment(piece);
			case 'graph':
				return this.graph(st, piece);
			case 'subgraph':
				return this.open(st, piece);
			case 'end':
				return this.close(piece);
			case 'direction': {
				const parent = this.parent;
				if (!parent) return this.raw(piece);
				parent.direction = st.direction;
				parent.props.dirText = piece.text;
				parent.props.dirIndex = parent.sections[0].memberIds.length;
				return;
			}
			case 'classDef':
				if (st.names.length !== 1 || this.doc.classDefs.some((c) => c.name === st.names[0]))
					return this.raw(piece);
				this.doc.classDefs.push({ name: st.names[0], style: st.style, sourceText: piece.text });
				return this.push(`classDef:${st.names[0]}`);
			case 'class':
			case 'style':
			case 'click':
			case 'linkStyle':
				this.deferred.push(st);
				return this.raw(piece);
			default:
				return this.raw(piece);
		}
	}

	private comment(piece: Piece): void {
		const id = this.gen('c');
		this.doc.comments.push({ id, text: piece.text });
		this.push(id);
	}

	private open(st: Extract<Stmt, { kind: 'subgraph' }>, piece: Piece): void {
		const outer = this.stack.at(-1);
		const box: Container = {
			id: st.id ?? `\u0000sg${this.stack.length}`,
			kind: 'subgraph',
			label: st.label,
			direction: '',
			parentId: outer?.box.id ?? null,
			sections: [{ label: '', memberIds: [] }],
			props: { openText: piece.text },
			sourceText: piece.text
		};
		const list = outer ? outer.box.sections[0].memberIds : this.doc.order;
		this.push(box.id);
		this.doc.containers.push(box);
		outer?.kids.push(box);
		this.stack.push({
			box,
			line: piece.line,
			mentioned: new Set(),
			kids: [],
			slot: { list, index: list.length - 1 }
		});
	}

	/** mermaid: unbenannte Subgraphen zählen in Schließreihenfolge, erster Schließer beansprucht Knoten. */
	private close(piece: Piece): void {
		const top = this.stack.pop();
		if (!top) return this.raw(piece);
		const { box } = top;
		box.props.endText = piece.text;
		if (box.id.startsWith('\u0000')) box.id = `subGraph${this.subgraphs}`;
		this.subgraphs++;
		top.slot.list[top.slot.index] = box.id;
		for (const kid of top.kids) kid.parentId = box.id;
		for (const id of top.mentioned) {
			const n = this.nodes.get(id);
			if (!n || this.claimed.has(id)) continue;
			this.claimed.add(id);
			n.parentId = box.id;
		}
	}

	finish(lastLine: number): void {
		if (!this.declSeen) throw new SyntaxFailure(lastLine, msg('services.syntax.expectedFlowchart'));
		const open = this.stack.at(-1);
		if (open)
			throw new SyntaxFailure(
				open.line,
				msg('services.syntax.subgraphOpen', { label: open.box.label })
			);
		// Kantenfolge beim Parsen: Serializer erkennt daran eine unveränderte Kantenfolge (linkStyle).
		this.doc.header.parsedEdgeIds = this.doc.edges.map((e) => e.id);
		// Container beim Parsen: nach einem Container-Wechsel gilt `stmtText` nicht mehr (O-102).
		for (const n of this.ordered) {
			const node = this.nodes.get(n)!;
			node.props.stmtParent = node.parentId;
		}
		for (const st of this.deferred) {
			if (st.kind === 'linkStyle') {
				for (const i of st.indices) Object.assign(this.doc.edges[i]?.style ?? {}, st.style);
				continue;
			}
			const ids = st.kind === 'class' ? st.ids : [(st as { id: string }).id];
			// `style X` legt X wie in mermaid (addVertex) an, class/click nicht.
			if (
				st.kind === 'style' &&
				!this.nodes.has(st.id) &&
				!this.doc.containers.some((c) => c.id === st.id)
			)
				this.touch({ id: st.id, shape: null, label: null, classes: [], text: st.id });
			for (const n of ids.map((id) => this.nodes.get(id))) {
				if (!n) continue;
				if (st.kind === 'class' && !n.cssClasses.includes(st.cls)) n.cssClasses.push(st.cls);
				if (st.kind === 'style') Object.assign(n.style, st.style);
				if (st.kind === 'click') n.props.click = st.text;
			}
		}
	}
}

function build(header: HeaderPart, gen: Gen): DiagramDocument {
	const doc = emptyDoc(header);
	const pieces = splitPieces(header.body, header.bodyLine);
	// Ohne ID vergibt mermaid `subGraph<N>` (N über alle Subgraphen in Schließreihenfolge).
	const ids = new Set<string>();
	const open: (string | null)[] = [];
	let closed = 0;
	for (const st of pieces.map((p) => classify(p.content))) {
		if (st.kind === 'subgraph') open.push(st.id);
		else if (st.kind === 'end' && open.length > 0) {
			ids.add(open.pop() ?? `subGraph${closed}`);
			closed++;
		}
	}
	const builder = new Builder(doc, gen, ids);
	for (const piece of pieces) builder.add(piece);
	builder.finish(pieces.at(-1)?.line ?? header.bodyLine);
	return doc;
}

export function parse(text: string): ParseResult {
	try {
		const header = readHeader(text);
		let k = 0;
		const draft = build(header, () => `\u0000${k++}`);
		let counters: IdCounters = initCounters(draft);
		const doc = build(header, (prefix) => {
			const next = nextId(counters, prefix);
			counters = next.counters;
			return next.id;
		});
		return { ok: true, doc };
	} catch (e) {
		if (!(e instanceof SyntaxFailure)) throw e;
		return { ok: false, errors: [{ line: e.line, column: 1, message: e.message }] };
	}
}
