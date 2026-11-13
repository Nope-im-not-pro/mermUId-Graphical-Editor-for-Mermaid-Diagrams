/**
 * Synchroner Zeilen-Parser für Sequence-Diagramme (O-15). Bekannte Statements werden zu
 * Modell-Elementen mit Rohtext in `sourceText`, alles andere zu `RawBlock`. Leerzeilen gehen als
 * Präfix in das folgende Statement, am Dateiende an das letzte (Byte-Erhalt im Roundtrip).
 */
import { msg as i18n } from '../../i18n';
import { initCounters, nextId, type IdCounters, type IdPrefix } from '../../../model/ids';
import type {
	Container,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	ParseError,
	ParseResult
} from '../../../model/types';
import {
	arrowStyle,
	boxHead,
	declaration,
	decodeLabel,
	ENTITY,
	lifecycleLine,
	matchMessage,
	messageText,
	MAX_LINE,
	rawUses,
	RE,
	SECTION_KEYWORD,
	statementText,
	TYPE_KEYWORD,
	type Lifecycle
} from './syntax';

interface Line {
	/** Zeile ohne Zeilenende. */
	text: string;
	/** Zeile mit Zeilenende. */
	raw: string;
	/** 1-basierte Zeilennummer. */
	no: number;
}

class SyntaxFailure extends Error {
	constructor(
		readonly line: number,
		message: string
	) {
		super(message);
	}
}

function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	const re = /([^\n]*?)(\r?\n|$)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) && m[0] !== '') {
		lines.push({ text: m[1], raw: m[0], no: lines.length + 1 });
	}
	return lines;
}

interface HeaderPart {
	frontmatter: string;
	directives: string[];
	typeSegment: string;
	bodyStart: number;
}

function readHeader(lines: Line[]): HeaderPart {
	let i = 0;
	let frontmatter = '';
	if (lines[0]?.text.trim() === '---') {
		const close = lines.findIndex((l, k) => k > 0 && l.text.trim() === '---');
		if (close < 0) throw new SyntaxFailure(1, i18n('services.syntax.frontmatterOpen'));
		frontmatter = lines
			.slice(0, close + 1)
			.map((l) => l.raw)
			.join('');
		i = close + 1;
	}
	const directives: string[] = [];
	let trivia = '';
	for (; i < lines.length; i++) {
		const line = lines[i];
		if (RE.directiveStart.test(line.text)) {
			const end = findFrom(lines, i, (l) => RE.directiveEnd.test(l.text));
			if (end < 0) throw new SyntaxFailure(line.no, i18n('services.syntax.directiveOpen'));
			directives.push(trivia + take(lines, i, end));
			trivia = '';
			i = end;
		} else if (line.text.trim() === '' || RE.comment.test(line.text)) {
			trivia += line.raw;
		} else if (RE.typeLine.test(line.text)) {
			return { frontmatter, directives, typeSegment: trivia + line.raw, bodyStart: i + 1 };
		} else {
			break;
		}
	}
	throw new SyntaxFailure(1, i18n('services.syntax.typeLineMissing', { keyword: TYPE_KEYWORD }));
}

/** Erste Zeile ab `from`, die `test` erfüllt, sonst -1 (Suche ab `from`, V-29: nicht ab 0). */
function findFrom(lines: Line[], from: number, test: (line: Line) => boolean): number {
	for (let k = from; k < lines.length; k++) if (test(lines[k])) return k;
	return -1;
}

function take(lines: Line[], from: number, to: number): string {
	return lines
		.slice(from, to + 1)
		.map((l) => l.raw)
		.join('');
}

type IdGen = (prefix: IdPrefix) => string;

/** Baut den Rumpf auf; `gen` liefert IDs (Durchlauf 1 Platzhalter, Durchlauf 2 über ids.ts). */
function buildBody(lines: Line[], start: number, doc: DiagramDocument, gen: IdGen): string {
	const nodes = new Map<string, DiagramNode>();
	/** Teilnehmer, die mermaid schon angelegt hat (Nachricht, Notiz, Deklaration; nicht `activate`). */
	const met = new Set<string>();
	const stack: Container[] = [];
	let trivia = '';
	let last: { obj: Record<string, unknown>; key: string } | null = null;
	/** `create`/`destroy` direkt vor der nächsten Nachricht (T135 C3), samt Rohtext. */
	let held: (Lifecycle & { seg: string }) | null = null;

	const parentId = () => stack[stack.length - 1]?.id ?? null;
	const emit = (id: string) => {
		const top = stack[stack.length - 1];
		if (top) top.sections[top.sections.length - 1].memberIds.push(id);
		else doc.order.push(id);
	};
	const ensure = (id: string) => {
		if (nodes.has(id)) return;
		const node = participant(id, 'participant', id, null, '');
		node.props = { implicit: true };
		nodes.set(id, node);
		doc.nodes.push(node);
	};
	const raw = (text: string) => {
		const block = { id: gen('n'), rawText: text };
		doc.rawBlocks.push(block);
		emit(block.id);
		last = { obj: block, key: 'rawText' };
		// Wie mermaid: Nennungen im RawBlock legen Teilnehmer an; eine Deklaration setzt Typ und
		// Label nur bei Erstanlage oder mit Alias. `base` hält den Stand für den Serializer.
		for (const use of rawUses(text)) {
			ensure(use.id);
			const node = nodes.get(use.id)!;
			if (use.kind && node.props.implicit && (!met.has(use.id) || use.label !== undefined)) {
				const label = use.label ?? (met.has(use.id) ? node.label : use.id);
				Object.assign(node, { kind: use.kind, shape: use.kind, label });
				node.props = { implicit: true, base: { kind: use.kind, label } };
			}
			met.add(use.id);
		}
	};

	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		const text = line.text.trim();
		const long = text.length > MAX_LINE;
		if (text === '') {
			trivia += line.raw;
			continue;
		}
		let seg = trivia + line.raw;
		trivia = '';

		if (RE.directiveStart.test(text)) {
			let end = findFrom(lines, i, (l) => RE.directiveEnd.test(l.text));
			if (end < 0) end = lines.length - 1;
			raw(seg + take(lines, i + 1, end));
			i = end;
			continue;
		}
		if (RE.comment.test(text)) {
			const comment = { id: gen('n'), text: seg };
			doc.comments.push(comment);
			emit(comment.id);
			last = { obj: comment, key: 'text' };
			continue;
		}
		if (RE.accDescrBlock.test(text) && !text.includes('}')) {
			let end = findFrom(lines, i + 1, (l) => l.text.includes('}'));
			if (end < 0) end = lines.length - 1;
			seg += take(lines, i + 1, end);
			i = end;
			raw(seg);
			continue;
		}

		const a = long ? null : RE.activation.exec(text);
		if (a) {
			const id = a[2];
			ensure(id);
			const edge = message(gen('e'), a[1].toLowerCase(), id, id, '', ['', ''], {}, parentId(), seg);
			doc.edges.push(edge);
			emit(edge.id);
			last = { obj: edge as unknown as Record<string, unknown>, key: 'sourceText' };
			continue;
		}

		const b = RE.block.exec(text);
		if (b) {
			const label = decodeLabel(b[2] ?? '');
			const container: Container = {
				id: gen('c'),
				kind: b[1].toLowerCase(),
				label,
				direction: '',
				parentId: parentId(),
				sections: [{ label, memberIds: [] }],
				props: { sourceSections: [], sourceEnd: '' },
				sourceText: seg
			};
			doc.containers.push(container);
			emit(container.id);
			stack.push(container);
			last = { obj: container as unknown as Record<string, unknown>, key: 'sourceText' };
			continue;
		}

		const s = RE.section.exec(text);
		if (s) {
			const top = stack[stack.length - 1];
			const keyword = s[1].toLowerCase();
			if (!top || SECTION_KEYWORD[top.kind] !== keyword)
				throw new SyntaxFailure(line.no, i18n('services.syntax.outsideBlock', { keyword }));
			top.sections.push({ label: decodeLabel(s[2] ?? ''), memberIds: [] });
			const raws = top.props.sourceSections as string[];
			raws.push(seg);
			last = { obj: raws as unknown as Record<string, unknown>, key: String(raws.length - 1) };
			continue;
		}

		if (RE.end.test(text)) {
			const top = stack.pop();
			if (!top) throw new SyntaxFailure(line.no, i18n('services.syntax.endWithoutBlock'));
			top.props.sourceEnd = seg;
			last = { obj: top.props, key: 'sourceEnd' };
			continue;
		}

		const box = long || stack.length > 0 ? null : boxHead(text);
		if (box && boxMembers(lines, i, nodes)) {
			const { color, label, wrap } = box;
			const container: Container = {
				id: gen('c'),
				kind: 'box',
				label,
				direction: '',
				parentId: null,
				sections: [{ label, memberIds: [] }],
				props: { sourceSections: [], sourceEnd: '', color, ...wrapProp(wrap) },
				sourceText: seg
			};
			doc.containers.push(container);
			emit(container.id);
			stack.push(container);
			last = { obj: container as unknown as Record<string, unknown>, key: 'sourceText' };
			continue;
		}

		if (RE.rawBlock.test(text)) {
			let depth = 0;
			let end = i;
			for (; end < lines.length; end++) {
				if (RE.anyBlock.test(lines[end].text)) depth++;
				else if (RE.end.test(lines[end].text)) depth--;
				if (depth === 0) break;
			}
			if (end === lines.length)
				throw new SyntaxFailure(lines[lines.length - 1].no, i18n('services.syntax.blockOpen'));
			raw(seg + take(lines, i + 1, end));
			i = end;
			continue;
		}

		if (long) {
			raw(seg);
			continue;
		}

		// Wie mermaid-db: `create` gilt der nächsten Nachricht, deren Ziel er ist (vorher nicht
		// genannt), `destroy` der nächsten, die ihn nennt. Nur direkt davor (Leerzeilen) als Option.
		const life = lifecycleLine(text);
		const next = life && !lifecycleBefore(lines, i) && messageAfter(lines, i);
		if (
			life &&
			next &&
			(life.type === 'create'
				? next[3] === life.id && !met.has(life.id)
				: next[0] === life.id || next[3] === life.id)
		) {
			held = { ...life, seg };
			continue;
		}

		const p = RE.participant.exec(text);
		if (p) {
			// Wie mermaid: Alias nur ohne Leerraum im Namen.
			const decl = declaration(p[2]);
			const { id, tail } = decl;
			const alias = decl.label !== undefined;
			const label = decl.label ?? id;
			const known = nodes.get(id);
			// Wie mermaid: ohne Alias übernimmt ein schon vorhandener Teilnehmer den Typ nicht.
			const kind = !alias && known && met.has(id) ? known.kind : p[1].toLowerCase();
			if (
				!RE.name.test(id) ||
				tail.replace(ENTITY, '').includes(';') ||
				(known && !known.props.implicit)
			) {
				raw(seg);
				continue;
			}
			const node = known ?? participant(id, kind, label, parentId(), seg);
			Object.assign(node, {
				kind,
				shape: kind,
				label,
				props: {},
				parentId: parentId(),
				sourceText: seg
			});
			if (!known) {
				nodes.set(id, node);
				doc.nodes.push(node);
			}
			met.add(id);
			emit(id);
			last = { obj: node as unknown as Record<string, unknown>, key: 'sourceText' };
			continue;
		}

		// Wie mermaid: Text endet am ersten `#` oder `;` (außerhalb einer Entity); `null` bleibt roh.
		const stmt = statementText(text);
		const n = stmt === null ? null : RE.note.exec(stmt);
		if (n) {
			const participants = n[2].split(',').map((s) => s.trim());
			participants.forEach(ensure);
			participants.forEach((id) => met.add(id));
			const { label, wrap } = messageText(n[3]);
			const note: DiagramNode = {
				id: gen('n'),
				kind: 'note',
				label,
				shape: 'note',
				cssClasses: [],
				style: {},
				props: { placement: n[1].toLowerCase(), participants, ...wrapProp(wrap) },
				parentId: parentId(),
				sourceText: seg
			};
			doc.nodes.push(note);
			emit(note.id);
			last = { obj: note as unknown as Record<string, unknown>, key: 'sourceText' };
			continue;
		}

		// Wie mermaid: `title ...` ist immer Titel, auch in Nachrichtenform.
		const t = RE.title.exec(text);
		const msg = stmt === null || t ? null : matchMessage(stmt);
		if (msg) {
			const [from, arrow, activation, to, text] = msg;
			const { label, wrap } = messageText(text);
			const life = held;
			held = null;
			if (life?.type === 'create') {
				// Wie `raw`: die Deklaration legt den Teilnehmer an (vor dem Absender).
				ensure(to);
				const { kind, label: name } = life;
				Object.assign(nodes.get(to)!, { kind, shape: kind, label: name });
				nodes.get(to)!.props = { implicit: true, base: { kind, label: name } };
			}
			ensure(from);
			ensure(to);
			met.add(from).add(to);
			const edge = message(
				gen('e'),
				'message',
				from,
				to,
				label,
				arrowStyle(arrow),
				{ arrow, activation, ...wrapProp(wrap), ...lifecycleProps(life) },
				parentId(),
				seg
			);
			doc.edges.push(edge);
			emit(edge.id);
			last = { obj: edge as unknown as Record<string, unknown>, key: 'sourceText' };
			continue;
		}

		if (t) doc.title = t[1];
		raw(seg);
	}

	if (stack.length > 0)
		throw new SyntaxFailure(
			lines[lines.length - 1].no,
			i18n('services.syntax.blockKindOpen', { kind: stack[stack.length - 1].kind })
		);
	if (trivia) {
		const target = last as { obj: Record<string, unknown>; key: string } | null;
		if (!target) return trivia;
		target.obj[target.key] = String(target.obj[target.key]) + trivia;
	}
	return '';
}

/**
 * Rumpf einer `box` ab Zeile `from` (Kopf) bis zum ersten `end`: nur Leerzeilen, Kommentare
 * (ohne Direktive) und Deklarationen, die der Teilnehmer-Zweig von `buildBody` annimmt, je mit
 * neuem Teilnehmer (mermaid nimmt schon bekannte nicht in die Gruppe auf) ohne Doppel. Sonst
 * bleibt die Gruppe RawBlock (T135 C2).
 */
function boxMembers(lines: Line[], from: number, nodes: Map<string, DiagramNode>): boolean {
	const ids = new Set<string>();
	for (let k = from + 1; k < lines.length; k++) {
		const text = lines[k].text.trim();
		if (RE.end.test(text)) return true;
		if (text === '' || (RE.comment.test(text) && !RE.directiveStart.test(text))) continue;
		const p = text.length > MAX_LINE ? null : RE.participant.exec(text);
		if (!p) return false;
		const { id, tail } = declaration(p[2]);
		if (!RE.name.test(id) || tail.replace(ENTITY, '').includes(';')) return false;
		if (nodes.has(id) || ids.has(id)) return false;
		ids.add(id);
	}
	return false;
}

/**
 * Nachricht, die der Rumpf-Parser in der nächsten nicht leeren Zeile nach `from` liest (gleiche
 * Zweig-Reihenfolge wie `buildBody`), sonst `null`.
 */
function messageAfter(lines: Line[], from: number): ReturnType<typeof matchMessage> {
	const k = findFrom(lines, from + 1, (l) => l.text.trim() !== '');
	const text = k < 0 ? '' : lines[k].text.trim();
	if (!text || text.length > MAX_LINE) return null;
	const other = [
		RE.directiveStart,
		RE.comment,
		RE.accDescrBlock,
		RE.activation,
		RE.anyBlock,
		RE.section,
		RE.end,
		RE.participant,
		RE.title
	];
	if (other.some((re) => re.test(text)) || lifecycleLine(text)) return null;
	const stmt = statementText(text);
	return stmt === null || RE.note.test(stmt) ? null : matchMessage(stmt);
}

/** Vorige nicht leere Zeile ist `create`/`destroy` (beide vor einer Nachricht: RawBlock). */
function lifecycleBefore(lines: Line[], at: number): boolean {
	for (let k = at - 1; k >= 0; k--)
		if (lines[k].text.trim() !== '') return lifecycleLine(lines[k].text) !== null;
	return false;
}

/** Nachrichten-Option aus `create`/`destroy` samt Rohtext (T135 C3). */
function lifecycleProps(life: (Lifecycle & { seg: string }) | null): Record<string, unknown> {
	if (!life) return {};
	return life.type === 'create'
		? { create: life.id, sourceCreate: life.seg }
		: { destroy: life.id, sourceDestroy: life.seg };
}

/** `props.wrap` nur bei Umbruch-Schalter im Text. */
const wrapProp = (wrap: boolean | undefined) => (wrap === undefined ? {} : { wrap });

function message(
	id: string,
	kind: string,
	sourceId: string,
	targetId: string,
	label: string,
	[lineStyle, arrowHead]: [string, string],
	props: Record<string, unknown>,
	parentId: string | null,
	sourceText: string
): DiagramEdge {
	return {
		id,
		kind,
		sourceId,
		targetId,
		label,
		lineStyle,
		arrowHead,
		style: {},
		props,
		parentId,
		sourceText
	};
}

function participant(
	id: string,
	kind: string,
	label: string,
	parentId: string | null,
	sourceText: string
): DiagramNode {
	return {
		id,
		kind,
		label,
		shape: kind,
		cssClasses: [],
		style: {},
		props: {},
		parentId,
		sourceText
	};
}

function emptyDoc(header: HeaderPart): DiagramDocument {
	return {
		id: '',
		diagramType: 'sequence',
		title: '',
		header: { frontmatter: header.frontmatter, directives: [...header.directives] },
		order: [],
		nodes: [],
		edges: [],
		containers: [],
		classDefs: [],
		rawBlocks: [],
		comments: [],
		layout: { mode: 'auto', engine: 'sequence', positions: {}, gridSize: 8, snap: false },
		modelVersion: 0
	};
}

export function parse(text: string): ParseResult {
	try {
		const lines = splitLines(text);
		const header = readHeader(lines);

		let k = 0;
		const draft = emptyDoc(header);
		buildBody(lines, header.bodyStart, draft, () => `\u0000${k++}`);

		let counters: IdCounters = initCounters(draft);
		const doc = emptyDoc(header);
		const rest = buildBody(lines, header.bodyStart, doc, (prefix) => {
			const next = nextId(counters, prefix);
			counters = next.counters;
			return next.id;
		});

		const typeSegment = header.typeSegment + rest;
		if (typeSegment !== `${TYPE_KEYWORD}\n`) doc.header.directives.push(typeSegment);
		return { ok: true, doc };
	} catch (e) {
		if (!(e instanceof SyntaxFailure)) throw e;
		const error: ParseError = { line: e.line, column: 1, message: e.message };
		return { ok: false, errors: [error] };
	}
}
