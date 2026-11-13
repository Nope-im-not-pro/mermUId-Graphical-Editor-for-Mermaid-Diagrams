// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../../../src/lib/services/adapters/diagnostics';
import { parse, validate } from '../../../../../src/lib/services/adapters/sequence';

const dir = join(__dirname, '../../../../fixtures/sequence/roundtrip');
/** raw-blocks.mmd hält Teilnehmer und Nachrichten bewusst in RawBlocks, daher ohne Zähl-Orakel. */
const counted = readdirSync(dir).filter((f) => f.endsWith('.mmd') && f !== 'raw-blocks.mmd');
/** Ausschnitt der Sequence-db von mermaid, soweit das Orakel ihn nutzt. */
interface SequenceDb {
	getActors(): Map<string, unknown>;
	getMessages(): { from?: string; to?: string; type?: number }[];
	LINETYPE: { NOTE: number };
}

const all = readdirSync(dir).filter((f) => f.endsWith('.mmd'));

describe('validate (O-15)', () => {
	it.each(all)('%s ist für mermaid gültig', async (file) => {
		expect(await validate(readFileSync(join(dir, file), 'utf8'))).toEqual([]);
	});

	it('meldet Syntaxfehler mit Zeile', async () => {
		const errors = await validate('sequenceDiagram\n    A->>B: ok\n    loop x\n');
		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBeGreaterThanOrEqual(3);
		expect(errors[0].column).toBeGreaterThanOrEqual(1);
		expect(errors[0].message).not.toBe('');
	});

	it.each([
		[
			'Frontmatter',
			'---\ntitle: X\nconfig: {}\n---\nsequenceDiagram\n    A->>B: ok\n    A-->>>B\n',
			7
		],
		[
			'Direktive und Kommentar',
			'%% Kopf\n%%{init: {"theme": "dark"}}%%\n\nsequenceDiagram\n    %% Rumpf\n    A->>B: ok\n    A-->>>B\n',
			7
		],
		[
			'CRLF und mehrzeilige Direktive',
			'%%{init: {\r\n}}%%\r\nsequenceDiagram\r\n    A-->>>B\r\n',
			4
		],
		['offener Block am Ende', 'sequenceDiagram\n    %% x\n    loop x\n', 4]
	])('meldet die Zeile im Originaltext (%s)', async (_, text, line) => {
		const errors = await validate(text);
		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBe(line);
	});

	it('lehnt andere Diagrammtypen ab', async () => {
		const errors = await validate('flowchart TD\n    A --> B\n');
		expect(errors).toEqual([{ line: 1, column: 1, message: expect.stringContaining('sequence') }]);
	});
});

describe('validate: Kurztext und Robustheit (T115)', () => {
	it('Kurztext ohne Token-Namen, Rohtext getrennt', async () => {
		const [error] = (await validate('sequenceDiagram\n    A->>B\n')) as Diagnostic[];
		expect(error.key).toBe('services.validate.missingText');
		expect(error.message).not.toMatch(/TXT|NEWLINE|Expecting|Parse error/);
		expect(error.raw).toContain('Expecting');
	});

	it.each([
		['Nachricht', `    A->>B: ${'\u{1F600}'.repeat(60)}\n`],
		['Kommentar', `    %% ${'\u{1F600}'.repeat(60)}\n`],
		['Teilnehmer', `    participant ${'\u{1F600}'.repeat(3)}\n    A->>B: x\n`]
	])('Fehlerzeile mit Emoji vor der Fehlerstelle (%s)', async (_, body) => {
		const text = `sequenceDiagram\n${body}    A-->>>B\n`;
		const [error] = await validate(text);
		expect(error.line).toBe(text.split('\n').length - 1);
	});

	it('Zeile aus der Meldung bei lexikalischem Fehler', async () => {
		const [error] = await validate('sequenceDiagram\n  A ->> B: x\n  activate\n');
		expect(error.line).toBe(3);
		expect((error as Diagnostic).key).toBe('services.validate.unrecognized');
	});

	it('großes ungültiges Dokument ohne RangeError', async () => {
		const text = `sequenceDiagram\n${'    %% c\n'.repeat(100000)}    A-->>>B\n`;
		const [error] = await validate(text);
		expect(error.line).toBe(100002);
	}, 60000);
});

describe('Orakel gegen mermaid-db', () => {
	it.each([
		[
			'participant A #kommentar\n    A->>B: x',
			['A #kommentar', 'A', 'B'],
			['A #kommentar', 'A', 'B']
		],
		['participant A as Alice #k\n    A->>B: x', ['A', 'B'], ['Alice', 'B']],
		['participant A #k as B', ['A #k as B'], ['A #k as B']],
		['actor X as Y#35;Z #59; W', ['X'], ['Y#Z ; W']]
	])('Teilnehmer mit # wie mermaid: %j', async (body, ids, labels) => {
		const text = `sequenceDiagram\n    ${body}\n`;
		const result = parse(text);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		await mermaid.parse(text);
		const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as SequenceDb;
		expect([...db.getActors().keys()]).toEqual(ids);
		expect(result.doc.nodes.map((n) => n.id)).toEqual(ids);
		expect(result.doc.nodes.map((n) => n.label)).toEqual(labels);
	});

	it.each(counted)('%s: Teilnehmer und Nachrichten wie mermaid', async (file) => {
		const text = readFileSync(join(dir, file), 'utf8');
		const result = parse(text);
		if (!result.ok) throw new Error(JSON.stringify(result.errors));
		await mermaid.parse(text);
		const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as SequenceDb;
		const messages = db.getMessages().filter((m) => m.from && m.to && m.type !== db.LINETYPE.NOTE);
		const participants = result.doc.nodes.filter((n) => n.kind !== 'note');
		expect(participants).toHaveLength(db.getActors().size);
		expect(result.doc.edges.filter((e) => e.kind === 'message')).toHaveLength(messages.length);
	});
});
