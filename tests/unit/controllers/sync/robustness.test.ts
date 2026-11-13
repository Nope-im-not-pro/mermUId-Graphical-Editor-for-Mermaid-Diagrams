import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync, type SyncTimer } from '../../../../src/lib/controllers/sync';
import type { DiagramDocument, ParseError } from '../../../../src/lib/model/types';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { msg } from '../../../../src/lib/services/i18n';
import { splitMeta } from '../../../../src/lib/services/meta';
import { fakeAdapters, fakeValidate, rename } from './helpers';

// V-13 Sync-Teile / D4 / O-47: werfende Adapter, Validierung der Grafik -> Code-Ausgabe.
const VALID = 'flowchart LR\n  A --> B\n';
const M1 = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,1]}}';
const M2 = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[10,20]}}';

/** Zeitgeber, dessen Rückrufe der Test selbst auslöst. */
function manualTimer() {
	const pending = new Map<number, () => void>();
	let next = 0;
	const timer: SyncTimer = {
		set(fn) {
			pending.set(++next, fn);
			return next;
		},
		clear: (handle) => pending.delete(handle as number)
	};
	return {
		timer,
		run() {
			const fns = [...pending.values()];
			pending.clear();
			fns.forEach((fn) => fn());
		}
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const invalidFor = (message: string) => msg('sync.generatedInvalid', { msg: message });

/** Validierung, die jede Ausgabe mit `Neu` ablehnt. */
const rejectNeu = (text: string): Promise<ParseError[]> =>
	Promise.resolve(text.includes('Neu') ? [{ line: 2, column: 1, message: 'kaputt' }] : []);

function withFlowchart(entry: Partial<(typeof fakeAdapters)['flowchart']>) {
	return { ...fakeAdapters, flowchart: { ...fakeAdapters.flowchart, ...entry } };
}

const labels = (sync: Awaited<ReturnType<typeof createSync>>) =>
	get(sync.commands).doc.nodes.map((n) => n.label);

describe('Validierung der Grafik -> Code-Ausgabe (D4)', () => {
	it('ungültige Ausgabe ergibt eine Warnung, keine Fehler, keinen Konflikt', async () => {
		const { timer, run } = manualTimer();
		const sync = await createSync(VALID, {
			adapters: withFlowchart({ validate: rejectNeu }),
			timer
		});
		await sync.execute(rename('A', 'Neu'));
		expect(get(sync).warnings).toEqual([]);
		run();
		await tick();
		expect(get(sync)).toMatchObject({ errors: [], conflict: false });
		expect(get(sync).warnings).toEqual([invalidFor('kaputt')]);
		await sync.execute(rename('B', 'Y'));
		expect(get(sync)).toMatchObject({ errors: [], conflict: false });
		expect(get(sync).code).toContain('Y');
		run();
		await tick();
		expect(get(sync).warnings).toEqual([invalidFor('kaputt')]);
		await sync.execute(rename('A', 'A'));
		run();
		await tick();
		expect(get(sync).warnings).toEqual([]);
	});

	it('Meta-Warnungen bleiben neben der Validierungswarnung erhalten', async () => {
		const { timer, run } = manualTimer();
		const text = `flowchart LR\n  A --> B\n${M1}\n${M2}\n`;
		const sync = await createSync(text, {
			adapters: withFlowchart({ validate: rejectNeu }),
			timer
		});
		const dup = msg('sync.metaDuplicate');
		expect(get(sync).warnings).toEqual([dup]);
		await sync.execute(rename('A', 'Neu'));
		run();
		await tick();
		expect(get(sync).warnings).toEqual([dup, invalidFor('kaputt')]);
		await sync.execute(rename('A', 'A'));
		run();
		await tick();
		expect(get(sync).warnings).toEqual([dup]);
	});

	it('veraltetes Validierungsergebnis (älterer codeVersion) wird verworfen', async () => {
		const { timer, run } = manualTimer();
		const calls: ((errors: ParseError[]) => void)[] = [];
		let deferred = false;
		const validate = (t: string): Promise<ParseError[]> =>
			deferred ? new Promise((resolve) => calls.push(resolve)) : fakeValidate(t);
		const sync = await createSync(VALID, { adapters: withFlowchart({ validate }), timer });
		await sync.execute(rename('A', 'Neu'));
		deferred = true;
		run();
		expect(calls).toHaveLength(1);
		deferred = false;
		const version = get(sync).codeVersion;
		await sync.execute(rename('B', 'Y'));
		expect(get(sync).codeVersion).toBeGreaterThan(version);
		calls[0]([{ line: 1, column: 1, message: 'alt' }]);
		await tick();
		expect(get(sync).warnings).toEqual([]);
		expect(get(sync)).toMatchObject({ errors: [], conflict: false });
	});

	it('abgelehnte Validierung wird zur Warnung, keine unbehandelte Ablehnung', async () => {
		const { timer, run } = manualTimer();
		const validate = (t: string) =>
			t.includes('Neu') ? Promise.reject(new Error('weg')) : Promise.resolve([]);
		const sync = await createSync(VALID, { adapters: withFlowchart({ validate }), timer });
		await sync.execute(rename('A', 'Neu'));
		run();
		await tick();
		expect(get(sync).warnings).toEqual([invalidFor('weg')]);
		expect(get(sync).errors).toEqual([]);
	});

	it('dispose bricht eine geplante Validierung ab', async () => {
		const { timer, run } = manualTimer();
		let count = 0;
		const validate = (t: string) => {
			count++;
			return fakeValidate(t);
		};
		const sync = await createSync(VALID, { adapters: withFlowchart({ validate }), timer });
		count = 0;
		await sync.execute(rename('A', 'Neu'));
		sync.dispose();
		run();
		await tick();
		expect(count).toBe(0);
	});
});

describe('werfender Adapter (V-13)', () => {
	const boom = (text: string) => {
		if (text.includes('X')) throw new Error('boom');
		return flowchartAdapter.parse(text);
	};

	it('werfendes parse beim Öffnen ergibt Fehlerzustand', async () => {
		const sync = await createSync('flowchart LR\n  X\n', {
			adapters: withFlowchart({ adapter: { ...flowchartAdapter, parse: boom } })
		});
		expect(get(sync)).toMatchObject({
			conflict: false,
			errors: [{ line: 1, column: 1, message: 'boom' }]
		});
	});

	it('werfendes parse beim Code-Edit: Fehlerzustand, Modell bleibt, kein Konflikt', async () => {
		const sync = await createSync(VALID, {
			adapters: withFlowchart({ adapter: { ...flowchartAdapter, parse: boom } })
		});
		const text = 'flowchart LR\n  A --> X\n';
		sync.editCode(text);
		await expect(sync.flush()).resolves.toBeUndefined();
		expect(get(sync)).toMatchObject({
			code: text,
			conflict: false,
			pending: false,
			errors: [{ line: 1, column: 1, message: 'boom' }]
		});
		expect(labels(sync)).toEqual(['A', 'B']);
		sync.editCode(VALID);
		await sync.flush();
		expect(get(sync)).toMatchObject({ errors: [], conflict: false });
	});

	it('werfendes serialize: Fehlerzustand, Modell und Code unverändert', async () => {
		const serialize = (doc: DiagramDocument) => {
			if (doc.nodes.some((n) => n.label === 'Neu')) throw new Error('kaputt');
			return flowchartAdapter.serialize(doc);
		};
		const sync = await createSync(VALID, {
			adapters: withFlowchart({ adapter: { ...flowchartAdapter, serialize } })
		});
		const before = get(sync);
		await expect(sync.execute(rename('A', 'Neu'))).resolves.toBeUndefined();
		expect(get(sync)).toMatchObject({
			code: VALID,
			codeVersion: before.codeVersion,
			modelVersion: before.modelVersion,
			conflict: false,
			errors: [{ line: 1, column: 1, message: 'kaputt' }]
		});
		expect(labels(sync)).toEqual(['A', 'B']);
		expect(get(sync.commands).canUndo).toBe(false);
		await sync.execute(rename('B', 'Y'));
		expect(get(sync)).toMatchObject({ errors: [], conflict: false });
		expect(get(sync).code).toContain('Y');
		expect(labels(sync)).toEqual(['A', 'Y']);
	});
});

describe('Robustheit C3 I2 (Review-Befunde)', () => {
	const serialize = (doc: DiagramDocument) => {
		if (doc.nodes.some((n) => n.label === 'Neu')) throw new Error('kaputt');
		return flowchartAdapter.serialize(doc);
	};
	const broken = () => withFlowchart({ adapter: { ...flowchartAdapter, serialize } });
	const INVALID = 'flowchart LR\n  A --> B\n  %%FEHLER\n';

	async function inConflict() {
		const sync = await createSync(VALID, { adapters: broken() });
		sync.editCode(INVALID);
		await sync.flush();
		await sync.execute(rename('A', 'Neu'));
		expect(get(sync)).toMatchObject({ conflict: true });
		return sync;
	}

	it('diff mit nicht serialisierbarem Modell liefert einen Wert statt Ablehnung', async () => {
		const sync = await inConflict();
		const d = await sync.diff();
		expect(d).toEqual({ code: INVALID, model: 'kaputt' });
	});

	it('keepGraphic mit werfendem serialize behält die Parse-Fehler', async () => {
		const sync = await inConflict();
		await sync.keepGraphic();
		expect(get(sync)).toMatchObject({ conflict: true, code: INVALID });
		expect(get(sync).errors.map((e) => e.message)).toEqual(['Syntaxfehler', 'kaputt']);
	});

	it('Nutzer-Edit vor der Validierung verwirft die Prüfung der erzeugten Ausgabe', async () => {
		const { timer, run } = manualTimer();
		const texts: string[] = [];
		const validate = (t: string) => {
			texts.push(t);
			return rejectNeu(t);
		};
		const sync = await createSync(VALID, { adapters: withFlowchart({ validate }), timer });
		await sync.execute(rename('A', 'Neu'));
		const generated = get(sync).code;
		const edited = 'flowchart LR\n  A[Neu] --> B\n  C\n';
		sync.editCode(edited);
		texts.length = 0;
		run();
		await sync.flush();
		await tick();
		expect(texts).not.toContain(splitMeta(generated).body);
		expect(get(sync).warnings).toEqual([]);
		expect(get(sync).errors.map((e) => e.message)).toEqual(['kaputt']);
	});

	it('Undo/Redo prüft die wiederhergestellte Ausgabe erneut, ohne doppelte Warnung', async () => {
		const { timer, run } = manualTimer();
		const sync = await createSync(VALID, {
			adapters: withFlowchart({ validate: rejectNeu }),
			timer
		});
		await sync.execute(rename('A', 'Neu'));
		run();
		await tick();
		expect(get(sync).warnings).toEqual([invalidFor('kaputt')]);
		await sync.undo();
		run();
		await tick();
		expect(get(sync).warnings).toEqual([]);
		await sync.redo();
		run();
		await tick();
		expect(get(sync).warnings).toEqual([invalidFor('kaputt')]);
		await sync.execute(rename('B', 'Y'));
		run();
		await tick();
		await sync.undo();
		run();
		await tick();
		expect(get(sync).warnings).toEqual([invalidFor('kaputt')]);
	});
});
