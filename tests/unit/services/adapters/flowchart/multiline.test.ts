// @vitest-environment jsdom
import mermaid from 'mermaid';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync } from '../../../../../src/lib/controllers/sync';
import { updateEdge, updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';
import {
	flowchartAdapter,
	serialize,
	warnings
} from '../../../../../src/lib/services/adapters/flowchart';
import { msg } from '../../../../../src/lib/services/i18n';
import { fakeAdapters, noop, place } from '../../../controllers/sync/helpers';

// V-07 / D3 Synthese A / O-46: mehrzeilige Label in Anführungszeichen als logisches Statement.

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface FlowDb {
	getVertices(): Map<string, { text?: string }>;
	getSubGraphs(): { id: string; nodes: string[]; title: string }[];
	getEdges(): { start: string; end: string; text?: string }[];
}

async function db(text: string): Promise<FlowDb> {
	await mermaid.parse(text);
	return (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
}

/** Knoten-, Kanten- und Subgraph-Mengen samt Zuordnung: Adapter gegen mermaid-DB. */
async function sameAsMermaid(text: string, labels = true): Promise<DiagramDocument> {
	const doc = parseOk(text);
	const flow = await db(text);
	expect(doc.nodes.map((n) => n.id).sort()).toEqual([...flow.getVertices().keys()].sort());
	expect(doc.edges.map((e) => `${e.sourceId}>${e.targetId}:${e.label}`).sort()).toEqual(
		flow
			.getEdges()
			.map((e) => `${e.start}>${e.end}:${e.text ?? ''}`)
			.sort()
	);
	expect(doc.containers.map((c) => c.id).sort()).toEqual(
		flow
			.getSubGraphs()
			.map((s) => s.id)
			.sort()
	);
	const owner = new Map<string, string>();
	for (const s of flow.getSubGraphs()) for (const n of s.nodes) owner.set(n, s.id);
	for (const n of doc.nodes) expect([n.id, n.parentId]).toEqual([n.id, owner.get(n.id) ?? null]);
	if (labels) {
		for (const [id, v] of flow.getVertices())
			expect([id, doc.nodes.find((n) => n.id === id)?.label]).toEqual([id, v.text ?? id]);
		for (const s of flow.getSubGraphs())
			expect([s.id, doc.containers.find((c) => c.id === s.id)?.label]).toEqual([s.id, s.title]);
	}
	expect(serialize(doc)).toBe(text);
	return doc;
}

const CASES: [string, string, boolean][] = [
	['Knotenlabel zweizeilig', 'flowchart TD\nA["Zeile 1\nZeile 2"] --> B\n', true],
	[
		'Mittelzeile end im Subgraph',
		'flowchart TD\nsubgraph S\nA["Zeile 1\nend\nZeile 3"] --> B\nend\n',
		true
	],
	['Mittelzeile subgraph x', 'flowchart TD\nA["Zeile 1\nsubgraph x\nZeile 3"] --> B\n', true],
	// Altverhalten: Backticks bleiben im Label (mermaid-DB liefert Markdown-Text), daher ohne Labelvergleich.
	[
		'Markdown-String (Backticks bleiben im Label)',
		'flowchart TD\nA["`Zeile 1\nZeile 2`"] --> B\n',
		false
	],
	['Subgraph-Titel mit ID', 'flowchart TD\nsubgraph S["Titel 1\nTitel 2"]\nA\nend\n', true],
	['Subgraph-Titel ohne ID', 'flowchart TD\nsubgraph "Titel 1\nTitel 2"\nA\nend\nB\n', true],
	['Kantenlabel mit Pipes', 'flowchart TD\nA -->|"Kante 1\nKante 2"| B\n', true],
	['Kantentext', 'flowchart TD\nA -- "Kante 1\nKante 2" --> B\n', true],
	['accTitle mit Einzel-"', 'flowchart TD\naccTitle: Sag "hallo\nA --> B\nC\n', true],
	['accDescr mit Einzel-"', 'flowchart TD\naccDescr: Sag "hallo\nA --> B\nC\n', true],
	[
		'accDescr-Block mit Einzel-" und end',
		'flowchart TD\nsubgraph S\naccDescr {\nSag "hallo\nend\nsubgraph x\n}\nA --> B\nend\nC\n',
		true
	],
	['Kommentar mit Einzel-"', 'flowchart TD\n%% Sag "hallo\nA --> B\nC\n', true],
	[
		'Kommentarzeile im offenen String',
		'flowchart TD\nA["Zeile 1\n%% Sag "hallo\nZeile 2"] --> B\n',
		true
	],
	['Trenner nach dem Label', 'flowchart TD\nA["Zeile 1\nZeile 2"] --> B; C --> D\nE\n', true],
	['CRLF', 'flowchart TD\r\nA["Zeile 1\r\nZeile 2"] --> B\r\n', true],
	// Befund I1-3: mermaid `cleanupComments` /^\s*%%(?!{)[^\n]+\n?/gm nach `removeDirectives`.
	['CRLF mit innerer Kommentarzeile', 'flowchart TD\r\nA["a\r\n%% c\r\nb"] --> B\r\n', true],
	['CRLF mit nackter %%-Zeile', 'flowchart TD\r\nA["a\r\n%%\r\nb"] --> B\r\n', true],
	['nackte %%-Zeile bleibt im Label', 'flowchart TD\nA["a\n%%\nb"] --> B\n', true],
	['Leerzeile vor %%-Zeile entfällt', 'flowchart TD\nA["a\n\n%% c\nb"] --> B\n', true],
	['Leerraumzeile vor %%-Zeile entfällt', 'flowchart TD\nA["a\n  \n%% c\nb"] --> B\n', true],
	['Leerzeile nach %%-Zeile bleibt', 'flowchart TD\nA["a\n%%c\n\nb"] --> B\n', true],
	['%%{…}%%-Zeile hinterlässt Leerzeile', 'flowchart TD\nA["a\n%%{init: {}}%%\nb"] --> B\n', true],
	// Befund I1-4: Kommentarzeile mit `}` beendet den accDescr-Block nicht.
	['accDescr-Block mit %%-Zeile und }', 'flowchart TD\naccDescr {\n%% }\nfoo "\n}\nA\n', true],
	// Befund I1-2: `call`-Name `[^(]*` und -Argumente `[^)]*` ohne String-Regel (mermaid-Lexer).
	['click call mit Einzel-" im Argument', 'flowchart TD\nA\nclick A call fn("x)\nC --> D\n', true],
	['click call mit Einzel-" im Namen', 'flowchart TD\nA\nclick A call "fn(x)\nC --> D\n', true]
];

describe('Mehrzeilige Label: Differenztest gegen mermaid-DB (V-07, D3)', () => {
	it.each(CASES)('%s', async (_n, text, labels) => {
		await sameAsMermaid(text, labels);
	});

	it('zweizeiliges Label ergibt Knoten und Kante mit echtem Zeilenumbruch', () => {
		const doc = parseOk('flowchart TD\nA["Zeile 1\nZeile 2"] --> B\n');
		expect(doc.nodes.map((n) => [n.id, n.label])).toEqual([
			['A', 'Zeile 1\nZeile 2'],
			['B', 'B']
		]);
		expect(doc.edges).toHaveLength(1);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual(['flowchart TD\n']);
	});

	it('Mittelzeile end/subgraph verändert die Container-Struktur nicht', () => {
		const doc = parseOk('flowchart TD\nsubgraph S\nA["Zeile 1\nend\nZeile 3"] --> B\nend\nC\n');
		expect(doc.containers.map((c) => c.id)).toEqual(['S']);
		expect(doc.nodes.map((n) => [n.id, n.parentId])).toEqual([
			['A', 'S'],
			['B', 'S'],
			['C', null]
		]);
		const nested = parseOk('flowchart TD\nA["Zeile 1\nsubgraph x\nZeile 3"] --> B\n');
		expect(nested.containers).toEqual([]);
	});

	it('Kommentarzeile im offenen String gehört nicht zum Label (cleanupComments)', () => {
		const doc = parseOk('flowchart TD\nA["Zeile 1\n  %% Notiz\nZeile 2"] --> B\n');
		expect(doc.nodes[0].label).toBe('Zeile 1\nZeile 2');
	});

	it('Zeilennummern bilden auf die Startzeile des Statements ab', () => {
		const open = flowchartAdapter.parse('flowchart TD\nsubgraph S["a\nb"]\nA\n');
		expect(open.ok).toBe(false);
		if (!open.ok) expect(open.errors[0].line).toBe(2);
		const later = flowchartAdapter.parse('flowchart TD\nA["x\ny"]; B --> C\nsubgraph Q\n');
		expect(later.ok).toBe(false);
		if (!later.ok) expect(later.errors[0].line).toBe(4);
	});
});

describe('Offener String bis Dateiende (D3)', () => {
	const TEXT = 'flowchart TD\nA --> B\nC["offen\nD --> E\nend\n';

	it('fällt ab der Startzeile auf einen RawBlock zurück, Roundtrip byte-gleich', () => {
		const doc = parseOk(TEXT);
		expect(doc.nodes.map((n) => n.id)).toEqual(['A', 'B']);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([
			'flowchart TD\n',
			'C["offen\nD --> E\nend\n'
		]);
		expect(serialize(doc)).toBe(TEXT);
	});

	it('wird als Warnung mit Startzeile gemeldet (services.flowchart.unclosedString)', () => {
		expect(warnings(parseOk(TEXT))).toEqual([
			msg('services.flowchart.unclosedString', { line: 3, text: 'C["offen' })
		]);
		expect(warnings(parseOk('flowchart TD\r\nA\r\n\r\nB["x\r\ny\r\n'))).toEqual([
			msg('services.flowchart.unclosedString', { line: 4, text: 'B["x' })
		]);
		expect(warnings(parseOk('flowchart TD\nA\nclick A call fn("x)\nC --> D\n'))).toEqual([]);
		expect(warnings(parseOk('flowchart TD\nA["Zeile 1\nZeile 2"] --> B\n'))).toEqual([]);
		expect(warnings(parseOk('flowchart TD\naccTitle: Sag "hallo\nA\n'))).toEqual([]);
	});
});

describe('Kommentarzeile im mehrzeiligen Label bei Bearbeitung (T111 C2)', () => {
	// T111 C2 (Kettenzeile in place): Das Statement bleibt stehen; nur das geänderte
	// Knoten-Token wird ersetzt, die %%-Zeile im Label eines anderen Knotens bleibt erhalten.
	it('Label-Änderung an B lässt die %%-Zeile im Label von A stehen', () => {
		const doc = parseOk('flowchart TD\nA["x\n%% note\ny"] --> B[b]\n');
		expect(serialize(updateNode(doc, 'B', { label: 'neu' }))).toBe(
			'flowchart TD\nA["x\n%% note\ny"] --> B[neu]\n'
		);
	});
});

describe('Laufzeit mehrzeiliger Statements (Muster robustness.test.ts)', () => {
	/** Laufzeit von `run` in ms. */
	function timed(run: () => void): number {
		const t0 = performance.now();
		run();
		return performance.now() - t0;
	}
	const text = (n: number) =>
		'flowchart TD\n' +
		Array.from({ length: n }, (_, i) => `N${i}["a ${i}\n%% c\nb"] --> M${i}\n`).join('');

	it('8000 mehrzeilige Statements: 16-fache Menge < 64-fache Zeit, Roundtrip byte-gleich', () => {
		const small = text(500);
		const large = text(8000);
		const run = (t: string) => () => parseOk(t);
		run(small)();
		run(large)();
		const tSmall: number[] = [];
		const tLarge: number[] = [];
		for (let i = 0; i < 3; i++) {
			for (let k = 0; k < 4; k++) tSmall.push(timed(run(small)));
			tLarge.push(timed(run(large)));
		}
		expect(Math.min(...tLarge) / Math.min(...tSmall)).toBeLessThan(64);
		const doc = parseOk(large);
		expect(doc.nodes).toHaveLength(16000);
		expect(doc.nodes[0].label).toBe('a 0\nb');
		expect(serialize(doc)).toBe(large);
	}, 60000);
});

describe('Kanonische Zeilenumbruch-Form (D3)', () => {
	const TEXT = 'flowchart TD\nA["Zeile 1\nZeile 2"] -->|"K 1\nK 2"| B\n';

	it('Edit ohne Wertänderung lässt den Code byte-gleich', () => {
		const doc = parseOk(TEXT);
		const same = updateNode(doc, 'A', { label: 'Zeile 1\nZeile 2' });
		expect(serialize(same)).toBe(TEXT);
		const edge = doc.edges[0];
		expect(serialize(updateEdge(doc, edge.id, { label: edge.label }))).toBe(TEXT);
	});

	it('echte Änderung schreibt kanonisch; Ergebnis bleibt mermaid-gleich', async () => {
		const doc = updateNode(parseOk(TEXT), 'A', { label: 'Neu 1\nNeu 2' });
		const out = serialize(doc);
		expect(out).toContain('A["Neu 1\nNeu 2"]');
		const again = await sameAsMermaid(out);
		expect(again.nodes.find((n) => n.id === 'A')?.label).toBe('Neu 1\nNeu 2');
	});
});

describe('%% @mermuid-Zeile im mehrzeiligen Label (O-64)', () => {
	const META = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2],"B":[3,4]}}';
	const TEXT = `flowchart LR\nA["Zeile 1\n${META}\nZeile 2"] --> B\n`;
	const open = () => createSync(TEXT, { adapters: fakeAdapters });
	const orphans = (doc: DiagramDocument) => {
		const ids = new Set([...doc.nodes, ...doc.edges, ...doc.containers].map((e) => e.id));
		return Object.keys(doc.layout.positions).filter((id) => !ids.has(id));
	};

	it('Positionen ohne Waisen, Label ohne Meta-Zeile, No-op byte-gleich', async () => {
		const sync = await open();
		const { doc } = get(sync.commands);
		expect(get(sync).errors).toEqual([]);
		expect(doc.nodes.map((n) => [n.id, n.label])).toEqual([
			['A', 'Zeile 1\nZeile 2'],
			['B', 'B']
		]);
		expect(doc.layout.positions.A).toEqual([1, 2, 0, 0]);
		expect(orphans(doc)).toEqual([]);
		expect((await sync.diff())?.model).toBe(TEXT);
		await sync.execute(noop);
		expect(get(sync).code).toBe(TEXT);
	});

	it('Positionsänderung (O-64): Zeile im Label bleibt, neue Zeile am Ende, Label unverändert', async () => {
		const sync = await open();
		await sync.execute(place('B', [5, 6, 0, 0]));
		const { code, warnings } = get(sync);
		expect(code.startsWith(TEXT)).toBe(true);
		expect(code.slice(TEXT.length)).toMatch(/^%% @mermuid: \{[^\n]*"B":\[5,6,0,0\][^\n]*\}\n$/);
		expect(warnings).toContain(msg('sync.metaDuplicate'));
		const doc = get(sync.commands).doc;
		expect(orphans(doc)).toEqual([]);
		expect(doc.nodes.find((n) => n.id === 'A')?.label).toBe('Zeile 1\nZeile 2');
		expect(doc.edges).toHaveLength(1);
		const reopened = await createSync(code, { adapters: fakeAdapters });
		expect(get(reopened.commands).doc.layout.positions.B).toEqual([5, 6, 0, 0]);
		expect(orphans(get(reopened.commands).doc)).toEqual([]);
	});
});
