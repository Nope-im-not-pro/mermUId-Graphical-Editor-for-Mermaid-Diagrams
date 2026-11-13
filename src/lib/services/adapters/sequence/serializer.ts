/**
 * Serializer: Reihenfolge ausschließlich aus `order` und `Section.memberIds`. Elemente mit
 * `sourceText` werden roh geschrieben, Elemente ohne `sourceText` kanonisch. Die Einrückung kommt
 * aus Geschwistern mit Rohtext, sonst 4 je Ebene. Geänderte implizite Teilnehmer werden vor ihrer
 * ersten Verwendung deklariert, zusammen mit den davor erstmals benutzten impliziten Teilnehmern
 * (mermaid ordnet Teilnehmer nach erstem Auftreten); steht davor ein später ausdrücklich
 * deklarierter Teilnehmer, direkt nach dieser Verwendung, dann immer mit Alias (mermaid übernimmt
 * den Typ eines vorhandenen Teilnehmers nur mit Beschreibung). Deklarationen in RawBlocks (`box`,
 * `create`) zählen als ausdrücklich; Nennungen in RawBlocks als Verwendung. Nachrichten-Optionen
 * `create`/`destroy` (T135 C3) stehen direkt vor ihrer Nachricht; `create` deklariert den Teilnehmer.
 */
import { msg } from '../../i18n';
import type {
	Comment,
	Container,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	RawBlock
} from '../../../model/types';
import {
	ALIASABLE,
	arrowToken,
	boxHeadLine,
	decodeLabel,
	detectEol,
	encodeLabel,
	isBoxColor,
	lifecycleLine,
	rawUses,
	RE,
	SECTION_KEYWORD,
	stageSafe,
	TYPE_KEYWORD,
	wrapPrefix
} from './syntax';

type Element =
	| { type: 'node'; el: DiagramNode }
	| { type: 'edge'; el: DiagramEdge }
	| { type: 'container'; el: Container }
	| { type: 'comment'; el: Comment }
	| { type: 'raw'; el: RawBlock };

const TYPE_SEGMENT = new RegExp(RE.typeLine.source, 'im');
const STEP = '    ';
const INDENT = /^([ \t]*)\S/m;
const LEADING_BLANK = /^(?:[ \t]*\r?\n)*/;

const indentOf = (text: string): string | undefined => INDENT.exec(text)?.[1];

/** Text nach `:` samt Umbruch-Schalter; mit `colon` (Vorstufe) Leerzeichen nach dem Schalter. */
const text = (wrap: unknown, label: string, colon: boolean) => {
	const prefix = wrapPrefix(wrap);
	return `${prefix && colon ? `${prefix} ` : prefix}${encodeLabel(label, colon)}`;
};

/** Deklaration; Alias auf Wunsch oder bei eigenem Label, nie für Namen außerhalb `ALIASABLE`. */
function nodeLine(node: DiagramNode, alias = false): string {
	if (node.kind === 'note') {
		const participants = (node.props.participants as string[] | undefined) ?? [];
		return stageSafe(
			(colon) =>
				`Note ${String(node.props.placement ?? 'over')} ${participants.join(',')}: ${text(node.props.wrap, node.label, colon)}`
		);
	}
	const keyword = node.kind === 'actor' ? 'actor' : 'participant';
	return (alias || (node.label && node.label !== node.id)) && ALIASABLE.test(node.id)
		? stageSafe((colon) => `${keyword} ${node.id} as ${encodeLabel(node.label || node.id, colon)}`)
		: `${keyword} ${node.id}`;
}

function edgeLine(edge: DiagramEdge): string {
	if (edge.kind === 'activate' || edge.kind === 'deactivate')
		return `${edge.kind} ${edge.sourceId}`;
	const arrow = arrowToken(edge.lineStyle, edge.arrowHead, edge.props.arrow);
	const activation = edge.props.activation === '+' || edge.props.activation === '-';
	// Vor `-` ein Leerzeichen, wenn der Pfeil auf `-` endet (sonst liest mermaid `/|--` als
	// gestrichelten Pfeil); nach `-` vor x/X ein Leerzeichen (sonst `-x` als Kreuz-Pfeil).
	const minus = edge.props.activation === '-';
	const pre = minus && arrow.endsWith('-') ? ' ' : '';
	const post = minus && /^x/i.test(edge.targetId) ? ' ' : '';
	return stageSafe(
		(colon) =>
			`${edge.sourceId}${arrow}${pre}${activation ? edge.props.activation : ''}${post}${edge.targetId}: ${text(edge.props.wrap, edge.label, colon)}`
	);
}

const head = (keyword: string, label: string) =>
	label ? stageSafe((colon) => `${keyword} ${encodeLabel(label, colon)}`) : keyword;

function elementIndex(doc: DiagramDocument): Map<string, Element> {
	const index = new Map<string, Element>();
	doc.nodes.forEach((el) => index.set(el.id, { type: 'node', el }));
	doc.edges.forEach((el) => index.set(el.id, { type: 'edge', el }));
	doc.containers.forEach((el) => index.set(el.id, { type: 'container', el }));
	doc.comments.forEach((el) => index.set(el.id, { type: 'comment', el }));
	doc.rawBlocks.forEach((el) => index.set(el.id, { type: 'raw', el }));
	return index;
}

const sourceOf = (entry: Element | undefined): string => {
	if (!entry) return '';
	if (entry.type === 'raw') return entry.el.rawText;
	if (entry.type === 'comment') return RE.comment.test(entry.el.text) ? entry.el.text : '';
	return entry.el.sourceText;
};

/** Einrückung einer Liste: erstes Element mit Rohtext, sonst `fallback`. */
function listIndentOf(index: Map<string, Element>, ids: string[], fallback: string): string {
	for (const id of ids) {
		const indent = indentOf(sourceOf(index.get(id)));
		if (indent !== undefined) return indent;
	}
	return fallback;
}

/**
 * Rohtext einer `autonumber`-Anweisung am Diagrammanfang (T135, Schalter "Nummerierung"):
 * Einrückung und Zeilenende wie der Serializer sie für die oberste Ebene wählt.
 */
export function autonumberText(doc: DiagramDocument): string {
	return `${listIndentOf(elementIndex(doc), doc.order, STEP)}autonumber${detectEol(doc)}`;
}

export function serialize(doc: DiagramDocument): string {
	const eol = detectEol(doc);
	const index = elementIndex(doc);

	// Stücke im Array statt `endsWith` auf dem wachsenden String (V-29: quadratisch).
	const out: string[] = [];
	/** Ausgabe endet nicht auf `\n` (`eol` endet immer auf `\n`, siehe `detectEol`). */
	let open = false;
	const put = (piece: string) => {
		if (open) out.push(eol);
		out.push(piece);
		open = piece !== '' && !piece.endsWith('\n');
	};
	const canonical = (indent: string, line: string) => put(`${indent}${line}${eol}`);

	const listIndent = (ids: string[], fallback: string): string =>
		listIndentOf(index, ids, fallback);

	/** Abweichung vom Stand nach Parse: implizit `participant`/ID, aus RawBlock-Deklaration `base`. */
	const changed = (n: DiagramNode) => {
		const base = n.props.base as { kind: string; label: string } | undefined;
		return n.kind !== (base?.kind ?? 'participant') || n.label !== (base?.label ?? n.id);
	};
	const inRaw = new Set(
		doc.rawBlocks.flatMap((r) =>
			rawUses(r.rawText)
				.filter((u) => u.kind)
				.map((u) => u.id)
		)
	);
	/** Von einer Nachricht erzeugte Teilnehmer: Deklaration steht in der `create`-Zeile. */
	const created = new Set(
		doc.edges.map((e) => e.props.create).filter((c): c is string => typeof c === 'string')
	);
	const implicit = new Map(
		doc.nodes
			.filter((n) => n.props.implicit === true && !n.sourceText && n.kind !== 'note')
			.filter((n) => !created.has(n.id))
			.filter((n) => changed(n) || !inRaw.has(n.id))
			.map((n) => [n.id, n])
	);
	const pending = new Map([...implicit].filter(([, n]) => changed(n)));
	/** Teilnehmer eines Eintrags in Reihenfolge des ersten Auftretens (Set erhält sie). */
	const uses = (id: string, found: Set<string>) => {
		const entry = index.get(id);
		if (entry?.type === 'edge') {
			if (typeof entry.el.props.create === 'string') found.add(entry.el.props.create);
			found.add(entry.el.sourceId).add(entry.el.targetId);
		} else if (entry?.type === 'node' && entry.el.kind === 'note')
			((entry.el.props.participants as string[] | undefined) ?? []).forEach((p) => found.add(p));
		else if (entry?.type === 'node' && !pending.has(id)) found.add(id);
		else if (entry?.type === 'container')
			entry.el.sections.forEach((s) => s.memberIds.forEach((m) => uses(m, found)));
		else if (entry?.type === 'raw') rawUses(entry.el.rawText).forEach((u) => found.add(u.id));
	};
	const seen = new Set<string>();
	/** Teilnehmer, die bis zur aktuellen Zeile in Dokumentreihenfolge schon auftraten. */
	const met = new Set<string>();
	/**
	 * Deklariert geänderte Teilnehmer und alle davor erstmals benutzten impliziten Teilnehmer.
	 * Steht davor ein nicht deklarierbarer (später ausdrücklich deklarierter) Teilnehmer, folgen die
	 * übrigen Deklarationen erst nach dem Eintrag; mermaid behält dann die Reihenfolge und übernimmt
	 * Label und Typ. Rückgabe: diese zurückgehaltenen Teilnehmer.
	 */
	const declare = (indent: string, used: Set<string>): DiagramNode[] => {
		const fresh = [...used].filter((p) => !seen.has(p));
		// RawBlock-Deklarationen (`box`, `create`) dürfen keine vorgezogene Deklaration bekommen.
		const stop = fresh.findIndex((p) => !implicit.has(p) || implicit.get(p)!.props.base);
		const before = stop < 0 ? fresh : fresh.slice(0, stop);
		let count = 0;
		before.forEach((p, i) => {
			if (pending.has(p)) count = i + 1;
		});
		const later = fresh.slice(before.length).filter((p) => pending.has(p));
		for (const p of [...before.slice(0, count), ...later]) pending.delete(p);
		before.slice(0, count).forEach((p) => canonical(indent, nodeLine(implicit.get(p)!)));
		used.forEach((p) => seen.add(p));
		// Ohne Alias ändert mermaid einen vorhandenen Teilnehmer nicht (Grenze in SUBSET.md).
		return later.filter((p) => ALIASABLE.test(p)).map((p) => implicit.get(p)!);
	};

	const write = (ids: string[], indent: string, top = false) => {
		for (const id of ids) {
			const entry = index.get(id);
			if (!entry) throw new Error(msg('services.syntax.unknownOrderId', { id }));
			let later: DiagramNode[] = [];
			if (top && pending.size > 0) {
				const used = new Set<string>();
				uses(id, used);
				later = declare(indent, used);
			}
			switch (entry.type) {
				case 'raw':
					put(entry.el.rawText);
					break;
				case 'comment':
					if (RE.comment.test(entry.el.text)) put(entry.el.text);
					else canonical(indent, `%% ${entry.el.text}`);
					break;
				case 'node':
					pending.delete(entry.el.id);
					if (entry.el.sourceText) put(entry.el.sourceText);
					else canonical(indent, nodeLine(entry.el, met.has(entry.el.id)));
					break;
				case 'edge':
					lifecycle(entry.el, indent);
					if (entry.el.sourceText) put(entry.el.sourceText);
					else canonical(indent, edgeLine(entry.el));
					break;
				case 'container':
					writeContainer(entry.el, indent);
			}
			if (entry.type !== 'container') uses(id, met);
			later.forEach((node) => canonical(indent, nodeLine(node, true)));
		}
	};

	/**
	 * `create`/`destroy` vor der Nachricht: Rohtext, solange er zum Modell passt, sonst kanonisch.
	 * Mit eigener (späterer) Deklarationszeile bestimmt diese Typ und Label: `create` bleibt roh.
	 */
	const lifecycle = (edge: DiagramEdge, indent: string) => {
		const create = edge.props.create;
		if (typeof create === 'string') {
			const node = index.get(create);
			const decl = node?.type === 'node' ? node.el : undefined;
			const raw = String(edge.props.sourceCreate ?? '');
			const life = lifecycleLine(raw);
			if (
				life?.type === 'create' &&
				life.id === create &&
				(!decl || decl.sourceText || (life.kind === decl.kind && life.label === decl.label))
			)
				put(raw);
			else canonical(indent, `create ${decl ? nodeLine(decl) : `participant ${create}`}`);
		}
		const destroy = edge.props.destroy;
		if (typeof destroy === 'string') {
			const raw = String(edge.props.sourceDestroy ?? '');
			const life = lifecycleLine(raw);
			if (life?.type === 'destroy' && life.id === destroy) put(raw);
			else canonical(indent, `destroy ${destroy}`);
		}
	};

	const sectionLabel = (raw: string) =>
		decodeLabel(RE.section.exec(raw.trim().split('\n')[0].trim())?.[2] ?? '');

	const writeContainer = (c: Container, siblingIndent: string) => {
		const sections = (c.props.sourceSections as string[] | undefined) ?? [];
		const end = String(c.props.sourceEnd ?? '');
		const own = indentOf(c.sourceText) ?? indentOf(end) ?? siblingIndent;
		if (c.sourceText) put(c.sourceText);
		else if (c.kind === 'box') {
			const color = String(c.props.color ?? '');
			const wrap = c.props.wrap as boolean | undefined;
			canonical(own, boxHeadLine({ color: isBoxColor(color) ? color : '', label: c.label, wrap }));
		} else canonical(own, head(c.kind, c.label));
		const fits = sections.length === c.sections.length - 1;
		c.sections.forEach((section, i) => {
			if (i > 0) {
				const raw = fits ? sections[i - 1] : '';
				if (raw && sectionLabel(raw) === section.label) put(raw);
				else {
					put(LEADING_BLANK.exec(raw)?.[0] ?? '');
					canonical(indentOf(raw) ?? own, head(SECTION_KEYWORD[c.kind] ?? 'else', section.label));
				}
			}
			write(section.memberIds, listIndent(section.memberIds, own + STEP));
		});
		if (end) put(end);
		else canonical(own, 'end');
	};

	put(doc.header.frontmatter);
	doc.header.directives.forEach(put);
	const last = doc.header.directives[doc.header.directives.length - 1];
	if (last === undefined || !TYPE_SEGMENT.test(last.replace(/^\s*%.*$/gm, '')))
		put(TYPE_KEYWORD + eol);
	write(doc.order, listIndent(doc.order, STEP), true);
	for (const node of pending.values())
		canonical(listIndent(doc.order, STEP), nodeLine(node, met.has(node.id)));
	return out.join('');
}
