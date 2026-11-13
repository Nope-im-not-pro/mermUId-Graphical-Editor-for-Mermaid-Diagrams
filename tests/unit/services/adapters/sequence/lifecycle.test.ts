/**
 * T135 C3 (F-06): `create` / `destroy` als Nachrichten-Option (`props.create` bzw. `props.destroy`
 * = Teilnehmer-ID, Rohzeile in `props.sourceCreate`/`props.sourceDestroy`), nur direkt vor der
 * passenden Nachricht (dazwischen nur Leerzeilen), sonst RawBlock wie bisher. Abgleich gegen
 * mermaid 12.2 (`getCreatedActors`/`getDestroyedActors`: Index der zugehörigen Nachricht).
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { lifecycleLine, parse, serialize } from '../../../../../src/lib/services/adapters/sequence';
import { updateEdge, updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface SequenceDb {
	getActors(): Map<string, { type: string; description: string }>;
	getMessages(): { from?: string; to?: string }[];
	getCreatedActors(): Map<string, number>;
	getDestroyedActors(): Map<string, number>;
}

/** mermaid-db: Teilnehmer und je erzeugtem/zerstörtem Teilnehmer die zugehörige Nachricht. */
async function mermaidLife(text: string) {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as SequenceDb;
	const messages = db.getMessages();
	const at = (map: Map<string, number>) =>
		[...map].map(([id, i]) => [id, messages[i]?.from, messages[i]?.to]);
	return {
		actors: [...db.getActors()].map(([id, a]) => [id, a.type, a.description]),
		created: at(db.getCreatedActors()),
		destroyed: at(db.getDestroyedActors())
	};
}

/** Modell: Teilnehmer und je Nachricht mit Option [ID, Quelle, Ziel]. */
function modelLife(doc: DiagramDocument) {
	const with_ = (key: string) =>
		doc.edges
			.filter((e) => typeof e.props[key] === 'string')
			.map((e) => [e.props[key], e.sourceId, e.targetId]);
	return {
		actors: doc.nodes.filter((n) => n.kind !== 'note').map((n) => [n.id, n.kind, n.label]),
		created: with_('create'),
		destroyed: with_('destroy')
	};
}

const dir = join(__dirname, '../../../../fixtures/sequence/roundtrip');

describe('create/destroy als Nachrichten-Option (T135 C3)', () => {
	it('create direkt vor der Nachricht an den Teilnehmer: Option, byte-gleich', async () => {
		const text = 'sequenceDiagram\n    create participant C\n    A->>C: x\n';
		const doc = ok(text);
		expect(doc.rawBlocks).toEqual([]);
		const [e] = doc.edges;
		expect(e.props).toMatchObject({ create: 'C', sourceCreate: '    create participant C\n' });
		expect(e.sourceText).toBe('    A->>C: x\n');
		expect(doc.order).toEqual([e.id]);
		const c = doc.nodes.find((n) => n.id === 'C')!;
		expect(c).toMatchObject({ kind: 'participant', label: 'C', sourceText: '' });
		expect(c.props).toEqual({ implicit: true, base: { kind: 'participant', label: 'C' } });
		expect(modelLife(doc)).toEqual(await mermaidLife(text));
		expect(serialize(doc)).toBe(text);
	});

	it.each([
		['actor mit Alias', 'sequenceDiagram\nA->>B: a\nCREATE actor C as Carl\nB->>C: x\n'],
		['Leerzeilen dazwischen', 'sequenceDiagram\nA->>B: a\n\ncreate participant C\n\n\nB-->>C: x\n'],
		['in einem Block', 'sequenceDiagram\nloop l\n  create participant C\n  A->>C: x\nend\n'],
		['Selbstnachricht', 'sequenceDiagram\ncreate actor C\nC->>C: x\n'],
		[
			'nach Aktivierung',
			'sequenceDiagram\nA->>B: a\nactivate C\ncreate participant C\nB->>C: x\ndeactivate C\n'
		],
		['später deklariert', 'sequenceDiagram\ncreate participant C\nA->>C: x\nactor C\n'],
		[
			'später als actor mit Alias deklariert',
			'sequenceDiagram\ncreate participant C\nA->>C: x\nactor C as Foo\n'
		],
		[
			'später als participant mit Alias deklariert',
			'sequenceDiagram\ncreate actor C\nA->>C: x\nparticipant C as Foo\n'
		],
		[
			'später gleich mit Alias deklariert',
			'sequenceDiagram\ncreate participant C\nA->>C: x\nparticipant C as Foo\n'
		],
		['destroy Ziel', 'sequenceDiagram\nA->>B: a\ndestroy B\nA-xB: x\n'],
		['destroy Quelle', 'sequenceDiagram\nA->>B: a\n  destroy A\n\n  A-->>B: x\n'],
		[
			'beides an verschiedenen Nachrichten',
			'sequenceDiagram\ncreate participant C\nA->>C: x\ndestroy C\nC->>A: y\n'
		]
	])('%s: Option wie mermaid, byte-gleich', async (_, text) => {
		const doc = ok(text);
		expect(doc.rawBlocks).toEqual([]);
		expect(modelLife(doc)).toEqual(await mermaidLife(text));
		expect(serialize(doc)).toBe(text);
		expect(serialize(ok(serialize(doc)))).toBe(text);
	});

	it.each(['actor', 'participant'])(
		'spätere Deklaration %s mit Alias: Modell gleich Re-Parse, create-Zeile bleibt',
		(kind) => {
			const text = `sequenceDiagram\n  create participant C\n  A->>C: x\n  ${kind} C as Foo\n`;
			const doc = ok(text);
			expect(doc.edges[0].props.create).toBe('C');
			expect(doc.nodes.find((n) => n.id === 'C')).toMatchObject({ kind, label: 'Foo' });
			const again = ok(serialize(doc));
			expect(serialize(again)).toBe(text);
			expect(modelLife(again)).toEqual(modelLife(doc));
		}
	);

	it('create mit Alias setzt Typ und Label des Teilnehmers', () => {
		const doc = ok('sequenceDiagram\ncreate actor C as Carl\nA->>C: x\n');
		expect(doc.nodes.map((n) => [n.id, n.kind, n.label])).toEqual([
			['C', 'actor', 'Carl'],
			['A', 'participant', 'A']
		]);
		expect(doc.nodes[0].props.base).toEqual({ kind: 'actor', label: 'Carl' });
	});

	it.each([
		['Notiz dazwischen', 'create participant C\nNote over A: n\nA->>C: x\n'],
		['Kommentar dazwischen', 'create participant C\n%% c\nA->>C: x\n'],
		['Aktivierung dazwischen', 'A->>B: a\ncreate participant C\nactivate A\nA->>C: x\n'],
		['Nachricht an anderen', 'A->>B: a\ncreate participant C\nA->>B: x\nA->>C: y\n'],
		['schon genannt', 'A->>C: a\ncreate participant C\nA->>C: x\n'],
		[
			'create und destroy vor einer Nachricht',
			'A->>B: a\ncreate participant C\ndestroy A\nA->>C: x\n'
		],
		[
			'destroy und create vor einer Nachricht',
			'A->>B: a\ndestroy A\ncreate participant C\nA->>C: x\n'
		],
		['mit Semikolon', 'create participant C;\nA->>C: x\n'],
		['mit Kommentar', 'create participant C %% c\nA->>C: x\n'],
		['Konfiguration', 'create participant C@{ "type": "database" }\nA->>C: x\n'],
		['Dateiende', 'A->>B: a\ncreate participant C\n'],
		['Block-Ende danach', 'loop l\nA->>B: a\ncreate participant C\nend\nA->>C: x\n'],
		['destroy ohne passende Nachricht', 'A->>B: a\ndestroy C\nA->>B: x\n'],
		['destroy mit Kommentar', 'A->>B: a\ndestroy B %% c\nA->>B: x\n'],
		['destroy vor Notiz', 'A->>B: a\ndestroy B\nNote over B: n\nA->>B: x\n'],
		['destroy hinter der Nachricht', 'A->>B: a\nA->>B: x\ndestroy B\n'],
		['Titel in Nachrichtenform', 'create participant C\ntitle A->>C: x\nA->>C: y\n'],
		['Gruppe', 'box G\ncreate participant C\nend\nA->>C: x\n']
	])('%s: bleibt RawBlock (Bestand), byte-gleich', (_, body) => {
		const text = `sequenceDiagram\n${body}`;
		const doc = ok(text);
		expect(doc.edges.some((e) => 'create' in e.props || 'destroy' in e.props)).toBe(false);
		expect(doc.rawBlocks.some((r) => /^(?:create|destroy|box)\b/im.test(r.rawText))).toBe(true);
		expect(serialize(doc)).toBe(text);
	});
});

describe('create/destroy kanonisch schreiben (T135 C3)', () => {
	it('Option ohne Rohzeile: create/destroy mit Einrückung der Liste', async () => {
		const doc = ok('sequenceDiagram\n  A->>B: a\n  B->>C: x\n  C->>A: y\n');
		const c = doc.nodes.find((n) => n.id === 'C')!;
		let next = updateNode(doc, 'C', {
			kind: 'actor',
			shape: 'actor',
			label: 'Carl',
			props: { implicit: true, base: { kind: 'actor', label: 'Carl' } }
		});
		expect(c.props).toEqual({ implicit: true });
		next = updateEdge(next, 'e2', { props: { ...doc.edges[1].props, create: 'C' } });
		next = updateEdge(next, 'e3', { props: { ...doc.edges[2].props, destroy: 'C' } });
		const text = serialize(next);
		expect(text).toBe(
			'sequenceDiagram\n  A->>B: a\n  create actor C as Carl\n  B->>C: x\n  destroy C\n  C->>A: y\n'
		);
		expect(modelLife(ok(text))).toEqual(modelLife(next));
		expect(modelLife(next)).toEqual(await mermaidLife(text));
	});

	it('Label des erzeugten Teilnehmers geändert: create-Zeile neu, keine zweite Deklaration', async () => {
		const doc = ok('sequenceDiagram\n    create actor C as Cc\n    A->>C: x\n');
		const text = serialize(updateNode(doc, 'C', { label: 'Neu' }));
		expect(text).toBe('sequenceDiagram\n    create actor C as Neu\n    A->>C: x\n');
		expect(modelLife(ok(text)).actors).toEqual((await mermaidLife(text)).actors);
	});

	it('Rohzeile mit anderer ID oder ohne Option wird nicht geschrieben', () => {
		const doc = ok('sequenceDiagram\ncreate participant C\nA->>C: x\ndestroy C\nC->>A: y\n');
		const [e1, e2] = doc.edges;
		let next = updateEdge(doc, e2.id, { props: { ...e2.props, destroy: 'A' } });
		const props = { ...e1.props };
		delete props.create;
		next = updateEdge(next, e1.id, { props });
		// Geänderte Nachrichten verlieren den Rohtext: Einrückung der obersten Ebene (4).
		expect(serialize(next)).toBe('sequenceDiagram\n    A->>C: x\n    destroy A\n    C->>A: y\n');
	});
});

describe('lifecycleLine (Adapter-Grammatik, T135 C3)', () => {
	it.each([
		['create participant C', { type: 'create', id: 'C', kind: 'participant', label: 'C' }],
		[
			'  \n  Create Actor C as Carl Z\n',
			{ type: 'create', id: 'C', kind: 'actor', label: 'Carl Z' }
		],
		['destroy C\r\n', { type: 'destroy', id: 'C' }],
		['\ndestroy  Web App\n', { type: 'destroy', id: 'Web App' }]
	])('%j', (text, expected) => expect(lifecycleLine(text)).toEqual(expected));

	it.each([
		'create participant C;',
		'create participant C@{ "type": "database" }',
		'create participant C\nA->>C: x',
		'create C',
		'destroy',
		'destroy A;',
		'participant C',
		'create participant C as X; D',
		`create participant ${'C'.repeat(2001)}`
	])('%j: keine Option', (text) => expect(lifecycleLine(text)).toBeNull());
});

describe('Roundtrip-Fixture create/destroy (LF und CRLF)', () => {
	const lf = readFileSync(join(dir, 'lifecycle.mmd'), 'utf8');
	const crlf = readFileSync(join(dir, 'lifecycle-crlf.mmd'), 'utf8');

	it('Fixtures: LF ohne CR, CRLF durchgehend, sonst gleich', () => {
		expect(lf).not.toContain('\r');
		expect(crlf.split('\r\n').join('\n')).toBe(lf);
		expect(crlf.replace(/\r\n/g, '')).not.toContain('\n');
	});

	it.each([
		['LF', lf],
		['CRLF', crlf]
	])('%s: Optionen wie mermaid, Rest RawBlock, byte-gleich', async (_, text) => {
		const doc = ok(text);
		const life = modelLife(doc);
		const m = await mermaidLife(text);
		expect(life.actors).toEqual(m.actors);
		expect(life.created).toEqual([
			['C', 'A', 'C'],
			['D', 'C', 'D']
		]);
		expect(life.destroyed).toEqual([
			['D', 'D', 'C'],
			['C', 'A', 'C']
		]);
		// mermaid führt zusätzlich E und B (RawBlock: nicht direkt vor der Nachricht).
		expect(m.created.map(([id]) => id)).toEqual(['C', 'D', 'E']);
		expect(m.created.slice(0, 2)).toEqual(life.created);
		expect(m.destroyed.map(([id]) => id)).toEqual(['D', 'C', 'B']);
		expect(m.destroyed.slice(0, 2)).toEqual(life.destroyed);
		expect(
			doc.rawBlocks.map((r) => r.rawText.trim()).filter((t) => /^(?:create|destroy)/.test(t))
		).toEqual(['create participant E', 'destroy B']);
		expect(serialize(doc)).toBe(text);
		expect(serialize(ok(serialize(doc)))).toBe(text);
	});
});
