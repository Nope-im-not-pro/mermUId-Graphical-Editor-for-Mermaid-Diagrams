/**
 * Command-Erzeugung des Sequenz-Canvas. Jede Aktion wird ein `Command` für den Sync-Controller;
 * Sequenz kennt keine Positionen, Lage ergibt sich nur aus der Reihenfolge im Modell.
 */
import type { Command, CommandContext } from '../../../controllers/commands/history';
import { sequenceGrammar, type RawStep } from '../../../controllers/sync';
import {
	addContainer as addContainerOp,
	addEdge,
	addNode,
	moveToContainer,
	removeContainer,
	removeEdge,
	removeNode,
	reorder,
	updateEdge,
	updateNode
} from '../../../model/operations';
import type { Container, DiagramDocument, DiagramEdge, DiagramNode } from '../../../model/types';
import { ARROW_TOKENS, arrowStyle } from './arrows';
import { labelFromEditor, parseSectionId, SECTION_KEYWORD } from './mapping';
import { t } from '../../shell/i18n.svelte';

/** Sequenz-Erkennung des Adapters über den Sync-Controller (T128, V-25). */
const { autonumberText, isBoxColor, lifecycleLine, messageLexes, rawEvents, withoutAutonumber } =
	sequenceGrammar;

export type ParticipantKind = 'participant' | 'actor';
export type Placement = 'over' | 'left of' | 'right of';
export type BlockKind = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'rect' | 'break';

/** Einfügestelle: Liste (`order` bei `parent` null, sonst Section) und Index darin. */
export interface Point {
	parent: string | null;
	section: number;
	index: number;
}

const RESERVED = new Set(
	[
		'participant',
		'actor',
		'as',
		'note',
		'over',
		'left',
		'right',
		'of',
		'loop',
		'alt',
		'else',
		'opt',
		'par',
		'and',
		'critical',
		'option',
		'break',
		'rect',
		'end',
		'activate',
		'deactivate',
		'title',
		'autonumber',
		'box',
		'create',
		'destroy',
		'link',
		'links',
		'properties',
		'details',
		'accTitle',
		'accDescr',
		'sequenceDiagram'
	].map((w) => w.toLowerCase())
);

/** Mermaid-gültig, kein Sperrwort, nicht im Format generierter IDs (`n1`, `e1`, `c1`). */
export function validParticipantId(id: string): boolean {
	return (
		/^[A-Za-z_]\w*$/.test(id) && !RESERVED.has(id.toLowerCase()) && !/^[nec][1-9]\d*$/.test(id)
	);
}

function allIds(doc: DiagramDocument): Set<string> {
	return new Set(
		[doc.nodes, doc.edges, doc.containers, doc.rawBlocks, doc.comments].flatMap((list) =>
			list.map((el) => el.id)
		)
	);
}

/** Nächste freie Teilnehmer-ID; auch in RawBlocks genannte Namen gelten als belegt. */
export function participantId(doc: DiagramDocument, kind: ParticipantKind): string {
	const base = kind === 'actor' ? t('canvas.default.actor') : t('canvas.default.participant');
	const ids = allIds(doc);
	const raw = doc.rawBlocks.map((r) => r.rawText).join('\n');
	for (let i = 1; ; i++) {
		const id = `${base}${i}`;
		if (validParticipantId(id) && !ids.has(id) && !new RegExp(`\\b${id}\\b`).test(raw)) return id;
	}
}

/** Teilnehmer, den eine Nachricht erzeugt (Option `create`, T135 C3). */
const createdBy = (doc: DiagramDocument, id: string) =>
	doc.edges.find((e) => e.kind === 'message' && e.props.create === id);

const isParticipant = (doc: DiagramDocument, id: string) =>
	doc.nodes.some((n) => n.id === id && n.kind !== 'note');

function requireParticipant(doc: DiagramDocument, id: string) {
	if (!isParticipant(doc, id)) throw new Error(t('canvas.err.unknownParticipant', { id }));
}

/** Lage eines Elements in `order` oder einer Section. */
export function locate(doc: DiagramDocument, id: string): Point | null {
	const i = doc.order.indexOf(id);
	if (i >= 0) return { parent: null, section: 0, index: i };
	for (const c of doc.containers) {
		for (const [section, s] of c.sections.entries()) {
			const index = s.memberIds.indexOf(id);
			if (index >= 0) return { parent: c.id, section, index };
		}
	}
	return null;
}

/** Section-Pseudo-ID eines vorhandenen Abschnitts. */
export function sectionOf(doc: DiagramDocument, id: string) {
	const sec = parseSectionId(id);
	const c = sec && doc.containers.find((x) => x.id === sec.containerId);
	return c && c.sections[sec!.index] ? { container: c, index: sec!.index } : null;
}

/** Teilnehmer-Gruppe (`box`, T135 C2). */
export const isBox = (doc: DiagramDocument, id: string) =>
	doc.containers.some((c) => c.id === id && c.kind === 'box');

/**
 * Einfügestelle hinter dem Anker: Abschnitt bzw. Block -> an dessen Anfang, Teilnehmer oder
 * ohne Anker -> Ende des Diagramms, Gruppe (`box`, nur Teilnehmer) -> direkt dahinter, sonst
 * direkt dahinter.
 */
export function pointAfter(doc: DiagramDocument, anchor?: string): Point {
	const end = { parent: null, section: 0, index: doc.order.length };
	if (!anchor) return end;
	const sec = sectionOf(doc, anchor);
	if (sec && !isBox(doc, sec.container.id))
		return { parent: sec.container.id, section: sec.index, index: 0 };
	const box = sec && sec.container.id;
	if (box || isBox(doc, anchor))
		return { parent: null, section: 0, index: doc.order.indexOf(box || anchor) + 1 };
	if (doc.containers.some((c) => c.id === anchor)) return { parent: anchor, section: 0, index: 0 };
	const at = isParticipant(doc, anchor) ? null : locate(doc, anchor);
	return at ? { ...at, index: at.index + 1 } : end;
}

function edge(
	id: string,
	kind: string,
	sourceId: string,
	targetId: string,
	parentId: string | null
): DiagramEdge {
	return {
		id,
		kind,
		sourceId,
		targetId,
		label: '',
		lineStyle: '',
		arrowHead: '',
		style: {},
		props: {},
		parentId,
		sourceText: ''
	};
}

export function addParticipant(kind: ParticipantKind): Command {
	return command(
		kind === 'actor' ? t('canvas.cmd.addActor') : t('canvas.cmd.addParticipant'),
		(doc) => {
			const id = participantId(doc, kind);
			return addNode(doc, {
				id,
				kind,
				label: id,
				shape: kind,
				cssClasses: [],
				style: {},
				props: {},
				parentId: null,
				sourceText: ''
			});
		}
	);
}

export function addMessage(from: string, to: string, arrow = '->>', anchor?: string): Command {
	return command(t('canvas.cmd.addMessage'), (doc, ctx) => {
		requireParticipant(doc, from);
		requireParticipant(doc, to);
		const style = arrowStyle(arrow);
		const at = pointAfter(doc, anchor);
		const id = ctx.newId('e');
		const next = addEdge(
			doc,
			{
				...edge(id, 'message', from, to, at.parent),
				label: t('canvas.default.message'),
				...style,
				props: { arrow, activation: '' }
			},
			at.section
		);
		return reorder(next, id, at.index);
	});
}

export function addNote(placement: Placement, participants: string[], anchor?: string): Command {
	return command(t('canvas.cmd.addNote'), (doc, ctx) => {
		if (participants.length === 0) throw new Error(t('canvas.err.noParticipant'));
		participants.forEach((p) => requireParticipant(doc, p));
		const at = pointAfter(doc, anchor);
		const id = ctx.newId('n');
		const next = addNode(
			doc,
			{
				id,
				kind: 'note',
				label: t('canvas.default.note'),
				shape: 'note',
				cssClasses: [],
				style: {},
				props: { placement, participants: [...participants] },
				parentId: at.parent,
				sourceText: ''
			},
			at.section
		);
		return reorder(next, id, at.index);
	});
}

/** `activate` vor und `deactivate` hinter dem Element, ohne Element beide am Ende. */
export function addActivation(participant: string, aroundId?: string): Command {
	return command(t('canvas.cmd.addActivation'), (doc, ctx) => {
		requireParticipant(doc, participant);
		const at = (aroundId && locate(doc, aroundId)) || pointAfter(doc);
		const on = ctx.newId('e');
		const off = ctx.newId('e');
		let next = addEdge(doc, edge(on, 'activate', participant, participant, at.parent), at.section);
		next = reorder(next, on, at.index);
		next = addEdge(next, edge(off, 'deactivate', participant, participant, at.parent), at.section);
		return reorder(next, off, aroundId ? at.index + 2 : at.index + 1);
	});
}

export function setMessage(
	id: string,
	patch: { sourceId?: string; targetId?: string; arrow?: string }
): Command {
	return command(t('canvas.cmd.setMessage'), (doc) => {
		const e = doc.edges.find((x) => x.id === id);
		if (e?.kind !== 'message') throw new Error(t('canvas.err.notMessage', { id }));
		const sourceId = patch.sourceId ?? e.sourceId;
		const targetId = patch.targetId ?? e.targetId;
		requireParticipant(doc, sourceId);
		requireParticipant(doc, targetId);
		const arrow = patch.arrow ?? String(e.props.arrow);
		return updateEdge(doc, id, {
			sourceId,
			targetId,
			...arrowStyle(arrow),
			props: { ...e.props, arrow }
		});
	});
}

export type LifecycleMode = '' | 'create' | 'destroySource' | 'destroyTarget';

/** Option der Nachricht `id`: `create` (Ziel) bzw. `destroy` (Absender oder Ziel). */
export function lifecycleOf(e: DiagramEdge): LifecycleMode {
	if (e.props.create === e.targetId) return 'create';
	if (e.props.destroy === undefined) return '';
	return e.props.destroy === e.sourceId ? 'destroySource' : 'destroyTarget';
}

/** Wählbare Optionen: bei Selbstnachricht (Absender = Ziel) nur eine Zerstören-Option. */
export function lifecycleModes(e: DiagramEdge): LifecycleMode[] {
	const modes: LifecycleMode[] = ['', 'create', 'destroySource'];
	return e.sourceId === e.targetId ? modes : [...modes, 'destroyTarget'];
}

/**
 * Nachrichten-Option Erzeugen/Zerstören (T135 C3, mermaid-Regeln in `checkLifecycle`): `create`
 * macht das Ziel zum erzeugten Teilnehmer, dessen Deklaration die `create`-Zeile trägt (eigene
 * Deklaration entfällt); in einer Gruppe nur im Code. `destroy` gilt Absender oder Ziel.
 */
export function setLifecycle(id: string, mode: LifecycleMode): Command {
	return command(t('services.sequence.cmd.lifecycle'), (doc) => {
		const e = doc.edges.find((x) => x.id === id);
		if (e?.kind !== 'message') throw new Error(t('canvas.err.notMessage', { id }));
		if (lifecycleOf(e) === mode) return doc;
		const props = { ...e.props };
		delete props.create;
		delete props.sourceCreate;
		delete props.destroy;
		delete props.sourceDestroy;
		if (mode === 'destroySource') props.destroy = e.sourceId;
		if (mode === 'destroyTarget') props.destroy = e.targetId;
		let next = doc;
		if (mode === 'create') {
			const target = e.targetId;
			const at = locate(doc, target);
			if (at?.parent && isBox(doc, at.parent))
				throw new Error(t('services.sequence.err.createBox', { id: target }));
			props.create = target;
			next = {
				...doc,
				// Eigene Deklaration entfällt: die `create`-Zeile deklariert den Teilnehmer.
				nodes: doc.nodes.map((n) =>
					n.id === target
						? {
								...n,
								sourceText: '',
								props: { ...n.props, implicit: true, base: { kind: n.kind, label: n.label } }
							}
						: n
				),
				order: doc.order.filter((x) => x !== target),
				containers: doc.containers.map((c) => ({
					...c,
					sections: c.sections.map((s) => ({
						...s,
						memberIds: s.memberIds.filter((x) => x !== target)
					}))
				}))
			};
		}
		// Option direkt im Modell, Rohtext der Nachricht bleibt (nur die Zeile davor ändert sich).
		return {
			...next,
			edges: next.edges.map((x) => (x.id === id ? { ...x, props } : x)),
			modelVersion: next.modelVersion + 1
		};
	});
}

function setContainer(doc: DiagramDocument, id: string, change: (c: Container) => Container) {
	return {
		...doc,
		containers: doc.containers.map((c) => (c.id === id ? change(c) : c)),
		modelVersion: doc.modelVersion + 1
	};
}

/** Label aus dem Editor; Teilnehmer ohne Label fallen auf ihre ID zurück. */
export function rename(id: string, text: string): Command {
	return command(t('canvas.cmd.rename'), (doc) => {
		const label = labelFromEditor(text);
		const sec = sectionOf(doc, id);
		if (sec && sec.index > 0) {
			return setContainer(doc, sec.container.id, (c) => ({
				...c,
				sections: c.sections.map((s, i) => (i === sec.index ? { ...s, label } : s))
			}));
		}
		const cid = sec ? sec.container.id : id;
		if (doc.containers.some((c) => c.id === cid)) {
			return setContainer(doc, cid, (c) => ({
				...c,
				label,
				sourceText: '',
				sections: c.sections.map((s, i) => (i === 0 ? { ...s, label } : s))
			}));
		}
		const node = doc.nodes.find((n) => n.id === id);
		const e = doc.edges.find((x) => x.id === id);
		if (!node && !e) throw new Error(t('canvas.err.unknownId', { id }));
		if (e && e.kind !== 'message') throw new Error(t('canvas.err.noLabel', { id }));
		if (node && node.kind !== 'note') {
			const created = !!createdBy(doc, id);
			if (node.props.base && !created)
				throw new Error(t('canvas.err.participantNotEditable', { id }));
			const final = label || id;
			if (final !== id && /\s/.test(id)) throw new Error(t('canvas.err.noAlias', { id }));
			// Erzeugter Teilnehmer: die `create`-Zeile trägt die Deklaration (Serializer schreibt neu).
			const props = created
				? { ...node.props, base: { kind: node.kind, label: final } }
				: node.props;
			return updateNode(doc, id, { label: final, props });
		}
		if (!label) throw new Error(t('canvas.err.emptyLabel'));
		return node ? updateNode(doc, id, { label }) : updateEdge(doc, id, { label });
	});
}

/** Elemente in Dokument-Reihenfolge (Container rekursiv). */
export function walk(doc: DiagramDocument): string[] {
	const containers = new Map(doc.containers.map((c) => [c.id, c]));
	const out: string[] = [];
	const visit = (ids: readonly string[]) => {
		for (const id of ids) {
			out.push(id);
			containers.get(id)?.sections.forEach((s) => visit(s.memberIds));
		}
	};
	visit(doc.order);
	return out;
}

/**
 * Entfernt `deactivate` bzw. ein `-` ohne vorherige Aktivierung (mermaid lehnt beides ab),
 * z. B. nach dem Löschen eines `activate` oder einer Nachricht mit `+`. Aktivierungen in RawBlocks
 * zählen mit; dort ist keine Reparatur möglich, eine offene Deaktivierung wird abgelehnt.
 */
export function repairActivations(doc: DiagramDocument): DiagramDocument {
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const raws = new Map(doc.rawBlocks.map((r) => [r.id, r]));
	const active = new Map<string, number>();
	const on = (p: string) => active.set(p, (active.get(p) ?? 0) + 1);
	const off = (p: string) => {
		const n = active.get(p) ?? 0;
		if (n > 0) active.set(p, n - 1);
		return n > 0;
	};
	let next = doc;
	for (const id of walk(doc)) {
		const e = edges.get(id);
		const raw = raws.get(id);
		if (raw) {
			for (const a of rawEvents(raw.rawText).act) {
				if (a.on) on(a.participant);
				else if (!off(a.participant)) {
					throw new Error(t('canvas.err.rawDeactivation'));
				}
			}
		} else if (e?.kind === 'activate') on(e.sourceId);
		else if (e?.kind === 'deactivate' && !off(e.sourceId)) next = removeEdge(next, id);
		else if (e?.kind === 'message') {
			if (e.props.activation === '+') on(e.targetId);
			if (e.props.activation === '-' && !off(e.sourceId)) {
				next = updateEdge(next, id, { props: { ...e.props, activation: '' } });
			}
		}
	}
	return next;
}

/** Teilnehmer, die in `activate`/`deactivate` bzw. `+`/`-` eines RawBlocks vorkommen. */
const rawActive = (raw: { rawText: string }) =>
	rawEvents(raw.rawText).act.map((a) => a.participant);

/**
 * Teilnehmer je Eintrag in `order` (samt Block-Inhalt): `named` sind Nennungen, die mermaid als
 * Teilnehmer anlegen (Deklaration, Nachricht, Notiz, RawBlock), `active` nur Aktivierungen
 * (Modell-Kanten und RawBlock), die keinen Teilnehmer anlegen. `nodes` ist die Reihenfolge, in
 * der das Parsen die Teilnehmer-Knoten anlegt (Nennungen und Modell-Aktivierungen).
 */
function references(doc: DiagramDocument) {
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const raws = new Map(doc.rawBlocks.map((r) => [r.id, r]));
	return (top: string) => {
		const named: string[] = [];
		const active: string[] = [];
		const created: string[] = [];
		for (const id of walk({ ...doc, order: [top] })) {
			const e = edges.get(id);
			const n = nodes.get(id);
			const raw = raws.get(id);
			const before = named.length;
			if (e?.kind === 'message' && typeof e.props.create === 'string') named.push(e.props.create);
			if (e?.kind === 'message') named.push(e.sourceId, e.targetId);
			else if (e) {
				active.push(e.sourceId);
				created.push(e.sourceId);
			} else if (n?.kind === 'note')
				named.push(...((n.props.participants as string[] | undefined) ?? []));
			else if (n) named.push(n.id);
			else if (raw) {
				const ev = rawEvents(raw.rawText);
				named.push(...ev.uses);
				active.push(...ev.act.map((a) => a.participant));
			}
			created.push(...named.slice(before));
		}
		return { named, active, nodes: created };
	};
}

/** Teilnehmer-Reihenfolge wie mermaid: erstes Auftreten, übrige Teilnehmer am Ende. */
function actorOrder(doc: DiagramDocument): string[] {
	const refs = references(doc);
	const out = new Set(doc.order.flatMap((top) => refs(top).named));
	doc.nodes.forEach((n) => n.kind !== 'note' && out.add(n.id));
	return [...out];
}

/** Impliziter Teilnehmer, den eine vorgezogene Deklaration nicht verändert. */
const declarable = (n: DiagramNode | undefined) =>
	n?.props.implicit === true && !n.props.base && !n.sourceText && n.kind !== 'note';

/**
 * Macht einen impliziten Teilnehmer explizit: Deklaration in `order` vor dem ersten Eintrag, der
 * ihn aktiviert oder einen in `prev` nach ihm stehenden Teilnehmer nennt. Nennt dieser Eintrag
 * auch in `prev` frühere, bis dahin nicht aufgetretene implizite Teilnehmer, werden sie davor
 * mitdeklariert (Reihenfolge bleibt).
 */
function declare(doc: DiagramDocument, id: string, prev: readonly string[]): DiagramDocument {
	const pos = prev.indexOf(id);
	const later = new Set(prev.slice(pos + 1));
	const earlier = new Set(prev.slice(0, pos));
	const tops = doc.order.map(references(doc));
	const at = tops.findIndex((r) => r.active.includes(id) || r.named.some((p) => later.has(p)));
	const met = new Set(tops.slice(0, at).flatMap((r) => r.named));
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const ids = [...new Set(tops[at].named)]
		.filter((p) => earlier.has(p) && !met.has(p) && declarable(nodes.get(p)))
		.sort((a, b) => prev.indexOf(a) - prev.indexOf(b));
	ids.push(id);
	let next = doc;
	for (const p of ids) {
		const props = { ...nodes.get(p)!.props };
		delete props.implicit;
		next = updateNode(next, p, { props });
	}
	return {
		...next,
		order: [...next.order.slice(0, at), ...ids, ...next.order.slice(at)],
		modelVersion: next.modelVersion + 1
	};
}

/** Teilnehmer-Knoten in der Reihenfolge, in der das Parsen des Codes sie anlegt. */
function sortParticipants(doc: DiagramDocument): DiagramDocument {
	const refs = references(doc);
	const seen = [...new Set(doc.order.flatMap((top) => refs(top).nodes))];
	const rank = new Map(seen.map((id, i) => [id, i]));
	const list = doc.nodes.filter((n) => n.kind !== 'note');
	const sorted = list
		.map((n, i) => ({ n, k: rank.get(n.id) ?? seen.length + i }))
		.sort((a, b) => a.k - b.k)
		.map((x) => x.n);
	if (sorted.every((n, i) => n === list[i])) return doc;
	let k = 0;
	return {
		...doc,
		nodes: doc.nodes.map((n) => (n.kind === 'note' ? n : sorted[k++])),
		modelVersion: doc.modelVersion + 1
	};
}

/**
 * Implizite Teilnehmer ohne Nennung (auch keine in RawBlocks) und ohne Abweichung von Typ
 * `participant` und Label = ID erzeugt der Serializer nicht; das Modell folgt dem Code.
 * Kommen sie nur noch in Aktivierungen vor, werden sie (auch geändert) explizit deklariert, so
 * dass die Teilnehmer-Reihenfolge aus `before` (Stand vor der Änderung) erhalten bleibt.
 * Danach stehen die Teilnehmer-Knoten in Parse-Reihenfolge.
 */
export function dropUnused(doc: DiagramDocument, before: DiagramDocument = doc): DiagramDocument {
	const tops = doc.order.map(references(doc));
	const named = new Set(tops.flatMap((t) => t.named));
	const active = new Set(tops.flatMap((t) => t.active));
	const prev = actorOrder(before);
	const next = doc.nodes
		.filter((n) => declarable(n) && !named.has(n.id))
		.reduce((d, n) => {
			if (active.has(n.id)) return declare(d, n.id, prev);
			return n.kind === 'participant' && n.label === n.id ? removeNode(d, n.id, 'cascade') : d;
		}, doc);
	return sortParticipants(next);
}

/** Abweichung vom Stand nach Parse wie im Serializer: implizit `participant`/ID, sonst `base`. */
const changed = (n: DiagramNode) => {
	const base = n.props.base as { kind: string; label: string } | undefined;
	return n.kind !== (base?.kind ?? 'participant') || n.label !== (base?.label ?? n.id);
};

/** Teilnehmer eines Eintrags (samt Block-Inhalt) in Reihenfolge des ersten Auftretens. */
function uses(doc: DiagramDocument, top: string): Set<string> {
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const raws = new Map(doc.rawBlocks.map((r) => [r.id, r]));
	const found = new Set<string>();
	for (const id of walk({ ...doc, order: [top] })) {
		const e = edges.get(id);
		const n = nodes.get(id);
		const raw = raws.get(id);
		if (e && typeof e.props.create === 'string') found.add(e.props.create);
		if (e) found.add(e.sourceId).add(e.targetId);
		else if (n?.kind === 'note')
			((n.props.participants as string[] | undefined) ?? []).forEach((p) => found.add(p));
		else if (n) found.add(n.id);
		else if (raw) rawEvents(raw.rawText).uses.forEach((p) => found.add(p));
	}
	return found;
}

/**
 * Geänderte implizite Teilnehmer schreibt der Serializer als Deklaration: vor den ersten Eintrag,
 * der sie nennt (mit den davor erstmals genannten impliziten), hinter ihn, wenn davor ein nicht
 * deklarierbarer Teilnehmer steht, ungenannte am Ende. Das Modell übernimmt genau diese
 * Deklarationen als explizite Teilnehmer, damit es dem Re-Parse des Codes gleicht.
 */
function declarePending(doc: DiagramDocument): DiagramDocument {
	const inRaw = new Set(doc.rawBlocks.flatMap((r) => rawEvents(r.rawText).declared));
	const implicit = new Map(
		doc.nodes
			.filter((n) => n.props.implicit === true && !n.sourceText && n.kind !== 'note')
			.filter((n) => !createdBy(doc, n.id))
			.filter((n) => changed(n) || !inRaw.has(n.id))
			.map((n) => [n.id, n])
	);
	const pending = new Set([...implicit.values()].filter(changed).map((n) => n.id));
	if (pending.size === 0) return doc;
	const seen = new Set<string>();
	const order: string[] = [];
	for (const top of doc.order) {
		let later: string[] = [];
		if (pending.size > 0) {
			const used = uses(doc, top);
			const fresh = [...used].filter((p) => !seen.has(p));
			const stop = fresh.findIndex((p) => !implicit.has(p) || implicit.get(p)!.props.base);
			const before = stop < 0 ? fresh : fresh.slice(0, stop);
			let count = 0;
			before.forEach((p, i) => {
				if (pending.has(p)) count = i + 1;
			});
			later = fresh.slice(before.length).filter((p) => pending.has(p));
			[...before.slice(0, count), ...later].forEach((p) => pending.delete(p));
			used.forEach((p) => seen.add(p));
			order.push(...before.slice(0, count));
		}
		order.push(top, ...later);
	}
	order.push(...pending);
	let next = doc;
	for (const id of order.filter((id) => implicit.has(id))) {
		const props = { ...implicit.get(id)!.props };
		delete props.implicit;
		next = updateNode(next, id, { props });
	}
	return { ...next, order, modelVersion: next.modelVersion + 1 };
}

/**
 * Deklaration mit Alias (`… as …`): roh aus `sourceText`, ohne Quelltext wie der Serializer, der
 * nach der ersten Nennung jede aliasbare ID mit Alias schreibt.
 */
const aliased = (n: DiagramNode) =>
	n.sourceText
		? /(?<=\S)\s+as(?:\s+|$)/i.test(
				n.sourceText.trim().replace(/^(?:create\s+)?(?:participant|actor)\s+/i, '')
			)
		: /^\S+$/.test(n.id);

/**
 * Regeln aus mermaid sequenceDb in Dokument-Reihenfolge: `create` nur für noch nicht genannte
 * Teilnehmer, die nächste Nachricht danach hat ihn als Ziel; nach `destroy` nennt die nächste
 * Nachricht ihn (Quelle oder Ziel). Ein offenes `create` hat Vorrang vor einem offenen `destroy`.
 * Typ und Label jedes Teilnehmers wie sequenceDb (`addActor`): Erstnennung legt `participant`
 * mit Label = ID an, eine Deklaration (kanonisch oder im RawBlock) setzt Typ und Label nur bei
 * Erstanlage oder mit Alias. Weicht das Modell davon ab, ginge es beim Re-Parse verloren.
 */
function checkLifecycle(doc: DiagramDocument) {
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const raws = new Map(doc.rawBlocks.map((r) => [r.id, r]));
	const actors = new Set<string>();
	/** Typ und Label nach sequenceDb; Label `undefined`: Alias aus RawBlock (Modell-`base`). */
	const types = new Map<string, { kind: string; label?: string }>();
	const declare = (id: string, kind: string, alias: boolean, label?: string) => {
		if (alias || !types.has(id)) types.set(id, { kind, label: alias ? label : id });
	};
	let created: string | undefined;
	let destroyed: string | undefined;
	/** Vor erster Nennung aktiviert: der Adapter legt sie dort an, mermaid-db erst bei Nennung. */
	const early: string[] = [];
	const add = (id: string) => {
		if (actors.has(id)) return;
		if (early.length > 0 && early.shift() !== id) {
			throw new Error(t('canvas.err.earlyActivation'));
		}
		actors.add(id);
	};
	const step = (s: RawStep) => {
		if (s.type === 'autonumber') return;
		if (s.type === 'use' || s.type === 'create') {
			if (s.decl) declare(s.id, s.decl.kind, s.decl.alias);
			else if (!types.has(s.id)) types.set(s.id, { kind: 'participant', label: s.id });
		}
		if (s.type === 'use') add(s.id);
		else if (s.type === 'create') {
			if (actors.has(s.id)) throw new Error(t('canvas.err.createAfterUse', { id: s.id }));
			created = s.id;
			add(s.id);
		} else if (s.type === 'destroy') destroyed = s.id;
		else if (created !== undefined) {
			if (s.to !== created) throw new Error(t('canvas.err.createMessage', { id: created }));
			created = undefined;
		} else if (destroyed !== undefined) {
			if (s.to !== destroyed && s.from !== destroyed) {
				throw new Error(t('canvas.err.destroyMessage', { id: destroyed }));
			}
			destroyed = undefined;
		}
	};
	for (const id of walk(doc)) {
		const e = edges.get(id);
		const n = nodes.get(id);
		const raw = raws.get(id);
		if (e?.kind === 'message') {
			const create = typeof e.props.create === 'string' ? e.props.create : undefined;
			const target = create === undefined ? undefined : nodes.get(create);
			if (create !== undefined) {
				const kind = target?.kind ?? 'participant';
				const alias = !!target && target.label !== target.id;
				step({ type: 'create', id: create, decl: { kind, alias } });
			}
			if (typeof e.props.destroy === 'string') step({ type: 'destroy', id: e.props.destroy });
			step({ type: 'use', id: e.sourceId });
			step({ type: 'use', id: e.targetId });
			step({ type: 'message', from: e.sourceId, to: e.targetId });
		} else if (e && !actors.has(e.sourceId)) {
			if (!early.includes(e.sourceId)) early.push(e.sourceId);
		} else if (n?.kind === 'note')
			((n.props.participants as string[] | undefined) ?? []).forEach((p) =>
				step({ type: 'use', id: p })
			);
		else if (n) {
			declare(n.id, n.kind, aliased(n), n.label);
			step({ type: 'use', id: n.id });
		} else if (raw) rawEvents(raw.rawText).steps.forEach(step);
	}
	if (early.length > 0) throw new Error(t('canvas.err.activationWithoutMention', { id: early[0] }));
	for (const n of doc.nodes) {
		const decl = types.get(n.id);
		if (!decl || n.kind === 'note') continue;
		if (decl.kind !== n.kind) {
			throw new Error(t('canvas.err.declarationType', { id: n.id }));
		}
		if (decl.label !== undefined && decl.label !== n.label) {
			throw new Error(t('canvas.err.declarationLabel', { id: n.id }));
		}
	}
}

/** Pfeil-Token wie im Serializer: aus Linienstil und Spitze, Halbpfeile aus `props.arrow`. */
function arrowOf(e: DiagramEdge): string {
	const token = String(e.props.arrow);
	if (e.arrowHead === 'half') return ARROW_TOKENS.includes(token) ? token : '->>';
	const found = ARROW_TOKENS.find((t) => {
		const s = arrowStyle(t);
		return s.lineStyle === e.lineStyle && s.arrowHead === e.arrowHead;
	});
	return found ?? (ARROW_TOKENS.includes(token) ? token : '->>');
}

/**
 * Namen mit `(`, `)` oder `#` liest mermaid in Nachrichten, der Adapter-Parser nicht (Stopp-Zeichen
 * bzw. unsichere Zeile): der Re-Parse machte einen RawBlock daraus.
 */
const UNPARSED = /[()#]/;

/** Kanonisch geschriebene Nachrichten müssen der mermaid-Lexer und der Parser genau so lesen. */
function checkMessages(doc: DiagramDocument) {
	for (const e of doc.edges) {
		if (e.kind !== 'message' || e.sourceText) continue;
		const act = e.props.activation === '+' || e.props.activation === '-' ? e.props.activation : '';
		const arrow = arrowOf(e);
		const parsed = !UNPARSED.test(e.sourceId) && !UNPARSED.test(e.targetId);
		if (parsed && messageLexes(e.sourceId, arrow, act, e.targetId)) continue;
		throw new Error(
			t('canvas.err.unreadableMessage', { message: `${e.sourceId}${arrow}${act}${e.targetId}` })
		);
	}
}

/**
 * Teilnehmer, die RawBlocks oder Notizen nennen, muss es im Modell geben; sonst fehlten sie nach
 * dem Löschen (z. B. Deklaration samt Block) im Modell, der Code legt sie beim Re-Parse wieder
 * an. Aktivierungen in RawBlocks zählen, wenn es den Teilnehmer vor dem Command gab.
 */
function checkReferences(doc: DiagramDocument, before: DiagramDocument) {
	const raw = doc.rawBlocks.flatMap((r) => [
		...rawEvents(r.rawText).uses,
		...rawActive(r).filter((id) => isParticipant(before, id))
	]);
	const inRaw = raw.find((id) => !isParticipant(doc, id));
	if (inRaw) throw new Error(t('canvas.err.participantInRaw', { id: inRaw }));
	for (const n of doc.nodes) {
		const ps = n.kind === 'note' ? ((n.props.participants as string[] | undefined) ?? []) : [];
		const gone = ps.find((id) => !isParticipant(doc, id));
		if (gone) throw new Error(t('canvas.err.noteParticipantMissing', { id: gone, note: n.id }));
	}
}

/**
 * RawBlocks außerhalb von `order` (z. B. aus gelöschten Blöcken) schreibt der Serializer nicht;
 * sie entfallen. Implizite Teilnehmer, deren `base` aus einer RawBlock-Deklaration stammt, die es
 * nicht mehr gibt, verlieren `base`; danach gelten sie wie implizit genannte (entfallen oder
 * werden deklariert, wenn Typ oder Label abweichen).
 */
function dropStaleBase(next: DiagramDocument): DiagramDocument {
	const reachable = new Set(walk(next));
	const doc = next.rawBlocks.every((r) => reachable.has(r.id))
		? next
		: {
				...next,
				rawBlocks: next.rawBlocks.filter((r) => reachable.has(r.id)),
				modelVersion: next.modelVersion + 1
			};
	const declared = new Set(doc.rawBlocks.flatMap((r) => rawEvents(r.rawText).declared));
	return doc.nodes
		.filter((n) => n.props.base && !declared.has(n.id) && !createdBy(doc, n.id))
		.reduce((d, n) => {
			const props = { ...n.props };
			delete props.base;
			return updateNode(d, n.id, { props });
		}, doc);
}

/**
 * Teilnehmer-Gruppen (`box`) wie der Parser sie liest (T135 C2): nur auf oberster Ebene, ein
 * Abschnitt, darin nur Teilnehmer-Deklarationen und Kommentare; jeder Teilnehmer tritt dort
 * zum ersten Mal auf (mermaid nimmt schon bekannte nicht in die Gruppe auf).
 */
function checkBoxes(doc: DiagramDocument) {
	const boxes = doc.containers.filter((c) => c.kind === 'box');
	if (boxes.length === 0) return;
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const comments = new Set(doc.comments.map((c) => c.id));
	const refs = references(doc);
	const met = new Set<string>();
	const tops = new Map(doc.order.map((id, i) => [id, i]));
	for (const c of boxes) {
		if (!tops.has(c.id) || c.sections.length !== 1)
			throw new Error(t('services.sequence.err.boxPlace'));
		for (const m of c.sections[0].memberIds) {
			const n = nodes.get(m);
			if (!comments.has(m) && (!n || n.kind === 'note'))
				throw new Error(t('services.sequence.err.boxMember'));
		}
	}
	for (const top of doc.order) {
		const box = boxes.find((c) => c.id === top);
		if (box) {
			for (const m of box.sections[0].memberIds) {
				if (comments.has(m)) continue;
				if (met.has(m)) throw new Error(t('services.sequence.err.boxFirstUse', { id: m }));
				met.add(m);
			}
			continue;
		}
		const r = refs(top);
		[...r.named, ...r.nodes].forEach((p) => met.add(p));
	}
}

/** Option `create`/`destroy` einer Nachricht passt zur Lifecycle-Zeile (T135 C3). */
const fits = (life: ReturnType<typeof lifecycleLine>, e: DiagramEdge | undefined) =>
	!!life &&
	e?.kind === 'message' &&
	e.props.create === undefined &&
	e.props.destroy === undefined &&
	(life.type === 'create' ? e.targetId === life.id : [e.sourceId, e.targetId].includes(life.id));

/**
 * `create`/`destroy` als RawBlock direkt vor einer passenden Nachricht liest der Parser als
 * Nachrichten-Option (T135 C3); das Modell übernimmt sie, damit es dem Re-Parse gleicht. Steht vor
 * einer Nachricht mit Option eine solche Rohzeile, läse der Parser beide roh: abgelehnt.
 */
function absorbLifecycle(doc: DiagramDocument): DiagramDocument {
	const raws = new Map(doc.rawBlocks.map((r) => [r.id, r]));
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const lifeOf = (id: string | undefined) => {
		const raw = id === undefined ? undefined : raws.get(id);
		return raw ? lifecycleLine(raw.rawText) : null;
	};
	const absorbed = new Map<string, Record<string, unknown>>();
	const gone = new Set<string>();
	const scan = (ids: string[]) =>
		ids.forEach((id, i) => {
			const e = edges.get(id);
			const life = lifeOf(id);
			if (e?.kind === 'message' && (e.props.create ?? e.props.destroy) !== undefined)
				if (lifeOf(ids[i - 1])) throw new Error(t('services.sequence.err.lifecycleTwice'));
			if (!fits(life, edges.get(ids[i + 1])) || lifeOf(ids[i - 1])) return;
			const raw = raws.get(id)!.rawText;
			absorbed.set(
				ids[i + 1],
				life!.type === 'create'
					? { create: life!.id, sourceCreate: raw }
					: { destroy: life!.id, sourceDestroy: raw }
			);
			gone.add(id);
		});
	scan(doc.order);
	doc.containers.forEach((c) => c.sections.forEach((s) => scan(s.memberIds)));
	if (absorbed.size === 0) return doc;
	let next: DiagramDocument = {
		...doc,
		order: doc.order.filter((id) => !gone.has(id)),
		containers: doc.containers.map((c) => ({
			...c,
			sections: c.sections.map((s) => ({
				...s,
				memberIds: s.memberIds.filter((id) => !gone.has(id))
			}))
		})),
		rawBlocks: doc.rawBlocks.filter((r) => !gone.has(r.id)),
		edges: doc.edges.map((e) =>
			absorbed.has(e.id) ? { ...e, props: { ...e.props, ...absorbed.get(e.id) } } : e
		),
		modelVersion: doc.modelVersion + 1
	};
	for (const props of absorbed.values()) {
		const id = props.create;
		const node = typeof id === 'string' ? next.nodes.find((n) => n.id === id) : undefined;
		const life = lifecycleLine(String(props.sourceCreate));
		if (node && life?.type === 'create') {
			const { kind, label } = life;
			next = updateNode(next, node.id, {
				kind,
				shape: kind,
				label,
				props: { ...node.props, implicit: true, base: { kind, label } }
			});
		}
	}
	return next;
}

/**
 * Gemeinsamer Abschluss jedes Sequenz-Commands. Normalisieren: verwaiste `base` entfernen,
 * ungenannte implizite Teilnehmer entfernen bzw. deklarieren, Serializer-Deklarationen übernehmen,
 * Teilnehmer in Parse-Reihenfolge. Gate: Aktivierungs-Bilanz, create/destroy wie mermaid-db und
 * Lesbarkeit der Nachrichtenzeilen; Verletzung lehnt das Command ab.
 */
export function finish(next: DiagramDocument, before: DiagramDocument): DiagramDocument {
	const doc = sortParticipants(
		declarePending(dropUnused(dropStaleBase(absorbLifecycle(next)), before))
	);
	if (repairActivations(doc) !== doc)
		throw new Error(t('canvas.err.deactivationWithoutActivation'));
	checkReferences(doc, before);
	checkBoxes(doc);
	checkLifecycle(doc);
	checkMessages(doc);
	return doc;
}

/** Sequenz-Command, dessen Ergebnis immer durch `finish` läuft. */
export function command(
	label: string,
	run: (doc: DiagramDocument, ctx: CommandContext) => DiagramDocument
): Command {
	return { label, do: (doc, ctx) => finish(run(doc, ctx), doc) };
}

function removeSection(doc: DiagramDocument, cid: string, index: number) {
	return setContainer(doc, cid, (c) => {
		const sections = c.sections.map((s, i) =>
			i === index - 1 ? { ...s, memberIds: [...s.memberIds, ...c.sections[index].memberIds] } : s
		);
		sections.splice(index, 1);
		return { ...c, sections };
	});
}

function removeParticipant(doc: DiagramDocument, id: string) {
	const node = doc.nodes.find((n) => n.id === id)!;
	if (node.props.base && !createdBy(doc, id))
		throw new Error(t('canvas.err.participantNotEditable', { id }));
	if (
		doc.rawBlocks.some((r) => rawEvents(r.rawText).uses.includes(id) || rawActive(r).includes(id))
	) {
		throw new Error(t('canvas.err.participantInRaw', { id }));
	}
	let next = doc;
	for (const n of doc.nodes) {
		const ps = (n.props.participants as string[] | undefined) ?? [];
		if (n.kind === 'note' && ps.includes(id)) next = removeNode(next, n.id, 'cascade');
	}
	return removeNode(next, id, 'cascade');
}

/** Gruppe samt Teilnehmern (mit deren Notizen und Nachrichten) und Kommentaren. */
function removeBox(doc: DiagramDocument, id: string) {
	const box = doc.containers.find((c) => c.id === id)!;
	const next = box.sections[0].memberIds
		.filter((m) => isParticipant(doc, m))
		.reduce(removeParticipant, doc);
	return removeContainer(next, id, 'cascade');
}

/** Löscht Elemente; bereits entfernte IDs werden übersprungen. */
export function deleteElements(ids: readonly string[]): Command {
	return command(t('canvas.cmd.delete'), (doc) => {
		let next = doc;
		for (const id of ids) {
			const sec = sectionOf(next, id);
			if (sec && sec.index > 0) next = removeSection(next, sec.container.id, sec.index);
			else if (isBox(next, id)) next = removeBox(next, id);
			else if (next.containers.some((c) => c.id === id))
				next = removeContainer(next, id, 'cascade');
			else if (isParticipant(next, id)) next = removeParticipant(next, id);
			else if (next.nodes.some((n) => n.id === id)) next = removeNode(next, id, 'cascade');
			else if (next.edges.some((e) => e.id === id)) next = removeEdge(next, id);
		}
		return repairActivations(next);
	});
}

/** Vorgabe-Label je Blockart; rect trägt Mermaid-Syntax (Farbe) und bleibt unübersetzt. */
const DEFAULT_LABEL = (kind: BlockKind): string =>
	kind === 'rect'
		? 'rgb(230, 230, 250)'
		: kind === 'break'
			? t('services.sequence.default.break')
			: t(`canvas.default.${kind}`);

/**
 * `autonumber` im Dokument (auch in größeren RawBlocks, `RawEvents.numbering`): eine sichtbare,
 * eine nicht entfernbare (Mischzeile, O-175).
 */
const numbering = (doc: DiagramDocument) => {
	const all = doc.rawBlocks.map((r) => rawEvents(r.rawText).numbering);
	return { visible: all.some((n) => n?.visible), fixed: all.some((n) => n?.fixed) };
};

/**
 * Schalter "Nummerierung" (T135, F-06): an setzt `autonumber` an den Diagrammanfang und entfernt
 * die übrigen (nur `autonumber off`); aus entfernt alle `autonumber`-Anweisungen. Entfernt werden
 * nur die Zeilen der Anweisungen (Adapter `withoutAutonumber`), Leerzeilen davor und danach
 * bleiben; ein RawBlock ohne Resttext entfällt. Ein Command = ein Undo-Schritt. Ist der Zustand
 * schon erreicht oder steht `autonumber` in einer Mischzeile (Schalter gesperrt), bleibt das
 * Modell unverändert.
 */
export function setAutonumber(on: boolean): Command {
	const label = on
		? t('services.sequence.cmd.autonumberOn')
		: t('services.sequence.cmd.autonumberOff');
	return command(label, (doc, ctx) => {
		const rest = new Map(doc.rawBlocks.map((r) => [r.id, withoutAutonumber(r.rawText)]));
		const touched = doc.rawBlocks.some((r) => rest.get(r.id) !== r.rawText);
		const state = numbering(doc);
		if (state.fixed || (on ? state.visible : !touched)) return doc;
		const drop = new Set(doc.rawBlocks.filter((r) => rest.get(r.id) === '').map((r) => r.id));
		const keep = (ids: string[]) => ids.filter((id) => !drop.has(id));
		const id = on ? ctx.newId('n') : '';
		return {
			...doc,
			order: on ? [id, ...keep(doc.order)] : keep(doc.order),
			containers: doc.containers.map((c) =>
				c.sections.some((s) => s.memberIds.some((m) => drop.has(m)))
					? { ...c, sections: c.sections.map((s) => ({ ...s, memberIds: keep(s.memberIds) })) }
					: c
			),
			rawBlocks: [
				...doc.rawBlocks
					.filter((r) => !drop.has(r.id))
					.map((r) => (rest.get(r.id) === r.rawText ? r : { ...r, rawText: rest.get(r.id)! })),
				...(on ? [{ id, rawText: autonumberText(doc) }] : [])
			],
			modelVersion: doc.modelVersion + 1
		};
	});
}

/** Block hinter dem Anker oder um ein vorhandenes Element (`wrapId`). */
export function addContainer(kind: BlockKind, anchor?: string, wrapId?: string): Command {
	return command(t('canvas.cmd.addBlock'), (doc, ctx) => {
		let at = pointAfter(doc, anchor);
		if (wrapId) {
			const found = isParticipant(doc, wrapId) || isBox(doc, wrapId) ? null : locate(doc, wrapId);
			if (!found) throw new Error(t('canvas.err.notWrappable', { id: wrapId }));
			at = found;
		}
		const id = ctx.newId('c');
		const label = DEFAULT_LABEL(kind);
		let next = addContainerOp(
			doc,
			{
				id,
				kind,
				label,
				direction: '',
				parentId: at.parent,
				sections: [{ label, memberIds: [] }],
				props: {},
				sourceText: ''
			},
			at.section
		);
		next = reorder(next, id, at.index);
		return wrapId ? moveToContainer(next, wrapId, id, 0) : next;
	});
}

export function addSection(cid: string): Command {
	return command(t('canvas.cmd.addSection'), (doc) => {
		const c = doc.containers.find((x) => x.id === cid);
		if (!c || !SECTION_KEYWORD[c.kind]) throw new Error(t('canvas.err.noSections', { id: cid }));
		return setContainer(doc, cid, (x) => ({
			...x,
			sections: [...x.sections, { label: t('canvas.default.section'), memberIds: [] }]
		}));
	});
}

/**
 * Neue Teilnehmer-Gruppe (T135 C2). Mit Teilnehmer: Gruppe vor seinem ersten Auftreten (ohne
 * seine bisherige Deklaration), er wird ihr erstes Mitglied (ausdrücklich deklariert); ohne:
 * leere Gruppe am Diagrammanfang. Die Teilnehmer-Reihenfolge bleibt: vor ihm stehende, bis dahin
 * nicht aufgetretene implizite Teilnehmer werden vor der Gruppe deklariert; geht das nicht, wird
 * das Command abgelehnt.
 */
export function addBox(participant?: string): Command {
	return command(t('services.sequence.cmd.addBox'), (doc, ctx) => {
		const id = ctx.newId('c');
		const label = t('services.sequence.default.box');
		const box: Container = {
			id,
			kind: 'box',
			label,
			direction: '',
			parentId: null,
			sections: [{ label, memberIds: [] }],
			props: { color: '' },
			sourceText: ''
		};
		if (!participant) return reorder(addContainerOp(doc, box), id, 0);
		requireParticipant(doc, participant);
		const prev = actorOrder(doc);
		const pos = prev.indexOf(participant);
		const later = new Set(prev.slice(pos));
		// Ohne die bisherige Deklaration des Teilnehmers (sie wandert in die Gruppe).
		let next: DiagramDocument = {
			...doc,
			order: doc.order.filter((x) => x !== participant),
			containers: doc.containers.map((c) => ({
				...c,
				sections: c.sections.map((s) => ({
					...s,
					memberIds: s.memberIds.filter((m) => m !== participant)
				}))
			}))
		};
		const refs = references(next);
		const tops = next.order.map((top) => [...refs(top).named, ...refs(top).nodes]);
		const found = tops.findIndex((ps) => ps.some((p) => later.has(p)));
		const at = found < 0 ? next.order.length : found;
		const met = new Set(tops.slice(0, at).flat());
		const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
		const early = prev
			.slice(0, pos)
			.filter((p) => !met.has(p) && declarable(nodes.get(p)) && tops[at]?.includes(p));
		for (const p of early) {
			const props = { ...nodes.get(p)!.props };
			delete props.implicit;
			next = updateNode(next, p, { props });
		}
		next = { ...next, order: [...next.order.slice(0, at), ...early, ...next.order.slice(at)] };
		next = reorder(addContainerOp(next, box), id, at + early.length);
		next = intoBox(next, participant, id);
		if (actorOrder(next).join('\n') !== prev.join('\n'))
			throw new Error(t('services.sequence.err.boxOrder', { id: participant }));
		return next;
	});
}

/** Teilnehmer ans Ende der Gruppe, ausdrücklich deklariert. */
function intoBox(doc: DiagramDocument, participant: string, box: string): DiagramDocument {
	const node = doc.nodes.find((n) => n.id === participant)!;
	if (node.props.base) throw new Error(t('canvas.err.participantNotEditable', { id: participant }));
	const props = { ...node.props };
	delete props.implicit;
	let next = updateNode(doc, participant, { props });
	if (locate(next, participant) === null) {
		next = { ...next, order: [...next.order, participant], modelVersion: next.modelVersion + 1 };
	}
	next = moveToContainer(next, participant, box, 0);
	const members = next.containers.find((c) => c.id === box)!.sections[0].memberIds;
	return reorder(next, participant, members.length);
}

/** Teilnehmer in die Gruppe `box` oder (`null`) aus seiner Gruppe direkt hinter sie. */
export function setParticipantBox(participant: string, box: string | null): Command {
	return command(t('services.sequence.cmd.boxMember'), (doc) => {
		requireParticipant(doc, participant);
		const at = locate(doc, participant);
		const current = at?.parent && isBox(doc, at.parent) ? at.parent : null;
		if (current === box) return doc;
		if (box !== null) {
			if (!isBox(doc, box)) throw new Error(t('canvas.err.unknownId', { id: box }));
			return intoBox(doc, participant, box);
		}
		const next = moveToContainer(doc, participant, null, 0);
		return reorder(next, participant, doc.order.indexOf(current!) + 1);
	});
}

/** Farbe der Gruppe; nur Allow-Liste (`isBoxColor`), `''` ohne Farbe. */
export function setBoxColor(id: string, color: string): Command {
	return command(t('services.sequence.cmd.boxColor'), (doc) => {
		if (!isBox(doc, id)) throw new Error(t('canvas.err.unknownId', { id }));
		if (color !== '' && !isBoxColor(color)) throw new Error(t('services.sequence.err.boxColor'));
		return setContainer(doc, id, (c) => ({ ...c, sourceText: '', props: { ...c.props, color } }));
	});
}

/** Einrückung der ersten nicht leeren Zeile eines Rohtexts. */
const indentOf = (text: unknown) => /^([ \t]*)\S/m.exec(String(text ?? ''))?.[1];

/**
 * Löst die Gruppe auf: Mitglieder stehen an ihrer Stelle auf oberster Ebene, Kommentare darin
 * mit der Einrückung der Gruppe (sonst bestimmte ein tiefer eingerückter die oberste Ebene).
 */
export function ungroupBox(id: string): Command {
	return command(t('services.sequence.cmd.ungroupBox'), (doc) => {
		const box = doc.containers.find((c) => c.id === id && c.kind === 'box');
		if (!box) throw new Error(t('canvas.err.unknownId', { id }));
		const members = box.sections[0].memberIds;
		const at = doc.order.indexOf(id);
		const inside = new Set(members);
		const indent = indentOf(box.sourceText) ?? indentOf(box.props.sourceEnd);
		return {
			...doc,
			order: [...doc.order.slice(0, at), ...members, ...doc.order.slice(at + 1)],
			containers: doc.containers.filter((c) => c.id !== id),
			nodes: doc.nodes.map((n) =>
				inside.has(n.id) ? { ...n, parentId: null, sourceText: '' } : n
			),
			comments:
				indent === undefined
					? doc.comments
					: doc.comments.map((c) =>
							inside.has(c.id) ? { ...c, text: c.text.replace(/^[ \t]*(?=[%#])/m, indent) } : c
						),
			modelVersion: doc.modelVersion + 1
		};
	});
}
