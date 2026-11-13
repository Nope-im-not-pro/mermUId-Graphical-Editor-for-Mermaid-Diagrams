// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
	createHistory,
	execute,
	undo,
	type History
} from '../../../../src/lib/controllers/commands/history';
import {
	fragmentText,
	readFragment,
	type Fragment
} from '../../../../src/lib/controllers/sync/fragment';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { cutElements, pasteFragment } from '../../../../src/lib/views/canvas/graph/commands';
import {
	canvasClipboard,
	clipboardReadable
} from '../../../../src/lib/views/canvas/graph/interaction';
import { fakeAdapters } from '../../controllers/sync/helpers';
import { parseOk } from './helpers';

async function fragmentOf(text: string): Promise<Fragment> {
	const read = await readFragment(text, fakeAdapters);
	if (!read.ok) throw new Error(read.reason);
	return read.fragment;
}

const manual = (doc: DiagramDocument, positions: DiagramDocument['layout']['positions']) => ({
	...doc,
	layout: { ...doc.layout, mode: 'manual' as const, positions }
});

const TARGET =
	'flowchart LR\n  n1[Eins] --> X\n  classDef hot fill:#00f\n  classDef default fill:#eee\n';

const SOURCE = [
	'flowchart LR',
	'  A[Start]:::hot --> B{Frage}',
	'  B -->|ja| C',
	'  C e9@--> A',
	'  classDef hot fill:#f00',
	'  classDef warm fill:#fa0',
	'  classDef default fill:#000',
	'  class B warm',
	'  click A "https://example.com"',
	''
].join('\n');

describe('Einfügen (T133 C2)', () => {
	it('neue IDs für Knoten und Kanten, innere Kanten umgehängt, Props bereinigt', async () => {
		const frag = await fragmentOf(SOURCE);
		expect(frag.edges[2].props.explicitId).toBe(true);
		const h = execute(createHistory(parseOk(TARGET)), pasteFragment(frag));
		const added = h.doc.nodes.filter((n) => !['n1', 'X'].includes(n.id));
		expect(added.map((n) => n.id)).toEqual(['n2', 'n3', 'n4']);
		expect(added.map((n) => n.label)).toEqual(['Start', 'Frage', 'C']);
		const byOld = Object.fromEntries(added.map((n, i) => [['A', 'B', 'C'][i], n.id]));
		const edges = h.doc.edges.slice(1);
		expect(edges.map((e) => [e.id, e.sourceId, e.targetId])).toEqual([
			['e2', byOld.A, byOld.B],
			['e3', byOld.B, byOld.C],
			['e4', byOld.C, byOld.A]
		]);
		expect(edges.every((e) => !('explicitId' in e.props) && e.sourceText === '')).toBe(true);
		expect(added[0].props.click).toBe(`click ${byOld.A} "https://example.com"`);
		expect(added.every((n) => n.parentId === null && n.sourceText === '')).toBe(true);
	});

	it('click ohne passende ID wird entfernt', async () => {
		const frag = await fragmentOf('flowchart LR\n  A\n');
		const odd: Fragment = {
			...frag,
			nodes: [{ ...frag.nodes[0], props: { click: 'click Z "https://x.org"' } }]
		};
		const d = pasteFragment(odd).do(parseOk(TARGET), { newId: (p) => `${p}99` });
		expect(d.nodes.find((n) => n.id === 'n99')!.props).toEqual({});
	});

	it('classDef-Merge: fehlende ergänzt, gleichnamige und default des Ziels bleiben', async () => {
		const frag = await fragmentOf(SOURCE);
		const h = execute(createHistory(parseOk(TARGET)), pasteFragment(frag));
		expect(h.doc.classDefs.map((c) => [c.name, c.style])).toEqual([
			['hot', { fill: '#00f' }],
			['default', { fill: '#eee' }],
			['warm', { fill: '#fa0' }]
		]);
	});

	it('default der Quelle wird nicht übernommen, wenn das Ziel keine hat', async () => {
		const frag = await fragmentOf(SOURCE);
		const h = execute(createHistory(parseOk('flowchart LR\n  X\n')), pasteFragment(frag));
		expect(h.doc.classDefs.map((c) => c.name)).toEqual(['hot', 'warm']);
	});

	it('ein Undo-Schritt; nach Undo werden IDs nie wiederverwendet (D-03)', async () => {
		const frag = await fragmentOf('flowchart LR\n  A --> B\n');
		const start = createHistory(parseOk(TARGET));
		const once = execute(start, pasteFragment(frag));
		expect(once.past).toHaveLength(1);
		const back = undo(once);
		expect(back.doc).toBe(start.doc);
		const again = execute(back, pasteFragment(frag));
		const ids = (h: History) => [...h.doc.nodes, ...h.doc.edges].map((el) => el.id);
		const first = ids(once).filter((id) => !ids(start).includes(id));
		const second = ids(again).filter((id) => !ids(start).includes(id));
		expect(first.some((id) => second.includes(id))).toBe(false);
	});

	it('Positionen versetzt; wiederholtes Einfügen versetzt weiter (manuell)', async () => {
		const src = manual(parseOk('flowchart LR\n  A --> B\n'), {
			A: [10, 20, 80, 42],
			B: [200, 20, 80, 42]
		});
		const frag = await fragmentOf(fragmentText(src, ['A', 'B'])!);
		const start = createHistory(src);
		const one = execute(start, pasteFragment(frag));
		const two = execute(one, pasteFragment(frag));
		const pos = two.doc.layout.positions;
		expect(pos.n1).toEqual([26, 36, 80, 42]);
		expect(pos.n2).toEqual([216, 36, 80, 42]);
		expect(pos.n3).toEqual([42, 52, 80, 42]);
		expect(pos.n4).toEqual([232, 52, 80, 42]);
		expect(two.past).toHaveLength(2);
	});

	it('Auto-Layout: keine Positionen geschrieben, Layout unverändert', async () => {
		const src = manual(parseOk('flowchart LR\n  A\n'), { A: [10, 20, 80, 42] });
		const frag = await fragmentOf(fragmentText(src, ['A'])!);
		const target = parseOk(TARGET);
		const h = execute(createHistory(target), pasteFragment(frag));
		expect(h.doc.layout).toEqual(target.layout);
		expect(h.doc.nodes.some((n) => n.id === 'n2')).toBe(true);
	});

	it('liefert die eingefügten Knoten-IDs für die Auswahl', async () => {
		const frag = await fragmentOf('flowchart LR\n  A --> B\n');
		const cmd = pasteFragment(frag);
		expect(cmd.pasted).toEqual([]);
		execute(createHistory(parseOk(TARGET)), cmd);
		expect(cmd.pasted).toEqual(['n2', 'n3']);
	});

	it('Bezeichnung des Undo-Schritts: Einfügen (T133 C3)', async () => {
		const frag = await fragmentOf('flowchart LR\n  A\n');
		expect(pasteFragment(frag).label).toBe('Einfügen');
		expect(cutElements(['A']).label).toBe('Ausschneiden');
	});

	it('class-Zuordnung der eingefügten Knoten bleibt', async () => {
		const frag = await fragmentOf(SOURCE);
		const h = execute(createHistory(parseOk(TARGET)), pasteFragment(frag));
		const added = h.doc.nodes.filter((n) => !['n1', 'X'].includes(n.id));
		expect(added.map((n) => n.cssClasses)).toEqual([['hot'], ['warm'], []]);
	});

	it('Serialisierungs-Rundlauf: style und linkStyle hängen an den neuen IDs', async () => {
		const frag = await fragmentOf(
			'flowchart LR\n  A --> B\n  style A fill:#f00\n  linkStyle 0 stroke:#0f0\n'
		);
		const h = execute(createHistory(parseOk('flowchart LR\n  X --> Y\n')), pasteFragment(frag));
		const again = parseOk(flowchartAdapter.serialize(h.doc));
		const a = again.nodes.find((n) => n.id === 'n1')!;
		expect(a.style).toEqual({ fill: '#f00' });
		const [old, pasted] = again.edges;
		expect(old.style).toEqual({});
		expect([pasted.sourceId, pasted.targetId]).toEqual(['n1', 'n2']);
		expect(pasted.style).toEqual({ stroke: '#0f0' });
	});

	it('Versatz weicht einem fremden Knoten auf dem Zielpunkt aus', async () => {
		const src = manual(parseOk('flowchart LR\n  A\n'), { A: [10, 20, 80, 42] });
		const frag = await fragmentOf(fragmentText(src, ['A'])!);
		const target = manual(parseOk('flowchart LR\n  A\n  F\n'), {
			A: [10, 20, 80, 42],
			F: [26, 36, 80, 42]
		});
		const h = execute(createHistory(target), pasteFragment(frag));
		expect(h.doc.layout.positions.n1).toEqual([42, 52, 80, 42]);
	});

	it('Versatz <= 0 fällt auf den Standard zurück (keine Endlosschleife)', async () => {
		const src = manual(parseOk('flowchart LR\n  A\n'), { A: [10, 20, 80, 42] });
		const frag = await fragmentOf(fragmentText(src, ['A'])!);
		for (const offset of [0, -5, Number.NaN]) {
			const h = execute(createHistory(src), pasteFragment(frag, offset));
			expect(h.doc.layout.positions.n1).toEqual([26, 36, 80, 42]);
		}
	});

	it('manuelles Ziel, Fragment ohne Positionen: Spalte rechts neben allem Vorhandenen', async () => {
		const frag = await fragmentOf('flowchart LR\n  A --> B\n');
		const target = manual(parseOk('flowchart LR\n  X\n  Y\n'), {
			X: [0, 50, 80, 42],
			Y: [300, 10, 100, 42]
		});
		const h = execute(createHistory(target), pasteFragment(frag));
		const pos = h.doc.layout.positions;
		expect(pos.n1).toEqual([440, 10, 80, 42]);
		expect(pos.n2).toEqual([440, 92, 80, 42]);
		expect(pos.X).toEqual([0, 50, 80, 42]);
	});

	it('Teil-Positionen: positionierte versetzt, übrige in der Spalte rechts daneben', async () => {
		const frag = await fragmentOf('flowchart LR\n  A --> B\n');
		const part: Fragment = { ...frag, positions: { A: [500, 0, 80, 42] } };
		const target = manual(parseOk('flowchart LR\n  X\n'), { X: [0, 0, 80, 42] });
		const h = execute(createHistory(target), pasteFragment(part));
		const pos = h.doc.layout.positions;
		expect(pos.n1).toEqual([516, 16, 80, 42]);
		expect(pos.n2).toEqual([636, 0, 80, 42]);
	});

	it('manuelles leeres Ziel: Spalte beginnt am Ursprung', async () => {
		const frag = await fragmentOf('flowchart LR\n  A\n');
		const h = execute(createHistory(manual(parseOk('flowchart LR\n'), {})), pasteFragment(frag));
		expect(h.doc.layout.positions.n1).toEqual([0, 0, 80, 42]);
	});

	it('leeres Fragment ändert nichts (kein Undo-Schritt)', () => {
		const empty: Fragment = { nodes: [], edges: [], classDefs: [], positions: {} };
		const start = createHistory(parseOk(TARGET));
		expect(execute(start, pasteFragment(empty))).toBe(start);
	});
});

describe('Ausschneiden (T133 C2)', () => {
	const doc = parseOk(SOURCE);

	it('liefert das Fragment und löscht die Auswahl in einem Undo-Schritt', async () => {
		const cmd = cutElements(['A', 'B']);
		const start = createHistory(doc);
		const h = execute(start, cmd);
		expect(cmd.text).toBe(fragmentText(doc, ['A', 'B']));
		expect(h.doc.nodes.map((n) => n.id)).toEqual(['C']);
		expect(h.doc.edges).toEqual([]);
		expect(h.past).toHaveLength(1);
		expect(undo(h).doc).toBe(start.doc);
		const frag = await fragmentOf(cmd.text!);
		expect(frag.nodes.map((n) => n.label)).toEqual(['Start', 'Frage']);
	});

	it('Container bleiben; ohne Knoten in der Auswahl kein Schritt', () => {
		const boxed = parseOk('flowchart LR\n  subgraph S1\n    C\n  end\n  A --> B\n');
		const start = createHistory(boxed);
		const cmd = cutElements(['S1', boxed.edges[0].id]);
		expect(execute(start, cmd)).toBe(start);
		expect(cmd.text).toBeNull();
		const h = execute(start, cutElements(['S1', 'A']));
		expect(h.doc.containers.map((c) => c.id)).toEqual(['S1']);
		expect(h.doc.nodes.map((n) => n.id)).toEqual(['C', 'B']);
	});
});

describe('Zwischenablage mit Fensterpuffer (T133 C3)', () => {
	const system = (read: () => Promise<string>) => ({
		readText: vi.fn(read),
		writeText: vi.fn(() => Promise.resolve())
	});

	it('Schreiben geht in System-Zwischenablage und Puffer', async () => {
		const clip = system(() => Promise.resolve('fremd'));
		const board = canvasClipboard(
			() => clip,
			() => Promise.resolve(false)
		);
		board.write('eigen');
		expect(clip.writeText).toHaveBeenCalledWith('eigen');
		expect(await board.read()).toBe('eigen');
		expect(clip.readText).not.toHaveBeenCalled();
	});

	it('mit Leserecht gilt die System-Zwischenablage', async () => {
		const clip = system(() => Promise.resolve('fremd'));
		const board = canvasClipboard(
			() => clip,
			() => Promise.resolve(true)
		);
		board.write('eigen');
		expect(await board.read()).toBe('fremd');
	});

	it('abgelehnt, leer oder ohne API: Puffer; Schreibfehler werfen nicht', async () => {
		const denied = system(() => Promise.reject(new Error('NotAllowedError')));
		denied.writeText.mockImplementation(() => Promise.reject(new Error('denied')));
		const a = canvasClipboard(
			() => denied,
			() => Promise.resolve(true)
		);
		expect(await a.read()).toBeNull();
		a.write('eigen');
		expect(await a.read()).toBe('eigen');
		const empty = canvasClipboard(
			() => system(() => Promise.resolve('')),
			() => Promise.resolve(true)
		);
		empty.write('eigen');
		expect(await empty.read()).toBe('eigen');
		const none = canvasClipboard(
			() => undefined,
			() => Promise.resolve(true)
		);
		none.write('eigen');
		expect(await none.read()).toBe('eigen');
	});

	it('Schreibfehler: Puffer hat Vorrang vor altem Systeminhalt, bis ein Schreiben gelingt', async () => {
		const clip = system(() => Promise.resolve('alt'));
		clip.writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
		const board = canvasClipboard(
			() => clip,
			() => Promise.resolve(true)
		);
		board.write('eigen');
		await Promise.resolve();
		expect(await board.read()).toBe('eigen');
		expect(clip.readText).not.toHaveBeenCalled();
		board.write('neu');
		expect(await board.read()).toBe('alt');
	});

	it('Leserecht: granted/prompt ja; denied, unbekannter Name (Firefox) oder ohne API nein', async () => {
		const perm = (state: string) => ({ query: () => Promise.resolve({ state }) });
		expect(await clipboardReadable(perm('granted') as unknown as Permissions)).toBe(true);
		expect(await clipboardReadable(perm('prompt') as unknown as Permissions)).toBe(true);
		expect(await clipboardReadable(perm('denied') as unknown as Permissions)).toBe(false);
		const firefox = { query: () => Promise.reject(new TypeError('clipboard-read')) };
		expect(await clipboardReadable(firefox as unknown as Permissions)).toBe(false);
		expect(await clipboardReadable(undefined)).toBe(false);
	});
});
