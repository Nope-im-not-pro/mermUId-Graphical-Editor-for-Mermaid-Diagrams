import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import { addEdge, updateEdge } from '../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { splitMeta } from '../../../../src/lib/services/meta';
import { fakeAdapters, noop, place, rename } from './helpers';

const fixtures = (type: string) => {
	const dir = join(__dirname, `../../../fixtures/${type}/roundtrip`);
	return readdirSync(dir).map((f) => [`${type}/${f}`, readFileSync(join(dir, f), 'utf8')]);
};
const all = [...fixtures('flowchart'), ...fixtures('sequence')];
const META = '%%  @mermuid: { "v":1, "layout":"manual", "pos":{"A":[1,2]}, "x":true }';

const open = (text: string, embed = true) => createSync(text, { adapters: fakeAdapters, embed });

describe('Grafik -> Code (C1)', () => {
	it.each(all)('%s: Grafik-Command ohne Wirkung ergibt byte-gleichen Text', async (_, text) => {
		const sync = await open(text);
		expect((await sync.diff())?.model).toBe(text);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
		expect(get(sync).codeVersion).toBe(0);
	});

	it('Metadaten-Zeile mit Originalbytes bleibt nach Command ohne Wirkung erhalten', async () => {
		for (const tail of ['\n', '\n\n  \n', '']) {
			const text = `flowchart LR\n  A --> B\n${META}${tail}`;
			const sync = await open(text);
			await sync.execute(noop);
			expect(get(sync).code).toBe(text);
			expect(get(sync.commands).doc.layout.positions.A).toEqual([1, 2, 0, 0]);
		}
	});

	it('CRLF-Text mit Metadaten-Zeile bleibt byte-gleich', async () => {
		const text = `flowchart LR\r\n  A --> B\r\n${META}\r\n`;
		const sync = await open(text);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
	});

	it('serialisiert nach jeder Command-Transaktion und erhöht codeVersion', async () => {
		const sync = await open('flowchart LR\n  A --> B\n');
		await sync.execute(rename('A', 'Neu'));
		const first = get(sync);
		expect(first.code).toContain('Neu');
		expect(first.codeVersion).toBe(1);
		expect(first.modelVersion).toBe(1);
		await sync.transaction('zwei', [rename('A', 'X'), rename('B', 'Y')]);
		expect(get(sync).code).toMatch(/X[\s\S]*Y/);
		expect(get(sync).codeVersion).toBe(2);
		expect(get(sync.commands).canUndo).toBe(true);
	});

	it('neue Positionen erzeugen die Metadaten-Zeile am Ende (D-02)', async () => {
		const sync = await open('flowchart LR\n  A --> B\n');
		await sync.execute(place('A', [10, 20, 0, 0]));
		expect(get(sync).code).toBe(
			'flowchart LR\n  A --> B\n%% @mermuid: {"v":1,"layout":"manual","ids":{"e":2,"c":2},"pos":{"A":[10,20,0,0]}}\n'
		);
	});

	it('Text ohne Zeilenende erhält die Zeile auf eigener Zeile', async () => {
		const sync = await open('flowchart LR\n  A --> B');
		await sync.execute(place('B', [1, 1, 0, 0]));
		expect(get(sync).code).toMatch(/A --> B\n%% @mermuid: .*"B":\[1,1,0,0\].*}$/);
	});

	it('geänderte Positionen ersetzen die Zeile, unbekannte Schlüssel bleiben', async () => {
		const sync = await open(`flowchart LR\n  A --> B\n${META}\n`);
		await sync.execute(place('A', [5, 5, 0, 0]));
		expect(get(sync).code).toBe(
			'flowchart LR\n  A --> B\n%% @mermuid: {"v":1,"layout":"manual","ids":{"e":2,"c":2},"pos":{"A":[5,5,0,0]},"x":true}\n'
		);
	});

	it('Schalter "Layout einbetten" aus: keine Metadaten-Zeile', async () => {
		const sync = await open('flowchart LR\n  A --> B\n', false);
		await sync.execute(place('A', [10, 20, 0, 0]));
		expect(get(sync).code).toBe('flowchart LR\n  A --> B\n');
	});

	it('defekte Metadaten-Zeile warnt statt abzubrechen und bleibt byte-gleich', async () => {
		const text = 'flowchart LR\n  A --> B\n%% @mermuid: {kaputt\n';
		const sync = await open(text);
		expect(get(sync).errors).toEqual([]);
		expect(get(sync).warnings.length).toBeGreaterThan(0);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
	});

	it('Undo und Redo stellen Modell und Code-Text wieder her', async () => {
		const text = 'flowchart LR\n  A --> B\n';
		const sync = await open(text);
		await sync.execute(rename('A', 'Neu'));
		const changed = get(sync).code;
		await sync.undo();
		expect(get(sync).code).toBe(text);
		expect(get(sync.commands).doc.nodes[0].label).toBe('A');
		await sync.redo();
		expect(get(sync).code).toBe(changed);
		await sync.redo();
		await sync.undo();
		await sync.undo();
		await sync.undo();
		expect(get(sync).code).toBe(text);
	});

	it('fehlschlagender Command ändert weder Modell noch Code', async () => {
		const text = 'flowchart LR\n  A --> B\n';
		const sync = await open(text);
		await expect(sync.execute(rename('Z', 'x'))).rejects.toThrow(/Z/);
		expect(get(sync).code).toBe(text);
		expect(get(sync).modelVersion).toBe(0);
	});

	it('stellt die Richtung über getDirection bereit (O-19)', async () => {
		expect(get(await open('flowchart LR\n  A --> B\n')).direction).toBe('LR');
		expect(get(await open('graph TD\n  A\n')).direction).toBe('TD');
		expect(get(await open('sequenceDiagram\n  A->>B: x\n')).direction).toBe('');
	});
});

describe('Body-Wiederverwendung bei reiner Layout-Änderung (T113 C3, V-29)', () => {
	/** Adapter-Attrappe, die `serialize`-Aufrufe zählt (echter Serializer dahinter). */
	function counting() {
		const calls = { n: 0 };
		const adapter = {
			...flowchartAdapter,
			serialize: (doc: DiagramDocument) => (calls.n++, flowchartAdapter.serialize(doc))
		};
		const adapters = { ...fakeAdapters, flowchart: { ...fakeAdapters.flowchart, adapter } };
		return { calls, open: (text: string) => createSync(text, { adapters }) };
	}

	const texts = [
		['LF', 'flowchart LR\n  A --> B\n'],
		['CRLF', 'flowchart LR\r\n  A --> B\r\n'],
		['ohne Zeilenende', 'flowchart LR\n  A --> B'],
		['CRLF ohne Zeilenende', 'flowchart LR\r\n  A --> B'],
		['CRLF mit Meta', `flowchart LR\r\n  A --> B\r\n${META}\r\n`]
	];

	it.each(texts)(
		'%s: weitere Positionsänderungen rufen serialize 0-mal, byte-gleich',
		async (_, text) => {
			const { calls, open: openCounting } = counting();
			const sync = await openCounting(text);
			await sync.execute(place('A', [10, 20, 0, 0]));
			const first = get(sync).code;
			calls.n = 0;
			await sync.execute(place('B', [30, 40, 0, 0]));
			await sync.execute(place('A', [11, 21, 0, 0]));
			expect(calls.n).toBe(0);
			const code = get(sync).code;
			expect(code).not.toBe(first);
			// Referenz ohne Wiederverwendung: beide Positionen in einem Command ab dem Ladezustand.
			const ref = await open(text);
			await ref.transaction('ref', [place('B', [30, 40, 0, 0]), place('A', [11, 21, 0, 0])]);
			expect(code).toBe(get(ref).code);
			expect(splitMeta(code).body).toBe(splitMeta(first).body);
			expect((await sync.diff())?.model).toBe(code);
		}
	);

	it('inhaltliche Änderung nach Layout-Änderung serialisiert neu; Undo bleibt byte-gleich', async () => {
		const { calls, open: openCounting } = counting();
		const text = 'flowchart LR\r\n  A --> B';
		const sync = await openCounting(text);
		await sync.execute(place('A', [1, 2, 0, 0]));
		const placed = get(sync).code;
		calls.n = 0;
		await sync.execute(rename('A', 'Neu'));
		expect(calls.n).toBeGreaterThan(0);
		expect(get(sync).code).toContain('Neu');
		await sync.undo();
		expect(get(sync).code).toBe(placed);
		calls.n = 0;
		await sync.execute(place('B', [3, 4, 0, 0]));
		expect(calls.n).toBe(0);
		expect(get(sync).code).not.toContain('Neu');
	});

	/** Commands, die `nodes` (Cache-Schlüssel) behalten und nur andere Body-Felder ändern. */
	const sameNodes: [string, Command, string][] = [
		[
			'addEdge',
			{
				label: 'edge',
				do: (d) =>
					addEdge(d, {
						...d.edges[0],
						id: 'e9',
						sourceId: 'B',
						targetId: 'A',
						label: '',
						sourceText: ''
					})
			},
			'B --> A'
		],
		[
			'Kanten-Label (nur edges)',
			{ label: 'edge-label', do: (d) => updateEdge(d, d.edges[0].id, { label: 'neu' }) },
			'|neu|'
		],
		[
			'Kommentar',
			{
				label: 'comment',
				do: (d) => ({
					...d,
					comments: d.comments.map((c) => ({ ...c, text: '%% neu' })),
					modelVersion: d.modelVersion + 1
				})
			},
			'%% neu'
		],
		[
			'Header',
			{
				label: 'header',
				do: (d) => ({
					...d,
					header: { ...d.header, directives: ["%%{init: {'theme':'dark'}}%%"] },
					modelVersion: d.modelVersion + 1
				})
			},
			"%%{init: {'theme':'dark'}}%%"
		]
	];

	it.each(sameNodes)(
		'%s nach Positionsänderung (gleiches nodes-Array): Cache verfehlt, Body neu',
		async (_, command, expected) => {
			const { calls, open: openCounting } = counting();
			const sync = await openCounting('flowchart LR\n  %% alt\n  A --> B\n');
			await sync.execute(place('A', [1, 2, 0, 0]));
			await sync.execute(place('B', [3, 4, 0, 0]));
			const nodes = get(sync.commands).doc.nodes;
			calls.n = 0;
			await sync.execute(command);
			expect(get(sync.commands).doc.nodes).toBe(nodes);
			expect(calls.n).toBeGreaterThan(0);
			expect(splitMeta(get(sync).code).body).toContain(expected);
			expect((await sync.diff())?.model).toBe(get(sync).code);
		}
	);
});
