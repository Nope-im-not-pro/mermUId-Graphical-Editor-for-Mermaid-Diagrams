// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { META_SHAPES } from '../../../../../src/lib/services/adapters/flowchart/syntax';
import { addNode, updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument, DiagramNode } from '../../../../../src/lib/model/types';

// T138 C1 (F-07): neue flowchart-Formen über `A@{ shape: ... }` (mermaid 12.2.0, shapesDefs).

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const node = (doc: DiagramDocument, id: string) => doc.nodes.find((n) => n.id === id)!;

interface FlowDb {
	getVertices(): Map<string, { text?: string; type?: string }>;
	getEdges(): { start: string; end: string }[];
}

async function db(text: string): Promise<FlowDb> {
	await mermaid.parse(text);
	return (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
}

/** Render braucht Textmaße; jsdom liefert keine. */
async function render(code: string): Promise<string> {
	const proto = window.SVGElement.prototype as unknown as Record<string, unknown>;
	proto.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
	proto.getComputedTextLength = () => 10;
	mermaid.initialize({ startOnLoad: false });
	const { svg } = await mermaid.render(`r${Math.random().toString(36).slice(2)}`, code);
	return svg;
}

/** Form-Name aus mermaid-db (Alias wie geschrieben) auf den kanonischen Kurznamen. */
const canonical = (type: string | undefined) =>
	Object.entries(META_SHAPES).find(
		([name, aliases]) => name === type || aliases.includes(type!)
	)?.[0];

/** Adapter gegen mermaid-db: Knoten-IDs, Label und Form; Roundtrip byte-gleich. */
async function sameAsMermaid(text: string): Promise<DiagramDocument> {
	const doc = parseOk(text);
	const flow = await db(text);
	const vertices = [...flow.getVertices()].map(([id, v]) => [id, v.text ?? id, canonical(v.type)]);
	expect(
		doc.nodes.map((n) => [n.id, n.label, n.shape in META_SHAPES ? n.shape : undefined]).sort()
	).toEqual(vertices.sort());
	expect(doc.edges.map((e) => `${e.sourceId}>${e.targetId}`).sort()).toEqual(
		flow
			.getEdges()
			.map((e) => `${e.start}>${e.end}`)
			.sort()
	);
	expect(serialize(doc)).toBe(text);
	return doc;
}

const newNode = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({
	id,
	kind: 'node',
	label: id,
	shape: 'default',
	cssClasses: [],
	style: {},
	props: {},
	parentId: null,
	sourceText: '',
	...extra
});

describe('META_SHAPES: Namen und Aliase aus mermaid 12.2.0 shapesDefs', () => {
	it('enthält genau die fünf Formen mit allen Aliasen', () => {
		expect(META_SHAPES).toEqual({
			doc: ['document'],
			delay: ['half-rounded-rectangle'],
			'sl-rect': ['manual-input', 'sloped-rectangle'],
			'h-cyl': ['das', 'horizontal-cylinder'],
			'lin-cyl': ['disk', 'lined-cylinder']
		});
	});
});

describe('Parsen jeder Form samt Alias (gegen mermaid-db)', () => {
	const names = Object.entries(META_SHAPES).flatMap(([name, aliases]) =>
		[name, ...aliases].map((alias) => [name, alias] as const)
	);
	it.each(names)('%s über %s', async (name, alias) => {
		const doc = await sameAsMermaid(`flowchart TD\nA@{ shape: ${alias}, label: "Text" }\n`);
		expect(node(doc, 'A')).toMatchObject({ shape: name, label: 'Text' });
	});

	it.each([
		['ohne Leerzeichen', 'A@{shape: doc,label: "Text"}'],
		['viele Leerzeichen', 'A@{   shape:   doc ,   label:   "Text"   }'],
		['Label zuerst', 'A@{ label: "Text", shape: doc }'],
		['Form in "', 'A@{ shape: "doc", label: "Text" }'],
		["Form in '", "A@{ shape: 'doc', label: 'Text' }"],
		['Label ungequotet', 'A@{ shape: doc, label: Text }'],
		["Label in ' mit ''", "A@{ shape: doc, label: 'It''s' }"],
		['Label mit Satzzeichen', 'A@{ shape: doc, label: "a, b: {c} [d] ; e" }'],
		['Label mit \\\\', 'A@{ shape: doc, label: "a\\\\b" }'],
		['Leerraum im Label bleibt', 'A@{ shape: doc, label: "  x  " }'],
		['ohne Label', 'A@{ shape: doc }'],
		['mit ;', 'A@{ shape: doc, label: "Text" };'],
		['eingerückt', '    A@{ shape: doc, label: "Text" }']
	])('%s', async (_name, line) => {
		const doc = await sameAsMermaid(`flowchart TD\n${line}\n`);
		expect(node(doc, 'A').shape).toBe('doc');
	});

	it('Label-Werte wie mermaid', () => {
		const label = (line: string) => node(parseOk(`flowchart TD\n${line}\n`), 'A').label;
		expect(label("A@{ shape: doc, label: 'It''s' }")).toBe("It's");
		expect(label('A@{ shape: doc, label: "a\\\\b" }')).toBe('a\\b');
		expect(label('A@{ shape: doc, label: "  x  " }')).toBe('  x  ');
		expect(label('A@{ shape: doc }')).toBe('A');
		expect(label('A@{ shape: doc, label: "" }')).toBe('A');
	});

	it('Label über mehrere Zeilen (mermaid: Zeilenumbruch samt Einzug wird <br/>)', async () => {
		const text = 'flowchart TD\nA@{ shape: doc, label: "a\n    b" }\n';
		const flow = await db(text);
		expect(flow.getVertices().get('A')?.text).toBe('a<br/>b');
		const doc = parseOk(text);
		expect(node(doc, 'A')).toMatchObject({ shape: 'doc', label: 'a\nb' });
		expect(serialize(doc)).toBe(text);
	});

	it('in Kanten, &-Gruppen und Subgraphen', async () => {
		const text = [
			'flowchart LR',
			'A@{ shape: doc, label: "D" } --> B@{ shape: delay, label: "W" }',
			'C@{ shape: disk } & D --> E',
			'subgraph S',
			'  F@{ shape: manual-input, label: "M" }',
			'end',
			''
		].join('\n');
		const doc = await sameAsMermaid(text);
		expect(doc.edges).toHaveLength(3);
		expect(node(doc, 'B').shape).toBe('delay');
		expect(node(doc, 'C').shape).toBe('lin-cyl');
		expect(node(doc, 'F').parentId).toBe('S');
	});

	it('CRLF', async () => {
		const text = 'flowchart TD\r\nA@{ shape: das, label: "X" } --> B\r\n';
		const doc = await sameAsMermaid(text);
		expect(node(doc, 'A').shape).toBe('h-cyl');
	});

	it('spätere @{}-Nennung setzt die Form eines Klammer-Knotens, Label bleibt ohne label', async () => {
		const doc = await sameAsMermaid('flowchart TD\nA[Alt] --> B\nA@{ shape: doc }\n');
		expect(node(doc, 'A')).toMatchObject({ shape: 'doc', label: 'Alt' });
	});
});

describe('Unbekannte @{}-Formen und sonstige Attribute bleiben RawBlock (byte-gleich)', () => {
	it.each([
		'A@{ shape: rect }',
		'A@{ shape: cyl, label: "x" }',
		'A@{ shape: doc, icon: "fa:user" }',
		'A@{ shape: doc, label: "x", label: "y" }',
		'A@{ label: "x" }',
		'A@{ shape: Doc }',
		'A@{ shape: unbekannt }',
		'A["x"]@{ shape: doc }',
		'A@{ shape: doc, label: "a\\"b" }',
		'A@{ shape: doc, label: 12 }',
		'A@{ shape: doc,\n  label: "x" }',
		'A@{ shape: doc } --> B@{ shape: rect }',
		'e1@{ animate: true }'
	])('%s', (line) => {
		const text = `flowchart TD\n${line}\n`;
		const doc = parseOk(text);
		expect(doc.nodes).toEqual([]);
		expect(doc.edges).toEqual([]);
		expect(serialize(doc)).toBe(text);
	});
});

describe('Modelländerung serialisiert gültiges mermaid', () => {
	it('Klammer -> neue Form schreibt @{}', async () => {
		const doc = parseOk('flowchart LR\n  A[Alt] --> B\n');
		const out = serialize(updateNode(doc, 'A', { shape: 'doc' }));
		expect(out).toBe('flowchart LR\n  A@{ shape: doc, label: "Alt" } --> B\n');
		await sameAsMermaid(out);
	});

	it('neue Form -> Klammer schreibt Klammer-Syntax', async () => {
		const doc = parseOk('flowchart LR\n  A@{ shape: document, label: "Alt" } --> B\n');
		const out = serialize(updateNode(doc, 'A', { shape: 'round' }));
		expect(out).toBe('flowchart LR\n  A(Alt) --> B\n');
		await sameAsMermaid(out);
	});

	it('neue Form -> andere neue Form und Label-Änderung', async () => {
		const doc = parseOk('flowchart LR\nA@{ shape: disk, label: "Alt" } --> B\n');
		const out = serialize(updateNode(doc, 'A', { shape: 'h-cyl', label: 'Neu "x" \\ y' }));
		expect(out).toBe('flowchart LR\nA@{ shape: h-cyl, label: "Neu #quot;x#quot; \\\\ y" } --> B\n');
		const re = parseOk(out);
		expect(node(re, 'A')).toMatchObject({ shape: 'h-cyl', label: 'Neu "x" \\ y' });
		expect(serialize(re)).toBe(out);
	});

	it('mehrzeiliges Label wird mit YAML-Escape \\n geschrieben (T138 C1 I3 Befund C)', () => {
		const doc = parseOk('flowchart LR\nA@{ shape: delay, label: "Alt" }\n');
		const out = serialize(updateNode(doc, 'A', { label: 'a\nb' }));
		expect(out).toBe('flowchart LR\nA@{ shape: delay, label: "a\\nb" }\n');
		expect(node(parseOk(out), 'A')).toMatchObject({ shape: 'delay', label: 'a\nb' });
	});

	it('neuer Knoten mit neuer Form, Label gleich ID ohne label', () => {
		const doc = parseOk('flowchart LR\nA --> B\n');
		let next = addNode(doc, newNode('N', { shape: 'sl-rect', label: 'Eingabe' }));
		next = addNode(next, newNode('M', { shape: 'lin-cyl' }));
		const out = serialize(next);
		expect(out).toBe(
			'flowchart LR\nA --> B\nN@{ shape: sl-rect, label: "Eingabe" }\nM@{ shape: lin-cyl }\n'
		);
		const re = parseOk(out);
		expect(node(re, 'N')).toMatchObject({ shape: 'sl-rect', label: 'Eingabe' });
		expect(node(re, 'M')).toMatchObject({ shape: 'lin-cyl', label: 'M' });
	});

	it('Klammer-Knoten schreiben weiter Klammer-Syntax', () => {
		const doc = parseOk('flowchart LR\nA[Alt]\n');
		expect(serialize(updateNode(doc, 'A', { shape: 'cylinder' }))).toBe('flowchart LR\nA[(Alt)]\n');
	});
});

describe('Render-Test mermaid 12.2.0 je Form', () => {
	it.each(Object.keys(META_SHAPES))('%s rendert', async (name) => {
		const doc = parseOk('flowchart LR\nA[Alt] --> B\n');
		const out = serialize(updateNode(doc, 'A', { shape: name, label: 'Text' }));
		expect(out).toContain(`A@{ shape: ${name}, label: "Text" }`);
		const svg = await render(out);
		expect(svg).toContain('<svg');
		expect(svg).toContain('Text');
		// Formmerkmal: Umriss als Pfad (`outer-path`), nicht das Rechteck der Standardform.
		const shapeOf = (s: string) => /flowchart-A-[\s\S]*?class="label"/.exec(s)![0];
		expect(shapeOf(svg)).toContain('<path');
		expect(shapeOf(svg)).toContain('outer-path');
		expect(shapeOf(svg)).not.toContain('<rect class="basic label-container"');
		expect(shapeOf(await render('flowchart LR\nA[Text] --> B\n'))).toContain(
			'<rect class="basic label-container"'
		);
	});
});

describe('Fixtures 09 (LF) und 10 (CRLF)', () => {
	const dir = join(__dirname, '../../../../fixtures/flowchart/roundtrip');
	const fixture = (name: string) => readFileSync(join(dir, name), 'utf8');

	it('09: Formen modelliert, Unbekanntes als RawBlock, gültig für mermaid, byte-gleich', async () => {
		const text = fixture('09-meta-shapes.mmd');
		const doc = parseOk(text);
		const shapes = Object.fromEntries(doc.nodes.map((n) => [n.id, [n.shape, n.label]]));
		expect(shapes).toMatchObject({
			A: ['doc', 'Bericht'],
			B: ['delay', 'Warten'],
			C: ['sl-rect', 'Eingabe'],
			D: ['h-cyl', 'Speicher'],
			E: ['lin-cyl', 'E'],
			I: ['lin-cyl', 'a\\b "c"'],
			J: ['sl-rect', 'Zeile 1\nZeile 2']
		});
		expect(shapes.H).toEqual(['square', 'Klammer']);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual(
			expect.arrayContaining([
				'    H@{ shape: rect, label: "unbekannt" }\n',
				'    e1@{ animate: true }\n'
			])
		);
		expect(node(doc, 'J').parentId).toBe('S');
		await mermaid.parse(text);
		expect(serialize(doc)).toBe(text);
	});

	it('10: CRLF byte-gleich, Formen über Aliase', async () => {
		const text = fixture('10-meta-shapes-crlf.mmd');
		expect(text).toContain('\r\n');
		const doc = parseOk(text);
		expect(doc.nodes.map((n) => [n.id, n.shape]).sort()).toEqual([
			['A', 'doc'],
			['B', 'delay'],
			['C', 'h-cyl'],
			['D', 'lin-cyl'],
			['E', 'sl-rect'],
			['X', 'square']
		]);
		expect(doc.rawBlocks.map((r) => r.rawText)).toContain('  X@{ shape: cyl }\r\n');
		await mermaid.parse(text);
		expect(serialize(doc)).toBe(text);
		const out = serialize(updateNode(doc, 'B', { label: 'Neu' }));
		expect(out).toContain('B@{ shape: delay, label: "Neu" }\r\n');
		expect(parseOk(out).nodes.find((n) => n.id === 'B')).toMatchObject({ shape: 'delay' });
	});
});
