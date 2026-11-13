import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { SyncTimer } from '../../../../src/lib/controllers/sync';
import { createSync } from '../../../../src/lib/controllers/sync';
import type { DiagramAdapter } from '../../../../src/lib/model/types';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { fakeAdapters, fakeValidate, rename } from './helpers';

// T142 Rückfall E: Code-Einträge halten kein Modell, Undo/Redo parst den Volltext neu.
const manualTimer: SyncTimer = { set: () => 0, clear: () => {} };
const open = (text: string, adapters = fakeAdapters) =>
	createSync(text, { adapters, timer: manualTimer });

const M = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[10,20],"B":[30,40]}}';
const START = `flowchart LR\n  A[Eins] --> B\n  B --> C\n${M}\n`;

describe('Undo/Redo eines Code-Eintrags parst neu (T142 E)', () => {
	it('Code-Edit -> Undo -> Redo: Text byte-gleich, Modell wertgleich', async () => {
		const sync = await open(START);
		const model0 = structuredClone(get(sync.commands).doc);
		const edited = START.replace('A[Eins]', 'A[Zwei]').replace('B --> C', 'B --> C\n  C --> D');
		sync.editCode(edited);
		await sync.flush();
		const model1 = structuredClone(get(sync.commands).doc);
		expect(model1.nodes.find((n) => n.id === 'A')?.label).toBe('Zwei');

		await sync.undo();
		expect(get(sync).code).toBe(START);
		expect(get(sync.commands).doc).toStrictEqual(model0);
		expect(get(sync).errors).toEqual([]);

		await sync.redo();
		expect(get(sync).code).toBe(edited);
		expect(get(sync.commands).doc).toStrictEqual(model1);
		sync.dispose();
	});

	it('mehrere Code-Schritte und ein Grafik-Schritt dazwischen: Undo/Redo bis zum Anfang und zurück', async () => {
		const sync = await open(START);
		const models = [structuredClone(get(sync.commands).doc)];
		const codes = [get(sync).code];
		const edit = async (text: string) => {
			sync.editCode(text);
			await sync.flush();
		};
		await edit(codes[0].replace('A[Eins]', 'A[Zwei]'));
		models.push(structuredClone(get(sync.commands).doc));
		codes.push(get(sync).code);
		await sync.execute(rename('B', 'Bee'));
		models.push(structuredClone(get(sync.commands).doc));
		codes.push(get(sync).code);
		await edit(get(sync).code.replace('B --> C', 'B --> C\n  C --> E'));
		models.push(structuredClone(get(sync.commands).doc));
		codes.push(get(sync).code);

		for (let i = models.length - 2; i >= 0; i--) {
			await sync.undo();
			expect(get(sync).code).toBe(codes[i]);
			expect(get(sync.commands).doc).toStrictEqual(models[i]);
		}
		for (let i = 1; i < models.length; i++) {
			await sync.redo();
			expect(get(sync).code).toBe(codes[i]);
			expect(get(sync.commands).doc).toStrictEqual(models[i]);
		}
		sync.dispose();
	});

	it('Positionen aus der Metadaten-Zeile kommen nach Undo identisch zurück', async () => {
		const sync = await open(START);
		const positions = structuredClone(get(sync.commands).doc.layout.positions);
		expect(positions.A).toEqual([10, 20, 0, 0]);
		sync.editCode(START.replace('[10,20]', '[99,99]'));
		await sync.flush();
		expect(get(sync.commands).doc.layout.positions.A).toEqual([99, 99, 0, 0]);
		await sync.undo();
		// Wertgleich; Prototyp folgt dem Parse (Meta: prototypfrei), `structuredClone` oben
		// liefert `Object.prototype`.
		expect(get(sync.commands).doc.layout.positions).toEqual(positions);
		expect(get(sync.commands).doc.layout.mode).toBe('manual');
		sync.dispose();
	});

	it('ungültige Zwischenstände: Undo über Fehler- und Gültig-Schritte', async () => {
		const sync = await open(START);
		const model0 = structuredClone(get(sync.commands).doc);
		sync.editCode(`${START}%%FEHLER\n`);
		await sync.flush();
		expect(get(sync).errors).not.toEqual([]);
		const valid = START.replace('A[Eins]', 'A[Drei]');
		sync.editCode(valid);
		await sync.flush();
		const model2 = structuredClone(get(sync.commands).doc);
		await sync.undo();
		expect(get(sync).errors).not.toEqual([]);
		expect(get(sync.commands).doc).toStrictEqual(model0);
		await sync.undo();
		expect(get(sync).code).toBe(START);
		expect(get(sync).errors).toEqual([]);
		expect(get(sync.commands).doc).toStrictEqual(model0);
		await sync.redo();
		await sync.redo();
		expect(get(sync).code).toBe(valid);
		expect(get(sync.commands).doc).toStrictEqual(model2);
		sync.dispose();
	});

	it('Parse-Fehler beim Re-Parse: Fehlerzustand wie Sync-Fehler, kein Absturz', async () => {
		let broken = false;
		const flaky: DiagramAdapter = {
			...flowchartAdapter,
			parse: (text) => {
				if (broken) throw new Error('kaputt');
				return flowchartAdapter.parse(text);
			}
		};
		const adapters = {
			...fakeAdapters,
			flowchart: { adapter: flaky, validate: fakeValidate }
		};
		const sync = await open(START, adapters);
		sync.editCode(START.replace('A[Eins]', 'A[Zwei]'));
		await sync.flush();
		const model1 = get(sync.commands).doc;
		broken = true;
		await expect(sync.undo()).resolves.toBeUndefined();
		expect(get(sync).code).toBe(START);
		expect(get(sync).errors).toEqual([{ line: 1, column: 1, message: 'kaputt' }]);
		expect(get(sync).conflict).toBe(false);
		// Das letzte gültige Modell bleibt aktiv.
		expect(get(sync.commands).doc).toBe(model1);
		sync.dispose();
	});
});

describe('Konflikt: Kandidat ohne Modell im Snapshot (T142 E)', () => {
	const VALID = 'flowchart LR\n  A --> B\n';
	const FIX1 = 'flowchart LR\n  A --> B --> C\n';
	const FIX2 = 'flowchart LR\n  A --> B --> D\n';
	const view = (sync: Awaited<ReturnType<typeof open>>) => {
		const { code, mode, errors, conflict, warnings } = get(sync);
		return { code, mode, errors, conflict, warnings };
	};
	/** Konflikt, dann zwei wieder gültige Code-Stände (je ein Kandidat). */
	async function conflictWithCandidates(adapters = fakeAdapters, steps = [FIX1, FIX2]) {
		const sync = await open(VALID, adapters);
		sync.editCode(`${VALID}%%FEHLER\n`);
		await sync.flush();
		await sync.execute(rename('A', 'Neu'));
		const views = [view(sync)];
		for (const text of steps) {
			sync.editCode(text);
			await sync.flush();
			views.push(view(sync));
		}
		expect(get(sync).conflict).toBe(true);
		return { sync, views };
	}
	/** Modell nach "Code behalten" ohne Undo/Redo. */
	async function kept(steps: string[]) {
		const { sync } = await conflictWithCandidates(fakeAdapters, steps);
		await sync.keepCode();
		const doc = structuredClone(get(sync.commands).doc);
		sync.dispose();
		return doc;
	}

	it('Undo/Redo stellt den Kandidaten wertgleich her, Konfliktanzeige unverändert', async () => {
		const expected1 = await kept([FIX1]);
		const expected2 = await kept([FIX1, FIX2]);
		const { sync, views } = await conflictWithCandidates();
		await sync.undo();
		expect(view(sync)).toStrictEqual(views[1]);
		await sync.redo();
		expect(view(sync)).toStrictEqual(views[2]);
		await sync.undo();
		await sync.undo();
		expect(view(sync)).toStrictEqual(views[0]);
		await sync.redo();
		await sync.redo();
		expect(view(sync)).toStrictEqual(views[2]);
		await sync.keepCode();
		expect(get(sync)).toMatchObject({ code: FIX2, conflict: false, errors: [] });
		expect(get(sync.commands).doc).toStrictEqual(expected2);
		await sync.undo();
		expect(view(sync)).toStrictEqual(views[2]);
		await sync.undo();
		expect(view(sync)).toStrictEqual(views[1]);
		await sync.keepCode();
		expect(get(sync)).toMatchObject({ code: FIX1, conflict: false, errors: [] });
		expect(get(sync.commands).doc).toStrictEqual(expected1);
		sync.dispose();
	});

	it('Re-Parse des Kandidaten schlägt fehl: Fehlerpfad, "Code behalten" nimmt den gültigen Stand', async () => {
		let broken = false;
		const flaky: DiagramAdapter = {
			...flowchartAdapter,
			parse: (text) => {
				if (broken) throw new Error('kaputt');
				return flowchartAdapter.parse(text);
			}
		};
		const adapters = { ...fakeAdapters, flowchart: { adapter: flaky, validate: fakeValidate } };
		const { sync } = await conflictWithCandidates(adapters);
		broken = true;
		await expect(sync.undo()).resolves.toBeUndefined();
		expect(get(sync)).toMatchObject({ code: FIX1, conflict: true });
		expect(get(sync).errors).toEqual([{ line: 1, column: 1, message: 'kaputt' }]);
		await sync.keepCode();
		expect(get(sync).conflict).toBe(false);
		expect(get(sync.commands).doc.nodes.map((n) => n.label)).toEqual(['A', 'B']);
		sync.dispose();
	});
});
