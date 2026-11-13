import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import { createSync } from '../../../../src/lib/controllers/sync';
import type { ParseError } from '../../../../src/lib/model/types';
import { BAD, fakeAdapters, place, rename } from './helpers';

const VALID = 'flowchart LR\n  A --> B\n';
const INVALID = `flowchart LR\n  A --> B\n${BAD}\n`;
const FIXED = 'flowchart LR\n  A --> B --> C\n';

async function inConflict() {
	const sync = await createSync(VALID, { adapters: fakeAdapters });
	sync.editCode(INVALID);
	await sync.flush();
	return sync;
}
const labels = (sync: Awaited<ReturnType<typeof inConflict>>) =>
	get(sync.commands).doc.nodes.map((n) => n.label);

describe('Konfliktfall (C3)', () => {
	it('ungültiger Code: letztes gültiges Modell bleibt, Fehler mit Zeile, kein Konflikt', async () => {
		const sync = await inConflict();
		expect(get(sync)).toMatchObject({
			code: INVALID,
			conflict: false,
			errors: [{ line: 3, column: 1 }]
		});
		expect(labels(sync)).toEqual(['A', 'B']);
	});

	it('Fehler ohne Grafik-Änderung: wieder gültiger Code wird ohne Wahl übernommen (D1)', async () => {
		const sync = await inConflict();
		sync.editCode(FIXED);
		await sync.flush();
		expect(get(sync)).toMatchObject({ code: FIXED, conflict: false, errors: [] });
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		await sync.execute(rename('C', 'Z'));
		expect(get(sync).code).toContain('Z');
	});

	it('Grafik-Command bei ungültigem Code setzt den Konflikt (D1)', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: true });
		await sync.undo();
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: false });
	});

	it('Parser-Fehler des Adapters gelten ebenso als Syntaxfehler', async () => {
		const sync = await createSync(VALID, { adapters: fakeAdapters });
		const text = 'flowchart LR\n  subgraph S\n  A\n';
		sync.editCode(text);
		await sync.flush();
		expect(get(sync)).toMatchObject({ code: text, conflict: false, errors: [{ line: 2 }] });
	});

	it('abgelehnte Validierung wird als Syntaxfehler gemeldet', async () => {
		const validate = (): Promise<ParseError[]> => Promise.reject(new Error('kaputt'));
		const sync = await createSync(VALID, {
			adapters: { ...fakeAdapters, flowchart: { ...fakeAdapters.flowchart, validate } }
		});
		expect(get(sync).errors).toEqual([{ line: 1, column: 1, message: 'kaputt' }]);
		const other = await createSync('sequenceDiagram\n  A->>B: x\n', {
			adapters: {
				...fakeAdapters,
				sequence: { ...fakeAdapters.sequence, validate: () => Promise.reject('x') }
			}
		});
		expect(get(other).errors[0].message).toBe('x');
	});

	it('Grafik-Commands wirken trotz Syntaxfehler, Code-Text bleibt (Fehlerklassen)', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		expect(labels(sync)).toEqual(['Neu', 'B']);
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: true });
		await sync.undo();
		expect(labels(sync)).toEqual(['A', 'B']);
		expect(get(sync).code).toBe(INVALID);
	});

	it('Banner bleibt bis zur Wahl, auch wenn der Code wieder gültig wird', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		sync.editCode(FIXED);
		await sync.flush();
		expect(get(sync)).toMatchObject({ code: FIXED, conflict: true, errors: [] });
		expect(labels(sync)).toEqual(['Neu', 'B']);
		await sync.execute(rename('B', 'Auch'));
		expect(get(sync).code).toBe(FIXED);
	});

	it('"Grafik behalten": Code aus dem Modell, ungültiger Text als Undo-Schritt', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		await sync.keepGraphic();
		const state = get(sync);
		expect(state).toMatchObject({ conflict: false, errors: [] });
		expect(state.code).toContain('Neu');
		expect(state.code).not.toContain(BAD);
		await sync.undo();
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: true });
		await sync.redo();
		expect(get(sync).code).toBe(state.code);
		await sync.execute(rename('B', 'Weiter'));
		expect(get(sync).code).toContain('Weiter');
	});

	it('"Code behalten" bei ungültigem Code verwirft Grafik-Änderungen seit letztem gültigen Stand', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		await sync.execute(place('B', [1, 1, 0, 0]));
		await sync.keepCode();
		expect(labels(sync)).toEqual(['A', 'B']);
		expect(get(sync.commands).doc.layout.positions).toEqual({});
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: false });
		expect(get(sync).errors).toHaveLength(1);
		await sync.undo();
		expect(labels(sync)).toEqual(['Neu', 'B']);
		expect(get(sync.commands).doc.layout.positions).toEqual({ B: [1, 1, 0, 0] });
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: true });
	});

	it('"Code behalten" bei wieder gültigem Code übernimmt den Code, kein Drei-Wege-Merge', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		sync.editCode(FIXED);
		await sync.keepCode();
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
		expect(get(sync)).toMatchObject({ code: FIXED, conflict: false });
		await sync.execute(rename('C', 'Z'));
		expect(get(sync).code).toContain('Z');
	});

	it('"Code behalten" erhält im Konflikt geändertes Raster (snap, gridSize)', async () => {
		const grid: Command = {
			label: 'grid',
			do: (d) => ({
				...d,
				layout: { ...d.layout, snap: true, gridSize: 16 },
				modelVersion: d.modelVersion + 1
			})
		};
		const invalid = await inConflict();
		await invalid.execute(grid);
		await invalid.keepCode();
		expect(get(invalid.commands).doc.layout).toMatchObject({ snap: true, gridSize: 16 });
		const fixed = await inConflict();
		await fixed.execute(grid);
		expect(get(fixed).conflict).toBe(true);
		fixed.editCode(FIXED);
		await fixed.flush();
		await fixed.keepCode();
		expect(get(fixed).conflict).toBe(false);
		expect(labels(fixed)).toEqual(['A', 'B', 'C']);
		expect(get(fixed.commands).doc.layout).toMatchObject({ snap: true, gridSize: 16 });
	});

	it('Grafik-Command nach "Code behalten" mit weiter ungültigem Code setzt erneut den Konflikt', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Alt'));
		expect(get(sync).conflict).toBe(true);
		await sync.keepCode();
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: false });
		await sync.execute(rename('A', 'Neu'));
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: true });
	});

	it('"Diff" stellt Code-Text und Modell-Text bereit', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		const diff = await sync.diff();
		expect(diff?.code).toBe(INVALID);
		expect(diff?.model).toContain('Neu');
	});

	it('Wahl ohne Konflikt ändert nichts', async () => {
		const sync = await createSync(VALID, { adapters: fakeAdapters });
		await sync.keepGraphic();
		await sync.keepCode();
		expect(get(sync.commands).canUndo).toBe(false);
		expect(get(sync).code).toBe(VALID);
	});

	it('gültiger Code anderen Typs im Konflikt ändert den Modell-Modus erst mit "Code behalten"', async () => {
		const sequence = 'sequenceDiagram\n  X->>Y: hallo\n';
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		sync.editCode(sequence);
		await sync.flush();
		expect(get(sync)).toMatchObject({ mode: 'flowchart', direction: 'LR', conflict: true });
		expect((await sync.diff())?.model).toBe('flowchart LR\n  A --> B\n  A[Neu]\n');
		await sync.keepGraphic();
		expect(get(sync).code).toMatch(/^flowchart LR\n/);
		expect(get(sync).code).toContain('Neu');
		expect(get(sync).code).not.toContain('sequenceDiagram');
		await sync.undo();
		expect(get(sync)).toMatchObject({ code: sequence, mode: 'flowchart', conflict: true });
		await sync.keepCode();
		expect(get(sync)).toMatchObject({ code: sequence, mode: 'sequence', conflict: false });
		expect(labels(sync)).toEqual(['X', 'Y']);
		await sync.execute(rename('X', 'Z'));
		expect(get(sync).code).toMatch(/^sequenceDiagram\n/);
	});

	it('ungültiger Code anderen Typs: Modell-Modus bleibt, "Grafik behalten" nutzt ihn', async () => {
		const sync = await createSync(VALID, { adapters: fakeAdapters });
		sync.editCode(`sequenceDiagram\n${BAD}\n`);
		await sync.flush();
		expect(get(sync)).toMatchObject({ mode: 'flowchart', direction: 'LR', conflict: false });
		await sync.execute(rename('A', 'Neu'));
		expect(get(sync)).toMatchObject({ mode: 'flowchart', conflict: true });
		await sync.keepGraphic();
		expect(get(sync).code).toBe('flowchart LR\n  A --> B\n  A[Neu]\n');
	});

	it('Fehler aus "nur Code" übernimmt den Modus des Modells, kein Konflikt', async () => {
		const sync = await createSync(VALID, { adapters: fakeAdapters });
		sync.editCode('pie\n  "a": 1\n');
		await sync.flush();
		sync.editCode(`sequenceDiagram\n${BAD}\n`);
		await sync.flush();
		expect(get(sync)).toMatchObject({ mode: 'flowchart', conflict: false });
		const open = await createSync('pie\n', { adapters: fakeAdapters });
		open.editCode(INVALID);
		await open.flush();
		expect(get(open)).toMatchObject({ mode: 'flowchart', conflict: false });
	});

	it('Text "nur Code" im Konflikt hebt den Konflikt nicht auf; Auflösung nur per Wahl', async () => {
		const sync = await inConflict();
		await sync.execute(rename('A', 'Neu'));
		sync.editCode('');
		await sync.flush();
		expect(get(sync)).toMatchObject({ code: '', mode: 'flowchart', conflict: true, errors: [] });
		sync.editCode(FIXED);
		await sync.flush();
		expect(get(sync)).toMatchObject({ code: FIXED, conflict: true });
		expect(labels(sync)).toEqual(['Neu', 'B']);
		sync.editCode('');
		await sync.flush();
		await sync.keepGraphic();
		expect(get(sync)).toMatchObject({ conflict: false });
		expect(get(sync).code).toContain('Neu');
		await sync.undo();
		await sync.keepCode();
		expect(get(sync)).toMatchObject({ code: '', mode: 'code', conflict: false });
		expect(labels(sync)).toEqual(['A', 'B']);
	});

	it('ungültiger Text beim Öffnen: leeres Modell, Fehler ohne Konflikt', async () => {
		const sync = await createSync(INVALID, { adapters: fakeAdapters });
		expect(get(sync)).toMatchObject({ mode: 'flowchart', conflict: false });
		expect(get(sync).errors).toHaveLength(1);
		expect(get(sync.commands).doc.nodes).toEqual([]);
		sync.editCode(FIXED);
		await sync.flush();
		expect(get(sync)).toMatchObject({ code: FIXED, conflict: false, errors: [] });
		expect(labels(sync)).toEqual(['A', 'B', 'C']);
	});

	it('Grafik-Command nach ungültigem Öffnen setzt den Konflikt', async () => {
		const sync = await createSync(INVALID, { adapters: fakeAdapters });
		await sync.execute(place('n1', [0, 0, 0, 0]));
		expect(get(sync)).toMatchObject({ code: INVALID, conflict: true });
	});
});

describe('Typ-Erkennung und Modus "nur Code"', () => {
	it('unbekannter Typ: Modus "nur Code" ohne Adapter, keine Grafik-Commands', async () => {
		const text = 'classDiagram\n  A <|-- B\n';
		const sync = await createSync(text, { adapters: fakeAdapters });
		expect(get(sync)).toMatchObject({ mode: 'code', direction: '', conflict: false });
		await expect(sync.execute(rename('A', 'x'))).rejects.toThrow(/nur Code/);
		expect(await sync.diff()).toBeNull();
		expect(get(sync).code).toBe(text);
	});

	it('Wechsel des Typs im Code wählt den Adapter neu', async () => {
		const sync = await createSync(VALID, { adapters: fakeAdapters });
		sync.editCode('pie\n  "a": 1\n');
		await sync.flush();
		expect(get(sync).mode).toBe('code');
		expect(labels(sync)).toEqual(['A', 'B']);
		sync.editCode('sequenceDiagram\n  X->>Y: hallo\n');
		await sync.flush();
		expect(get(sync).mode).toBe('sequence');
		expect(labels(sync)).toEqual(['X', 'Y']);
		await sync.undo();
		expect(get(sync)).toMatchObject({ mode: 'code', code: 'pie\n  "a": 1\n' });
		await sync.undo();
		expect(get(sync)).toMatchObject({ mode: 'flowchart', code: VALID });
	});
});

describe('Strukturelles Teilen im Code-Pfad (T142)', () => {
	const nodeById = (sync: Awaited<ReturnType<typeof inConflict>>, id: string) =>
		get(sync.commands).doc.nodes.find((n) => n.id === id);

	it('Code-Edit übernimmt unveränderte Knoten als dieselben Objekte, Undo stellt sie her', async () => {
		const sync = await createSync(VALID, { adapters: fakeAdapters });
		const before = get(sync.commands).doc;
		sync.editCode('flowchart LR\n  A[Neu] --> B\n');
		await sync.flush();
		expect(nodeById(sync, 'A')!.label).toBe('Neu');
		expect(nodeById(sync, 'B')).toBe(before.nodes.find((n) => n.id === 'B'));
		await sync.undo();
		// Rückfall E: Undo parst neu, wertgleich; unveränderte Knoten bleiben dieselben Objekte.
		expect(get(sync.commands).doc).toStrictEqual(before);
		expect(nodeById(sync, 'B')).toBe(before.nodes.find((n) => n.id === 'B'));
	});

	it('"Code behalten" teilt unveränderte Knoten des Kandidaten mit dem gültigen Stand', async () => {
		const sync = await inConflict();
		const valid = get(sync.commands).doc;
		await sync.execute(rename('A', 'Neu'));
		sync.editCode(FIXED);
		await sync.flush();
		sync.editCode('flowchart LR\n  A --> B --> D\n');
		await sync.flush();
		await sync.keepCode();
		expect(get(sync)).toMatchObject({ conflict: false, errors: [] });
		expect(labels(sync)).toEqual(['A', 'B', 'D']);
		// A weicht vom Store-Stand (umbenannt) ab: neue Hülle, Unterobjekte geteilt.
		expect(nodeById(sync, 'A')).toStrictEqual(valid.nodes.find((n) => n.id === 'A'));
		expect(nodeById(sync, 'A')!.style).toBe(valid.nodes.find((n) => n.id === 'A')!.style);
		expect(nodeById(sync, 'B')).toBe(valid.nodes.find((n) => n.id === 'B'));
	});
});
