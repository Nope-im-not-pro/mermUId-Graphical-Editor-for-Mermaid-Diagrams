// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../../../../../src/lib/services/adapters/sequence';
import type { DiagramDocument } from '../../../../../src/lib/model/types';
import { updateEdge, updateNode } from '../../../../../src/lib/model/operations';
import { encodeLabel, styleStage } from '../../../../../src/lib/services/adapters/sequence/syntax';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

/** Ausschnitt der Sequence-db von mermaid. */
interface SequenceDb {
	getMessages(): { from?: string; to?: string; type?: number; message: string }[];
	LINETYPE: { NOTE: number };
}

/** Texte, die mermaid anzeigt; numerische Entities (Platzhalter von `encodeEntities`) dekodiert. */
async function shown(text: string): Promise<{ messages: string[]; notes: string[] }> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as SequenceDb;
	const decode = (s: string) =>
		s.replace(/ﬂ\xB0\xB0(\d+)\xB6\xDF/g, (_, code: string) => String.fromCodePoint(Number(code)));
	const all = db.getMessages().filter((m) => m.from && m.to);
	return {
		messages: all.filter((m) => m.type !== db.LINETYPE.NOTE).map((m) => decode(m.message)),
		notes: all.filter((m) => m.type === db.LINETYPE.NOTE).map((m) => decode(m.message))
	};
}

const model = (doc: DiagramDocument) => ({
	messages: doc.edges.filter((e) => e.kind === 'message').map((e) => e.label),
	notes: doc.nodes.filter((n) => n.kind === 'note').map((n) => n.label)
});

describe('V-09: # und ; in Nachrichten und Notizen', () => {
	it.each([
		'A->>B: Ticket #42',
		'A->>B: SELECT 1;',
		'A->>B: SELECT 1;   ',
		'A->>B: a;;',
		'A->>B: a; %% c',
		'A->>B: a; #c',
		'A->>B: #1',
		'A->>B:;',
		'A->>B: a\t#x',
		'A->>B: x#59;y #35; z',
		'A->>B: a #1; B->>A: b',
		'Note over A: x #1',
		'Note over A: x;',
		'Note left of A: SELECT 1; #c',
		'Note over A,B: #35;1 #2',
		// mermaids `style`-Vorstufe entfernt vorab das letzte `;` der Zeile (auch Entity-`;`).
		'A->>B: style:#fff;',
		'A->>B: style:#35;1',
		'A->>B: style:#35;x;',
		'A->>B: classDef:#35;b;',
		'A->>B: style x:y #1;',
		'Note over A: style:#35;1',
		// `wrap:`/`nowrap:` (auch `:wrap:`) am Textanfang ist Umbruch-Schalter, kein Text.
		'A->>B:wrap: x #1',
		'A->>B:nowrap:y;',
		'A->>B: wrap:x',
		'A->>B: :nowrap: z',
		'A->>B: wrap:wrap: w',
		'A->>B: wrapx: y',
		'A->>B: wrap#58; y',
		'Note over A: wrap: n'
	])('%j: Modell zeigt den Text wie mermaid, Roundtrip byte-gleich', async (body) => {
		const text = `sequenceDiagram\n    ${body}\n`;
		const doc = ok(text);
		expect(doc.rawBlocks).toEqual([]);
		expect(model(doc)).toEqual(await shown(text));
		expect(serialize(doc)).toBe(text);
	});

	it('hält den Rohtext in sourceText', () => {
		const text = 'sequenceDiagram\n    A->>B: Ticket #42\n    Note over B: SELECT 1;\n';
		const doc = ok(text);
		expect(doc.edges[0]).toMatchObject({ label: 'Ticket', sourceText: '    A->>B: Ticket #42\n' });
		expect(doc.nodes.find((n) => n.kind === 'note')).toMatchObject({
			label: 'SELECT 1',
			sourceText: '    Note over B: SELECT 1;\n'
		});
	});

	it.each([
		// Nach `;` folgt eine weitere Anweisung: mermaid liest zwei Nachrichten.
		'A->>B: a; B->>A: b',
		// Entity nach `;` wird vor dem Lexer ersetzt und ist dort kein Kommentar (Parse-Fehler).
		'A->>B: a; #59;',
		// `;` oder `#` vor dem `:` (Namen).
		'A#x->>B: a #1',
		'Note over A;B: x #1',
		// Nach der `style`-Vorstufe folgt auf `;` noch Text.
		'A->>B: a; style:#x;'
	])('%j bleibt RawBlock', (body) => {
		const text = `sequenceDiagram\n    ${body}\n`;
		const doc = ok(text);
		expect(doc.edges.filter((e) => e.kind === 'message')).toEqual([]);
		expect(doc.nodes.filter((n) => n.kind === 'note')).toEqual([]);
		expect(doc.rawBlocks).toHaveLength(1);
		expect(serialize(doc)).toBe(text);
	});

	it('schreibt # und ; beim grafischen Bearbeiten als Entity, mermaid zeigt den Text', async () => {
		const text = 'sequenceDiagram\n    A->>B: Ticket #42\n    Note over A: SELECT 1;\n';
		const doc = ok(text);
		const note = doc.nodes.find((n) => n.kind === 'note')!;
		let next = updateEdge(doc, doc.edges[0].id, { label: 'Ticket #42' });
		next = updateNode(next, note.id, { label: 'SELECT 1; #2' });
		const out = serialize(next);
		expect(out).toBe(
			'sequenceDiagram\n    A->>B: Ticket #35;42\n    Note over A: SELECT 1#59; #35;2\n'
		);
		expect(await shown(out)).toEqual({ messages: ['Ticket #42'], notes: ['SELECT 1; #2'] });
		expect(model(ok(out))).toEqual({ messages: ['Ticket #42'], notes: ['SELECT 1; #2'] });
	});

	it('übernimmt wrap/nowrap als props.wrap und schreibt es beim grafischen Bearbeiten zurück', async () => {
		const text = 'sequenceDiagram\n    A->>B:wrap: x\n    Note over A: nowrap: n\n    A->>B: y\n';
		const doc = ok(text);
		const note = doc.nodes.find((n) => n.kind === 'note')!;
		expect(doc.edges.map((e) => [e.label, e.props.wrap])).toEqual([
			['x', true],
			['y', undefined]
		]);
		expect(note.props.wrap).toBe(false);
		let next = updateEdge(doc, doc.edges[0].id, { label: 'x2' });
		next = updateEdge(next, doc.edges[1].id, { label: 'wrap: y' });
		next = updateNode(next, note.id, { label: 'n2' });
		const out = serialize(next);
		expect(out).toBe(
			'sequenceDiagram\n    A->>B: wrap:x2\n    Note over A: nowrap:n2\n    A->>B: wrap#58; y\n'
		);
		expect(await shown(out)).toEqual({ messages: ['x2', 'wrap: y'], notes: ['n2'] });
		expect(model(ok(out))).toEqual({ messages: ['x2', 'wrap: y'], notes: ['n2'] });
		await mermaid.parse(out);
		const db = (await mermaid.mermaidAPI.getDiagramFromText(out)).db as unknown as {
			getMessages(): { from?: string; wrap?: boolean }[];
		};
		expect(
			db
				.getMessages()
				.filter((m) => m.from)
				.map((m) => m.wrap)
		).toEqual([true, false, false]);
	});
});

describe('style-/classDef-Vorstufe', () => {
	/** Vorstufe von mermaid 12.2.0 `encodeEntities` (`utils`), wörtlich. */
	const reference = (text: string) =>
		text
			.replace(/style.*:\S*#.*;/g, (s) => s.substring(0, s.length - 1))
			.replace(/classDef.*:\S*#.*;/g, (s) => s.substring(0, s.length - 1));

	it('entspricht mermaid auf zufälligen Zeilen', () => {
		const parts = [
			'style',
			'classDef',
			':',
			'#',
			';',
			' ',
			'\t',
			'x',
			'\n',
			'\r',
			'\r\n',
			'\u2028',
			'\u2029',
			'sty',
			'le'
		];
		// Auslöser gewichtet, sonst greift die Vorstufe zu selten.
		const weighted = [
			...parts,
			'style',
			'style',
			'classDef',
			':',
			':',
			':',
			'#',
			'#',
			'#',
			';',
			';',
			';'
		];
		// xorshift32: deckt alle Teile ab (lineare Kongruenz mit `%` verlor Genauigkeit).
		let seed = 7;
		const next = () => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return (seed >>> 0) % 1000003;
		};
		let changed = 0;
		for (let k = 0; k < 20000; k++) {
			// Jede zweite Zeile beginnt mit einem Schlüsselwort.
			let text = k % 2 ? parts[next() % 2] : '';
			const len = next() % 16;
			for (let i = 0; i < len; i++) text += weighted[next() % weighted.length];
			const expected = reference(text);
			if (expected !== text) changed++;
			expect(styleStage(text), JSON.stringify(text)).toBe(expected);
		}
		expect(changed).toBeGreaterThan(500);
	});
});

describe('grafische Bearbeitung unter der style-/classDef-Vorstufe', () => {
	/** Beschreibungen der Teilnehmer, wie mermaid sie anzeigt. */
	async function actors(text: string): Promise<Record<string, string>> {
		await mermaid.parse(text);
		const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as {
			getActors(): Map<string, { description: string }>;
		};
		const decode = (s: string) =>
			s.replace(/ﬂ\xB0\xB0(\d+)\xB6\xDF/g, (_, code: string) => String.fromCodePoint(Number(code)));
		return Object.fromEntries([...db.getActors()].map(([id, a]) => [id, decode(a.description)]));
	}

	async function edit(from: string, to: string, labels: [string, string, string]) {
		const text = `sequenceDiagram\n    participant P as p\n    ${from}->>${to}: a\n    Note over ${from}: n\n`;
		const doc = ok(text);
		const note = doc.nodes.find((n) => n.kind === 'note')!;
		let next = updateEdge(doc, doc.edges[0].id, { label: labels[0] });
		next = updateNode(next, note.id, { label: labels[1] });
		next = updateNode(next, 'P', { label: labels[2] });
		const out = serialize(next);
		const want = { messages: [labels[0]], notes: [labels[1]] };
		expect(await shown(out), out).toEqual(want);
		expect((await actors(out)).P, out).toBe(labels[2]);
		const again = ok(out);
		expect(model(again), out).toEqual(want);
		expect(again.nodes.find((n) => n.id === 'P')?.label, out).toBe(labels[2]);
		return out;
	}

	it.each([
		['A', 'B', 'CSS style:#1'],
		['styleSvc', 'B', 'a:#1'],
		['A', 'B', 'classDef:x;'],
		['classDefX', 'styleY', 'k:#;'],
		['A', 'B', 'style:#1;'],
		['A', 'B', 'wrap:#1 style:#2']
	])(
		'%s->>%s mit Label %j: mermaid und erneuter Parse zeigen das Label',
		async (from, to, label) => {
			await edit(from, to, [label, label, label]);
		}
	);

	it('Bearbeitungs-Fuzz: mermaid und erneuter Parse zeigen exakt das bearbeitete Label', async () => {
		const names = ['A', 'styleSvc', 'classDefX', 'xstyle', 'B'];
		const parts = [
			'style',
			'classDef',
			':',
			':',
			'#',
			'#',
			';',
			';',
			' ',
			'x',
			'1',
			'#35;',
			'#59;',
			'#58;',
			'wrap:'
		];
		let seed = 11;
		const next = () => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return (seed >>> 0) % 1000003;
		};
		// Benannte Entities (`#x;`) bleiben roh stehen (bekannte Grenze), daher ausgelassen.
		const label = (): string => {
			let text = '';
			const len = 1 + (next() % 8);
			for (let i = 0; i < len; i++) text += parts[next() % parts.length];
			text = text.trim() || 'x';
			return /#[A-Za-z]\w*;/.test(text) ? label() : text;
		};
		let staged = 0;
		for (let k = 0; k < 300; k++) {
			const from = names[next() % names.length];
			const to = names.filter((n) => n !== from)[next() % (names.length - 1)];
			const labels: [string, string, string] = [label(), label(), label()];
			const out = await edit(from, to, labels);
			// Zeilen, die ohne Maskierung (`build(false)` in `stageSafe`) die Vorstufe auslösten.
			const plain = [
				`${from}->>${to}: ${encodeLabel(labels[0])}`,
				`Note over ${from}: ${encodeLabel(labels[1])}`,
				`participant P as ${encodeLabel(labels[2])}`
			];
			for (const line of plain) {
				if (styleStage(line) !== line) staged++;
				else expect(out.split('\n'), line).toContain(`    ${line}`);
			}
		}
		// Direkt gezählt 201 von 900 Zeilen (vorher `/\S#58;/`: 231 inklusive `wrap#58;`).
		expect(staged).toBeGreaterThan(150);
	}, 60000);
});

describe('`%%` direkt nach `:`', () => {
	it.each(['A->>B:%%', 'A->>B:%% x', 'Note over A:%%', 'Note over A:%%x #1'])(
		'%j bleibt RawBlock (mermaid liest Kommentar, Parse-Fehler)',
		async (body) => {
			const text = `sequenceDiagram\n    ${body}\n`;
			await expect(mermaid.parse(text)).rejects.toThrow();
			const doc = ok(text);
			expect(doc.edges.filter((e) => e.kind === 'message')).toEqual([]);
			expect(doc.nodes.filter((n) => n.kind === 'note')).toEqual([]);
			expect(doc.rawBlocks).toHaveLength(1);
			expect(serialize(doc)).toBe(text);
		}
	);

	it.each(['A->>B: %%', 'A->>B:x%%y', 'Note over A: %%'])(
		'%j bleibt Nachricht/Notiz wie mermaid',
		async (body) => {
			const text = `sequenceDiagram\n    ${body}\n`;
			const doc = ok(text);
			expect(doc.rawBlocks).toEqual([]);
			expect(model(doc)).toEqual(await shown(text));
		}
	);
});
