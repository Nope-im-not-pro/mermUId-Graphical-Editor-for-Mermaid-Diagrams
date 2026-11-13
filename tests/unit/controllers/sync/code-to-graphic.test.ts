import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBOUNCE_MS, createSync, type SyncTimer } from '../../../../src/lib/controllers/sync';
import type { ParseError } from '../../../../src/lib/model/types';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import { addNode } from '../../../../src/lib/model/operations';
import { node } from '../../model/fixtures';
import { fakeAdapters, rename } from './helpers';

const START = 'flowchart LR\n  A --> B\n';
const NEXT = 'flowchart LR\n  A --> B --> C\n';
const open = (text = START) => createSync(text, { adapters: fakeAdapters });
const labels = (sync: Awaited<ReturnType<typeof open>>) =>
	get(sync.commands).doc.nodes.map((n) => n.label);

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('Code -> Grafik (C2)', () => {
	it('parst debounced nach 500 ms und ersetzt das Modell als eine Undo-Transaktion', async () => {
		expect(DEBOUNCE_MS).toBe(500);
		const sync = await open();
		sync.editCode(NEXT);
		expect(get(sync)).toMatchObject({ code: NEXT, codeVersion: 1, pending: true });
		await vi.advanceTimersByTimeAsync(499);
		expect(labels(sync)).toEqual(['A', 'B']);
		await vi.advanceTimersByTimeAsync(1);
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		expect(get(sync)).toMatchObject({ code: NEXT, pending: false, modelVersion: 1 });
		await sync.undo();
		expect(labels(sync)).toEqual(['A', 'B']);
		expect(get(sync).code).toBe(START);
		await sync.redo();
		expect(get(sync).code).toBe(NEXT);
	});

	it('eine Tippfolge im Debounce-Fenster ergibt genau einen Undo-Schritt (D-09)', async () => {
		const sync = await open();
		sync.editCode('flowchart LR\n  A --> B -');
		await vi.advanceTimersByTimeAsync(300);
		sync.editCode('flowchart LR\n  A --> B --> ');
		await vi.advanceTimersByTimeAsync(300);
		sync.editCode(NEXT);
		await vi.advanceTimersByTimeAsync(500);
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		await sync.undo();
		expect(get(sync).code).toBe(START);
		expect(get(sync.commands).canUndo).toBe(false);
	});

	it('unveränderter Text (Tippen und Zurücknehmen) erzeugt keinen Schritt', async () => {
		const sync = await open();
		sync.editCode(NEXT);
		sync.editCode(START);
		sync.editCode(START);
		await vi.advanceTimersByTimeAsync(500);
		expect(get(sync.commands).canUndo).toBe(false);
		expect(get(sync)).toMatchObject({ pending: false, modelVersion: 0 });
	});

	it('Flush: ausstehender Code-Edit wird vor dem Grafik-Command angewendet (§6.1)', async () => {
		const sync = await open();
		sync.editCode(NEXT);
		await sync.execute(rename('C', 'Neu'));
		expect(labels(sync)).toEqual(['A', 'B', 'Neu']);
		expect(get(sync).code).toContain('B --> C');
		expect(get(sync).code).toContain('Neu');
		await sync.undo();
		expect(get(sync).code).toBe(NEXT);
		await sync.undo();
		expect(get(sync).code).toBe(START);
		await vi.advanceTimersByTimeAsync(1000);
		expect(get(sync).code).toBe(START);
	});

	it('Code-Edit im selben Tick nach einem Grafik-Command wird nicht überschrieben', async () => {
		const sync = await open();
		const pending = sync.execute(rename('A', 'Neu'));
		sync.editCode(NEXT);
		await pending;
		expect(labels(sync)).toEqual(['Neu', 'B', 'C']);
		expect(get(sync).code).toContain('B --> C');
		expect(get(sync)).toMatchObject({ pending: false });
		const after = get(sync).code;
		const undo = sync.undo();
		sync.editCode(START);
		await undo;
		expect(get(sync).code).toBe(after);
		expect(labels(sync)).toEqual(['Neu', 'B', 'C']);
	});

	it('ID-Zähler der Metadaten-Zeile im Code gilt nach codeApply als Untergrenze (D-03)', async () => {
		const ids: string[] = [];
		const newNode: Command = {
			label: 'add',
			do: (d, ctx) => {
				const id = ctx.newId('n');
				ids.push(id);
				return addNode(d, node(id, { sourceText: '' }));
			}
		};
		const sync = await open();
		sync.editCode(
			NEXT + '%% @mermuid: {"v":1,"layout":"manual","ids":{"n":5},"pos":{"A":[1,2,0,0]}}\n'
		);
		await sync.flush();
		await sync.execute(newNode);
		expect(ids).toEqual(['n5']);
		await sync.undo();
		await sync.undo();
		await sync.execute(newNode);
		expect(ids).toEqual(['n5', 'n6']);
	});

	it('Flush vor Transaktion, Undo und Redo', async () => {
		const sync = await open();
		sync.editCode(NEXT);
		await sync.transaction('t', [rename('C', 'X')]);
		expect(labels(sync)).toContain('X');
		sync.editCode(START);
		await sync.undo();
		expect(get(sync).code).toContain('X');
		sync.editCode(NEXT);
		await sync.redo();
		expect(get(sync).code).toBe(NEXT);
		await sync.flush();
	});

	it('übernimmt Positionen der Metadaten-Zeile in das Modell', async () => {
		const sync = await open();
		sync.editCode(`${START}%% @mermuid: {"v":1,"layout":"manual","pos":{"B":[7,8]}}\n`);
		await sync.flush();
		expect(get(sync.commands).doc.layout).toMatchObject({
			mode: 'manual',
			positions: { B: [7, 8, 0, 0] }
		});
	});

	it('verwirft veraltete Läufe und plant neu (codeVersion)', async () => {
		let hold = false;
		const waiting: (() => void)[] = [];
		const validate = (): Promise<ParseError[]> =>
			hold ? new Promise((resolve) => waiting.push(() => resolve([]))) : Promise.resolve([]);
		const sync = await createSync(START, {
			adapters: { ...fakeAdapters, flowchart: { ...fakeAdapters.flowchart, validate } }
		});
		hold = true;
		sync.editCode('flowchart LR\n  A --> X\n');
		await vi.advanceTimersByTimeAsync(500);
		expect(waiting).toHaveLength(1);
		sync.editCode(NEXT);
		waiting[0]();
		await vi.advanceTimersByTimeAsync(0);
		expect(labels(sync)).toEqual(['A', 'B']);
		expect(get(sync).pending).toBe(true);
		hold = false;
		await vi.advanceTimersByTimeAsync(500);
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		expect(get(sync.commands).canUndo).toBe(true);
		await sync.undo();
		expect(get(sync).code).toBe(START);
	});

	it('Flush wartet auf einen laufenden Parse-Lauf', async () => {
		let release: () => void = () => {};
		let hold = false;
		const validate = (): Promise<ParseError[]> =>
			hold ? new Promise((resolve) => (release = () => resolve([]))) : Promise.resolve([]);
		const sync = await createSync(START, {
			adapters: { ...fakeAdapters, flowchart: { ...fakeAdapters.flowchart, validate } }
		});
		hold = true;
		sync.editCode(NEXT);
		await vi.advanceTimersByTimeAsync(500);
		const done = sync.execute(rename('C', 'Z'));
		hold = false;
		release();
		await done;
		expect(labels(sync)).toEqual(['A', 'B', 'Z']);
	});

	it('nutzt einen injizierten Zeitgeber', async () => {
		const calls: number[] = [];
		const tasks = new Map<number, () => void>();
		let next = 0;
		const timer: SyncTimer = {
			set(fn, ms) {
				calls.push(ms);
				tasks.set(++next, fn);
				return next;
			},
			clear(handle) {
				tasks.delete(handle as number);
			}
		};
		const sync = await createSync(START, { adapters: fakeAdapters, timer });
		sync.editCode('x');
		sync.editCode(NEXT);
		expect(calls).toEqual([500, 500]);
		expect(tasks.size).toBe(1);
		const [id, task] = [...tasks][0];
		tasks.delete(id);
		task();
		await sync.flush();
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		sync.editCode(START);
		sync.dispose();
		expect(tasks.size).toBe(0);
	});

	it('Default-Raster 8 px (KONZEPT §5) für flowchart, sequence und "nur Code"', async () => {
		for (const text of [START, 'sequenceDiagram\n  A->>B: x\n', 'pie\n']) {
			const sync = await open(text);
			expect(get(sync.commands).doc.layout).toMatchObject({ gridSize: 8, snap: false });
		}
	});

	it('Re-Parse übernimmt snap und gridSize aus dem bisherigen Modell, ohne Meta-Zeile', async () => {
		const sync = await open();
		const grid: Command = {
			label: 'grid',
			do: (d) => ({
				...d,
				layout: { ...d.layout, snap: true, gridSize: 16 },
				modelVersion: d.modelVersion + 1
			})
		};
		await sync.execute(grid);
		const after = get(sync).code;
		expect(after).not.toMatch(/snap|grid/i);
		sync.editCode(after.replace('A --> B', 'A --> B --> C'));
		await sync.flush();
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		expect(get(sync.commands).doc.layout).toMatchObject({ snap: true, gridSize: 16 });
		expect(get(sync).code).not.toMatch(/snap|grid/i);
		await sync.undo();
		expect(labels(sync)).toEqual(['A', 'B']);
		expect(get(sync.commands).doc.layout).toMatchObject({ snap: true, gridSize: 16 });
		await sync.undo();
		expect(get(sync.commands).doc.layout).toMatchObject({ snap: false, gridSize: 8 });
		await sync.redo();
		await sync.redo();
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		expect(get(sync.commands).doc.layout).toMatchObject({ snap: true, gridSize: 16 });
	});
});
