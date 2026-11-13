import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { BAD, fakeAdapters, noop, place, rename } from './helpers';

const VALID = 'flowchart LR\n  A --> B\n';
const META = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2]}}';
const open = (text: string) => createSync(text, { adapters: fakeAdapters });
const versions = (sync: Awaited<ReturnType<typeof open>>) => {
	const { codeVersion, modelVersion } = get(sync);
	return { codeVersion, modelVersion };
};

describe('Command ohne Änderung im Editor (T107 DoD 2, O-71)', () => {
	it('legt keinen Undo-Schritt ab, Redo-Stapel und Zähler bleiben', async () => {
		const sync = await open(VALID);
		await sync.execute(rename('A', 'Neu'));
		await sync.undo();
		const before = { ...get(sync.commands), ...versions(sync), code: get(sync).code };
		expect(before).toMatchObject({ canUndo: false, canRedo: true });
		await sync.execute(noop);
		expect(get(sync.commands)).toMatchObject({ canUndo: false, canRedo: true });
		expect(versions(sync)).toEqual({
			codeVersion: before.codeVersion,
			modelVersion: before.modelVersion
		});
		expect(get(sync).code).toBe(before.code);
		await sync.redo();
		expect(get(sync).code).toContain('Neu');
	});

	it('Undo nach einem Command ohne Änderung nimmt den letzten echten Schritt zurück', async () => {
		const sync = await open(VALID);
		await sync.execute(rename('A', 'Neu'));
		await sync.execute(noop);
		await sync.undo();
		expect(get(sync).code).toBe(VALID);
		expect(get(sync.commands).canUndo).toBe(false);
	});

	it('bei ungültigem Code: kein Konflikt, kein Undo-Schritt', async () => {
		const sync = await open(VALID);
		sync.editCode(`${VALID}${BAD}\n`);
		await sync.flush();
		const canUndo = get(sync.commands).canUndo;
		const v = versions(sync);
		await sync.execute(noop);
		expect(get(sync).conflict).toBe(false);
		expect(get(sync.commands).canUndo).toBe(canUndo);
		expect(versions(sync)).toEqual(v);
		await sync.execute(rename('A', 'Neu'));
		expect(get(sync).conflict).toBe(true);
	});

	it('Ziehen auf die gleiche Position erzeugt keinen Eintrag', async () => {
		const text = `${VALID}${META}\n`;
		const sync = await open(text);
		const v = versions(sync);
		await sync.execute(place('A', [1, 2, 0, 0]));
		expect(get(sync.commands).canUndo).toBe(false);
		expect(versions(sync)).toEqual(v);
		expect(get(sync).code).toBe(text);
		await sync.execute(place('A', [3, 4, 0, 0]));
		expect(get(sync.commands).canUndo).toBe(true);
	});

	it('nur metaCleanup ändert Modell und Code: Eintrag entsteht', async () => {
		const text = `flowchart LR\n%% @mermuid: {"v":1,"layout":"manual","pos":{"Z":[1,2]}}\n  A --> B\n`;
		const sync = await open(text);
		expect(get(sync.commands).doc.comments).toHaveLength(1);
		await sync.execute(noop);
		expect(get(sync).code).toBe(VALID);
		expect(get(sync.commands).doc.comments).toHaveLength(0);
		expect(get(sync.commands).canUndo).toBe(true);
		await sync.undo();
		expect(get(sync).code).toBe(text);
	});

	it('nur der Code-Text ändert sich (veraltete Zeile am Ende): Eintrag entsteht', async () => {
		const text = `${VALID}%% @mermuid: {"v":1,"layout":"manual","pos":{"Z":[1,2]}}\n`;
		const sync = await open(text);
		await sync.execute(noop);
		expect(get(sync).code).toBe(VALID);
		expect(get(sync.commands).canUndo).toBe(true);
		await sync.undo();
		expect(get(sync).code).toBe(text);
	});
});
