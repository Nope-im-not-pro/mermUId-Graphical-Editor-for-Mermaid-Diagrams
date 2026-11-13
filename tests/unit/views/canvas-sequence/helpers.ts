import type { Command } from '../../../../src/lib/controllers/commands/history';
import { createSync, type SyncController } from '../../../../src/lib/controllers/sync';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { layoutSequence } from '../../../../src/lib/services/layout';
import { sequenceAdapter } from '../../../../src/lib/services/adapters/sequence';
import { fakeAdapters } from '../../controllers/sync/helpers';

export const SAMPLE = [
	'sequenceDiagram',
	'    participant A as Alice',
	'    actor B',
	'    A->>+B: Hallo',
	'    Note over A,B: Notiz',
	'    alt Fall',
	'        B-->>A: Ja',
	'    else Sonst',
	'        activate A',
	'        A-xB: Nein',
	'        deactivate A',
	'    end',
	'    autonumber',
	''
].join('\n');

export function parseOk(text: string): DiagramDocument {
	const result = sequenceAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

/** Fester Rahmen für Tests: Kommando wie im Sync-Controller, aber ohne Store. */
export function apply(doc: DiagramDocument, command: Command): DiagramDocument {
	let n = 900;
	return command.do(doc, { newId: (p) => `${p}${n++}` });
}

/**
 * Modell ohne generierte IDs und Quelltext: Teilnehmer in Layout-Reihenfolge, Zeilen in
 * Dokument-Reihenfolge (Container rekursiv mit Section-Labels).
 */
export function semantic(doc: DiagramDocument) {
	const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
	const edges = new Map(doc.edges.map((e) => [e.id, e]));
	const containers = new Map(doc.containers.map((c) => [c.id, c]));
	const layout = layoutSequence(doc, () => ({ width: 10, height: 10 }));
	const participants = Object.keys(layout.participants).map((id) => {
		const n = nodes.get(id)!;
		return { id, kind: n.kind, label: n.label };
	});
	const body = (ids: readonly string[]): unknown[] =>
		ids.flatMap((id): unknown[] => {
			const e = edges.get(id);
			if (e) {
				const p = e.props;
				return [
					[
						e.kind,
						e.sourceId,
						e.targetId,
						e.label,
						e.lineStyle,
						e.arrowHead,
						p.arrow,
						p.activation,
						// Nachrichten-Option create/destroy (T135 C3), nur wenn gesetzt.
						...(p.create !== undefined || p.destroy !== undefined ? [p.create, p.destroy] : [])
					]
				];
			}
			const c = containers.get(id);
			if (c) return [[c.kind, c.label, c.sections.map((s) => [s.label, body(s.memberIds)])]];
			const n = nodes.get(id);
			if (n?.kind === 'note') return [['note', n.props.placement, n.props.participants, n.label]];
			return [];
		});
	return { participants, body: body(doc.order) };
}

export function docOf(sync: SyncController): DiagramDocument {
	let doc!: DiagramDocument;
	sync.commands.subscribe((s) => (doc = s.doc))();
	return doc;
}

export function codeOf(sync: SyncController): string {
	let code = '';
	sync.subscribe((s) => (code = s.code))();
	return code;
}

const timer = { set: () => 0, clear: () => {} };

export function makeSync(text: string) {
	return createSync(text, { adapters: fakeAdapters, timer });
}

/** Command über den Sync-Controller; Re-Parse des erzeugten Codes muss dasselbe Modell geben. */
export async function roundTrip(text: string, command: Command) {
	const sync = await makeSync(text);
	await sync.execute(command);
	const doc = docOf(sync);
	const reparsed = parseOk(codeOf(sync));
	sync.dispose();
	return { doc, reparsed, same: [semantic(doc), semantic(reparsed)] as const };
}
