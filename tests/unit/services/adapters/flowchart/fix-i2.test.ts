// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
	flowchartAdapter,
	getDirection,
	serialize,
	validate
} from '../../../../../src/lib/services/adapters/flowchart';
import { parseStyle } from '../../../../../src/lib/services/adapters/flowchart/syntax';
import { removeContainer, removeEdge, removeNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface FlowDb {
	getVertices(): Map<string, { id: string; text: string }>;
	getEdges(): { start: string; end: string; text: string; type: string }[];
	getSubGraphs(): { id: string; nodes: string[] }[];
}

async function db(text: string): Promise<FlowDb> {
	await mermaid.parse(text);
	return (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
}

const edges = (doc: DiagramDocument) =>
	doc.edges.map((e) => `${e.sourceId}>${e.targetId}:${e.label}`);

describe('Trenner `;` (P2)', () => {
	it('trennt keinen ungequoteten Kantentext', async () => {
		const text = 'flowchart TD\nA -- a;b --> B\n';
		const doc = parseOk(text);
		expect(doc.nodes.map((n) => n.id)).toEqual(['A', 'B']);
		expect(edges(doc)).toEqual(['A>B:a;b']);
		expect((await db(text)).getEdges().map((e) => e.text)).toEqual(['a;b']);
	});

	it('trennt kein `>...]`-Label', async () => {
		const text = 'flowchart TD\nA>a;b] --> B\n';
		const doc = parseOk(text);
		expect(doc.nodes.find((n) => n.id === 'A')?.label).toBe('a;b');
		expect(edges(doc)).toEqual(['A>B:']);
		expect((await db(text)).getVertices().get('A')?.text).toBe('a;b');
	});

	it('trennt weiterhin echte Statements', () => {
		expect(edges(parseOk('flowchart TD\nA --> B; C --> D\n'))).toEqual(['A>B:', 'C>D:']);
	});
});

describe('Subgraph-IDs (P2)', () => {
	it('nummeriert unbenannte Subgraphen in Schließreihenfolge wie mermaid', async () => {
		const text = 'flowchart TD\nsubgraph "Außen x"\nsubgraph "Innen y"\nA\nend\nB\nend\n';
		const doc = parseOk(text);
		const ids = (await db(text)).getSubGraphs().map((s) => s.id);
		expect(doc.containers.map((c) => c.id).sort()).toEqual([...ids].sort());
		expect(doc.containers.find((c) => c.label === 'Innen y')?.id).toBe('subGraph0');
		expect(doc.nodes.find((n) => n.id === 'A')?.parentId).toBe('subGraph0');
		expect(serialize(doc)).toBe(text);
	});

	it('nimmt gequoteten Titel ohne Leerzeichen als ID', async () => {
		const text = 'flowchart TD\nsubgraph "Outer"\nA\nend\n';
		expect(parseOk(text).containers.map((c) => c.id)).toEqual(['Outer']);
		expect((await db(text)).getSubGraphs().map((s) => s.id)).toEqual(['Outer']);
	});
});

describe('parentId nach makeUniq (P2)', () => {
	it.each([
		'flowchart TD\nA-->B\nsubgraph S\nB\nend\n',
		'flowchart TD\nsubgraph O\nB\nsubgraph I\nB\nend\nend\n',
		'flowchart TD\nsubgraph S\nA --> B\nend\nsubgraph T\nB\nend\n'
	])('%j wie mermaid-db', async (text) => {
		const doc = parseOk(text);
		const owner = new Map<string, string>();
		for (const s of (await db(text)).getSubGraphs()) for (const n of s.nodes) owner.set(n, s.id);
		for (const node of doc.nodes) expect(node.parentId).toBe(owner.get(node.id) ?? null);
		for (const c of doc.containers) expect(c.parentId).toBe(owner.get(c.id) ?? null);
	});
});

describe('validate: Originalzeilen (P2)', () => {
	it('rechnet entfernte Kommentarzeilen zurück', async () => {
		const [error] = await validate('flowchart TD\n%% c1\n%% c2\n%% c3\nA-->\n');
		expect(error.line).toBe(5);
	});

	it('rechnet Frontmatter zurück', async () => {
		const [error] = await validate('---\ntitle: x\n---\nflowchart TD\n%% c1\n%% c2\n%% c3\nA-->\n');
		expect(error.line).toBe(8);
		const [plain] = await validate('---\ntitle: x\n---\nflowchart TD\nA --> B\nC -->\n');
		expect(plain.line).toBe(6);
	});

	it('rechnet Direktiven und CRLF zurück', async () => {
		const [error] = await validate(
			'%%{init: {"theme":"dark"}}%%\r\n\r\n%% x\r\nflowchart TD\r\nA --> B\r\nC -->\r\n'
		);
		expect(error.line).toBe(6);
	});

	it('nimmt ohne loc die Zeile aus der Fehlermeldung', async () => {
		const [error] = await validate('flowchart TD\n%% x\nA --> B\nC --> ]\n');
		expect(error.line).toBe(4);
	});
});

/** Kette aus `n` Knoten und `n` Kanten als Quelltext. */
function chainText(n: number): string {
	const lines = ['flowchart TD'];
	for (let i = 0; i < n; i++) lines.push(`    n${i}[Knoten ${i}]`, `    n${i} --> n${i + 1}`);
	return `${lines.join('\n')}\n`;
}

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

// Verhältnis statt absoluter Zeit: Die Grenzen 300 ms und 50 ms schlugen unter Gesamtlast
// sporadisch fehl (4k-Dokument bis 430 ms, parseStyle über 50 ms), beide Größen werden aber
// ähnlich gebremst. Je Test 16-fache Eingabe: linear gemessen 7 bis 35, unter Last vereinzelt
// bis 70 (Allokation und GC wachsen mit der Eingabe mit), quadratisch etwa 256. Grenze 128 =
// Exponent 1,75. Für TEXT_END wäre eine großzügige Absolutgrenze (10-fache Lastmessung, etwa
// 400 ms) nur Faktor 3 bis 5 vom quadratischen Fall über 20000 Zeichen (Probe 1,4 bis 2 s)
// entfernt; das Verhältnis trennt deutlicher und gilt für alle Tests hier einheitlich.
describe('Laufzeit (P2/P3)', () => {
	it('serialisiert ein unverändertes 8k-Dokument: 16-fache Eingabe < 128-fache Zeit', () => {
		const text = chainText(4000);
		const small = parseOk(chainText(250));
		const large = parseOk(text);
		expect(serialize(large)).toBe(text);
		expect(
			growth(
				() => serialize(small),
				() => serialize(large)
			)
		).toBeLessThan(128);
	}, 30000);

	it.each<[string, (k: number) => string]>([
		['Kantentext mit Leerzeichen', (k) => `flowchart TD\nA -- ${'a '.repeat(k)}\n`],
		['Leerzeichen', (k) => `flowchart TD\nA -- ${' '.repeat(2 * k)}x\n`],
		['Punktkette', (k) => `flowchart TD\nA -. ${'.'.repeat(2 * k)}\n`],
		['Kantentext mit Bindestrichen', (k) => `flowchart TD\nA -- ${'a-'.repeat(k)}\n`]
	])('TEXT_END linear: %s, 16-fache Länge < 128-fache Zeit', (_name, make) => {
		const small = make(625);
		const large = make(10000);
		expect(
			growth(
				() => flowchartAdapter.parse(small),
				() => flowchartAdapter.parse(large)
			)
		).toBeLessThan(128);
	});

	it('parseStyle ohne Klammern linear: 16-fache Länge < 128-fache Zeit', () => {
		const small = 'a:b,'.repeat(320);
		const large = 'a:b,'.repeat(5120);
		expect(
			growth(
				() => parseStyle(small),
				() => parseStyle(large)
			)
		).toBeLessThan(128);
	});

	it('parseStyle linear: 16-fache Länge < 128-fache Zeit', () => {
		const small = `${'stroke:#f00,'.repeat(100)}fill:url(a,b)`;
		const large = `${'stroke:#f00,'.repeat(1600)}fill:url(a,b)`;
		expect(parseStyle(large).fill).toBe('url(a,b)');
		expect(
			growth(
				() => parseStyle(small),
				() => parseStyle(large)
			)
		).toBeLessThan(128);
	});
});

describe('Kanten und Richtung (P3)', () => {
	it('liest `A---oB` als Kreis-Kante wie mermaid', async () => {
		const text = 'flowchart TD\nA---oB\n';
		const doc = parseOk(text);
		expect(doc.edges.map((e) => `${e.sourceId}>${e.targetId}`)).toEqual(['A>B']);
		const [edge] = (await db(text)).getEdges();
		expect(`${edge.start}>${edge.end}:${edge.type}`).toBe('A>B:arrow_circle');
		expect(serialize(doc)).toBe(text);
	});

	it.each([
		['>', 'LR'],
		['<', 'RL'],
		['^', 'BT'],
		['v', 'TB'],
		['TD', 'TD'],
		['LR', 'LR']
	])('getDirection normalisiert %s zu %s', (token, dir) => {
		expect(getDirection(parseOk(`flowchart ${token}\nA --> B\n`))).toBe(dir);
	});

	it('behält linkStyle mit Index jenseits der Modellkanten im unveränderten Dokument', () => {
		const text = 'flowchart TD\nA-->B\nA@{shape: rect} --> C\nlinkStyle 1 stroke:red\n';
		expect(serialize(parseOk(text))).toBe(text);
	});
});

describe('Ketten- und `&`-Gruppen (P3)', () => {
	it('Nachfolger rücken bei removeNode(cascade) an den Platz des Leaders', () => {
		const doc = parseOk('flowchart TD\nA & B --> C\nX --> Y\n');
		expect(serialize(removeNode(doc, 'A', 'cascade'))).toBe('flowchart TD\nB --> C\nX --> Y\n');
	});

	it('Nachfolger rücken bei removeEdge auf die erste Kettenkante nach', () => {
		const doc = parseOk('flowchart TD\nA --> B --> C\nX --> Y\n');
		const out = serialize(removeEdge(doc, doc.edges[0].id));
		expect(out).toBe('flowchart TD\nA\nB --> C\nX --> Y\n');
	});

	it('gibt hängende Kanten im mark-Modus nur als Kommentar aus', () => {
		const doc = removeNode(parseOk('flowchart TD\nA --> B\nB --> C\n'), 'A', 'mark');
		const out = serialize(doc);
		expect(out).toContain('%% A --> B');
		const again = parseOk(out);
		expect(again.nodes.map((n) => n.id).sort()).toEqual(['B', 'C']);
	});

	it('löscht Kommentare und RawBlocks eines entfernten Containers mit', () => {
		const doc = parseOk(
			'flowchart TD\nsubgraph S\n%% Notiz\nclick A call f()\nA --> B\nend\nX --> Y\n'
		);
		expect(serialize(removeContainer(doc, 'S', 'cascade'))).toBe('flowchart TD\nX --> Y\n');
	});
});

describe('Einrückung der Quelle (P3)', () => {
	it('übernimmt 2 Leerzeichen für neue Zeilen', () => {
		const doc = parseOk('flowchart TD\n  subgraph S\n    A\n  end\n');
		const node = doc.nodes[0];
		const out = serialize({ ...doc, nodes: [{ ...node, label: 'Neu' }] });
		expect(out).toBe('flowchart TD\n  subgraph S\n    A[Neu]\n  end\n');
	});

	it('rückt nicht ein, wenn die Quelle nie einrückt', () => {
		const doc = parseOk('flowchart TD\nA --> B\nB --> C\n');
		const out = serialize({ ...doc, nodes: doc.nodes.map((n) => ({ ...n, label: `${n.id}!` })) });
		expect(out).toBe('flowchart TD\nA --> B\nB --> C\nA[A!]\nB[B!]\nC[C!]\n');
	});

	it('nimmt ohne Anhalt vier Leerzeichen', () => {
		const doc = parseOk('flowchart TD\n');
		const out = serialize({ ...doc, nodes: [{ ...parseOk('flowchart TD\nA\n').nodes[0] }] });
		expect(out).toBe('flowchart TD\n    A\n');
	});
});
