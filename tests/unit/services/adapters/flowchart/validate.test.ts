// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../../../src/lib/services/adapters/diagnostics';
import { flowchartAdapter, validate } from '../../../../../src/lib/services/adapters/flowchart';

const dir = join(__dirname, '../../../../fixtures/flowchart/roundtrip');
const files = readdirSync(dir).filter((f) => f.endsWith('.mmd'));

/** Ausschnitt der Flowchart-db von mermaid, soweit das Orakel ihn nutzt. */
interface FlowDb {
	getVertices(): Map<string, { id: string }>;
	getEdges(): { start: string; end: string; id?: string; isUserDefinedId?: boolean }[];
	getSubGraphs(): { id: string }[];
}

describe('validate (O-15)', () => {
	it.each(files)('%s ist für mermaid gültig', async (file) => {
		expect(await validate(readFileSync(join(dir, file), 'utf8'))).toEqual([]);
	});

	it('meldet Syntaxfehler mit Zeile und Spalte', async () => {
		const errors = await validate('flowchart TD\n    A --> B\n    C -->\n');
		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBeGreaterThanOrEqual(3);
		expect(errors[0].column).toBeGreaterThanOrEqual(1);
		expect(errors[0].message).not.toBe('');
	});

	it('lehnt andere Diagrammtypen ab', async () => {
		const errors = await validate('sequenceDiagram\n    A->>B: x\n');
		expect(errors).toEqual([{ line: 1, column: 1, message: expect.stringContaining('flowchart') }]);
	});
});

describe('validate: Kurztext und Robustheit (T115)', () => {
	it('Kurztext ohne Token-Namen, Rohtext getrennt', async () => {
		const [error] = (await validate('flowchart TD\n  A[x\n')) as Diagnostic[];
		expect(error.key).toBe('services.validate.unclosedBracket');
		expect(error.message).not.toMatch(/SQE|Expecting|Parse error/);
		expect(error.raw).toContain('Expecting');
	});

	it('Fehlerzeile mit Emoji vor der Fehlerstelle', async () => {
		const emoji = '\u{1F600}'.repeat(60);
		const [error] = await validate(`flowchart TD\n%% ${emoji}\n  A["${emoji}"] --> B\n  C -->\n`);
		expect(error.line).toBe(4);
	});

	it('großes ungültiges Dokument ohne RangeError', async () => {
		const text = `flowchart TD\n${'%% c\n'.repeat(100000)}A-->\n`;
		const [error] = await validate(text);
		expect(error.line).toBe(100002);
	}, 60000);
});

describe('Orakel gegen mermaid-db', () => {
	it.each(files)('%s: Knoten, Kanten und Subgraphen wie mermaid', async (file) => {
		const text = readFileSync(join(dir, file), 'utf8');
		const result = flowchartAdapter.parse(text);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		await mermaid.parse(text);
		const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
		const doc = result.doc;
		expect(doc.nodes.map((n) => n.id).sort()).toEqual([...db.getVertices().keys()].sort());
		expect(doc.edges.map((e) => `${e.sourceId}>${e.targetId}`)).toEqual(
			db.getEdges().map((e) => `${e.start}>${e.end}`)
		);
		expect(doc.edges.filter((e) => e.props.explicitId).map((e) => e.id)).toEqual(
			db
				.getEdges()
				.filter((e) => e.isUserDefinedId)
				.map((e) => e.id)
		);
		expect(doc.containers.map((c) => c.id).sort()).toEqual(
			db
				.getSubGraphs()
				.map((s) => s.id)
				.sort()
		);
	});
});
