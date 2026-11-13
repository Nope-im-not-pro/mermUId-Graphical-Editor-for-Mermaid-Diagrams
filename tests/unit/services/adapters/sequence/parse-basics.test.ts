import { describe, expect, it } from 'vitest';
import { parse } from '../../../../../src/lib/services/adapters/sequence';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

describe('Header', () => {
	it('erkennt die Typzeile und liefert ein leeres Dokument', () => {
		const doc = ok('sequenceDiagram\n');
		expect(doc.diagramType).toBe('sequence');
		expect(doc.order).toEqual([]);
		expect(doc.header).toEqual({ frontmatter: '', directives: [] });
	});

	it('hält Frontmatter und Direktiven roh', () => {
		const text = '---\ntitle: X\n---\n%%{init: {"theme":"dark"}}%%\nsequenceDiagram\n';
		const doc = ok(text);
		expect(doc.header.frontmatter).toBe('---\ntitle: X\n---\n');
		expect(doc.header.directives).toEqual(['%%{init: {"theme":"dark"}}%%\n']);
	});

	it('liest mehrzeilige Direktiven als einen Eintrag', () => {
		const doc = ok('%%{init: {\n  "theme": "dark"\n}}%%\nsequenceDiagram\n');
		expect(doc.header.directives).toEqual(['%%{init: {\n  "theme": "dark"\n}}%%\n']);
	});

	it('meldet fehlende Typzeile mit Zeile 1', () => {
		const result = parse('flowchart TD\n  A --> B\n');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].line).toBe(1);
	});

	it('meldet nicht geschlossenes Frontmatter', () => {
		const result = parse('---\ntitle: X\nsequenceDiagram\n');
		expect(result.ok).toBe(false);
	});

	it('meldet nicht geschlossene Direktive', () => {
		const result = parse('%%{init: {\nsequenceDiagram\n');
		expect(result.ok).toBe(false);
	});

	it('übernimmt title als doc.title und RawBlock', () => {
		const doc = ok('sequenceDiagram\n    title: Bestellung\n');
		expect(doc.title).toBe('Bestellung');
		expect(doc.rawBlocks).toHaveLength(1);
		expect(doc.order).toEqual([doc.rawBlocks[0].id]);
	});

	it('setzt keine Positions-Metadaten', () => {
		const doc = ok('sequenceDiagram\n    A->>B: x\n');
		expect(doc.layout.positions).toEqual({});
		expect(doc.layout.mode).toBe('auto');
	});
});

describe('Teilnehmer', () => {
	it('liest participant und actor mit und ohne Alias', () => {
		const doc = ok(
			'sequenceDiagram\n    participant A as Alice Smith\n    actor B\n    Participant C as C\n'
		);
		expect(doc.nodes.map((n) => [n.id, n.kind, n.label])).toEqual([
			['A', 'participant', 'Alice Smith'],
			['B', 'actor', 'B'],
			['C', 'participant', 'C']
		]);
		expect(doc.order).toEqual(['A', 'B', 'C']);
		expect(doc.nodes[0].sourceText).toBe('    participant A as Alice Smith\n');
	});

	it('legt implizite Teilnehmer aus Nachrichten an, ohne sie in order aufzunehmen', () => {
		const doc = ok('sequenceDiagram\n    John Doe->>Bob: hi\n');
		expect(doc.nodes.map((n) => n.id)).toEqual(['John Doe', 'Bob']);
		expect(doc.nodes.every((n) => n.props.implicit === true && n.sourceText === '')).toBe(true);
		expect(doc.order).toEqual([doc.edges[0].id]);
	});

	it('wandelt impliziten Teilnehmer bei späterer Deklaration um', () => {
		const doc = ok('sequenceDiagram\n    A->>B: hi\n    actor B as Bob\n');
		const b = doc.nodes.find((n) => n.id === 'B');
		expect(b).toMatchObject({ kind: 'actor', label: 'Bob', props: {} });
		expect(doc.order).toEqual([doc.edges[0].id, 'B']);
	});

	it('erhält doppelte Deklaration als RawBlock', () => {
		const doc = ok('sequenceDiagram\n    participant A\n    participant A as X\n');
		expect(doc.nodes).toHaveLength(1);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual(['    participant A as X\n']);
	});

	it('erhält Teilnehmer mit Konfiguration, create und destroy als RawBlock', () => {
		const doc = ok(
			'sequenceDiagram\n    participant D@{ "type": "database" }\n    create participant E\n    destroy E\n'
		);
		expect(doc.rawBlocks).toHaveLength(3);
	});
});

describe('Nachrichten', () => {
	const arrows: [string, string, string][] = [
		['->', 'solid', 'none'],
		['-->', 'dotted', 'none'],
		['->>', 'solid', 'arrow'],
		['-->>', 'dotted', 'arrow'],
		['-x', 'solid', 'cross'],
		['--x', 'dotted', 'cross'],
		['-)', 'solid', 'open'],
		['--)', 'dotted', 'open'],
		['<<->>', 'solid', 'both'],
		['<<-->>', 'dotted', 'both'],
		['-|\\', 'solid', 'half'],
		['--//', 'dotted', 'half']
	];

	it.each(arrows)('Pfeil %s ergibt %s/%s', (arrow, lineStyle, arrowHead) => {
		const doc = ok(`sequenceDiagram\n    A${arrow}B: Text mit: Doppelpunkt\n`);
		expect(doc.edges).toHaveLength(1);
		expect(doc.edges[0]).toMatchObject({
			kind: 'message',
			sourceId: 'A',
			targetId: 'B',
			label: 'Text mit: Doppelpunkt',
			lineStyle,
			arrowHead,
			props: { arrow, activation: '' }
		});
	});

	it('liest Namen mit Bindestrich', () => {
		const doc = ok('sequenceDiagram\n    Web-Server->>DB: query\n');
		expect(doc.edges[0]).toMatchObject({ sourceId: 'Web-Server', targetId: 'DB' });
	});

	it('vergibt Kanten-IDs über ids.ts ohne Kollision mit Nutzer-IDs', () => {
		const doc = ok('sequenceDiagram\n    participant e1\n    e1->>e2: a\n    e2->>e1: b\n');
		expect(doc.edges.map((e) => e.id)).toEqual(['e3', 'e4']);
	});

	it('erhält Nachrichten ohne Text sowie mit weiterer Anweisung nach ; als RawBlock', () => {
		const doc = ok('sequenceDiagram\n    A->>B\n    A->>B: a; B->>A: b\n    A->>B: x #1\n');
		// V-09: `#` beendet den Text wie in mermaid, der Rest ist Kommentar.
		expect(doc.edges.map((e) => e.label)).toEqual(['x']);
		expect(doc.rawBlocks).toHaveLength(2);
	});
});

describe('Notizen', () => {
	it('liest left of, right of und over mit einem oder zwei Teilnehmern', () => {
		const doc = ok(
			'sequenceDiagram\n    participant A\n    Note left of A: l\n    note right of A: r\n    Note over A,B: o\n'
		);
		const notes = doc.nodes.filter((n) => n.kind === 'note');
		expect(notes.map((n) => [n.label, n.props.placement, n.props.participants])).toEqual([
			['l', 'left of', ['A']],
			['r', 'right of', ['A']],
			['o', 'over', ['A', 'B']]
		]);
		expect(doc.nodes.find((n) => n.id === 'B')?.props.implicit).toBe(true);
		expect(notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
	});
});

describe('Kommentare und Unbekanntes', () => {
	it('hält Kommentare roh inklusive Leerzeilen davor', () => {
		const doc = ok('sequenceDiagram\n\n    %% Hinweis\n    # alt\n    %% @mermuid: {"v":1}\n');
		expect(doc.comments.map((c) => c.text)).toEqual([
			'\n    %% Hinweis\n',
			'    # alt\n',
			'    %% @mermuid: {"v":1}\n'
		]);
		expect(doc.order).toEqual(doc.comments.map((c) => c.id));
	});

	it('erhält unbekannte Zeilen und Direktiven im Rumpf als RawBlock', () => {
		const doc = ok('sequenceDiagram\n    autonumber\n    %%{init: {}}%%\n');
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([
			'    autonumber\n',
			'    %%{init: {}}%%\n'
		]);
	});

	it('liest die Nachricht nach einer einzeiligen Direktive im Rumpf als Kante', () => {
		const doc = ok('sequenceDiagram\n    %%{init: {}}%%\n    A->>B: x\n    %%{init: {}}%%\n');
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([
			'    %%{init: {}}%%\n',
			'    %%{init: {}}%%\n'
		]);
		expect(doc.edges.map((e) => [e.sourceId, e.targetId, e.label])).toEqual([['A', 'B', 'x']]);
	});

	it('hängt Leerzeilen am Dateiende an das letzte Statement', () => {
		const doc = ok('sequenceDiagram\n    A->>B: x\n\n\n');
		expect(doc.edges[0].sourceText).toBe('    A->>B: x\n\n\n');
	});
});
