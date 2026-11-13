// @vitest-environment jsdom
import mermaid from 'mermaid';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

// T138 C1 Iteration 3: Review-Befunde A-C (W31_T138_C1_I2_review).

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const node = (doc: DiagramDocument, id: string) => doc.nodes.find((n) => n.id === id);

async function vertex(text: string, id: string): Promise<{ text?: string; type?: string }> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as {
		getVertices(): Map<string, { text?: string; type?: string }>;
	};
	return db.getVertices().get(id)!;
}

const dir = join(__dirname, '../../../../fixtures/flowchart/roundtrip');
const fixture = (name: string) => readFileSync(join(dir, name), 'utf8');

describe('Befund A: subGraph<N> nur für Subgraphen ohne ID, Index in Schließreihenfolge', () => {
	it.each([
		['subgraph S\nX\nend\nsubGraph0@{ shape: doc }', 'subGraph0'],
		['subgraph S\nX\nend\nsubGraph0@{ shape: doc } --> X', 'subGraph0'],
		['subgraph "a"\nX\nend\nsubgraph "b"\nY\nend\nsubGraph1@{ shape: doc }', 'subGraph1']
	])('%j: Knoten mit Form doc, Roundtrip byte-gleich', async (body, id) => {
		const text = `flowchart TD\n${body}\n`;
		expect((await vertex(text, id)).type).toBe('doc');
		const doc = parseOk(text);
		expect(node(doc, id)?.shape).toBe('doc');
		expect(serialize(doc)).toBe(text);
	});

	it.each([
		// Verschachtelt ohne ID: innerer schließt zuerst und heißt subGraph0.
		['subgraph "x y"\nsubgraph "p q"\nX\nend\nend\nsubGraph0@{ shape: doc }', 'subGraph0'],
		['subgraph "x y"\nsubgraph "p q"\nX\nend\nend\nsubGraph1@{ shape: doc }', 'subGraph1'],
		// Mit expliziter ID davor zählt der Index trotzdem weiter.
		['subgraph S\nX\nend\nsubgraph "p q"\nY\nend\nsubGraph1@{ shape: doc }', 'subGraph1']
	])('%j: @{} auf Subgraph bleibt RawBlock, byte-gleich', async (body, id) => {
		const text = `flowchart TD\n${body}\n`;
		await mermaid.parse(text);
		const doc = parseOk(text);
		expect(doc.containers.map((c) => c.id)).toContain(id);
		expect(node(doc, id)).toBeUndefined();
		expect(doc.rawBlocks.some((r) => r.rawText.startsWith(`${id}@{`))).toBe(true);
		expect(serialize(doc)).toBe(text);
	});

	it('Absicherung: RawBlock mit @{} auf Subgraph und weiterem Knoten bleibt samt Kante', async () => {
		const text = 'flowchart TD\nsubgraph S\nX\nend\nS@{ shape: doc } --> Y\n';
		await mermaid.parse(text);
		const doc = parseOk(text);
		expect(node(doc, 'Y')).toBeDefined();
		expect(serialize(doc)).toBe(text);
		// Nach einer Änderung an anderer Stelle bleibt die Zeile.
		expect(serialize(updateNode(doc, 'X', { label: 'neu' }))).toContain('S@{ shape: doc } --> Y\n');
	});
});

describe('Befund B: `@{...}` vor Leerraum und `;`', () => {
	it('Lesen: `A@{ shape: doc } ;` ist für mermaid ein Fehler und bleibt RawBlock', async () => {
		const text = 'flowchart TD\nA@{ shape: doc } ;\n';
		await expect(mermaid.parse(text)).rejects.toThrow();
		const doc = parseOk(text);
		expect(node(doc, 'A')).toBeUndefined();
		expect(serialize(doc)).toBe(text);
	});

	it('Lesen: `A@{ shape: doc };` ohne Leerraum ist gültig', async () => {
		const text = 'flowchart TD\nA@{ shape: doc };\n';
		expect((await vertex(text, 'A')).type).toBe('doc');
		expect(node(parseOk(text), 'A')?.shape).toBe('doc');
	});

	it.each([
		['Fixture 07', fixture('07-semicolons-meta.mmd')],
		['A[x] ; B', 'flowchart TD\nA[x] ; B\n']
	])('Schreiben: %s, A -> Form doc ergibt gültigen Quelltext', async (_, text) => {
		const doc = parseOk(text);
		const out = serialize(updateNode(doc, 'A', { shape: 'doc' }));
		expect(out).not.toMatch(/\}[ \t]+;/);
		expect((await vertex(out, 'A')).type).toBe('doc');
		expect(node(parseOk(out), 'A')?.shape).toBe('doc');
	});
});

describe('Befund C: Zeilenumbruch im @{}-Label als YAML-Escape', () => {
	it('Schreiben: Label mit Umbruch und `%%` ergibt gültigen Quelltext', async () => {
		const doc = parseOk('flowchart TD\nA@{ shape: doc } --> B\n');
		const out = serialize(updateNode(doc, 'A', { label: 'a\n%% c' }));
		expect(out).toContain('label: "a\\n%% c"');
		expect(await vertex(out, 'A')).toMatchObject({ text: 'a\n%% c', type: 'doc' });
		expect(node(parseOk(out), 'A')).toMatchObject({ label: 'a\n%% c', shape: 'doc' });
	});

	it.each([
		['A@{ shape: doc, label: "a\\n%% c" }', 'a\n%% c'],
		['A@{ shape: doc, label: "a\\\\n" }', 'a\\n'],
		['A@{ shape: doc, label: "a\\\\\\nb" }', 'a\\\nb']
	])('Lesen: %s', async (body, label) => {
		const text = `flowchart TD\n${body}\n`;
		expect((await vertex(text, 'A')).text).toBe(label);
		const doc = parseOk(text);
		expect(node(doc, 'A')).toMatchObject({ label, shape: 'doc' });
		expect(serialize(doc)).toBe(text);
	});

	it('Lesen: andere Escapes bleiben RawBlock', () => {
		const text = 'flowchart TD\nA@{ shape: doc, label: "a\\tb" }\n';
		const doc = parseOk(text);
		expect(node(doc, 'A')).toBeUndefined();
		expect(serialize(doc)).toBe(text);
	});

	it('Roundtrip: echter Umbruch im String bleibt byte-gleich, auch nach Änderung anderswo', () => {
		const text = 'flowchart TD\nA@{ shape: doc, label: "a\n  b" }\nC\n';
		const doc = parseOk(text);
		expect(node(doc, 'A')?.label).toBe('a\nb');
		expect(serialize(doc)).toBe(text);
		expect(serialize(updateNode(doc, 'C', { label: 'D' }))).toContain(
			'A@{ shape: doc, label: "a\n  b" }\n'
		);
	});
});
