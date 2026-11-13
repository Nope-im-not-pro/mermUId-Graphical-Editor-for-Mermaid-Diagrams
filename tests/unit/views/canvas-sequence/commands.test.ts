// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	addActivation,
	addContainer,
	addMessage,
	addNote,
	addParticipant,
	addSection,
	deleteElements,
	participantId,
	rename,
	setMessage,
	validParticipantId
} from '../../../../src/lib/views/canvas/sequence/commands';
import { apply, parseOk, roundTrip, SAMPLE, semantic } from './helpers';

const doc = parseOk(SAMPLE);

async function check(text: string, command: Parameters<typeof roundTrip>[1]) {
	const r = await roundTrip(text, command);
	expect(r.same[0]).toEqual(r.same[1]);
	return r;
}

describe('participantId', () => {
	it('Sperrwörter und generierte ID-Formen sind ungültig', () => {
		for (const id of [
			'end',
			'participant',
			'loop',
			'alt',
			'else',
			'note',
			'Note',
			'n1',
			'e12',
			'1a',
			'a-b'
		])
			expect(validParticipantId(id), id).toBe(false);
		for (const id of ['Foo', 'Teilnehmer1', '_x', 'n0', 'node'])
			expect(validParticipantId(id), id).toBe(true);
	});

	it('kollisionsfrei, mermaid-gültig, ohne Sperrwörter', () => {
		expect(participantId(doc, 'participant')).toBe('Teilnehmer1');
		expect(participantId(doc, 'actor')).toBe('Akteur1');
		const used = parseOk(
			'sequenceDiagram\nparticipant Teilnehmer1\nTeilnehmer2->>Teilnehmer1: a\n'
		);
		expect(participantId(used, 'participant')).toBe('Teilnehmer3');
		const raw = parseOk('sequenceDiagram\nbox currentcolor x\nparticipant Teilnehmer1\nend\n');
		expect(participantId(raw, 'participant')).toBe('Teilnehmer2');
		const free = participantId(doc, 'participant');
		expect(free).toMatch(/^[A-Za-z_]\w*$/);
	});
});

describe('Anlegen', () => {
	it('Teilnehmer und Akteur', async () => {
		const r = await check(SAMPLE, addParticipant('actor'));
		expect(r.same[0].participants.at(-1)).toEqual({
			id: 'Akteur1',
			kind: 'actor',
			label: 'Akteur1'
		});
		const empty = await check('sequenceDiagram\n', addParticipant('participant'));
		expect(empty.same[0].participants).toEqual([
			{ id: 'Teilnehmer1', kind: 'participant', label: 'Teilnehmer1' }
		]);
	});

	it('Nachricht hinter Anker, in Section und am Ende', async () => {
		const r = await check(SAMPLE, addMessage('B', 'A', '-->>', 'e1'));
		expect(r.same[0].body[1]).toEqual([
			'message',
			'B',
			'A',
			'Nachricht',
			'dotted',
			'arrow',
			'-->>',
			''
		]);
		const inSection = await check(SAMPLE, addMessage('A', 'B', '-x', 'c1:1'));
		const alt = inSection.same[0].body[2] as [string, string, [string, unknown[]][]];
		expect((alt[2][1][1][0] as unknown[])[6]).toBe('-x');
		const inContainer = await check(SAMPLE, addMessage('A', 'B', '->>', 'c1'));
		const alt2 = inContainer.same[0].body[2] as [string, string, [string, unknown[]][]];
		expect(alt2[2][0][1]).toHaveLength(2);
		const end = await check(SAMPLE, addMessage('A', 'A', '->>'));
		expect((end.same[0].body.at(-1) as unknown[])[1]).toBe('A');
		const inner = await check(SAMPLE, addMessage('A', 'B', '->>', 'e2'));
		const alt3 = inner.same[0].body[2] as [string, string, [string, unknown[]][]];
		expect(alt3[2][0][1]).toHaveLength(2);
	});

	it('Nachricht prüft Teilnehmer und Pfeil', () => {
		expect(() => apply(doc, addMessage('A', 'X', '->>'))).toThrow('Unbekannter Teilnehmer');
		expect(() => apply(doc, addMessage('A', 'B', '=>'))).toThrow('Unbekannter Pfeil');
	});

	it('Notizen', async () => {
		const over = await check(SAMPLE, addNote('over', ['A', 'B'], 'n1'));
		expect(over.same[0].body[2]).toEqual(['note', 'over', ['A', 'B'], 'Notiz']);
		const left = await check(SAMPLE, addNote('left of', ['B']));
		expect(left.same[0].body.at(-1)).toEqual(['note', 'left of', ['B'], 'Notiz']);
		expect(() => apply(doc, addNote('over', ['X']))).toThrow('Unbekannter Teilnehmer');
		expect(() => apply(doc, addNote('over', []))).toThrow('Unbekannter Teilnehmer');
	});

	it('Aktivierung um ein Element und am Ende', async () => {
		const around = await check(SAMPLE, addActivation('B', 'n1'));
		expect(around.same[0].body.slice(1, 4)).toEqual([
			['activate', 'B', 'B', '', '', '', undefined, undefined],
			['note', 'over', ['A', 'B'], 'Notiz'],
			['deactivate', 'B', 'B', '', '', '', undefined, undefined]
		]);
		const end = await check(SAMPLE, addActivation('A'));
		expect((end.same[0].body.at(-2) as unknown[])[0]).toBe('activate');
		expect(() => apply(doc, addActivation('X'))).toThrow('Unbekannter Teilnehmer');
	});

	it('Nachricht ändern: Pfeil und Endpunkte', async () => {
		const r = await check(SAMPLE, setMessage('e1', { sourceId: 'B', targetId: 'A', arrow: '-)' }));
		expect((r.same[0].body[0] as unknown[]).slice(1, 7)).toEqual([
			'B',
			'A',
			'Hallo',
			'solid',
			'open',
			'-)'
		]);
		expect(() => apply(doc, setMessage('n1', { arrow: '->' }))).toThrow('Keine Nachricht');
		const moved = await check('sequenceDiagram\nA->>B: x\n', setMessage('e1', { targetId: 'A' }));
		expect(moved.same[0].participants.map((p) => p.id)).toEqual(['A']);
	});
});

describe('Umbenennen', () => {
	it('Teilnehmer, Nachricht, Notiz', async () => {
		const p = await check(SAMPLE, rename('B', 'Bob'));
		expect(p.same[0].participants[1]).toEqual({ id: 'B', kind: 'actor', label: 'Bob' });
		const back = await check(SAMPLE, rename('A', ''));
		expect(back.same[0].participants[0].label).toBe('A');
		const m = await check(SAMPLE, rename('e1', ' Zeile1\nZeile2; #x '));
		expect((m.same[0].body[0] as unknown[])[3]).toBe('Zeile1<br>Zeile2; #x');
		const n = await check(SAMPLE, rename('n1', 'Neu'));
		expect((n.same[0].body[1] as unknown[])[3]).toBe('Neu');
	});

	it('Block und Abschnitt', async () => {
		const c = await check(SAMPLE, rename('c1', 'Wenn'));
		const alt = c.same[0].body[2] as [string, string, [string, unknown[]][]];
		expect([alt[1], alt[2][0][0]]).toEqual(['Wenn', 'Wenn']);
		const s = await check(SAMPLE, rename('c1:1', 'Andernfalls'));
		const alt2 = s.same[0].body[2] as [string, string, [string, unknown[]][]];
		expect(alt2[2][1][0]).toBe('Andernfalls');
	});

	it('Grenzen', () => {
		expect(() => apply(doc, rename('e1', '  '))).toThrow('Label leer');
		const based = parseOk('sequenceDiagram\nbox currentcolor G\nparticipant X\nend\nX->>Y: a\n');
		expect(() => apply(based, rename('X', 'Neu'))).toThrow('nicht grafisch editierbar');
		const spaced = parseOk('sequenceDiagram\nparticipant A b\n');
		expect(() => apply(spaced, rename('A b', 'Neu'))).toThrow('Alias');
		expect(apply(spaced, rename('A b', 'A b')).nodes[0].label).toBe('A b');
		expect(() => apply(doc, rename('zz', 'x'))).toThrow('Unbekannte ID');
		expect(() => apply(doc, rename('c1:7', 'x'))).toThrow('Unbekannte ID');
		expect(() => apply(doc, rename('e3', 'x'))).toThrow('kein Label');
	});
});

describe('Löschen', () => {
	it('Teilnehmer samt Nachrichten, Notizen und verwaister Aktivierungen', async () => {
		const r = await check(SAMPLE, deleteElements(['B']));
		expect(r.same[0].participants.map((p) => p.id)).toEqual(['A']);
		expect(JSON.stringify(r.same[0].body)).not.toContain('"B"');
		const explicit = await check(
			'sequenceDiagram\nparticipant A\nA->>B: x\nNote left of A: n\n',
			deleteElements(['A'])
		);
		expect(explicit.same[0].participants).toEqual([]);
	});

	it('activate entfernt das zugehörige deactivate', async () => {
		const r = await check(SAMPLE, deleteElements(['e3']));
		expect(JSON.stringify(r.same[0].body)).not.toContain('activate');
		const plus = await check('sequenceDiagram\nA->>+B: x\nB-->>-A: y\n', deleteElements(['e1']));
		expect((plus.same[0].body[0] as unknown[])[7]).toBe('');
	});

	it('Nachricht, Notiz, Block, Abschnitt; fehlende IDs übersprungen', async () => {
		const many = await check(SAMPLE, deleteElements(['e1', 'n1', 'zz', 'e1']));
		expect(many.same[0].body).toHaveLength(1);
		const block = await check(SAMPLE, deleteElements(['c1']));
		expect(block.same[0].body).toHaveLength(2);
		const section = await check(SAMPLE, deleteElements(['c1:1']));
		const alt = section.same[0].body[2] as [string, string, [string, unknown[]][]];
		expect(alt[2]).toHaveLength(1);
		expect(alt[2][0][1]).toHaveLength(4);
		const based = parseOk('sequenceDiagram\nbox currentcolor G\nparticipant X\nend\nX->>Y: a\n');
		expect(() => apply(based, deleteElements(['X']))).toThrow('nicht grafisch editierbar');
	});
});

describe('Blöcke (C2)', () => {
	it('alle Arten anlegen, mit und ohne Umschließen', async () => {
		for (const kind of ['loop', 'alt', 'opt', 'par', 'critical', 'rect'] as const) {
			const r = await check(SAMPLE, addContainer(kind, 'n1'));
			expect((r.same[0].body[2] as unknown[])[0]).toBe(kind);
		}
		const wrap = await check(SAMPLE, addContainer('loop', undefined, 'e1'));
		const loop = wrap.same[0].body[0] as [string, string, [string, unknown[]][]];
		expect(loop[2][0][1]).toHaveLength(1);
		const nested = await check(SAMPLE, addContainer('opt', undefined, 'e4'));
		expect(JSON.stringify(nested.same[0].body)).toContain('"opt"');
		const wrapBlock = await check(SAMPLE, addContainer('loop', undefined, 'c1'));
		expect((wrapBlock.same[0].body[2] as unknown[])[0]).toBe('loop');
		expect(() => apply(doc, addContainer('loop', undefined, 'A'))).toThrow('nicht umschließbar');
	});

	it('Abschnitt nur für alt, par, critical', async () => {
		const r = await check(SAMPLE, addSection('c1'));
		const alt = r.same[0].body[2] as [string, string, [string, unknown[]][]];
		expect(alt[2].map((s) => s[0])).toEqual(['Fall', 'Sonst', 'Abschnitt']);
		const loop = apply(doc, addContainer('loop'));
		const cid = loop.containers.at(-1)!.id;
		expect(() => apply(loop, addSection(cid))).toThrow('keine Abschnitte');
	});
});

it('semantic bleibt stabil ohne Änderung', () => {
	expect(semantic(doc)).toEqual(semantic(parseOk(SAMPLE)));
});
