// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import { validate } from '../../../../src/lib/services/adapters/sequence';
import { rawUses } from '../../../../src/lib/services/adapters/sequence/syntax';
import {
	deleteElements,
	dropUnused,
	rename,
	setMessage
} from '../../../../src/lib/views/canvas/sequence/commands';
import { moveTo } from '../../../../src/lib/views/canvas/sequence/order';
import { sequenceGrammar } from '../../../../src/lib/controllers/sync';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import { codeOf, docOf, makeSync, parseOk, semantic } from './helpers';

const { rawEvents } = sequenceGrammar;

/** Commands nacheinander über den Sync-Controller; abgelehnte Commands ändern nichts. */
async function run(text: string, ...commands: Command[]) {
	const sync = await makeSync(text);
	const rejected: unknown[] = [];
	for (const c of commands) await sync.execute(c).catch((e: unknown) => rejected.push(e));
	const doc = docOf(sync);
	const code = codeOf(sync);
	let undo = false;
	sync.commands.subscribe((st) => (undo = st.canUndo))();
	sync.dispose();
	return { doc, code, rejected, undo, errors: await validate(code) };
}

function expectStable(r: Awaited<ReturnType<typeof run>>) {
	expect(r.errors).toEqual([]);
	expect(semantic(r.doc)).toEqual(semantic(parseOk(r.code)));
}

describe('rawEvents (Erkennung wie Adapter)', () => {
	const samples = [
		'par_over b\n    A->>C: y\nend\n',
		'box Aqua Gruppe\nparticipant X as Ix\nactor Y\nend\n',
		'par_over b\nNote over P,Q: t\nNote left of R: u\nend\n',
		'par_over b\ncreate participant Z\nlinks Z: {}\nend\n',
		'par_over b\nA-->>+B: x; B--x-A: y\nend\n',
		'par_over A wants\nactivate A\ndeactivate A\nend\n',
		'title A->>B: x\n',
		'par_over b\nA -|\\ B: halb\nend\n'
	];
	it.each(samples)('Nennungen gleich rawUses: %s', (text) => {
		expect(rawEvents(text).uses).toEqual(rawUses(text).map((u) => u.id));
	});

	it('Aktivierungen in Reihenfolge', () => {
		expect(
			rawEvents('par_over b\nA-->>+B: x; B--x-A: y\nactivate C\ndeactivate C\nend\n').act
		).toEqual([
			{ on: true, participant: 'B' },
			{ on: false, participant: 'B' },
			{ on: true, participant: 'C' },
			{ on: false, participant: 'C' }
		]);
		expect(rawEvents('title activate A\n').act).toEqual([]);
	});
});

describe('dropUnused (Serializer-Regel)', () => {
	it('Nennungen in RawBlocks gelten als benutzt', async () => {
		const text = 'sequenceDiagram\nA->>C: x\npar_over b\nA->>C: y\nend\n';
		const r = await run(text, deleteElements(['e1']));
		expect(r.doc.nodes.map((n) => n.id)).toEqual(['A', 'C']);
		expectStable(r);
	});

	it('umbenannte implizite Teilnehmer bleiben', async () => {
		const r = await run('sequenceDiagram\nA->>B: x\n', rename('B', 'Bob'), deleteElements(['e1']));
		expect(r.doc.nodes.find((n) => n.id === 'B')?.label).toBe('Bob');
		expectStable(r);
	});

	it('implizite Akteure bleiben, unveränderte implizite Teilnehmer gehen', () => {
		const doc = parseOk('sequenceDiagram\nA->>B: x\n');
		const actor = {
			...doc,
			nodes: doc.nodes.map((n) => (n.id === 'B' ? { ...n, kind: 'actor', shape: 'actor' } : n)),
			edges: [],
			order: []
		};
		expect(dropUnused(actor).nodes.map((n) => n.id)).toEqual(['B']);
	});
});

describe('Aktivierungen in RawBlocks', () => {
	it('activate löschen, deactivate im RawBlock: abgelehnt, Code gültig', async () => {
		const text = 'sequenceDiagram\nactivate A\nA->>B: x\npar_over b\ndeactivate A\nend\n';
		const r = await run(text, deleteElements(['e1']));
		expect(r.rejected).toHaveLength(1);
		expectStable(r);
	});

	it('activate im RawBlock deckt deactivate', async () => {
		const text = 'sequenceDiagram\npar_over b\nactivate A\nend\ndeactivate A\nA->>B: x\n';
		const del = await run(text, deleteElements(['e2']));
		expect(del.doc.edges.map((e) => e.kind)).toEqual(['deactivate']);
		expectStable(del);
		const moved = await run(text, moveTo('e2', { parent: null, section: 0, index: 1 }));
		expect(moved.rejected).toEqual([]);
		expect(moved.doc.order).toEqual(['n1', 'e2', 'e1']);
		expectStable(moved);
	});

	it('deactivate vor das activate im RawBlock bleibt abgelehnt', async () => {
		const text = 'sequenceDiagram\npar_over b\nactivate A\nend\ndeactivate A\nA->>B: x\n';
		const r = await run(text, moveTo('e1', { parent: null, section: 0, index: 0 }));
		expect(r.rejected).toHaveLength(1);
		expectStable(r);
	});
});

describe('Aktivierungs-Bilanz bei Absender-/Empfänger-Wechsel', () => {
	it('Absender eines `-` ohne Aktivierung: abgelehnt, Code gültig', async () => {
		const withC = 'sequenceDiagram\nparticipant C\nactivate A\nA->>-B: x\n';
		const c = await run(withC, setMessage('e2', { sourceId: 'C' }));
		expect(c.rejected).toHaveLength(1);
		expect(c.undo).toBe(false);
		expect(c.code).toBe(withC);
		expectStable(c);
	});

	it('Empfänger eines `+` mit späterem deactivate: abgelehnt, Code gültig', async () => {
		const text = 'sequenceDiagram\nparticipant C\nA->>+B: x\ndeactivate B\n';
		const r = await run(text, setMessage('e1', { targetId: 'C' }));
		expect(r.rejected).toHaveLength(1);
		expect(r.undo).toBe(false);
		expect(r.code).toBe(text);
		expectStable(r);
	});

	it('Wechsel ohne Bilanz-Bruch bleibt erlaubt', async () => {
		const text = 'sequenceDiagram\nparticipant C\nactivate A\nA->>-B: x\n';
		const r = await run(text, setMessage('e2', { targetId: 'C' }));
		expect(r.rejected).toEqual([]);
		expect(r.doc.edges.find((e) => e.id === 'e2')?.targetId).toBe('C');
		expectStable(r);
	});
});

describe('Teilnehmer mit Nennung in RawBlock', () => {
	it.each([
		[
			'Nachricht in par_over',
			'sequenceDiagram\nparticipant A\nparticipant B\npar_over b\nA->>B: y\nend\n'
		],
		[
			'Note over A in par_over',
			'sequenceDiagram\nparticipant A\nparticipant B\npar_over b\nNote over A: t\nend\n'
		]
	])('Löschen abgelehnt (%s)', async (_, text) => {
		const r = await run(text, deleteElements(['A']));
		expect(r.rejected).toHaveLength(1);
		expect(r.undo).toBe(false);
		expect(r.doc.nodes.map((n) => n.id)).toEqual(['A', 'B']);
		expect(r.code).toBe(text);
		expectStable(r);
	});

	it('Mehrfachauswahl: gesamter Vorgang abgelehnt', async () => {
		const text =
			'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: x\npar_over b\nNote over A: t\nend\n';
		const r = await run(text, deleteElements(['e1', 'B', 'A']));
		expect(r.rejected).toHaveLength(1);
		expect(r.undo).toBe(false);
		expect(r.code).toBe(text);
		expectStable(r);
	});

	it('Teilnehmer ohne RawBlock-Nennung bleibt löschbar', async () => {
		const text = 'sequenceDiagram\nparticipant A\nparticipant B\npar_over b\nNote over A: t\nend\n';
		const r = await run(text, deleteElements(['B']));
		expect(r.rejected).toEqual([]);
		expect(r.doc.nodes.map((n) => n.id)).toEqual(['A']);
		expectStable(r);
	});
});

describe('Aktivierungen eines Teilnehmers in RawBlock (mermaid.render)', () => {
	/** Render braucht Textmaße; jsdom liefert keine. */
	async function render(code: string) {
		const proto = window.SVGElement.prototype as unknown as Record<string, unknown>;
		proto.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
		proto.getComputedTextLength = () => 10;
		mermaid.initialize({ startOnLoad: false });
		await mermaid.render(`r${Math.random().toString(36).slice(2)}`, code);
	}

	it('Teilnehmer mit activate/deactivate im RawBlock: Löschen abgelehnt', async () => {
		const text =
			'sequenceDiagram\nparticipant X\nparticipant B\nX->>B: m\npar_over b\nactivate X\ndeactivate X\nend\n';
		const r = await run(text, deleteElements(['X']));
		expect(r.rejected).toHaveLength(1);
		expect((r.rejected[0] as Error).message).toBe(
			'Teilnehmer X wird in nicht editierbarem Block genannt'
		);
		expect(r.undo).toBe(false);
		expect(r.code).toBe(text);
		expectStable(r);
		await render(r.code);
	});

	it('letzte Nachricht eines impliziten Teilnehmers: bleibt explizit, Undo stellt Ursprung her', async () => {
		const text = 'sequenceDiagram\nX->>B: m\nB->>B: n\npar_over b\nactivate X\ndeactivate X\nend\n';
		const sync = await makeSync(text);
		await sync.execute(deleteElements(['e1']));
		const doc = docOf(sync);
		const code = codeOf(sync);
		expect(doc.edges.map((e) => e.id)).toEqual(['e2']);
		const x = doc.nodes.find((n) => n.id === 'X');
		expect(x?.props.implicit).toBeUndefined();
		expect(code).toMatch(/^\s*participant X$/m);
		const reparsed = parseOk(code);
		expect(reparsed.nodes.find((n) => n.id === 'X')?.props.implicit).toBeUndefined();
		expect(semantic(doc)).toEqual(semantic(reparsed));
		expect(await validate(code)).toEqual([]);
		await render(code);
		await sync.undo();
		expect(codeOf(sync)).toBe(text);
		expect(semantic(docOf(sync))).toEqual(semantic(parseOk(text)));
		sync.dispose();
	});

	/** Teilnehmer-Reihenfolge laut mermaid. */
	async function actors(code: string) {
		const db = (await mermaid.mermaidAPI.getDiagramFromText(code)).db as unknown as {
			getActorKeys(): string[];
		};
		return db.getActorKeys();
	}

	it.each([
		[
			'a: nur Modell-Aktivierung',
			'sequenceDiagram\nX->>B: m\nactivate X\ndeactivate X\n',
			deleteElements(['e1']),
			['X']
		],
		[
			'b: Absender-Wechsel',
			'sequenceDiagram\nparticipant C\nX->>B: m\nactivate X\ndeactivate X\n',
			setMessage('e1', { sourceId: 'C' }),
			['C', 'X', 'B']
		],
		[
			'c: Modell-activate, deactivate im RawBlock',
			'sequenceDiagram\nX->>B: m\nactivate X\npar_over b\ndeactivate X\nend\n',
			deleteElements(['e1']),
			['X']
		],
		[
			'Reihenfolge X,B',
			'sequenceDiagram\nX->>B: m\nB->>B: n\npar_over b\nactivate X\ndeactivate X\nend\n',
			deleteElements(['e1']),
			['X', 'B']
		],
		[
			'Reihenfolge C,X,B',
			'sequenceDiagram\nparticipant C\nX->>B: m\npar_over b\nactivate X\ndeactivate X\nend\n',
			setMessage('e1', { sourceId: 'C' }),
			['C', 'X', 'B']
		]
	])('nur noch aktiviert (%s): explizit, Reihenfolge erhalten', async (_, text, command, order) => {
		const sync = await makeSync(text);
		const before = await actors(text);
		await sync.execute(command);
		const doc = docOf(sync);
		const code = codeOf(sync);
		expect(doc.nodes.find((n) => n.id === 'X')?.props.implicit).toBeUndefined();
		expect(code).toMatch(/^\s*participant X$/m);
		expect(await validate(code)).toEqual([]);
		expect(semantic(doc)).toEqual(semantic(parseOk(code)));
		expect(await actors(code)).toEqual(order);
		expect(order).toEqual(before.filter((p) => order.includes(p)));
		await render(code);
		await sync.undo();
		expect(codeOf(sync)).toBe(text);
		expect(semantic(docOf(sync))).toEqual(semantic(parseOk(text)));
		sync.dispose();
	});

	const participantIds = (doc: ReturnType<typeof parseOk>) =>
		doc.nodes.filter((n) => n.kind !== 'note').map((n) => n.id);

	it.each([
		[
			'Umbenennen zurück nach Löschen (nur aktiviert)',
			'sequenceDiagram\nX->>B: m\nactivate X\ndeactivate X\n',
			[rename('X', 'Ex'), deleteElements(['e1']), rename('X', '')],
			['X']
		],
		[
			// Umbenennen deklariert X an Serializer-Position; die Deklaration bleibt danach stehen.
			'Umbenennen zurück nach Löschen (ungenannt)',
			'sequenceDiagram\nX->>B: m\nB->>C: n\n',
			[rename('X', 'Ex'), deleteElements(['e1']), rename('X', '')],
			['X', 'B', 'C']
		],
		[
			'umbenannter impliziter Teilnehmer nur noch aktiviert',
			'sequenceDiagram\nX->>B: m\nB->>C: n\nactivate X\ndeactivate X\n',
			[rename('X', 'Ex'), deleteElements(['e1'])],
			['X', 'B', 'C']
		],
		[
			'Zieleintrag nennt früheren und späteren Teilnehmer',
			'sequenceDiagram\nA->>X: m\nB->>A: q\nactivate X\ndeactivate X\n',
			[setMessage('e1', { targetId: 'B' })],
			['A', 'X', 'B']
		],
		[
			'create im RawBlock nach Entfernen',
			'sequenceDiagram\nX->>B: m\npar_over b\ncreate participant Z\nB->>Z: hi\nend\n',
			[deleteElements(['e1'])],
			['Z', 'B']
		]
	])('Reihenfolge nach Folge (%s)', async (_, text, commands, order) => {
		const sync = await makeSync(text);
		for (const c of commands) await sync.execute(c);
		const doc = docOf(sync);
		const code = codeOf(sync);
		const reparsed = parseOk(code);
		expect(await validate(code)).toEqual([]);
		expect(semantic(doc)).toEqual(semantic(reparsed));
		expect(participantIds(doc)).toEqual(participantIds(reparsed));
		expect(participantIds(doc)).toEqual(order);
		expect(await actors(code)).toEqual(order);
		await render(code);
		for (let i = 0; i < commands.length; i++) await sync.undo();
		expect(codeOf(sync)).toBe(text);
		expect(semantic(docOf(sync))).toEqual(semantic(parseOk(text)));
		sync.dispose();
	});
});
