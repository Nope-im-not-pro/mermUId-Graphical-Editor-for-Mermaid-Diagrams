// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import { validate } from '../../../../src/lib/services/adapters/sequence';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import {
	addActivation,
	addContainer,
	addMessage,
	addNote,
	addParticipant,
	deleteElements,
	rename,
	setMessage,
	walk
} from '../../../../src/lib/views/canvas/sequence/commands';
import { sequenceGrammar } from '../../../../src/lib/controllers/sync';
import { moveTo, verticalGroups } from '../../../../src/lib/views/canvas/sequence/order';
import { codeOf, docOf, makeSync, parseOk, semantic } from './helpers';

const S = 'sequenceDiagram\n';
const { messageLexes } = sequenceGrammar;
mermaid.initialize({ startOnLoad: false });

const participantIds = (doc: DiagramDocument) =>
	doc.nodes.filter((n) => n.kind !== 'note').map((n) => n.id);

/** Ergebnisse je Code zwischenspeichern: viele Folgen erzeugen denselben Code. */
const cache = new Map<string, Promise<{ errors: unknown[]; actors: string[] }>>();

/**
 * Render-Stub wie in raw.test.ts (jsdom kennt keine SVG-Maße). Gezeichnet wird direkt über den
 * Renderer des geparsten Diagramms (Kern von `mermaid.render`, ohne zweiten Parse).
 */
function check(code: string) {
	let hit = cache.get(code);
	if (!hit) {
		hit = (async () => {
			const proto = window.SVGElement.prototype as unknown as Record<string, unknown>;
			proto.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
			proto.getComputedTextLength = () => 10;
			const errors = await validate(code);
			const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
			const id = `r${cache.size}`;
			document.body.innerHTML = `<svg id="${id}"></svg>`;
			await diagram.renderer.draw(code, id, '0', diagram);
			const db = diagram.db as unknown as { getActorKeys(): string[] };
			return { errors, actors: db.getActorKeys() };
		})();
		cache.set(code, hit);
	}
	return hit;
}

/** Modell gleich Re-Parse (inkl. Teilnehmer-Reihenfolge), Code gültig und renderbar. */
async function expectConsistent(doc: DiagramDocument, code: string) {
	const reparsed = parseOk(code);
	const { errors, actors } = await check(code);
	expect(errors).toEqual([]);
	expect(semantic(doc)).toEqual(semantic(reparsed));
	expect(participantIds(doc)).toEqual(participantIds(reparsed));
	expect(participantIds(doc)).toEqual(actors);
}

async function rejected(text: string, command: Command, message: RegExp) {
	const sync = await makeSync(text);
	const doc = docOf(sync);
	await expect(sync.execute(command)).rejects.toThrow(message);
	expect(docOf(sync)).toBe(doc);
	expect(codeOf(sync)).toBe(text);
	let undo = true;
	sync.commands.subscribe((st) => (undo = st.canUndo))();
	expect(undo).toBe(false);
	sync.dispose();
}

async function accepted(text: string, commands: Command[], order: string[]) {
	const sync = await makeSync(text);
	for (const c of commands) await sync.execute(c);
	const doc = docOf(sync);
	const code = codeOf(sync);
	await expectConsistent(doc, code);
	expect(participantIds(doc)).toEqual(order);
	for (let i = 0; i < commands.length; i++) await sync.undo();
	expect(codeOf(sync)).toBe(text);
	expect(semantic(docOf(sync))).toEqual(semantic(parseOk(text)));
	sync.dispose();
	return code;
}

describe('Gate create/destroy (mermaid-db)', () => {
	const created = S + 'A->>B: a\ncreate participant C\nB->>C: c\n';
	it('setMessage: erzeugende Nachricht verliert ihr Ziel', () =>
		rejected(created, setMessage('e2', { targetId: 'A' }), /create C/));
	it('setMessage: Teilnehmer vor create genannt', () =>
		rejected(created, setMessage('e1', { targetId: 'C' }), /vor create/));
	it('setMessage: Nachricht nach destroy nennt ihn nicht', () =>
		rejected(
			S + 'destroy B\nA->>B: b\n',
			setMessage('e1', { sourceId: 'A', targetId: 'A' }),
			/destroy B/
		));
	// T135 C3: `create` ist Option der erzeugenden Nachricht und entfällt mit ihr.
	it('deleteElements: erzeugende Nachricht samt create', () =>
		accepted(
			S + 'create participant C\nB->>C: c\ndestroy C\nC->>A: d\n',
			[deleteElements(['e1'])],
			['C', 'A']
		));
	// T135 C3: zwischen create und erzeugender Nachricht gibt es keine Stelle mehr.
	it('moveTo vor die erzeugende Nachricht', () =>
		rejected(
			S + 'create participant C\nB->>C: c\nC->>A: d\n',
			moveTo('e2', { parent: null, section: 0, index: 0 }),
			/vor create/
		));
	it('moveTo hinter create sortiert Teilnehmer', () =>
		accepted(
			S + 'create participant C\nC->>A: d\nB->>C: c\n',
			[moveTo('e2', { parent: null, section: 0, index: 1 })],
			['C', 'B', 'A']
		));
	it('addActivation vor erster Nennung ändert die Reihenfolge', () =>
		rejected(
			S + 'Note over P: p\nNote over Q: q\nA->>B: m\n',
			addActivation('A', 'n2'),
			/Reihenfolge/
		));
	it('moveTo vor Deklaration ohne Alias (Typ ginge verloren)', () =>
		rejected(
			S + 'actor B\nloop l\nA->>B: m\nend\n',
			moveTo('c1', { parent: null, section: 0, index: 0 }),
			/verliert den Typ/
		));
});

describe('Review E6', () => {
	it('Deklaration ohne Quelltext nach Nennung bekommt Alias (addMessage davor)', async () => {
		const code = await accepted(
			S + 'A->>B: m\n',
			[addParticipant('actor'), addMessage('Akteur1', 'A', '->>', 'e1')],
			['A', 'B', 'Akteur1']
		);
		expect(code).toBe(S + 'A->>B: m\nAkteur1->>A: Nachricht\nactor Akteur1 as Akteur1\n');
	});
	it('Deklaration ohne Quelltext nach Nennung bekommt Alias (setMessage)', () =>
		accepted(
			S + 'A->>B: m\n',
			[addParticipant('actor'), setMessage('e1', { targetId: 'Akteur1' })],
			['A', 'Akteur1']
		));
	it('rohe Deklaration ohne Alias nach Nennung bleibt abgelehnt', () =>
		rejected(
			S + 'actor B\nloop l\nA->>B: m\nend\n',
			moveTo('c1', { parent: null, section: 0, index: 0 }),
			/verliert den Typ/
		));
	it('Container mit create actor gelöscht: Typ bleibt über Deklaration', async () => {
		const code = await accepted(
			S + 'U->>S: l\nopt ok\ncreate actor D\nS->>D: neu\nend\nD->>S: w\n',
			[deleteElements(['c1'])],
			['U', 'S', 'D']
		);
		expect(code).toBe(S + 'U->>S: l\nactor D\nD->>S: w\n');
	});
	it('Container mit create participant gelöscht: ungenannter Teilnehmer entfällt', () =>
		accepted(
			S + 'U->>S: l\nopt ok\ncreate participant D\nS->>D: neu\nend\n',
			[deleteElements(['c1'])],
			['U', 'S']
		));
	const deact = S + 'A->>+B: m\nB-->>-A: n\nA->>X: o\nA->>x1: p\n';
	it('setMessage: Ziel X hinter Deaktivierung mit Leerzeichen (kein Kreuz-Pfeil)', async () => {
		const code = await accepted(
			deact,
			[setMessage('e2', { targetId: 'X' })],
			['A', 'B', 'X', 'x1']
		);
		expect(code).toContain('B-->>- X: n\n');
	});
	it('setMessage: Ziel x1 hinter Deaktivierung mit Leerzeichen (kein Kreuz-Pfeil)', async () => {
		const code = await accepted(
			deact,
			[setMessage('e2', { targetId: 'x1' })],
			['A', 'B', 'x1', 'X']
		);
		expect(code).toContain('B-->>- x1: n\n');
	});
	it('setMessage: Ziel X hinter Aktivierung bleibt lesbar', () =>
		accepted(S + 'A->>+B: m\nA->>X: o\n', [setMessage('e1', { targetId: 'X' })], ['A', 'X']));
	it('Lexer-Nachbildung wie mermaid', () => {
		expect(messageLexes('B', '-->>', '-', 'A')).toBe(true);
		expect(messageLexes('B', '-->>', '-', 'X')).toBe(true);
		expect(messageLexes('B', '->>', '-', 'x1')).toBe(true);
		expect(messageLexes('B', '->>', '+', 'x1')).toBe(true);
		expect(messageLexes('x1', '-x', '', 'X')).toBe(true);
		expect(messageLexes('A-B', '->>', '', 'C')).toBe(true);
		expect(messageLexes('A', '->>', '', 'Over')).toBe(false);
		expect(messageLexes('A', '-|\\', '', 'B')).toBe(true);
	});
});

describe('Review W06 C-B R1', () => {
	const deact = S + 'A->>+B: m\nB-->>-A: n\n';
	it.each(['/|-', '\\|-', '//-', '\\\\-'])(
		'setMessage: Halbpfeil %s vor Deaktivierung mit Leerzeichen (kein Pfeil auf --)',
		async (arrow) => {
			const code = await accepted(deact, [setMessage('e2', { arrow })], ['A', 'B']);
			expect(code).toContain(`B${arrow} -A: n\n`);
		}
	);
	it('Lexer-Nachbildung: Pfeil auf - vor Marker -', () => {
		expect(messageLexes('B', '/|-', '-', 'A')).toBe(true);
		expect(messageLexes('B', '\\\\-', '-', 'X')).toBe(true);
		expect(messageLexes('B', '/|-', '+', 'A')).toBe(true);
	});
	it.each([
		['a#b', 'A->>B: m\n', 'e1', { targetId: 'a#b' }],
		['O)', 'A->>B: m\n', 'e1', { targetId: 'O)' }],
		['x)', 'A->>+B: m\nB-->>-A: n\n', 'e2', { targetId: 'x)' }],
		['a(b', 'A->>B: m\n', 'e1', { sourceId: 'a(b' }]
	])('setMessage: Name %s liest der Adapter nicht als Nachricht', (id, body, edge, patch) =>
		rejected(S + `participant ${id}\n` + body, setMessage(edge, patch), /nicht lesbar/)
	);
});

describe('Review E7', () => {
	const boxed =
		S +
		'actor xA\nparticipant Xy as Why\nxA->>+Xy: a\nXy--x-yA: b\nrect rgb(1,2,3)\nbox Blue K\nactor K1\nend\nK1->>xA: k\nend\ncritical c\ndestroy K1\nxA->>K1: d\noption o\nXy->>xA: e\nend\n';
	it('addMessage nennt K1 vor der Deklaration im RawBlock', () =>
		rejected(boxed, addMessage('K1', 'K1', '-//', 'e2'), /verliert den Typ/));
	it('setMessage nennt K1 vor der Deklaration im RawBlock', () =>
		rejected(boxed, setMessage('e1', { sourceId: 'K1' }), /verliert den Typ/));
	it('moveTo zieht die Nennung von K1 vor die Deklaration im RawBlock', () =>
		rejected(boxed, moveTo('e3', { parent: null, section: 0, index: 4 }), /verliert den Typ/));
	it('Nennung nach der Deklaration im RawBlock bleibt erlaubt', () =>
		accepted(boxed, [addMessage('K1', 'xA', '->>', 'e3')], ['xA', 'Xy', 'yA', 'K1']));
	it('Deklaration mit Alias im RawBlock setzt den Typ auch nach Nennung', () =>
		accepted(
			S + 'A->>B: m\nbox currentcolor K\nactor K1 as Ka\nend\nK1->>A: k\n',
			[addMessage('K1', 'A', '->>', 'e1')],
			['A', 'B', 'K1']
		));
	const declared =
		S +
		'participant A as Alice\nactor B\nNote over Q: q\nA->>+B: hi\npar_over b\nB->>C: x\nactivate C\ndeactivate C\nend\nB-->>-A: ok\nloop l\nA->>Q: m\nend\n';
	it('deleteElements: Block mit Deklaration eines im RawBlock genannten Teilnehmers', async () => {
		const sync = await makeSync(declared);
		await sync.execute(moveTo('B', { parent: 'c1', section: 0, index: 0 }));
		const doc = docOf(sync);
		const code = codeOf(sync);
		await expect(sync.execute(deleteElements(['c1']))).rejects.toThrow(/nicht editierbarem Block/);
		expect(docOf(sync)).toBe(doc);
		expect(codeOf(sync)).toBe(code);
		sync.dispose();
	});
	it('deleteElements: Block mit Deklaration ohne RawBlock-Nennung bleibt erlaubt', () =>
		accepted(
			S + 'actor B\nA->>B: m\nloop l\nA->>A: n\nend\nA->>A: o\n',
			[moveTo('B', { parent: 'c1', section: 0, index: 0 }), deleteElements(['c1'])],
			['A']
		));
});

describe('Normalisierung (Modell = Re-Parse)', () => {
	it('geänderter ungenannter impliziter Teilnehmer an Serializer-Position', async () => {
		const code = await accepted(
			S + 'Note over Q: q\nA->>Q: m\n',
			[rename('A', 'Neu'), deleteElements(['e1'])],
			['Q', 'A']
		);
		expect(code).toBe(S + 'Note over Q: q\nparticipant A as Neu\n');
	});
	it('rename mit erster Nennung in Note', () =>
		accepted(S + 'Note over Q: q\nA->>Q: m\n', [rename('Q', 'Neu')], ['Q', 'A']));
	it('rename mit erster Nennung in RawBlock', () =>
		accepted(S + 'par_over b\nA->>B: x\nend\nB->>A: y\n', [rename('B', 'Neu')], ['A', 'B']));
	it('moveTo sortiert Teilnehmer aus Notizen', () =>
		accepted(
			S + 'Note over P: p\nNote over Q: q\nA->>B: m\n',
			[moveTo('n2', { parent: null, section: 0, index: 0 })],
			['Q', 'P', 'A', 'B']
		));
	it('addActivation sortiert Teilnehmer', () =>
		accepted(
			S + 'Note over P: p\nNote over Q: q\nA->>B: m\n',
			[addActivation('Q')],
			['P', 'Q', 'A', 'B']
		));
});

/** Deterministischer Zufall (mulberry32). */
function prng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const STARTS = [
	S +
		'participant A as Alice\nactor B\nNote over Q: q\nA->>+B: hi\npar_over b\nB->>C: x\nactivate C\ndeactivate C\nend\nB-->>-A: ok\nloop l\nA->>Q: m\nend\n',
	S +
		'box Aqua G\nparticipant X\nend\nX->>Y: a\ncreate participant Z\nY->>Z: z\nNote over P: p\nZ->>X: b\ndestroy Z\nX->>Z: c\nY->>X: d\n',
	S +
		'Note over P: p\nNote over Q: q\nA->>B: m\nB->>A: n\nactivate A\nA->>P: o\ndeactivate A\nalt x\nQ->>B: r\nelse y\npar_over c\nP->>A: s\nend\nend\n',
	S +
		'A->>+B: hi\nB-->>-A: ok\nA->>X: a\nx1->>A: b\nloop l\ncreate actor D\nX->>D: neu\nD->>x1: c\ndestroy D\nx1->>D: weg\nend\nB->>X: z\n',
	S +
		'opt o\ncreate participant C\nA->>C: c\nend\nC->>+X: d\nX-->>-C: e\nNote over x2: n\nalt a\ndestroy C\nX->>C: f\nelse b\nA->>x2: g\nend\n',
	S +
		'actor xA\nparticipant Xy as Why\nxA->>+Xy: a\nXy--x-yA: b\nrect rgb(1,2,3)\nbox Blue K\nactor K1\nend\nK1->>xA: k\nend\ncritical c\ndestroy K1\nxA->>K1: d\noption o\nXy->>xA: e\nend\n',
	S +
		'A->>B: a\nbox Aqua G\nactor P as Pe\nparticipant R\nactor A\nend\npar_over b\ncreate actor D\nR->>D: d\nend\nP->>R: x\nD-xA: y\nNote over R,P: n\n'
];

const PLACEMENTS = ['over', 'left of', 'right of'] as const;
const BLOCKS = ['loop', 'alt', 'opt', 'par', 'critical', 'rect'] as const;

function randomCommand(doc: DiagramDocument, rnd: () => number): Command | null {
	const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(rnd() * list.length)];
	const parts = participantIds(doc);
	const messages = doc.edges.filter((e) => e.kind === 'message').map((e) => e.id);
	const items = walk(doc);
	switch (Math.floor(rnd() * 9)) {
		case 0: {
			const id = pick([...parts, ...messages, ...doc.nodes.map((n) => n.id)]);
			return id ? rename(id, pick(['Neu', '', 'Zwei', id])!) : null;
		}
		case 1: {
			const id = pick(messages);
			if (!id) return null;
			return setMessage(id, rnd() < 0.5 ? { sourceId: pick(parts) } : { targetId: pick(parts) });
		}
		case 2: {
			const id = pick(items);
			return id ? deleteElements([id]) : null;
		}
		case 3: {
			const id = pick(items);
			const groups = id ? verticalGroups(doc, id) : [];
			const at = pick(groups)?.[0];
			return id && at ? moveTo(id, at) : null;
		}
		case 4: {
			const p = pick(parts);
			return p ? addActivation(p, pick([undefined, ...items])) : null;
		}
		case 5:
			return addParticipant(rnd() < 0.5 ? 'actor' : 'participant');
		case 6: {
			const placement = pick(PLACEMENTS)!;
			const ps = [pick(parts), pick(parts)].slice(0, placement === 'over' ? 2 : 1);
			const list = [...new Set(ps.filter((p): p is string => p !== undefined))];
			return list.length ? addNote(placement, list, pick([undefined, ...items])) : null;
		}
		case 7: {
			const kind = pick(BLOCKS)!;
			return rnd() < 0.5
				? addContainer(kind, pick([undefined, ...items]))
				: addContainer(kind, undefined, pick(items));
		}
		default: {
			const [from, to] = [pick(parts), pick(parts)];
			return from && to ? addMessage(from, to, '->>', pick([undefined, ...items])) : null;
		}
	}
}

describe('Fuzz: jedes angenommene Command bleibt gültig', () => {
	// 7 × 22 Folgen aus je 4 bis 6 Commands; ein Seed je Startdokument.
	STARTS.forEach((text, start) =>
		it(`22 Folgen mit festem Seed auf Start ${start + 1}`, async () => {
			await expectConsistent(parseOk(text), text);
			const rnd = prng(20261102 + start);
			let applied = 0;
			for (let run = 0; run < 22; run++) {
				const sync = await makeSync(text);
				const codes = [text];
				const length = 4 + Math.floor(rnd() * 3);
				for (let k = 0; k < length; k++) {
					const doc = docOf(sync);
					const command = randomCommand(doc, rnd);
					if (!command) continue;
					const before = codeOf(sync);
					let ok = true;
					await sync.execute(command).catch(() => (ok = false));
					if (!ok) {
						expect(docOf(sync)).toBe(doc);
						expect(codeOf(sync)).toBe(before);
						continue;
					}
					applied++;
					// Command ohne Wirkung legt keinen Undo-Schritt ab (T107/O-71).
					if (codeOf(sync) !== before || docOf(sync) !== doc) codes.push(codeOf(sync));
					await expectConsistent(docOf(sync), codeOf(sync));
				}
				for (let i = codes.length - 2; i >= 0; i--) {
					await sync.undo();
					expect(codeOf(sync)).toBe(codes[i]);
				}
				expect(semantic(docOf(sync))).toEqual(semantic(parseOk(text)));
				sync.dispose();
			}
			expect(applied).toBeGreaterThan(45);
		}, 25000)
	);
});
