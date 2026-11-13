// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { parse, serialize, validate } from '../../../../../src/lib/services/adapters/sequence';
import {
	arrowStyle,
	encodeLabel,
	matchMessage
} from '../../../../../src/lib/services/adapters/sequence/syntax';
import type { DiagramDocument } from '../../../../../src/lib/model/types';
import { updateContainer, updateEdge, updateNode } from '../../../../../src/lib/model/operations';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

/** Ausschnitt der Sequence-db von mermaid. */
interface SequenceDb {
	getActors(): Map<string, { type: string }>;
}

async function actors(text: string): Promise<[string, string][]> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as SequenceDb;
	return [...db.getActors()].map(([id, actor]) => [id, actor.type]);
}

describe('Container- und Section-Labels mit Sonderzeichen', () => {
	it('maskiert geänderte Labels, bleibt für mermaid gültig und liest sie zurück', async () => {
		const doc = ok(
			'sequenceDiagram\n    A->>B: x\n    loop x\n        alt a\n            A->>B: y\n        else b\n            B->>A: z\n        end\n    end\n'
		);
		const [loop, alt] = doc.containers;
		const next = updateContainer(doc, loop.id, { label: 'a; b #1' });
		next.containers[1].sourceText = '';
		next.containers[1].sections[1].label = 'n;o';
		const text = serialize(next);
		expect(text).toContain('    loop a#59; b #35;1\n');
		expect(text).toContain('        else n#59;o\n');
		await expect(mermaid.parse(text)).resolves.toBeTruthy();
		const again = ok(text);
		expect(again.containers.map((c) => c.label)).toEqual(['a; b #1', alt.label]);
		expect(again.containers[1].sections.map((s) => s.label)).toEqual(['a', 'n;o']);
	});

	it('liest Entities in Block- und Section-Labels dekodiert und bleibt byte-gleich', () => {
		const text =
			'sequenceDiagram\n    loop x#59;y\n        A->>B: m\n    end\n    alt a#35;b\n        A->>B: n\n    else c#59;d\n        B->>A: o\n    end\n';
		const doc = ok(text);
		expect(doc.containers.map((c) => c.label)).toEqual(['x;y', 'a#b']);
		expect(doc.containers[1].sections.map((s) => s.label)).toEqual(['a#b', 'c;d']);
		expect(serialize(doc)).toBe(text);
		doc.containers[1].sourceText = '';
		expect(serialize(doc)).toBe(text);
	});
});

describe('Reihenfolge impliziter Teilnehmer', () => {
	it.each([
		['oberste Ebene', 'sequenceDiagram\n    A->>B: x\n    B->>C: y\n'],
		[
			'verschachtelt',
			'sequenceDiagram\n    loop l\n        alt a\n            A->>B: x\n        end\n    end\n'
		],
		[
			'nach früherer Nutzung',
			'sequenceDiagram\n    A->>C: x\n    loop l\n        D->>B: y\n    end\n'
		]
	])('behält die mermaid-Akteursreihenfolge (%s)', async (_, text) => {
		const before = await actors(text);
		const out = serialize(updateNode(ok(text), 'B', { label: 'Bob' }));
		expect((await actors(out)).map(([id]) => id)).toEqual(before.map(([id]) => id));
		expect(ok(out).nodes.find((n) => n.id === 'B')?.label).toBe('Bob');
	});

	it('deklariert vor einem RawBlock, der den Teilnehmer schon benutzt', async () => {
		const text = 'sequenceDiagram\n    break q\n        A->>B: x\n    end\n    A->>B: ok\n';
		const out = serialize(updateNode(ok(text), 'B', { kind: 'actor' }));
		expect(await actors(out)).toEqual([
			['A', 'participant'],
			['B', 'actor']
		]);
		expect(ok(out).nodes.find((n) => n.id === 'B')?.kind).toBe('actor');
	});
});

describe('Zeilenumbrüche in Labels', () => {
	it('ersetzt auch einzelnes \\r durch <br>', async () => {
		expect(encodeLabel('a\rb\r\nc\nd')).toBe('a<br>b<br>c<br>d');
		const doc = ok('sequenceDiagram\n    A->>B: x\n');
		const text = serialize(updateEdge(doc, doc.edges[0].id, { label: 'a\rb' }));
		expect(text).toBe('sequenceDiagram\n    A->>B: a<br>b\n');
		await expect(mermaid.parse(text)).resolves.toBeTruthy();
	});
});

describe('validate mit eingerücktem Frontmatter', () => {
	it('meldet die Zeile im Originaltext', async () => {
		const errors = await validate(
			'  ---\n  title: X\n  ---\nsequenceDiagram\n    A->>B: ok\n    A-->>>B\n'
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBe(6);
	});
});

/** Laufzeit von `run` in ms. */
function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

/**
 * Zeitfaktor groß/klein (Vorlage fix-e2): Warmlauf je Größe, 5 Runden im Wechsel (je 4x klein,
 * 1x groß), je Größe das Minimum (filtert Last-Spitzen und GC-Pausen).
 */
function growth(small: () => void, large: () => void): number {
	small();
	large();
	const tSmall: number[] = [];
	const tLarge: number[] = [];
	for (let i = 0; i < 5; i++) {
		for (let k = 0; k < 4; k++) tSmall.push(timed(small));
		tLarge.push(timed(large));
	}
	return Math.min(...tLarge) / Math.min(...tSmall);
}

describe('Nachrichten-Erkennung', () => {
	it.each([
		['A->>-B: x', ['A', '->>', '-', 'B', ' x']],
		['A-X B: y', ['A', '-X', '', 'B', ' y']],
		['A ->> B : x', ['A', '->>', '', 'B', ' x']],
		['A-x-x-x+B: y', ['A-x-x', '-x', '+', 'B', ' y']],
		['A-x-x-xB: y', ['A', '-x', '-', 'x-xB', ' y']],
		['Al ice-->>+Bo b:  l : m', ['Al ice', '-->>', '+', 'Bo b', '  l : m']],
		['A<<-->>B:', ['A', '<<-->>', '', 'B', '']],
		['A-//-B: h', ['A', '-//', '-', 'B', ' h']],
		['A--//B: h', ['A', '--//', '', 'B', ' h']],
		['-->>B: x', ['-', '->>', '', 'B', ' x']],
		['A-)+-B: q', ['A', '-)', '+', '-B', ' q']],
		['A - ->> B: z', ['A -', '->>', '', 'B', ' z']],
		['A->> - B: z', ['A', '->>', '-', 'B', ' z']],
		['A->>-: z', ['A', '->>', '', '-', ' z']],
		['A-->>>B: x', null],
		['A->>B C,: x', null],
		['A->>B: a\rb', null],
		['A->>B', null],
		[':A->>B', null]
	])('%j', (line, expected) => {
		expect(matchMessage(line)).toEqual(expected);
	});

	// Verhältnis statt absoluter Zeit: Die Grenze 100 ms lag unter Gesamtlast nur Faktor 3 über
	// der Messung. Grenze 16: Lineares Wachstum in der Kettenlänge (Grundlast je Zeile plus
	// Anteil je Zeichen) hebt den Faktor höchstens auf 16, gemessen 2 bis 4 auch unter Last; ein
	// quadratisches Backtracking je Zeile ergab in der Probe 46 bis 54. Eine Absolutgrenze reicht nicht:
	// dasselbe Backtracking über knapp 2000 Zeichen je Zeile kostet nur etwa 30 ms.
	it('bleibt bei -x-Ketten linear (16-fache Kettenlänge < 16-fache Zeit)', () => {
		const lines = [
			(c: string) => c,
			(c: string) => `${c}+B: y`,
			(c: string) => `${c},B: y`,
			(c: string) => `${c})B: y`
		];
		for (const line of lines) {
			const make = (k: number) =>
				'sequenceDiagram\n' + `    ${line('A' + '-x'.repeat(k))}\n`.repeat(25);
			const small = make(62);
			const text = make(990);
			expect(text.length).toBeGreaterThan(49000);
			expect(
				growth(
					() => parse(small),
					() => parse(text)
				),
				line('A-x').slice(-6)
			).toBeLessThan(16);
			const result = parse(text);
			if (result.ok) expect(serialize(result.doc)).toBe(text);
		}
	});
});

describe('Teilnehmer erst benutzt, später ausdrücklich deklariert', () => {
	const text = 'sequenceDiagram\n    A->>B: x\n    participant A as Al\n';

	it('behält die mermaid-Reihenfolge bei geändertem impliziten Teilnehmer', async () => {
		const out = serialize(updateNode(ok(text), 'B', { label: 'Bob' }));
		expect(await actors(out)).toEqual(await actors(text));
		expect(out.match(/participant B/g)).toHaveLength(1);
		expect(ok(out).nodes.find((n) => n.id === 'B')?.label).toBe('Bob');
	});

	it('behält sie über mehrere Änderungen nacheinander', async () => {
		let doc = updateNode(ok(text), 'B', { label: 'Bob' });
		doc = updateNode(doc, 'A', { label: 'Alice' });
		doc = updateNode(doc, 'B', { kind: 'actor' });
		const out = serialize(doc);
		expect(await actors(out)).toEqual([
			['A', 'participant'],
			['B', 'actor']
		]);
		const again = serialize(updateNode(ok(out), 'B', { label: 'Bobby' }));
		expect((await actors(again)).map(([id]) => id)).toEqual(['A', 'B']);
		const nodes = ok(again).nodes;
		expect(nodes.map((n) => [n.id, n.label])).toEqual([
			['A', 'Alice'],
			['B', 'Bobby']
		]);
	});
});

describe('accDescr-Blöcke enthalten keine Nachrichten', () => {
	it('deklariert nicht vor accDescr mit nachrichtenähnlicher Zeile', async () => {
		const text = 'sequenceDiagram\n    accDescr {\n    A->>B: describes\n    }\n    B->>A: real\n';
		const out = serialize(updateNode(ok(text), 'A', { label: 'Al' }));
		expect((await actors(out)).map(([id]) => id)).toEqual(['B', 'A']);
		expect(out.indexOf('participant A as Al')).toBeGreaterThan(out.indexOf('}'));
	});
});

describe('title-Zeile mit Nachrichtenform', () => {
	it('liest die ganze Zeile als Titel wie mermaid', async () => {
		const text = 'sequenceDiagram\n    title A->>B: flow\n    C->>D: m\n';
		const doc = ok(text);
		expect(doc.title).toBe('A->>B: flow');
		expect(doc.edges).toHaveLength(1);
		expect(doc.nodes.map((n) => n.id)).toEqual(['C', 'D']);
		expect((await actors(text)).map(([id]) => id)).toEqual(['C', 'D']);
		expect(serialize(doc)).toBe(text);
		const out = serialize(updateNode(doc, 'D', { label: 'Dora' }));
		expect((await actors(out)).map(([id]) => id)).toEqual(['C', 'D']);
	});
});

describe('Zurückgehaltener Teilnehmer mit reinem Typwechsel', () => {
	it.each([
		['oberste Ebene', 'sequenceDiagram\n    A->>B: x\n    participant A as Al\n', 'B'],
		[
			'nach Block',
			'sequenceDiagram\n    alt a\n        A->>B: x\n        C->>D: y\n    end\n    participant A as Al\n    participant C\n',
			'D'
		]
	])('erzwingt den Typ wie im Modell (%s)', async (_, text, id) => {
		const out = serialize(updateNode(ok(text), id, { kind: 'actor' }));
		const expected = (await actors(text)).map(([p, type]): [string, string] => [
			p,
			p === id ? 'actor' : type
		]);
		expect(await actors(out)).toEqual(expected);
		expect(ok(out).nodes.map((n) => [n.id, n.kind])).toEqual(expected);
	});
});

describe('Teilnehmer nur in box-RawBlock deklariert', () => {
	async function boxes(text: string): Promise<[string, string | undefined][]> {
		const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as {
			getActors(): Map<string, { box?: { name?: string } }>;
		};
		return [...db.getActors()].map(([p, actor]) => [p, actor.box?.name]);
	}

	it.each([
		['nach Nutzung', 'sequenceDiagram\n    A->>B: x\n    box Aqua G\n    participant A\n    end\n'],
		['vor Nutzung', 'sequenceDiagram\n    box Aqua G\n    participant A\n    end\n    A->>B: x\n']
	])('deklariert nicht doppelt (%s)', async (_, text) => {
		const out = serialize(updateNode(ok(text), 'B', { label: 'Bob' }));
		expect(out.match(/participant A\b/g)).toHaveLength(1);
		expect(await actors(out)).toEqual(await actors(text));
		expect(await boxes(out)).toEqual(await boxes(text));
		expect(ok(out).nodes.find((n) => n.id === 'B')?.label).toBe('Bob');
	});
});

describe('Deklaration hinter der ersten Verwendung', () => {
	/** Teilnehmer aus Modell (ohne Notizen) als [id, kind] in Modell-Reihenfolge. */
	const model = (text: string) =>
		ok(text)
			.nodes.filter((n) => n.kind !== 'note')
			.map((n): [string, string] => [n.id, n.kind]);

	it('schreibt kanonische Deklarationen nach Nutzung mit Alias (Kette mit Re-Parse)', async () => {
		let text = 'sequenceDiagram\n    A->>B: x\n    participant A as Al\n';
		for (const kind of ['actor', 'participant', 'actor']) {
			text = serialize(updateNode(ok(text), 'B', { kind }));
			const expected: [string, string][] = [
				['A', 'participant'],
				['B', kind]
			];
			expect(await actors(text)).toEqual(expected);
			expect(model(text)).toEqual(expected);
		}
		expect(text).toContain('actor B as B\n');
	});

	it('schreibt explizite Deklaration nach Nutzung mit Alias', async () => {
		const text = 'sequenceDiagram\n    A->>B: x\n    participant B\n';
		const out = serialize(updateNode(ok(text), 'B', { kind: 'actor' }));
		const expected: [string, string][] = [
			['A', 'participant'],
			['B', 'actor']
		];
		expect(out).toBe('sequenceDiagram\n    A->>B: x\n    actor B as B\n');
		expect(await actors(out)).toEqual(expected);
		expect(model(out)).toEqual(expected);
	});

	it('prüft positionsgenau, auch im Container', async () => {
		const text = 'sequenceDiagram\n    loop l\n        participant B\n        A->>B: x\n    end\n';
		const out = serialize(updateNode(ok(text), 'B', { kind: 'actor' }));
		expect(out).toContain('        actor B\n');
		expect(await actors(out)).toEqual([
			['B', 'actor'],
			['A', 'participant']
		]);
		expect(model(out)).toEqual(await actors(out));
	});

	it('bleibt für unveränderte Dokumente byte-gleich', () => {
		const text = 'sequenceDiagram\n    A->>B: x\n    actor B\n    participant A as Al\n';
		expect(serialize(ok(text))).toBe(text);
	});

	it.each([
		['ohne Alias', 'sequenceDiagram\n    A->>B: x\n    actor B\n'],
		['mit Alias', 'sequenceDiagram\n    A->>B: x\n    actor B as Bo\n'],
		['nach Notiz', 'sequenceDiagram\n    Note over B: n\n    actor B\n'],
		['nach activate', 'sequenceDiagram\n    activate B\n    actor B\n    B->>B: x\n']
	])('liest den Typ wie mermaid (%s)', async (_, text) => {
		expect(model(text)).toEqual(await actors(text));
	});
});

describe('Teilnehmer-IDs mit Leerraum', () => {
	const model = (text: string) =>
		ok(text)
			.nodes.filter((n) => n.kind !== 'note')
			.map((n): [string, string] => [n.id, n.kind]);

	it('liest Deklarationen mit Leerraum vor `as` wie mermaid', async () => {
		const text = 'sequenceDiagram\n    participant B c as Bob\n    A->>B c: x\n';
		expect(model(text)).toEqual(await actors(text));
		expect(serialize(ok(text))).toBe(text);
	});

	it.each([
		[
			'Typ nach Nutzung',
			'sequenceDiagram\n    A->>B c: x\n    participant A as Al\n',
			{ kind: 'actor' }
		],
		['Label', 'sequenceDiagram\n    A->>B c: x\n', { label: 'Bob' }],
		['Label explizit', 'sequenceDiagram\n    participant B c\n    A->>B c: x\n', { label: 'Bob' }]
	])('erzeugt keine Zusatz-Akteure (%s)', async (_, text, patch) => {
		const out = serialize(updateNode(ok(text), 'B c', patch));
		const ids = (await actors(out)).map(([id]) => id);
		expect(ids).toEqual((await actors(text)).map(([id]) => id));
		expect(model(out)).toEqual(await actors(out));
		expect(out).not.toMatch(/B c as/);
	});

	it('deklariert den Typ vor der ersten Nutzung', async () => {
		const text = 'sequenceDiagram\n    A->>B c: x\n';
		const out = serialize(updateNode(ok(text), 'B c', { kind: 'actor' }));
		expect(await actors(out)).toEqual([
			['A', 'participant'],
			['B c', 'actor']
		]);
		expect(model(out)).toEqual(await actors(out));
	});
});

describe('Deaktivierung vor Ziel mit x/X-Anfang', () => {
	const text = (to: string) => `sequenceDiagram\n    A->>+B: m\n    B-->>-A: n\n    A->>${to}: o\n`;

	it.each(['X', 'x1', 'Xy'])('trennt Marker und Ziel %s (sonst Kreuz-Pfeil -x)', async (to) => {
		const out = serialize(updateEdge(ok(text(to)), 'e2', { targetId: to }));
		expect(out).toBe(`sequenceDiagram\n    A->>+B: m\n    B-->>- ${to}: n\n    A->>${to}: o\n`);
		expect(await validate(out)).toEqual([]);
		expect((await actors(out)).map(([id]) => id)).toEqual(['A', 'B', to]);
		const edge = ok(out).edges[1];
		expect([edge.sourceId, edge.targetId, edge.props.activation]).toEqual(['B', to, '-']);
	});

	it('lässt andere Ziele und Aktivierungen ohne Leerzeichen', () => {
		const plus = updateEdge(ok(text('X')), 'e1', { targetId: 'X' });
		const minus = updateEdge(ok(text('C')), 'e2', { targetId: 'C' });
		expect(serialize(plus)).toBe('sequenceDiagram\n    A->>+X: m\n    B-->>-A: n\n    A->>X: o\n');
		expect(serialize(minus)).toBe('sequenceDiagram\n    A->>+B: m\n    B-->>-C: n\n    A->>C: o\n');
	});
});

describe('Deaktivierung hinter Halbpfeil auf -', () => {
	const text = 'sequenceDiagram\n    A->>+B: m\n    B-->>-A: n\n';

	it.each(['/|-', '\\|-', '//-', '\\\\-'])(
		'trennt %s und Marker (sonst gestrichelter Pfeil auf --)',
		async (arrow) => {
			const [lineStyle, arrowHead] = arrowStyle(arrow);
			const doc = ok(text);
			const e = doc.edges[1];
			const out = serialize(
				updateEdge(doc, 'e2', { lineStyle, arrowHead, props: { ...e.props, arrow } })
			);
			expect(out).toBe(`sequenceDiagram\n    A->>+B: m\n    B${arrow} -A: n\n`);
			expect(await validate(out)).toEqual([]);
			const db = (await mermaid.mermaidAPI.getDiagramFromText(out)).db as unknown as {
				getMessages(): { from: string; to: string | null; type: number }[];
			};
			const [, , msg, end] = db.getMessages();
			expect([msg.from, msg.to, end.from, end.type]).toEqual(['B', 'A', 'B', 18]);
			const back = ok(out).edges[1];
			expect([back.targetId, back.props.arrow, back.props.activation]).toEqual(['A', arrow, '-']);
		}
	);
});
