// @vitest-environment jsdom
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import {
	carryRenames,
	connectNodes,
	containerRenames,
	createNode,
	deleteElements,
	duplicateNodes,
	groupIntoSubgraph,
	moveElements,
	reconnectEdge,
	renameElement,
	setLayoutOption
} from '../../../../src/lib/views/canvas/graph/commands';
import { computeGeometry } from '../../../../src/lib/views/canvas/graph/mapping';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { createSync, type SyncController } from '../../../../src/lib/controllers/sync';
import { fakeAdapters } from '../../controllers/sync/helpers';
import { SAMPLE, measure, parseOk } from './helpers';

function run(doc: DiagramDocument, cmd: Command) {
	let n = 0;
	return cmd.do(doc, { newId: (p) => `${p}${++n + 100}` });
}

const manual = (doc: DiagramDocument): DiagramDocument => ({
	...doc,
	layout: { ...doc.layout, mode: 'manual' }
});

describe('Commands', () => {
	const doc = parseOk(SAMPLE);
	const geo = computeGeometry(doc, 'LR', measure);

	it('createNode (manuell): neue ID, Label = ID, Position mit Standardgröße in Metadaten', () => {
		const d = run(manual(doc), createNode({ x: 40, y: 50 }));
		const n = d.nodes.find((x) => x.id === 'n101')!;
		expect(n).toMatchObject({ label: 'n101', shape: 'square', parentId: null });
		expect(d.layout.positions.n101).toEqual([40, 50, 80, 42]);
		expect(d.layout.mode).toBe('manual');
		expect(d.modelVersion).toBeGreaterThan(doc.modelVersion);
	});

	// T122 (M-08/O-48): im Auto-Layout keine wirkungslose Klickposition, Modus bleibt auto.
	it('createNode (auto): Knoten ohne Position, Layout unverändert', () => {
		expect(doc.layout.mode).toBe('auto');
		const d = run(doc, createNode({ x: 40, y: 50 }));
		expect(d.nodes.find((x) => x.id === 'n101')).toMatchObject({ label: 'n101' });
		expect(d.layout).toEqual(doc.layout);
		expect(d.modelVersion).toBeGreaterThan(doc.modelVersion);
	});

	it('createNode (auto) mit erhaltenen manuellen Positionen: neuer Knoten auf dagre-Rückfall', () => {
		const kept: DiagramDocument = {
			...doc,
			layout: { ...doc.layout, positions: { A: [500, 500, 80, 42] } }
		};
		const d = run(kept, createNode({ x: 40, y: 50 }));
		expect(d.layout.positions).toEqual({ A: [500, 500, 80, 42] });
		const auto = computeGeometry(d, 'LR', measure);
		const back = computeGeometry(manual(d), 'LR', measure);
		expect(back.A).toMatchObject({ x: 500, y: 500 });
		expect(back.n101).toEqual(auto.n101);
	});

	it('moveElements: Auto-Layout wird eingefroren, Kinder folgen dem Container', () => {
		const d = run(doc, moveElements([{ id: 'S1', x: geo.S1.x + 10, y: geo.S1.y + 20 }], geo));
		expect(d.layout.mode).toBe('manual');
		expect(d.layout.positions.S1.slice(0, 2)).toEqual([geo.S1.x + 10, geo.S1.y + 20]);
		expect(d.layout.positions.C.slice(0, 2)).toEqual([geo.C.x + 10, geo.C.y + 20]);
		expect(d.layout.positions.A.slice(0, 2)).toEqual([geo.A.x, geo.A.y]);
	});

	it('moveElements: Kind eines mitbewegten Containers nicht doppelt', () => {
		const d = run(
			manual(doc),
			moveElements(
				[
					{ id: 'S1', x: geo.S1.x + 10, y: geo.S1.y },
					{ id: 'C', x: geo.C.x + 10, y: geo.C.y }
				],
				geo
			)
		);
		expect(d.layout.positions.C[0]).toBe(geo.C.x + 10);
	});

	it('moveElements ohne Änderung liefert dasselbe Dokument', () => {
		expect(run(doc, moveElements([{ id: 'A', x: geo.A.x, y: geo.A.y }], geo))).toBe(doc);
		expect(run(doc, moveElements([{ id: 'X', x: 1, y: 1 }], geo))).toBe(doc);
	});

	it('renameElement: Container vor Knoten, dann Kante', () => {
		expect(run(doc, renameElement('S1', 'Neu')).containers[0].label).toBe('Neu');
		expect(run(doc, renameElement('A', 'a<br>b')).nodes[0].label).toBe('a<br>b');
		expect(run(doc, renameElement('e1', 'ja')).edges[0].label).toBe('ja');
		expect(run(doc, renameElement('fehlt', 'x'))).toBe(doc);
	});

	it('deleteElements: Kaskade, Container-ID-Knoten mit, Fehlendes übersprungen', () => {
		const d = run(doc, deleteElements(['A', 'S1', 'e1', 'fehlt']));
		expect(d.nodes.map((n) => n.id)).toEqual(['B']);
		expect(d.containers).toHaveLength(0);
		expect(d.edges).toHaveLength(0);
		const e = run(doc, deleteElements(['e1']));
		expect(e.edges.map((x) => x.id)).toEqual(['e2', 'e3']);
	});

	it('duplicateNodes: Kopien versetzt, Kanten zwischen Kopien mitkopiert', () => {
		const d = run(doc, duplicateNodes(['C', 'D', 'S1'], geo));
		const copies = d.nodes.filter((n) => n.id.startsWith('n1'));
		expect(copies.map((n) => [n.label, n.parentId])).toEqual([
			['C', 'S1'],
			['D', 'S1']
		]);
		expect(d.layout.mode).toBe('manual');
		expect(d.layout.positions[copies[0].id].slice(0, 2)).toEqual([geo.C.x + 16, geo.C.y + 16]);
		const edge = d.edges.find((e) => e.sourceId === copies[0].id)!;
		expect(edge.targetId).toBe(copies[1].id);
		expect(run(doc, duplicateNodes(['S1'], geo))).toBe(doc);
	});

	it('connectNodes: Kante solid mit Pfeil', () => {
		const d = run(doc, connectNodes('B', 'C'));
		expect(d.edges.at(-1)).toMatchObject({
			sourceId: 'B',
			targetId: 'C',
			lineStyle: 'solid',
			arrowHead: 'arrow',
			label: ''
		});
	});
});

describe('Commands (C3)', () => {
	const doc = parseOk('flowchart TB\n  subgraph S1\n    C\n  end\n  A --> B\n');

	it('groupIntoSubgraph: neuer Subgraph enthält die Auswahl', () => {
		const d = run(doc, groupIntoSubgraph(['A', 'B', 'e1', 'nix']));
		const c = d.containers.find((x) => x.id === 'c101')!;
		expect(c).toMatchObject({ kind: 'subgraph', label: 'c101', parentId: null });
		expect(c.sections[0].memberIds).toEqual(['A', 'B']);
		expect(d.nodes.find((n) => n.id === 'A')!.parentId).toBe('c101');
	});

	it('groupIntoSubgraph: gemeinsamer Elterncontainer, Container als Mitglied', () => {
		const d = run(doc, groupIntoSubgraph(['C']));
		expect(d.containers.find((x) => x.id === 'c101')!.parentId).toBe('S1');
		const outer = run(doc, groupIntoSubgraph(['S1', 'C', 'A']));
		expect(outer.containers.find((x) => x.id === 'S1')!.parentId).toBe('c101');
		expect(outer.nodes.find((n) => n.id === 'C')!.parentId).toBe('S1');
		expect(run(doc, groupIntoSubgraph(['nix']))).toBe(doc);
	});
});

describe('Commands (Fix E1)', () => {
	const doc = parseOk(SAMPLE);
	const geo = computeGeometry(doc, 'LR', measure);

	it('duplicateNodes: keine zweite click-Zeile, Kanten-Kopie ohne Statement-Bindung', () => {
		const src = parseOk('flowchart LR\n  A --> B\n  click A cb\n');
		const g = computeGeometry(src, 'LR', measure);
		const d = run(src, duplicateNodes(['A', 'B'], g));
		const code = flowchartAdapter.serialize(d);
		expect(code.split('\n').filter((l) => l.trim().startsWith('click'))).toEqual(['  click A cb']);
		const copy = d.edges.find((e) => e.sourceId !== 'A')!;
		for (const key of ['stmt', 'idx', 'of', 'explicitId'])
			expect(copy.props).not.toHaveProperty(key);
		expect(flowchartAdapter.parse(code).ok).toBe(true);
	});

	it('Einfrieren: Nudge um 8 in S1 ändert den Rahmen höchstens um 8', () => {
		const d = run(doc, moveElements([{ id: 'C', x: geo.C.x + 8, y: geo.C.y }], geo));
		const after = computeGeometry(d, 'LR', measure).S1;
		for (const k of ['x', 'y', 'w', 'h'] as const) {
			expect(Math.abs(after[k] - geo.S1[k])).toBeLessThanOrEqual(8);
		}
	});

	it('Einfrieren behält vorhandene manuelle Positionen (manual -> auto -> Drag)', () => {
		const auto: DiagramDocument = {
			...doc,
			layout: { ...doc.layout, mode: 'auto', positions: { A: [500, 600, 80, 42] } }
		};
		const d = run(auto, moveElements([{ id: 'B', x: geo.B.x + 8, y: geo.B.y }], geo));
		expect(d.layout.mode).toBe('manual');
		expect(d.layout.positions.A).toEqual([500, 600, 80, 42]);
		expect(d.layout.positions.B.slice(0, 2)).toEqual([geo.B.x + 8, geo.B.y]);
		expect(d.layout.positions.C.slice(0, 2)).toEqual([geo.C.x, geo.C.y]);
	});

	it('setLayoutOption: Snap und Raster ins Layout-Feld, Rest unverändert', () => {
		const d = run(doc, setLayoutOption({ snap: true }));
		expect(d.layout).toEqual({ ...doc.layout, snap: true });
		expect(d.modelVersion).toBe(doc.modelVersion + 1);
		expect(run(doc, setLayoutOption({ gridSize: 16 })).layout.gridSize).toBe(16);
	});
});

describe('Eltern-Map je Command (T113 C3, V-29)', () => {
	/** Dokument mit 500 Knoten in 10 Containern; zählt Lesezugriffe auf `nodes`/`containers`. */
	function big() {
		const base = parseOk(SAMPLE);
		const containers = Array.from({ length: 10 }, (_, i) => ({
			...base.containers[0],
			id: `S${i}`,
			parentId: null,
			sections: [{ label: '', memberIds: [] }]
		}));
		const nodes = Array.from({ length: 500 }, (_, i) => ({
			...base.nodes[0],
			id: `N${i}`,
			parentId: `S${i % 10}`
		}));
		const reads = { n: 0 };
		const doc = { ...base, edges: [] } as DiagramDocument;
		Object.defineProperty(doc, 'nodes', {
			enumerable: true,
			get: () => (reads.n++, nodes)
		});
		Object.defineProperty(doc, 'containers', {
			enumerable: true,
			get: () => (reads.n++, containers)
		});
		const geometry = Object.fromEntries(
			[...nodes, ...containers].map((el, i) => [el.id, { x: i, y: i, w: 80, h: 42 }])
		);
		return { doc, reads, geometry, ids: [...nodes, ...containers].map((el) => el.id) };
	}

	it('moveElements mit 500 Knoten liest die Elementlisten einmal (Map) plus Kopie', () => {
		const { doc, reads, geometry, ids } = big();
		const moves = ids.map((id) => ({ id, x: geometry[id].x + 5, y: geometry[id].y }));
		const d = run(doc, moveElements(moves, geometry));
		// 1x `parentMap` (nodes + containers) + 1x Spread in `withPositions` (nodes + containers).
		expect(reads.n).toBe(4);
		// Nur Container bewegt sich selbst; Kinder folgen genau einmal um dx.
		expect(d.layout.positions.S0.slice(0, 2)).toEqual([geometry.S0.x + 5, geometry.S0.y]);
		expect(d.layout.positions.N10.slice(0, 2)).toEqual([geometry.N10.x + 5, geometry.N10.y]);
	});
});

describe('Stabile ID unbenannter Subgraphen (T111 C3, V-13)', () => {
	const META = '%% @mermuid: {"v":1,"layout":"manual","pos":{}}\n';
	const TWO = [
		'flowchart TD',
		'    subgraph Erste Gruppe',
		'        A',
		'    end',
		'    subgraph Zweite Gruppe',
		'        B',
		'    end',
		''
	].join('\n');
	const open = (text: string) => createSync(text, { adapters: fakeAdapters });
	const body = (code: string) => code.replace(/%% @mermuid:[^\n]*\n/, '');
	const docOf = (sync: SyncController) => get(sync.commands).doc;
	const drag = async (sync: SyncController, id: string, dx = 30) => {
		const geo = computeGeometry(docOf(sync), 'TD', measure);
		await sync.execute(moveElements([{ id, x: geo[id].x + dx, y: geo[id].y }], geo));
		return geo;
	};

	it('(a) Position des zweiten speichern: Editor-ID im Code und in den Meta-Positionen', async () => {
		const sync = await open(TWO + META);
		const geo = await drag(sync, 'subGraph1');
		const { code } = get(sync);
		const id = /subgraph (c\d+) \[Zweite Gruppe\]/.exec(code)?.[1];
		expect(id).toBeDefined();
		expect(body(code)).toBe(
			TWO.replace('subgraph Zweite Gruppe', `subgraph ${id} [Zweite Gruppe]`)
		);
		const { layout, containers } = docOf(sync);
		expect(containers.map((c) => c.id)).toEqual(['subGraph0', id]);
		expect(layout.positions[id!].slice(0, 2)).toEqual([geo.subGraph1.x + 30, geo.subGraph1.y]);
		expect(layout.positions).not.toHaveProperty('subGraph1');
		expect(code).toContain(`"${id}":[`);
		// (e) Knoten-Positionen behalten ihre ID.
		expect(layout.positions.B.slice(0, 2)).toEqual([geo.B.x + 30, geo.B.y]);
		expect(docOf(sync).nodes.find((n) => n.id === 'B')!.parentId).toBe(id);
	});

	it('(b) danach Code-seitig unbenannten Subgraph davor einfügen: Position bleibt am Container', async () => {
		const sync = await open(TWO + META);
		await drag(sync, 'subGraph1');
		const saved = get(sync).code;
		const id = /subgraph (c\d+) /.exec(saved)![1];
		const pos = docOf(sync).layout.positions[id];
		sync.editCode(
			saved.replace(
				`    subgraph ${id}`,
				`    subgraph Dritte Gruppe\n        C\n    end\n    subgraph ${id}`
			)
		);
		await sync.flush();
		const doc = docOf(sync);
		expect(doc.containers.map((c) => [c.id, c.label])).toEqual([
			['subGraph0', 'Erste Gruppe'],
			['subGraph1', 'Dritte Gruppe'],
			[id, 'Zweite Gruppe']
		]);
		expect(doc.layout.positions[id]).toEqual(pos);
		expect(doc.layout.positions).not.toHaveProperty('subGraph1');
	});

	it('(c) ein Undo-Schritt stellt Code und Positionen wieder her', async () => {
		const sync = await open(TWO + META);
		await drag(sync, 'subGraph1');
		expect(get(sync.commands).canUndo).toBe(true);
		await sync.undo();
		expect(get(sync).code).toBe(TWO + META);
		expect(docOf(sync).containers.map((c) => c.id)).toEqual(['subGraph0', 'subGraph1']);
		expect(docOf(sync).layout.positions).toEqual({});
		expect(get(sync.commands).canUndo).toBe(false);
		await sync.redo();
		expect(get(sync).code).toMatch(/subgraph c\d+ \[Zweite Gruppe\]/);
	});

	it('Auto-Layout einfrieren speichert alle Rahmen: alle unbenannten erhalten eine Editor-ID', async () => {
		const sync = await open(TWO);
		await drag(sync, 'A');
		const doc = docOf(sync);
		expect(doc.layout.mode).toBe('manual');
		expect(doc.containers.every((c) => /^c\d+$/.test(c.id))).toBe(true);
		expect(doc.containers.map((c) => c.label)).toEqual(['Erste Gruppe', 'Zweite Gruppe']);
		for (const c of doc.containers) expect(doc.layout.positions).toHaveProperty(c.id);
		expect(body(get(sync).code)).toMatch(
			/subgraph c\d+ \[Erste Gruppe\][\s\S]*subgraph c\d+ \[Zweite Gruppe\]/
		);
	});

	it('Kante und Container-ID-Knoten folgen der Umbenennung', async () => {
		const sync = await open(TWO + '    subGraph1 --> A\n' + META);
		await drag(sync, 'subGraph1');
		const doc = docOf(sync);
		const id = doc.containers[1].id;
		expect(doc.edges.map((e) => [e.sourceId, e.targetId])).toEqual([[id, 'A']]);
		expect(doc.nodes.some((n) => n.id === 'subGraph1')).toBe(false);
		expect(body(get(sync).code)).toContain(`    ${id} --> A\n`);
	});

	it('(d) explizite ID-Texte und Nicht-Auto-IDs bleiben', async () => {
		const text =
			'flowchart TD\n    subgraph subGraph0 [Erste]\n        A\n    end\n    subgraph S1 [Gruppe]\n        B\n    end\n';
		const sync = await open(text + META);
		await drag(sync, 'subGraph0');
		await drag(sync, 'S1');
		expect(docOf(sync).containers.map((c) => c.id)).toEqual(['subGraph0', 'S1']);
		expect(body(get(sync).code)).toBe(text);
	});

	// T111 C3 I3 (O-111 (3)): ganzer Code-Body, kein Zusatz `c<N>[subGraph<N>]`.
	it('Kante am Container: Code-Body ohne Zusatzzeile', async () => {
		const text = 'flowchart TD\n    subgraph Zwei Worte\n        A\n    end\n    subGraph0 --> A\n';
		const sync = await open(text + META);
		await drag(sync, 'subGraph0');
		const id = docOf(sync).containers[0].id;
		expect(id).toMatch(/^c\d+$/);
		expect(body(get(sync).code)).toBe(
			`flowchart TD\n    subgraph ${id} [Zwei Worte]\n        A\n    end\n    ${id} --> A\n`
		);
	});

	it('verschachtelt, Richtung, Kanten, CRLF: Code-Body ohne Zusatzzeilen', async () => {
		const text = [
			'flowchart TD',
			'    subgraph Aussen Box',
			'        direction LR',
			'        subgraph Innen Box',
			'            A --> B',
			'        end',
			'        C',
			'    end',
			'    subGraph1 --> D',
			'    subGraph0 --> C',
			''
		].join('\r\n');
		const sync = await open(text + META.replace('\n', '\r\n'));
		await drag(sync, 'subGraph1');
		const label = (l: string) => docOf(sync).containers.find((c) => c.label === l)!.id;
		const [o, i] = [label('Aussen Box'), label('Innen Box')];
		expect([o, i].every((x) => /^c\d+$/.test(x))).toBe(true);
		expect(body(get(sync).code)).toBe(
			text
				.replace('subgraph Aussen Box', `subgraph ${o} [Aussen Box]`)
				.replace('subgraph Innen Box', `subgraph ${i} [Innen Box]`)
				.replace('subGraph1 --> D', `${o} --> D`)
				.replace('subGraph0 --> C', `${i} --> C`)
		);
	});

	// T111 C3 I3 (O-111 (2)): style/class/click-Zeilen folgen der Umbenennung.
	it('style/class/click am Container folgen, classDef und Teiltreffer bleiben', async () => {
		const extra =
			'    style subGraph1 fill:#f00\n    class subGraph1 foo\n    click subGraph1 cb\n' +
			'    classDef foo stroke:#00f\n';
		const sync = await open(TWO + extra + META);
		await drag(sync, 'subGraph1');
		const id = docOf(sync).containers[1].id;
		expect(id).toMatch(/^c\d+$/);
		expect(body(get(sync).code)).toBe(
			TWO.replace('subgraph Zweite Gruppe', `subgraph ${id} [Zweite Gruppe]`) +
				extra.replaceAll('subGraph1', id)
		);
	});

	it('Teiltreffer `subGraph10` ist keine Nennung von `subGraph1`', async () => {
		const groups = Array.from(
			{ length: 11 },
			(_, k) => `    subgraph Gruppe ${k}\n        N${k}\n    end\n`
		).join('');
		const text = `flowchart TD\n${groups}    style subGraph10 fill:#0f0\n`;
		const sync = await open(text + META);
		await drag(sync, 'subGraph1');
		const id = docOf(sync).containers[1].id;
		expect(id).toMatch(/^c\d+$/);
		expect(body(get(sync).code)).toBe(
			text.replace('subgraph Gruppe 1\n', `subgraph ${id} [Gruppe 1]\n`)
		);
	});

	// T111 C3 I3 (O-111 (1)): nur Container, deren Position dieses Command schreibt.
	it('aus Meta geladene Container-Position: createNode/duplicateNodes/Knoten-Drag benennen nicht um', () => {
		const loaded: DiagramDocument = {
			...parseOk(TWO),
			layout: {
				mode: 'manual',
				engine: 'dagre',
				positions: { subGraph1: [10, 10, 100, 80], B: [20, 30, 80, 42] },
				gridSize: 10,
				snap: false
			}
		};
		const geo = computeGeometry(loaded, 'TD', measure);
		const ids = (d: DiagramDocument) => d.containers.map((c) => c.id);
		for (const cmd of [
			createNode({ x: 300, y: 300 }),
			duplicateNodes(['A'], geo),
			moveElements([{ id: 'B', x: geo.B.x + 5, y: geo.B.y }], geo)
		]) {
			const d = run(loaded, cmd);
			expect(ids(d)).toEqual(['subGraph0', 'subGraph1']);
			expect(d.layout.positions.subGraph1).toEqual([10, 10, 100, 80]);
		}
		// Gegenprobe: eigene Container-Position schreiben benennt um.
		const moved = run(loaded, moveElements([{ id: 'subGraph1', x: 99, y: 99 }], geo));
		expect(ids(moved)).toEqual(['subGraph0', 'c101']);
	});
});

describe('Auswahl über Container-Umbenennung (T111 C3 I3, O-111 (5))', () => {
	const box = (id: string, label = id) => ({ id, label });

	it('containerRenames: Index-Vergleich, nur echte Umbenennungen', () => {
		const before = [box('subGraph0'), box('subGraph1'), box('S')];
		expect([...containerRenames(before, [box('c3'), box('subGraph1'), box('c4')])]).toEqual([
			['subGraph0', 'c3'],
			['S', 'c4']
		]);
		expect(containerRenames(before, before).size).toBe(0);
		// Hinzufügen/Entfernen verschiebt Indizes: keine Umbenennung ableiten.
		expect(containerRenames(before, [box('subGraph1'), box('S')]).size).toBe(0);
		expect(containerRenames(before, [...before, box('c9')]).size).toBe(0);
		// Vertauschte Reihenfolge ist keine Umbenennung (alte ID existiert weiter).
		expect(containerRenames(before, [box('subGraph1'), box('subGraph0'), box('S')]).size).toBe(0);
	});

	it('carryRenames: vor dem Resync alte IDs umbenennen, danach Auswahl/Messung übernehmen', () => {
		const m = { width: 120, height: 90 };
		const prev = [
			{ id: 'subGraph1', selected: true, measured: m },
			{ id: 'A', selected: false }
		];
		const renames = new Map([['subGraph1', 'c7']]);
		// Resync noch nicht gelaufen: Liste trägt die alte ID.
		expect(carryRenames(prev, prev, renames)).toEqual([
			{ id: 'c7', selected: true, measured: m },
			{ id: 'A', selected: false }
		]);
		// Resync schon gelaufen: neue ID ohne Auswahl/Messung.
		const fresh = [{ id: 'c7' }, { id: 'A', selected: false }];
		expect(carryRenames(fresh, prev, renames)).toEqual([
			{ id: 'c7', selected: true, measured: m },
			{ id: 'A', selected: false }
		]);
		const same = [{ id: 'A' }];
		expect(carryRenames(same, prev, new Map())).toBe(same);
	});
});

// T130 (F-03): Kante per Drag umhängen, ein Undo-Schritt, Attribute bleiben.
describe('reconnectEdge (T130, F-03)', () => {
	const TEXT = [
		'flowchart TD',
		'    A -->|ja| B',
		'    C -.-> D',
		'    E',
		'    linkStyle 0 stroke:#ff0000',
		''
	].join('\n');
	const open = () => createSync(TEXT, { adapters: fakeAdapters });
	const edgeOf = (sync: SyncController, i: number) => get(sync.commands).doc.edges[i];
	const canUndo = (sync: SyncController) => get(sync.commands).canUndo;

	it('Ziel umhängen: Code nennt neues Ziel, Label/Pfeil/linkStyle bleiben, ein Undo-Schritt', async () => {
		const sync = await open();
		const before = edgeOf(sync, 0);
		await sync.execute(reconnectEdge(before.id, 'target', 'E'));
		const { code } = get(sync);
		expect(code).toContain('A -->|ja| E');
		expect(code).not.toContain('A -->|ja| B');
		expect(code).toContain('linkStyle 0 stroke:#ff0000');
		expect(edgeOf(sync, 0)).toMatchObject({
			id: before.id,
			sourceId: 'A',
			targetId: 'E',
			label: before.label,
			lineStyle: before.lineStyle,
			arrowHead: before.arrowHead,
			style: before.style
		});
		// Genau ein Schritt: ein Undo stellt den Ausgangstext her, danach ist nichts mehr rückgängig.
		await sync.undo();
		expect(get(sync).code).toBe(TEXT);
		expect(canUndo(sync)).toBe(false);
	});

	it('Quelle umhängen: Linienstil bleibt', async () => {
		const sync = await open();
		const before = edgeOf(sync, 1);
		await sync.execute(reconnectEdge(before.id, 'source', 'E'));
		expect(get(sync).code).toContain('E -.-> D');
		expect(edgeOf(sync, 1)).toMatchObject({ sourceId: 'E', targetId: 'D', lineStyle: 'dotted' });
		await sync.undo();
		expect(get(sync).code).toBe(TEXT);
		expect(canUndo(sync)).toBe(false);
	});

	it('unveränderter Endpunkt, Selbstkante, unbekannte Kante oder unbekannter Knoten: kein Schritt', async () => {
		const sync = await open();
		const id = edgeOf(sync, 0).id;
		const doc = get(sync.commands).doc;
		expect(run(doc, reconnectEdge(id, 'target', 'B'))).toBe(doc);
		expect(run(doc, reconnectEdge(id, 'target', 'A'))).toBe(doc);
		expect(run(doc, reconnectEdge('fehlt', 'target', 'E'))).toBe(doc);
		expect(run(doc, reconnectEdge(id, 'target', 'fehlt'))).toBe(doc);
		await sync.execute(reconnectEdge(id, 'source', 'A'));
		await sync.execute(reconnectEdge(id, 'source', 'B'));
		expect(canUndo(sync)).toBe(false);
		expect(get(sync).code).toBe(TEXT);
	});

	it('Kante an Subgraph umhängen', async () => {
		const sync = await open();
		await sync.editCode(TEXT + '    subgraph S [Gruppe]\n        F\n    end\n');
		await sync.flush();
		const id = edgeOf(sync, 0).id;
		await sync.execute(reconnectEdge(id, 'target', 'S'));
		expect(edgeOf(sync, 0)).toMatchObject({ sourceId: 'A', targetId: 'S' });
		expect(get(sync).code).toContain('A -->|ja| S');
	});
});
