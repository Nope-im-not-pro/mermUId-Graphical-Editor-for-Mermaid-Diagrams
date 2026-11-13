import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import { createSync } from '../../../../src/lib/controllers/sync';
import { addNode } from '../../../../src/lib/model/operations';
import { msg } from '../../../../src/lib/services/i18n';
import { node } from '../../model/fixtures';
import { fakeAdapters, noop, place, rename } from './helpers';

// V-08 / D2 Synthese C / O-45: `%% @mermuid`-Zeile an beliebiger Stelle.
const M1 = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,1]}}';
const M2 = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[10,20]}}';
const MID = `flowchart LR\n  A --> B\n${M2}\n  B --> C\n`;

const open = (text: string) => createSync(text, { adapters: fakeAdapters });
const metaLines = (code: string) => code.split('\n').filter((l) => l.includes('@mermuid'));
const addOne: Command = { label: 'add', do: (d, ctx) => addNode(d, node(ctx.newId('n'))) };
const DUP = msg('sync.metaDuplicate');

/** Genau eine `@mermuid`-Zeile, und zwar als letzte Zeile; davor `body`. */
function expectOneAtEnd(code: string, body: string) {
	expect(metaLines(code)).toHaveLength(1);
	expect(code.startsWith(body)).toBe(true);
	expect(code.slice(body.length)).toMatch(/^%% @mermuid: \{[^\n]*\}\n$/);
}

describe('Positionszeile mitten in der Datei (V-08, O-45)', () => {
	it('Positionen werden gelesen, keine Warnung', async () => {
		const sync = await open(MID);
		const { layout } = get(sync.commands).doc;
		expect(layout.mode).toBe('manual');
		expect(layout.positions.A).toEqual([10, 20, 0, 0]);
		expect(get(sync).warnings).toEqual([]);
		expect(get(sync).errors).toEqual([]);
	});

	it('Grafik-Command ohne Meta-Änderung: Zeile bleibt an alter Stelle, Bytes gleich (1)', async () => {
		const sync = await open(MID);
		expect((await sync.diff())?.model).toBe(MID);
		await sync.execute(noop);
		expect(get(sync).code).toBe(MID);
		await sync.execute(rename('C', 'Neu'));
		const lines = get(sync).code.split('\n');
		expect(metaLines(get(sync).code)).toEqual([M2]);
		expect(lines[2]).toBe(M2);
		expect(get(sync).code).toContain('Neu');
	});

	it('Positionsänderung: genau eine Zeile am Ende, keine im Body (2)', async () => {
		const sync = await open(MID);
		await sync.execute(place('B', [1, 1, 0, 0]));
		const { code } = get(sync);
		expectOneAtEnd(code, 'flowchart LR\n  A --> B\n  B --> C\n');
		expect(code).toMatch(/"pos":\{"A":\[10,20,0,0\],"B":\[1,1,0,0\]\}/);
		expect(get(sync.commands).doc.comments.some((c) => c.text.includes('@mermuid'))).toBe(false);
	});

	it('jede Meta-Inhaltsänderung verschiebt die Zeile, nicht nur Positionen (3)', async () => {
		const toAuto: Command = {
			label: 'auto',
			do: (d) => ({ ...d, layout: { ...d.layout, mode: 'auto' } })
		};
		const created: Command = {
			label: 'create',
			do: (d, ctx) => {
				const id = ctx.newId('n');
				const doc = addNode(d, node(id));
				const positions = { ...doc.layout.positions, [id]: [3, 4, 0, 0] as const };
				return { ...doc, layout: { ...doc.layout, positions: positions as never } };
			}
		};
		for (const command of [toAuto, created]) {
			const sync = await open(MID);
			await sync.execute(command);
			const { code } = get(sync);
			expect(metaLines(code)).toHaveLength(1);
			expect(code.trimEnd().split('\n').at(-1)).toMatch(/^%% @mermuid: /);
			expect(code.split('\n')[2]).not.toContain('@mermuid');
		}
	});

	it('neuer Knoten ohne Position: Zähler aus dem Modell ableitbar, canon gleich, Zeile bleibt (D-02)', async () => {
		const sync = await open(MID);
		await sync.execute(addOne);
		expect(metaLines(get(sync).code)).toEqual([M2]);
		expect(get(sync).code.split('\n')[2]).toBe(M2);
	});

	it('nach dem Verschieben bleibt es bei einer Zeile am Ende; Undo stellt den Text her', async () => {
		const sync = await open(MID);
		await sync.execute(place('B', [1, 1, 0, 0]));
		const moved = get(sync).code;
		await sync.execute(noop);
		expect(get(sync).code).toBe(moved);
		await sync.execute(rename('C', 'Neu'));
		expectOneAtEnd(get(sync).code, 'flowchart LR\n  A --> B\n  B --> C\n  C[Neu]\n');
		for (let i = 0; i < 3; i++) await sync.undo();
		expect(get(sync).code).toBe(MID);
		expect(get(sync.commands).doc.comments).toHaveLength(1);
		await sync.execute(noop);
		expect(get(sync).code).toBe(MID);
	});

	it('Weitertippen unter der Zeile behält die Positionen (V-08 Befund)', async () => {
		const start = `flowchart LR\n  A --> B\n${M2}\n`;
		const sync = await open(start);
		sync.editCode(start + '  B --> C\n');
		await sync.flush();
		expect(get(sync.commands).doc.layout.positions.A).toEqual([10, 20, 0, 0]);
		expect(get(sync).warnings).toEqual([]);
		await sync.execute(place('C', [5, 5, 0, 0]));
		expectOneAtEnd(get(sync).code, 'flowchart LR\n  A --> B\n  B --> C\n');
		sync.dispose();
	});

	it('Zeile in einem Subgraphen vor `direction`: Reihenfolge bleibt erhalten', async () => {
		const text = `flowchart LR\n  subgraph S\n    ${M2}\n    direction TB\n    A\n  end\n  A --> B\n`;
		const sync = await open(text);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
		await sync.execute(place('B', [1, 1, 0, 0]));
		expectOneAtEnd(
			get(sync).code,
			'flowchart LR\n  subgraph S\n    direction TB\n    A\n  end\n  A --> B\n'
		);
	});

	it('CRLF: Zeile wandert mit CRLF ans Ende', async () => {
		const text = MID.replaceAll('\n', '\r\n');
		const sync = await open(text);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
		await sync.execute(place('B', [1, 1, 0, 0]));
		const { code } = get(sync);
		expect(code.startsWith('flowchart LR\r\n  A --> B\r\n  B --> C\r\n%% @mermuid: ')).toBe(true);
		expect(code.endsWith('}\r\n')).toBe(true);
		expect(code.match(/@mermuid/g)).toHaveLength(1);
	});

	it('sequence: Kommentar-Element wird gleich behandelt', async () => {
		const text = `sequenceDiagram\n  A->>B: hi\n${M2}\n  B->>A: ok\n`;
		const sync = await open(text);
		expect(get(sync.commands).doc.layout.positions.A).toEqual([10, 20, 0, 0]);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
		await sync.execute(place('B', [1, 1, 0, 0]));
		expectOneAtEnd(get(sync).code, 'sequenceDiagram\n  A->>B: hi\n  B->>A: ok\n');
	});
});

describe('mehrere Positionszeilen (O-45)', () => {
	const TWO_END = `flowchart LR\n${M1}\n  A --> B\n${M2}\n`;
	const TWO_MID = `flowchart LR\n${M1}\n  A --> B\n  ${M2}\n  B --> C\n`;

	it.each([TWO_END, TWO_MID])('letzte gilt, Warnung statt Fehler: %j', async (text) => {
		const sync = await open(text);
		expect(get(sync.commands).doc.layout.positions.A).toEqual([10, 20, 0, 0]);
		expect(get(sync).warnings).toEqual([DUP]);
		expect(get(sync).errors).toEqual([]);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
		expect(get(sync).warnings).toEqual([DUP]);
	});

	it('ändernder Schreibvorgang hinterlässt genau eine Zeile am Ende, Warnung entfällt', async () => {
		const sync = await open(TWO_MID);
		await sync.execute(place('B', [1, 1, 0, 0]));
		expectOneAtEnd(get(sync).code, 'flowchart LR\n  A --> B\n  B --> C\n');
		expect(get(sync).code).toMatch(/"A":\[10,20,0,0\]/);
		expect(get(sync).warnings).toEqual([]);
	});

	it('Code-Edit mit zweiter Zeile meldet die Warnung', async () => {
		const start = `flowchart LR\n  A --> B\n${M2}\n`;
		const sync = await open(start);
		sync.editCode(`${start}${M1}\n`);
		await sync.flush();
		expect(get(sync.commands).doc.layout.positions.A).toEqual([1, 1, 0, 0]);
		expect(get(sync).warnings).toEqual([DUP]);
		sync.dispose();
	});
});

describe('Lage aus dem serialisierten Modell (O-45, Konflikt)', () => {
	const END = `flowchart LR\n  A --> B\n${M2}\n`;

	it('Zeile im Code mitten, im Modell am Ende: keepGraphic und diff behalten genau eine Zeile', async () => {
		const sync = await open(END);
		sync.editCode(`flowchart LR\n  A --> B\n${M2}\n  subgraph S\n`);
		await sync.flush();
		expect(get(sync).errors.length).toBeGreaterThan(0);
		await sync.execute(rename('A', 'Neu'));
		expect(get(sync).conflict).toBe(true);
		const model = (await sync.diff())?.model ?? '';
		expect(metaLines(model)).toEqual([M2]);
		expect(model.endsWith(`\n${M2}\n`)).toBe(true);
		expect(model).toContain('Neu');
		await sync.keepGraphic();
		expect(get(sync).code).toBe(model);
		expect(get(sync.commands).doc.layout.positions.A).toEqual([10, 20, 0, 0]);
		sync.dispose();
	});

	it('Zeile im Modell mitten, im ungültigen Code am Ende: keepGraphic ergibt genau eine Zeile', async () => {
		const sync = await open(MID);
		sync.editCode(`flowchart LR\n  A --> B\n  B --> C\n  subgraph S\n${M2}\n`);
		await sync.flush();
		await sync.execute(rename('C', 'Neu'));
		const model = (await sync.diff())?.model ?? '';
		await sync.keepGraphic();
		expect(get(sync).code).toBe(model);
		// Der entfernte Kommentar trug einen Zähler: Inhalt ändert sich, Zeile steht am Ende.
		const { code } = get(sync);
		expect(metaLines(code)).toHaveLength(1);
		expect(code.trimEnd().split('\n').at(-1)).toMatch(/"pos":\{"A":\[10,20,0,0\]\}/);
		expect(code).toContain('Neu');
		sync.dispose();
	});

	it('abweichende Zeile im ungültigen Code: Modell-Kommentar entfällt, eine Zeile am Ende', async () => {
		const sync = await open(MID);
		sync.editCode(`flowchart LR\n  A --> B\n  B --> C\n  subgraph S\n${M1}\n`);
		await sync.flush();
		await sync.execute(rename('C', 'Neu'));
		await sync.keepGraphic();
		const { code } = get(sync);
		expect(metaLines(code)).toHaveLength(1);
		expect(code.trimEnd().split('\n').at(-1)).toMatch(/^%% @mermuid: /);
		expect(get(sync.commands).doc.comments.some((c) => c.text.includes('@mermuid'))).toBe(false);
		sync.dispose();
	});

	it('keepGraphic mit Cleanup: Undo und Redo stellen Text und Modell her', async () => {
		const sync = await open(MID);
		const invalid = `flowchart LR\n  A --> B\n  B --> C\n  subgraph S\n${M1}\n`;
		sync.editCode(invalid);
		await sync.flush();
		await sync.execute(rename('C', 'Neu'));
		await sync.keepGraphic();
		const resolved = get(sync).code;
		await sync.undo();
		expect(get(sync).code).toBe(invalid);
		expect(get(sync).conflict).toBe(true);
		expect(get(sync.commands).doc.comments).toHaveLength(1);
		await sync.redo();
		expect(get(sync).code).toBe(resolved);
		expect(get(sync).conflict).toBe(false);
		expect(get(sync.commands).doc.comments).toHaveLength(0);
		await sync.execute(noop);
		expect(get(sync).code).toBe(resolved);
		sync.dispose();
	});
});

describe('Randfälle (O-45)', () => {
	it('Redo nach Verschieben stellt die Zeile am Ende wieder her', async () => {
		const sync = await open(MID);
		await sync.execute(place('B', [1, 1, 0, 0]));
		const moved = get(sync).code;
		await sync.undo();
		expect(get(sync).code).toBe(MID);
		await sync.redo();
		expect(get(sync).code).toBe(moved);
		expect(get(sync.commands).doc.comments).toHaveLength(0);
		await sync.execute(noop);
		expect(get(sync).code).toBe(moved);
	});

	it('sequence: Leerzeilen vor der Zeile bleiben beim Verschieben erhalten', async () => {
		const text = `sequenceDiagram\n  A->>B: hi\n\n${M2}\n  B->>A: ok\n`;
		const sync = await open(text);
		await sync.execute(place('B', [1, 1, 0, 0]));
		expectOneAtEnd(get(sync).code, 'sequenceDiagram\n  A->>B: hi\n\n  B->>A: ok\n');
		await sync.execute(noop);
		expectOneAtEnd(get(sync).code, 'sequenceDiagram\n  A->>B: hi\n\n  B->>A: ok\n');
	});

	it('flowchart: Leerzeilen vor der Zeile bleiben beim Verschieben erhalten', async () => {
		const text = `flowchart LR\n  A --> B\n\n${M2}\n  B --> C\n`;
		const sync = await open(text);
		await sync.execute(place('B', [1, 1, 0, 0]));
		expectOneAtEnd(get(sync).code, 'flowchart LR\n  A --> B\n\n  B --> C\n');
	});

	it('BOM: byte-gleich an alter Stelle und beim Verschieben erhalten', async () => {
		const text = `\uFEFF${MID}`;
		const sync = await open(text);
		await sync.execute(noop);
		expect(get(sync).code).toBe(text);
		await sync.execute(place('B', [1, 1, 0, 0]));
		expectOneAtEnd(get(sync).code, '\uFEFFflowchart LR\n  A --> B\n  B --> C\n');
	});
});

// T135 C2: `box` ist modelliert (Teilnehmer-Gruppe); `par_over` bleibt RawBlock.
describe('Zeile in einem RawBlock (O-45, D-02)', () => {
	const BLOCK = `  par_over G\n  participant A\n${M2}\n  end\n`;
	const TEXT = `sequenceDiagram\n${BLOCK}  A->>B: hi\n`;

	it('Positionen werden gelesen; Grafik-Command ohne Meta-Änderung bleibt byte-gleich', async () => {
		const sync = await open(TEXT);
		expect(get(sync.commands).doc.layout.positions.A).toEqual([10, 20, 0, 0]);
		await sync.execute(noop);
		expect(get(sync).code).toBe(TEXT);
		expect(get(sync).warnings).toEqual([]);
		expect((await sync.diff())?.model).toBe(TEXT);
	});

	it('Meta-Änderung: RawBlock-Bytes bleiben, die neue (gültige) Zeile steht am Ende', async () => {
		const sync = await open(TEXT);
		await sync.execute(place('B', [1, 1, 0, 0]));
		const { code } = get(sync);
		expect(code.startsWith(`sequenceDiagram\n${BLOCK}  A->>B: hi\n%% @mermuid: `)).toBe(true);
		const lines = metaLines(code);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(M2);
		expect(code.endsWith(`${lines[1]}\n`)).toBe(true);
		expect(lines[1]).toMatch(/"pos":\{"A":\[10,20,0,0\],"B":\[1,1,0,0\]\}/);
		expect(get(sync).warnings).toEqual([DUP]);
		await sync.execute(noop);
		expect(get(sync).code).toBe(code);
		const again = await open(code);
		expect(get(again.commands).doc.layout.positions.B).toEqual([1, 1, 0, 0]);
	});
});

describe('Zeile in einem RawBlock ohne neue Positionen (O-45)', () => {
	const TEXT = `sequenceDiagram\n  par_over G\n  participant A\n${M2}\n  end\n  A->>B: hi\n`;

	it('entfernte Positionen: neutrale Zeile am Ende überdeckt die RawBlock-Zeile', async () => {
		const clear: Command = {
			label: 'clear',
			do: (d) => ({ ...d, layout: { ...d.layout, mode: 'auto', positions: {} } })
		};
		const sync = await open(TEXT);
		await sync.execute(clear);
		const { code } = get(sync);
		expect(code.startsWith(TEXT)).toBe(true);
		expect(code.slice(TEXT.length)).toMatch(
			/^%% @mermuid: \{"v":1,"layout":"auto",[^\n]*"pos":\{\}\}\n$/
		);
		await sync.execute(noop);
		expect(get(sync).code).toBe(code);
		const again = await open(code);
		expect(get(again.commands).doc.layout.positions).toEqual({});
		expect(get(again.commands).doc.layout.mode).toBe('auto');
	});
});

describe('Zeile in einer Teilnehmer-Gruppe (box, T135 C2, O-45)', () => {
	const TEXT = `sequenceDiagram\n  box Aqua G\n  participant A\n${M2}\n  end\n  A->>B: hi\n`;

	it('ohne Meta-Änderung byte-gleich, bei Änderung wie in jedem modellierten Block: eine Zeile am Ende', async () => {
		const sync = await open(TEXT);
		expect(get(sync.commands).doc.layout.positions.A).toEqual([10, 20, 0, 0]);
		await sync.execute(noop);
		expect(get(sync).code).toBe(TEXT);
		await sync.execute(place('B', [1, 1, 0, 0]));
		expectOneAtEnd(
			get(sync).code,
			'sequenceDiagram\n  box Aqua G\n  participant A\n  end\n  A->>B: hi\n'
		);
		expect(get(sync).warnings).toEqual([]);
	});
});
