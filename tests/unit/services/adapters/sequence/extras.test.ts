/**
 * T135 C1 (F-06): `break` als Block-Typ (Container) und `autonumber` als erkannte Anweisung
 * (`rawEvents(...).autonumber`, byte-gleich als RawBlock erhalten).
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
	autonumberText,
	parse,
	rawEvents,
	serialize,
	withoutAutonumber
} from '../../../../../src/lib/services/adapters/sequence';
import { addContainer } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

const dir = join(__dirname, '../../../../fixtures/sequence/roundtrip');

describe('break als Block (T135 C1)', () => {
	it.each(['break', 'Break', 'BREAK'])('%s wird Container mit einer Section', (kw) => {
		const doc = ok(`sequenceDiagram\n    ${kw} wenn voll\n        A->>B: x\n    end\n`);
		expect(doc.rawBlocks).toEqual([]);
		expect(doc.containers).toHaveLength(1);
		const c = doc.containers[0];
		expect(c).toMatchObject({ kind: 'break', label: 'wenn voll', parentId: null });
		expect(c.sections).toEqual([{ label: 'wenn voll', memberIds: [doc.edges[0].id] }]);
		expect(doc.edges[0].parentId).toBe(c.id);
		expect(doc.order).toEqual([c.id]);
	});

	it('ohne Label, verschachtelt in und mit anderen Blöcken', () => {
		const text =
			'sequenceDiagram\n    loop L\n        break\n            alt a\n                A->>B: x\n            else b\n                Note over A: n\n            end\n        end\n    end\n';
		const doc = ok(text);
		const [loop, brk, alt] = doc.containers;
		expect([loop.kind, brk.kind, alt.kind]).toEqual(['loop', 'break', 'alt']);
		expect(brk).toMatchObject({ label: '', parentId: loop.id });
		expect(alt.parentId).toBe(brk.id);
		expect(serialize(doc)).toBe(text);
	});

	it('else in break ist ein Fehler wie in mermaid', async () => {
		const text = 'sequenceDiagram\n    break x\n        A->>B: y\n    else z\n    end\n';
		const result = parse(text);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].line).toBe(4);
		await expect(mermaid.parse(text)).rejects.toBeTruthy();
	});

	it('neuer break-Container wird kanonisch geschrieben und von mermaid gelesen', async () => {
		const doc = ok('sequenceDiagram\n    A->>B: x\n');
		const next = addContainer(doc, {
			id: 'c1',
			kind: 'break',
			label: 'Abbruch; jetzt',
			direction: '',
			parentId: null,
			sections: [{ label: 'Abbruch; jetzt', memberIds: [] }],
			props: {},
			sourceText: ''
		});
		const text = serialize(next);
		expect(text).toBe('sequenceDiagram\n    A->>B: x\n    break Abbruch#59; jetzt\n    end\n');
		await expect(mermaid.parse(text)).resolves.toBeTruthy();
		expect(ok(text).containers[0]).toMatchObject({ kind: 'break', label: 'Abbruch; jetzt' });
	});

	// T135 C2: box ist eine Teilnehmer-Gruppe (Container); `end` der Gruppe schließt nicht break.
	it('break nach box: box-Container und break-Block getrennt', () => {
		const doc = ok(
			'sequenceDiagram\n    box G\n        participant A\n    end\n    break b\n    end\n'
		);
		expect(doc.rawBlocks).toEqual([]);
		expect(doc.containers.map((c) => c.kind)).toEqual(['box', 'break']);
		expect(doc.containers[0].sections[0].memberIds).toEqual(['A']);
	});

	it('Teilnehmer in break wie mermaid (Reihenfolge, Typ)', async () => {
		const text =
			'sequenceDiagram\n    break b\n        actor C\n        C->>A: x\n    end\n    A->>B: y\n';
		const doc = ok(text);
		await mermaid.parse(text);
		const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as {
			getActors(): Map<string, { type: string }>;
		};
		const actors = [...db.getActors()].map(([id, a]) => [id, a.type]);
		expect(doc.nodes.filter((n) => n.kind !== 'note').map((n) => [n.id, n.kind])).toEqual(actors);
	});
});

describe('autonumber (T135 C1)', () => {
	it.each([
		['autonumber', { visible: true }],
		['AutoNumber', { visible: true }],
		['autonumber off', { visible: false }],
		['autonumber OFF', { visible: false }],
		['autonumber 10', { start: 10, step: 1, visible: true }],
		['autonumber 10 5', { start: 10, step: 5, visible: true }],
		['autonumber 1.5 .25', { start: 1.5, step: 0.25, visible: true }],
		['\tautonumber\t3 2\r\n', { start: 3, step: 2, visible: true }],
		['\n\n    autonumber\n', { visible: true }],
		['autonumber # Kommentar', { visible: true }],
		['autonumber 3 %% Kommentar\n', { start: 3, step: 1, visible: true }],
		['autonumber off;', { visible: false }]
	])('%j wird erkannt', (text, expected) => {
		expect(rawEvents(text).autonumber).toEqual(expected);
	});

	it.each([
		'autonumber x',
		'autonumber 1 2 3',
		'autonumber off 2',
		'autonumbers',
		'x autonumber',
		'autonumber 3\t2',
		'autonumber 3;'
	])('%j ist keine autonumber-Anweisung', (text) => {
		expect(rawEvents(text).autonumber).toBeUndefined();
	});

	it('Erkennung wie mermaid: Kommentar, ";", Tab, Zahlenform', async () => {
		const cases = [
			'autonumber 3\t2',
			'autonumber\t3 2',
			'autonumber 3;',
			'autonumber;',
			'autonumber off;',
			'autonumber # c',
			'autonumber 3 # c',
			'autonumber 3# c',
			'autonumber#c',
			'autonumber %% c',
			'autonumber 3 %% c',
			'autonumber 3%%c',
			'autonumber 3 2%%c',
			'autonumber off%%c',
			'autonumber 3 2;',
			'autonumber 3 ;',
			'autonumber 3  2',
			'autonumber 1.234',
			'autonumber.5',
			'autonumber off 3',
			'autonumber; A->>B: y',
			'autonumber 2; A->>B: y',
			// Kommentar beendet die Zeile: die Nachricht dahinter zählt nicht (Review I2 C).
			'autonumber # c; C->>D: q',
			'autonumber %% c; C->>D: q',
			'autonumber off%%c; C->>D: q',
			'autonumber 3 #c; C->>D: q',
			'autonumber #c; C->>D: q'
		];
		type Seen = { set: unknown } | { from: string; to: string };
		for (const statement of cases) {
			const text = `sequenceDiagram\nA->>B: x\n${statement}\nA->>B: z\n`;
			let expected: Seen[] | undefined;
			try {
				const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as {
					getMessages(): { type: number; message: unknown; from: string; to: string }[];
				};
				expected = db
					.getMessages()
					.map((m) => (m.type === 26 ? { set: m.message } : { from: m.from, to: m.to }))
					.slice(1, -1);
			} catch {
				// mermaid-Fehler: keine autonumber-Anweisung (Nachrichten meldet validate)
			}
			const seen = rawEvents(statement).steps.flatMap((s): Seen[] =>
				s.type === 'autonumber'
					? [{ set: s.set }]
					: s.type === 'message' && expected
						? [{ from: s.from, to: s.to }]
						: []
			);
			expect(seen, statement).toEqual(expected ?? []);
		}
	});

	it('Kommentar in autonumber beendet die Zeile auch für Nennungen und Entfernen', () => {
		for (const line of ['autonumber # c; C->>D: q', 'autonumber %% c; C->>D: q']) {
			expect(rawEvents(line).uses, line).toEqual([]);
			expect(rawEvents(line).autonumber, line).toEqual({ visible: true });
			expect(withoutAutonumber(`${line}\n`), line).toBe('');
		}
	});

	it('numbering: sichtbar nummeriert und nicht entfernbar an einer Stelle (O-175)', () => {
		expect(rawEvents('A->>B: x').numbering).toBeUndefined();
		expect(rawEvents('autonumber 3\n').numbering).toEqual({ visible: true, fixed: false });
		expect(rawEvents('autonumber off').numbering).toEqual({ visible: false, fixed: false });
		expect(rawEvents('loop l\n  autonumber\n  A->>B: x\nend\n').numbering).toEqual({
			visible: true,
			fixed: false
		});
		expect(rawEvents('autonumber; A->>B: y').numbering).toEqual({ visible: true, fixed: true });
		expect(rawEvents('autonumber\nautonumber off; A->>B: y').numbering).toEqual({
			visible: true,
			fixed: true
		});
		expect(rawEvents('autonumber # c; A->>B: y').numbering).toEqual({
			visible: true,
			fixed: false
		});
	});

	it('accDescr-Block: Zeile "autonumber" ist Beschreibung, bleibt erhalten', () => {
		const block = 'accDescr {\n    autonumber\n    A->>B: x\n}\n';
		expect(withoutAutonumber(block)).toBe(block);
		expect(rawEvents(block).steps).toEqual([]);
		expect(rawEvents(block).numbering).toBeUndefined();
	});

	it('autonumber in größerem RawBlock: Schritt in der Abfolge, kein Feld', () => {
		const ev = rawEvents('par_over p\n    autonumber 5\n    A->>B: y\nend\n');
		expect(ev.autonumber).toBeUndefined();
		expect(ev.steps).toEqual([
			{ type: 'autonumber', set: { start: 5, step: 1, visible: true } },
			{ type: 'use', id: 'A' },
			{ type: 'use', id: 'B' },
			{ type: 'message', from: 'A', to: 'B' }
		]);
		expect(rawEvents('autonumber; A->>B: y').steps.map((s) => s.type)).toEqual([
			'autonumber',
			'use',
			'use',
			'message'
		]);
	});

	it('withoutAutonumber entfernt nur Zeilen aus autonumber-Anweisungen', () => {
		expect(withoutAutonumber('\n\n    autonumber 10 5\n')).toBe('\n\n');
		expect(withoutAutonumber('    autonumber\r\n\r\n')).toBe('\r\n');
		expect(withoutAutonumber('autonumber; autonumber off;')).toBe('');
		expect(withoutAutonumber('par_over p\n    autonumber 5\n    A->>B: y\nend\n')).toBe(
			'par_over p\n    A->>B: y\nend\n'
		);
		for (const keep of ['autonumber; A->>B: y\n', 'box G\nparticipant A\nend\n', 'autonumber 3\t2'])
			expect(withoutAutonumber(keep)).toBe(keep);
	});

	it('autonumberText: Einrückung und Zeilenende wie der Serializer', () => {
		expect(autonumberText(ok('sequenceDiagram\r\n'))).toBe('    autonumber\r\n');
		expect(autonumberText(ok('sequenceDiagram\n  A->>B: x\n'))).toBe('  autonumber\n');
		// Zeilenende nur im Frontmatter (Typzeile ohne Umbruch): CRLF, nicht `\n`.
		expect(autonumberText(ok('---\r\ntitle: t\r\n---\r\nsequenceDiagram'))).toBe(
			'    autonumber\r\n'
		);
		expect(autonumberText(ok('sequenceDiagram\nloop l\r\nend\r\n'))).toBe('autonumber\r\n');
	});

	it('ohne autonumber kein Feld (Golden unverändert)', () => {
		expect(Object.keys(rawEvents('A->>B: x'))).toEqual(['uses', 'act', 'declared', 'steps']);
	});

	it('Parser hält autonumber als eigenen RawBlock in der Reihenfolge, auch in Blöcken', () => {
		const doc = ok(
			'sequenceDiagram\n    autonumber\n    A->>B: x\n    loop l\n        autonumber 5 5\n    end\n'
		);
		const [top, inner] = doc.rawBlocks;
		expect(rawEvents(top.rawText).autonumber).toEqual({ visible: true });
		expect(rawEvents(inner.rawText).autonumber).toEqual({ start: 5, step: 5, visible: true });
		expect(doc.order[0]).toBe(top.id);
		expect(doc.containers[0].sections[0].memberIds).toEqual([inner.id]);
	});
});

describe('Roundtrip-Fixture extras (LF und CRLF)', () => {
	const lf = readFileSync(join(dir, 'extras.mmd'), 'utf8');
	const crlf = readFileSync(join(dir, 'extras-crlf.mmd'), 'utf8');

	it('Fixtures: LF ohne CR, CRLF durchgehend, sonst gleich', () => {
		expect(lf).not.toContain('\r');
		expect(crlf.split('\r\n').join('\n')).toBe(lf);
		expect(crlf.replace(/\r\n/g, '')).not.toContain('\n');
	});

	it.each([
		['LF', lf],
		['CRLF', crlf]
	])('%s: break als Container, autonumber erkannt, byte-gleich', (_, text) => {
		const doc = ok(text);
		expect(doc.containers.map((c) => c.kind)).toContain('break');
		expect(doc.rawBlocks.map((r) => rawEvents(r.rawText).autonumber)).toEqual([
			{ visible: true },
			{ start: 10, step: 5, visible: true },
			{ visible: false }
		]);
		expect(serialize(doc)).toBe(text);
		expect(serialize(ok(serialize(doc)))).toBe(text);
	});
});
