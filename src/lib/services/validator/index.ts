/**
 * Modell-Validator (T15): reine Funktion `validateModel(doc) -> ModelIssue[]`.
 * Meldet Modell-Fehler, bricht nie ab (§6.1); MVP nur Markierung (FA-13).
 * Meldungen nennen nur Element-IDs, keine Pfade oder Systeminfos (§10).
 *
 * Entscheidungen:
 * - Layout-Positionen unbekannter IDs sind kein Fehler: Positionen sind Metadaten, und eine
 *   im Code neu angelegte gelöschte ID erbt ihre noch vorhandene Position (§8).
 * - Knoten (außer Notizen) ohne Eintrag in `order` oder `memberIds` sind gültig:
 *   flowchart-Knoten, die nur über Kanten genannt werden, und Sequence-Teilnehmer, die nur in
 *   Nachrichten oder Notizen vorkommen, haben keinen. Ein vorhandener Knoten-Eintrag ist die Stelle der Anweisung, nicht
 *   die Mitgliedschaft (der flowchart-Parser legt ihn im Rahmen der Anweisung an, `parentId`
 *   vergibt der zuerst schließende nennende Subgraph); er wird daher nicht gegen `parentId`
 *   abgeglichen. Notizen sind eigene Anweisungen und brauchen einen Eintrag.
 * - Kanten, Container, RawBlocks, Kommentare und Notizen ohne Eintrag sind Fehler: der
 *   Serializer schreibt nur aus `order`/`memberIds`, das Element ginge still verloren. Für
 *   Kanten und Container muss der Eintrag zur `parentId` passen.
 * - Knoten und Container mit gleicher ID sind mermaid-Semantik (eine Entität, SUBSET T10) und
 *   ergeben nur einen Hinweis `node-container-id`; jede weitere Doppelung ist ein Fehler.
 *
 * Reihenfolge: Klassen in fester Folge (doppelte IDs, unbekannte IDs, Container-Referenzen,
 * dangling Edges), innerhalb einer Klasse in Dokument-Reihenfolge. Laufzeit linear.
 */
import { danglingEdges } from '../../model/operations';
import { msg, type MessageKey } from '../i18n';
import type { DiagramDocument } from '../../model/types';

export type ModelIssueKind =
	'duplicate-id' | 'node-container-id' | 'unknown-id' | 'invalid-container-ref' | 'dangling-edge';

export interface ModelIssue {
	kind: ModelIssueKind;
	/** `error` = Modell-Fehler, `hint` = zulässig, aber erklärungsbedürftig. */
	severity: 'error' | 'hint';
	/** ID des betroffenen Elements bzw. des unbekannten Eintrags. */
	elementId: string;
	message: string;
}

const CLASSDEF_PREFIX = 'classDef:';

type Issues = ModelIssue[];

function add(
	issues: Issues,
	kind: ModelIssueKind,
	elementId: string,
	message: string,
	severity: ModelIssue['severity'] = 'error'
): void {
	issues.push({ kind, severity, elementId, message });
}

/** Element mit parentId (Knoten, Kante, Container). */
interface Placed {
	id: string;
	parentId: string | null;
}

function placedElements(doc: DiagramDocument): Placed[] {
	return [...doc.nodes, ...doc.edges, ...doc.containers];
}

function checkDuplicates(doc: DiagramDocument, issues: Issues): void {
	const seen = new Map<string, MessageKey[]>();
	const lists: [MessageKey, { id: string }[]][] = [
		['services.validator.kind.node', doc.nodes],
		['services.validator.kind.edge', doc.edges],
		['services.validator.kind.container', doc.containers],
		['services.validator.kind.rawBlock', doc.rawBlocks],
		['services.validator.kind.comment', doc.comments]
	];
	for (const [label, list] of lists) {
		for (const el of list) {
			const found = seen.get(el.id);
			if (found) found.push(label);
			else seen.set(el.id, [label]);
		}
	}
	for (const [id, labels] of seen) {
		if (labels.length < 2) continue;
		if (
			labels.length === 2 &&
			labels[0] === 'services.validator.kind.node' &&
			labels[1] === 'services.validator.kind.container'
		) {
			add(
				issues,
				'node-container-id',
				id,
				msg('services.validator.nodeContainerId', { id }),
				'hint'
			);
		} else {
			const kinds = labels.map((label) => msg(label)).join(', ');
			add(issues, 'duplicate-id', id, msg('services.validator.duplicateId', { id, kinds }));
		}
	}
}

function checkUnknownIds(doc: DiagramDocument, issues: Issues): void {
	const known = new Set<string>();
	for (const list of [doc.nodes, doc.edges, doc.containers, doc.rawBlocks, doc.comments]) {
		for (const el of list) known.add(el.id);
	}
	const classNames = new Set(doc.classDefs.map((c) => c.name));
	// classDef-Anweisungen stehen als `classDef:<name>` in `order` und (im Subgraphen) in `memberIds`.
	const isKnown = (id: string) =>
		known.has(id) ||
		(id.startsWith(CLASSDEF_PREFIX) && classNames.has(id.slice(CLASSDEF_PREFIX.length)));
	for (const id of doc.order) {
		if (!isKnown(id)) {
			add(issues, 'unknown-id', id, msg('services.validator.unknownOrderEntry', { id }));
		}
	}
	for (const c of doc.containers) {
		for (const section of c.sections) {
			for (const m of section.memberIds) {
				if (!isKnown(m)) {
					add(
						issues,
						'unknown-id',
						m,
						msg('services.validator.unknownMember', { container: c.id, id: m })
					);
				}
			}
		}
	}
	const nodeIds = new Set(doc.nodes.map((n) => n.id));
	for (const n of doc.nodes) {
		const list = n.props.participants;
		if (n.kind !== 'note' || !Array.isArray(list)) continue;
		for (const p of list) {
			if (typeof p !== 'string' || !nodeIds.has(p)) {
				add(
					issues,
					'unknown-id',
					n.id,
					msg('services.validator.unknownParticipant', { id: n.id, participant: String(p) })
				);
			}
		}
	}
}

/** Container auf einem Zyklus der parentId-Kette (Färbung, jeder Container einmal besucht). */
function cyclicContainers(doc: DiagramDocument): Set<string> {
	const parents = new Map<string, string | null>();
	for (const c of doc.containers) if (!parents.has(c.id)) parents.set(c.id, c.parentId);
	const done = new Set<string>();
	const cyclic = new Set<string>();
	for (const start of parents.keys()) {
		const path: string[] = [];
		const onPath = new Map<string, number>();
		let cursor: string | null | undefined = start;
		while (cursor != null && parents.has(cursor) && !done.has(cursor)) {
			const at = onPath.get(cursor);
			if (at !== undefined) {
				for (const id of path.slice(at)) cyclic.add(id);
				break;
			}
			onPath.set(cursor, path.length);
			path.push(cursor);
			cursor = parents.get(cursor);
		}
		for (const id of path) done.add(id);
	}
	return cyclic;
}

function where(parentId: string | null): string {
	return parentId === null
		? msg('services.validator.whereTop')
		: msg('services.validator.whereContainer', { id: parentId });
}

function checkContainerRefs(doc: DiagramDocument, issues: Issues): void {
	const containerIds = new Set(doc.containers.map((c) => c.id));
	const placed = placedElements(doc);
	for (const el of placed) {
		if (el.parentId !== null && !containerIds.has(el.parentId)) {
			add(
				issues,
				'invalid-container-ref',
				el.id,
				msg('services.validator.missingParent', { parent: el.parentId, id: el.id })
			);
		}
	}
	const cyclic = cyclicContainers(doc);
	for (const c of doc.containers) {
		if (cyclic.delete(c.id)) {
			add(issues, 'invalid-container-ref', c.id, msg('services.validator.cycle', { id: c.id }));
		}
	}
	// Abgleich nur für Kanten und Container; Einträge mit Knoten-ID sind Anweisungsstellen.
	// Unbekannte parentId ist oben schon gemeldet und wird nicht doppelt abgeglichen.
	const nodeIds = new Set(doc.nodes.map((n) => n.id));
	const parentsById = new Map<string, (string | null)[]>();
	for (const el of [...doc.edges, ...doc.containers]) {
		if (el.parentId !== null && !containerIds.has(el.parentId)) continue;
		const found = parentsById.get(el.id);
		if (found) found.push(el.parentId);
		else parentsById.set(el.id, [el.parentId]);
	}
	const entries = new Set<string>();
	const mismatch = (id: string, expected: string | null, place: string) => {
		entries.add(id);
		const actual = parentsById.get(id);
		if (actual && !nodeIds.has(id) && !actual.includes(expected)) {
			add(
				issues,
				'invalid-container-ref',
				id,
				msg('services.validator.misplaced', { id, place, where: where(actual[0]) })
			);
		}
	};
	for (const id of doc.order) mismatch(id, null, msg('services.validator.placeTop'));
	for (const c of doc.containers) {
		for (const section of c.sections) {
			for (const m of section.memberIds)
				mismatch(m, c.id, msg('services.validator.placeContainer', { id: c.id }));
		}
	}
	const needEntry = [
		...doc.nodes.filter((n) => n.kind === 'note'),
		...doc.edges,
		...doc.containers,
		...doc.rawBlocks,
		...doc.comments
	];
	for (const el of needEntry) {
		if (!entries.has(el.id)) {
			add(issues, 'invalid-container-ref', el.id, msg('services.validator.lost', { id: el.id }));
		}
	}
}

function checkDangling(doc: DiagramDocument, issues: Issues): void {
	const ends = new Set([...doc.nodes, ...doc.containers].map((el) => el.id));
	for (const e of danglingEdges(doc)) {
		const missing: string[] = [];
		if (!ends.has(e.sourceId)) missing.push(msg('services.validator.source', { id: e.sourceId }));
		if (!ends.has(e.targetId)) missing.push(msg('services.validator.target', { id: e.targetId }));
		add(
			issues,
			'dangling-edge',
			e.id,
			msg('services.validator.dangling', {
				id: e.id,
				missing: missing.join(` ${msg('services.validator.and')} `)
			})
		);
	}
}

/** Prüft das Modell und liefert alle Befunde in deterministischer Reihenfolge. */
export function validateModel(doc: DiagramDocument): ModelIssue[] {
	const issues: Issues = [];
	checkDuplicates(doc, issues);
	checkUnknownIds(doc, issues);
	checkContainerRefs(doc, issues);
	checkDangling(doc, issues);
	return issues;
}
