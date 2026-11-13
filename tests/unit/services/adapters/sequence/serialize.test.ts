import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	parse,
	sequenceAdapter,
	serialize
} from '../../../../../src/lib/services/adapters/sequence';
import type { DiagramDocument, DiagramEdge } from '../../../../../src/lib/model/types';
import { addEdge, updateNode } from '../../../../../src/lib/model/operations';

const dir = join(__dirname, '../../../../fixtures/sequence/roundtrip');
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.mmd'));

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

describe('Roundtrip', () => {
	it('hat mindestens 4 Fixtures inklusive CRLF und verschachtelter Blöcke', () => {
		expect(fixtures.length).toBeGreaterThanOrEqual(4);
		const texts = fixtures.map((f) => readFileSync(join(dir, f), 'utf8'));
		expect(texts.some((t) => t.includes('\r\n'))).toBe(true);
		expect(texts.some((t) => ok(t).containers.some((c) => c.parentId !== null))).toBe(true);
	});

	it.each(fixtures)('%s ist byte-gleich', (file) => {
		const text = readFileSync(join(dir, file), 'utf8');
		expect(sequenceAdapter.serialize(ok(text))).toBe(text);
	});

	it.each(['sequenceDiagram', 'sequenceDiagram\n\n', 'sequenceDiagram\n    A->>B: x'])(
		'%j ist byte-gleich',
		(text) => {
			expect(serialize(ok(text))).toBe(text);
		}
	);

	it('exportiert einen DiagramAdapter vom Typ sequence', () => {
		expect(sequenceAdapter.type).toBe('sequence');
		expect(sequenceAdapter.parse).toBe(parse);
	});
});

describe('Reihenfolge und kanonische Ausgabe', () => {
	it('folgt ausschließlich order und ergänzt fehlende Zeilenenden', () => {
		const doc = ok('sequenceDiagram\n    A->>B: eins\n    B->>A: zwei');
		doc.order.reverse();
		expect(serialize(doc)).toBe('sequenceDiagram\n    B->>A: zwei\n    A->>B: eins\n');
	});

	it('schreibt Elemente ohne sourceText kanonisch', () => {
		const doc = ok('sequenceDiagram\n    participant A\n    loop x\n        A->>B: m\n    end\n');
		for (const el of [...doc.nodes, ...doc.edges, ...doc.containers]) el.sourceText = '';
		doc.nodes.push({
			id: 'n9',
			kind: 'note',
			label: 'neu',
			shape: 'note',
			cssClasses: [],
			style: {},
			props: { placement: 'over', participants: ['A', 'B'] },
			parentId: null,
			sourceText: ''
		});
		doc.nodes.push({
			id: 'Z',
			kind: 'actor',
			label: 'Zoe',
			shape: 'actor',
			cssClasses: [],
			style: {},
			props: {},
			parentId: null,
			sourceText: ''
		});
		doc.comments.push({ id: 'n10', text: 'Hinweis' });
		doc.order.push('n9', 'Z', 'n10');
		expect(serialize(doc)).toBe(
			'sequenceDiagram\n    participant A\n    loop x\n        A->>B: m\n    end\n' +
				'    Note over A,B: neu\n    actor Z as Zoe\n    %% Hinweis\n'
		);
	});

	it('schreibt Container mit Sections, Aktivierungen und Pfeilarten kanonisch', () => {
		const text =
			'sequenceDiagram\n  alt a\n    A-->>+B: x\n    activate B\n  else\n    A-|\\B: h\n  end\n  critical\n    A<<-->>B: y\n  option o\n  end\n';
		const doc = ok(text);
		for (const el of [...doc.edges, ...doc.containers]) el.sourceText = '';
		for (const c of doc.containers) c.props = {};
		expect(serialize(doc)).toBe(
			'sequenceDiagram\n    alt a\n        A-->>+B: x\n        activate B\n    else\n        A-|\\B: h\n    end\n' +
				'    critical\n        A<<-->>B: y\n    option o\n    end\n'
		);
	});

	it('übernimmt geänderten Pfeilstil und fällt sonst auf ->> zurück', () => {
		const doc = ok('sequenceDiagram\n    A->>B: x\n    A-//B: y\n');
		const [first, second] = doc.edges;
		Object.assign(first, { sourceText: '', lineStyle: 'dotted', arrowHead: 'cross' });
		Object.assign(second, { sourceText: '', props: { arrow: '??', activation: '' } });
		expect(serialize(doc)).toBe('sequenceDiagram\n    A--xB: x\n    A->>B: y\n');
	});

	it('übernimmt CRLF für neue Elemente', () => {
		const doc = ok('sequenceDiagram\r\n    A->>B: x\r\n');
		doc.edges[0].sourceText = '';
		expect(serialize(doc)).toBe('sequenceDiagram\r\n    A->>B: x\r\n');
	});

	it.each(['\n', '\r\n'])(
		'schließt RawBlock ohne Zeilenende vor leerem RawBlock genau einmal mit %j ab',
		(eol) => {
			const doc = ok(`sequenceDiagram${eol}    A->>B: m${eol}`);
			const [message] = doc.edges;
			message.sourceText = '';
			doc.rawBlocks.push(
				{ id: 'r1', rawText: `    %% x${eol}    autonumber` },
				{ id: 'r2', rawText: '' }
			);
			doc.order = ['r1', 'r2', message.id];
			expect(serialize(doc)).toBe(
				`sequenceDiagram${eol}    %% x${eol}    autonumber${eol}    A->>B: m${eol}`
			);
		}
	);

	it('schreibt die Typzeile kanonisch, wenn kein Typsegment vorliegt', () => {
		const doc = ok('%%{init: {}}%%\nsequenceDiagram\n');
		expect(doc.header.directives).toEqual(['%%{init: {}}%%\n']);
		expect(serialize(doc)).toBe('%%{init: {}}%%\nsequenceDiagram\n');
	});

	it('wirft bei unbekannter ID in order', () => {
		const doc = ok('sequenceDiagram\n');
		doc.order.push('fehlt');
		expect(() => serialize(doc)).toThrow('fehlt');
	});
});

function edge(id: string, sourceId: string, targetId: string, label: string): DiagramEdge {
	return {
		id,
		kind: 'message',
		sourceId,
		targetId,
		label,
		lineStyle: 'solid',
		arrowHead: 'arrow',
		style: {},
		props: {},
		parentId: null,
		sourceText: ''
	};
}

describe('Labels mit Sonderzeichen', () => {
	it('liest Entities in Nachrichten, Notizen und Aliasen dekodiert und bleibt byte-gleich', () => {
		const text =
			'sequenceDiagram\n    participant A as x#59;y\n    A->>B: a #59; b #35; c #quot; #9829;\n    Note over A: n#35;1\n';
		const doc = ok(text);
		expect(doc.nodes.map((n) => n.label)).toEqual(['x;y', 'B', 'n#1']);
		expect(doc.edges[0].label).toBe('a ; b # c #quot; \u2665');
		expect(serialize(doc)).toBe(text);
	});

	it('lässt ungültige Codepunkte als Entity stehen', () => {
		expect(ok('sequenceDiagram\n    A->>B: #99999999;\n').edges[0].label).toBe('#99999999;');
	});

	it('maskiert ; und # und ersetzt Zeilenumbrüche beim Schreiben', () => {
		const doc = ok('sequenceDiagram\n    participant A\n    A->>B: x\n    Note over A: n\n');
		doc.nodes[0].label = 'Al;ice #1';
		doc.edges[0].label = 'a; b # c #quot;';
		const note = doc.nodes.find((n) => n.kind === 'note');
		if (!note) throw new Error('Notiz fehlt');
		note.label = 'zwei\nZeilen\r\n#';
		for (const el of [...doc.nodes, ...doc.edges]) el.sourceText = '';
		const text = serialize(doc);
		expect(text).toBe(
			'sequenceDiagram\n    participant A as Al#59;ice #35;1\n    A->>B: a#59; b #35; c #quot;\n' +
				'    Note over A: zwei<br>Zeilen<br>#35;\n'
		);
		const again = ok(text);
		expect(again.nodes[0].label).toBe('Al;ice #1');
		expect(again.edges[0].label).toBe('a; b # c #quot;');
	});
});

describe('Implizite Teilnehmer', () => {
	const base = 'sequenceDiagram\n    participant A\n    loop x\n        A->>B: hi\n    end\n';

	it('schreibt geändertes Label als Deklaration vor die erste Verwendung', () => {
		const doc = updateNode(ok(base), 'B', { label: 'Bob' });
		const text = serialize(doc);
		expect(text).toBe(
			'sequenceDiagram\n    participant A\n    participant B as Bob\n    loop x\n        A->>B: hi\n    end\n'
		);
		const b = ok(text).nodes.find((n) => n.id === 'B');
		expect(b).toMatchObject({ kind: 'participant', label: 'Bob', props: {} });
	});

	it('schreibt Wechsel zu actor als Deklaration', () => {
		const doc = updateNode(ok('sequenceDiagram\n    Note over B: n\n    A->>B: hi\n'), 'B', {
			kind: 'actor'
		});
		const text = serialize(doc);
		expect(text).toBe('sequenceDiagram\n    actor B\n    Note over B: n\n    A->>B: hi\n');
		expect(ok(text).nodes.find((n) => n.id === 'B')?.kind).toBe('actor');
	});

	it('schreibt unveränderte implizite Teilnehmer nicht und unbenutzte am Ende', () => {
		const doc = ok(base);
		expect(serialize(doc)).toBe(base);
		const lonely = updateNode(ok('sequenceDiagram\n    A->>B: hi\n'), 'B', { label: 'Bob' });
		lonely.edges = [];
		lonely.order = [];
		expect(serialize(lonely)).toBe('sequenceDiagram\n    participant B as Bob\n');
	});
});

describe('Container nach Modelländerung', () => {
	const text =
		'sequenceDiagram\n  alt ok\n    A->>B: a\n\n  else nein\n    B->>A: b\n\n  end\n  A->>B: z\n';

	it('behält Einrückung, Section-Zeilen und Leerzeilen beim Hinzufügen', () => {
		const doc = ok(text);
		const alt = doc.containers[0];
		const next = addEdge(doc, { ...edge('e9', 'A', 'B', 'neu'), parentId: alt.id }, 1);
		expect(next.containers[0].sourceText).toBe('');
		expect(serialize(next)).toBe(
			'sequenceDiagram\n  alt ok\n    A->>B: a\n\n  else nein\n    B->>A: b\n    A->>B: neu\n\n  end\n  A->>B: z\n'
		);
	});

	it('schreibt Sections kanonisch mit abgeleiteter Einrückung, wenn Labels abweichen', () => {
		const doc = ok(text);
		const alt = doc.containers[0];
		alt.sourceText = '';
		alt.sections[1].label = 'anders';
		expect(serialize(doc)).toBe(
			'sequenceDiagram\n  alt ok\n    A->>B: a\n\n  else anders\n    B->>A: b\n\n  end\n  A->>B: z\n'
		);
	});

	it('leitet die Einrückung neuer Container aus Nachbarn ab', () => {
		const doc = ok('sequenceDiagram\n  A->>B: z\n');
		doc.containers.push({
			id: 'c9',
			kind: 'opt',
			label: 'neu',
			direction: '',
			parentId: null,
			sections: [{ label: 'neu', memberIds: [] }],
			props: {},
			sourceText: ''
		});
		doc.order.push('c9');
		expect(serialize(doc)).toBe('sequenceDiagram\n  A->>B: z\n  opt neu\n  end\n');
	});
});
