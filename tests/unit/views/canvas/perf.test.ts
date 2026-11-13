// @vitest-environment jsdom
/** T113 C1 (V-28/V-29): Layout je Dokument-Identität, dagre überspringen, Mess-Cache. */
import { flushSync } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as layout from '../../../../src/lib/services/layout';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import {
	BOX_CACHE_MAX,
	canvasMeasure,
	computeGeometry,
	manualGeometry,
	toFlow,
	VISIBLE_ONLY_FROM
} from '../../../../src/lib/views/canvas/graph/mapping';
import {
	SAMPLE,
	installBrowserStubs,
	measure,
	mountCanvas,
	parseOk,
	settle,
	unmountAll
} from './helpers';
import { presetMeasured } from '../../../../src/lib/views/canvas/graph/fit';

vi.mock('../../../../src/lib/services/layout', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/lib/services/layout')>();
	return { ...actual, layoutGraph: vi.fn(actual.layoutGraph) };
});

/** Letztes `fitView`-Promise der Canvas-API (resolvt erst bei `nodesInitialized`). */
const fits = vi.hoisted(() => [] as Promise<boolean>[]);
vi.mock('@xyflow/svelte', async (original) => {
	const real = await original<typeof import('@xyflow/svelte')>();
	return {
		...real,
		useSvelteFlow: () => {
			const api = real.useSvelteFlow();
			return {
				...api,
				fitView: (o?: unknown) => {
					const p = api.fitView(o as never);
					fits.push(p);
					return p;
				}
			};
		}
	};
});

const layoutCalls = () => vi.mocked(layout.layoutGraph).mock.calls.length;
const state = { direction: 'LR', errors: [] };

beforeAll(installBrowserStubs);
beforeEach(() => {
	vi.mocked(layout.layoutGraph).mockClear();
});
afterEach(unmountAll);

describe('Layout je Dokument-Identität (V-28)', () => {
	it('10 editCode-Emissionen ohne Modelländerung: 0 layoutGraph-Aufrufe', async () => {
		const { sync } = await mountCanvas(SAMPLE);
		const before = layoutCalls();
		expect(before).toBeGreaterThan(0);
		for (let i = 0; i < 10; i++) {
			sync.editCode(`${SAMPLE}%% ${i}\n`);
			flushSync();
		}
		expect(layoutCalls()).toBe(before);
	});

	it('Whitespace-Edit nach Parse: Modell inhaltsgleich, kein Re-Layout (O-87)', async () => {
		const { sync } = await mountCanvas(SAMPLE);
		const before = layoutCalls();
		sync.editCode(SAMPLE.replace('  A[', '      A['));
		await sync.flush();
		await settle();
		expect(layoutCalls()).toBe(before);
		// Gegenprobe: echte Änderung (neues Label) rechnet neu.
		sync.editCode(SAMPLE.replace('Frage', 'Frage2'));
		await sync.flush();
		await settle();
		expect(layoutCalls()).toBe(before + 1);
	});

	it('toFlow: nur `sourceText` verschieden -> Layout wiederverwendet', () => {
		const a = parseOk(SAMPLE);
		toFlow(a, state, measure);
		const calls = layoutCalls();
		const b = parseOk(SAMPLE.replace('  A[', '      A['));
		expect(b).not.toBe(a);
		expect(toFlow(b, state, measure).geometry).toEqual(toFlow(a, state, measure).geometry);
		expect(layoutCalls()).toBe(calls);
		toFlow(b, { direction: 'TB', errors: [] }, measure);
		expect(layoutCalls()).toBe(calls + 1);
	});

	it('toFlow: Einzug an Einzelknoten- und subgraph-Zeile -> kein Re-Layout (O-102)', () => {
		const text = 'flowchart LR\n  A[Start]\n  B{Frage}\n  A --> B\n  subgraph S\n    C\n  end\n';
		const base = parseOk(text);
		/** Layout-Aufrufe für `variant`, verglichen mit einem frisch geparsten Ausgangsdokument. */
		const probe = (variant: string | DiagramDocument) => {
			toFlow(parseOk(text), state, measure);
			const calls = layoutCalls();
			toFlow(typeof variant === 'string' ? parseOk(variant) : variant, state, measure);
			return layoutCalls() - calls;
		};
		// Quelltext-Felder (`stmtText`, `openText`/`endText`/`dirText`, `stmtParent`) zählen nicht.
		expect(probe(text.replace('  A[', '      A['))).toBe(0);
		expect(probe(text.replace('  subgraph S', '    subgraph S'))).toBe(0);
		expect(probe(text.replace('  end', '  end  '))).toBe(0);
		expect(probe(text.replace('Frage', 'Frage2'))).toBe(1);
		// Gegenprobe Allow-Liste je Feld: Kante, Eltern, Container-Label, Modus, Positionen.
		expect(probe(text.replace('A --> B', 'B --> A'))).toBe(1);
		expect(probe(text.replace('    C\n  end\n', '  end\n  C\n'))).toBe(1);
		expect(probe(text.replace('subgraph S', 'subgraph S [Gruppe]'))).toBe(1);
		const manual = (positions: DiagramDocument['layout']['positions']): DiagramDocument => ({
			...base,
			layout: { ...base.layout, mode: 'manual', positions }
		});
		// Unvollständige Positionen: dagre-Rückfall, daher zählbar.
		expect(probe(manual({}))).toBe(1);
		toFlow(manual({ A: [0, 0, 0, 0] }), state, measure);
		const calls = layoutCalls();
		toFlow(manual({ A: [0, 0, 0, 0] }), state, measure);
		expect(layoutCalls()).toBe(calls);
		toFlow(manual({ A: [5, 0, 0, 0] }), state, measure);
		expect(layoutCalls()).toBe(calls + 1);
		// Zusätzlicher Positions-Schlüssel bei gleichen Werten der vorhandenen (O-108, Mutant R3).
		toFlow(manual({ A: [5, 0, 0, 0], C: [0, 0, 0, 0] }), state, measure);
		expect(layoutCalls()).toBe(calls + 2);
	});

	it('toFlow mit identischem Dokument rechnet das Layout nicht neu', () => {
		const doc = parseOk(SAMPLE);
		const first = toFlow(doc, state, measure);
		const calls = layoutCalls();
		const again = toFlow(doc, { direction: 'LR', errors: [] }, measure);
		expect(layoutCalls()).toBe(calls);
		expect(again.geometry).toEqual(first.geometry);
		toFlow(doc, { direction: 'TB', errors: [] }, measure);
		expect(layoutCalls()).toBe(calls + 1);
		// Neues, inhaltsgleiches Dokument in LR: `lastLayout` hält nur das letzte Layout (TB),
		// Richtung verschieden -> rechnet neu; danach dasselbe in LR -> Treffer über `lastLayout`.
		toFlow(parseOk(SAMPLE), state, measure);
		expect(layoutCalls()).toBe(calls + 2);
		toFlow(parseOk(SAMPLE), state, measure);
		expect(layoutCalls()).toBe(calls + 2);
	});
});

describe('Manueller Modus ohne dagre (V-28)', () => {
	const withPositions = (positions: Record<string, number[]>) => {
		const doc = parseOk(SAMPLE);
		return {
			...doc,
			layout: { ...doc.layout, mode: 'manual' as const, positions: positions as never }
		};
	};

	it('vollständige Positionen: layoutGraph wird nicht gerufen', () => {
		const doc = withPositions({
			A: [0, 0, 0, 0],
			B: [200, 0, 0, 0],
			C: [100, 100, 0, 0],
			D: [300, 200, 0, 0]
		});
		const g = computeGeometry(doc, 'LR', measure);
		expect(layoutCalls()).toBe(0);
		expect(g.C).toEqual({ x: 100, y: 100, w: 80, h: 42 });
		expect(g.B.x).toBe(200);
		expect(g.S1.x).toBeLessThan(100);
		expect(g.S1.x + g.S1.w).toBeGreaterThan(380);
	});

	it('vollständige Positionen: exakt gleich dem alten Pfad (Auto-Layout + Überschreibung)', () => {
		const text = [
			'flowchart LR',
			'  A --> B',
			'  subgraph O [Außen]',
			'    subgraph I [Innen]',
			'      C --> D',
			'    end',
			'    E',
			'  end',
			'  B --> O',
			''
		].join('\n');
		const base = parseOk(text);
		const positions = {
			A: [0, 0, 0, 0],
			B: [200, 0, 0, 0],
			C: [100, 150, 0, 0],
			D: [300, 150, 0, 0],
			E: [100, 300, 0, 0],
			O: [40, 60, 500, 400]
		};
		const doc: DiagramDocument = {
			...base,
			layout: { ...base.layout, mode: 'manual', positions: positions as never }
		};
		const fast = computeGeometry(doc, 'LR', measure);
		expect(layoutCalls()).toBe(0);
		const auto = computeGeometry(
			{ ...doc, layout: { ...doc.layout, mode: 'auto' } },
			'LR',
			measure
		);
		expect(layoutCalls()).toBe(1);
		const old = manualGeometry(doc, doc.containers, auto, measure);
		expect(fast).toEqual(old);
		expect(Object.keys(fast).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'I', 'O']);
	});

	it('leerer Container mit Position zählt als vollständig', () => {
		const doc = parseOk('flowchart TB\n  subgraph X\n  end\n');
		const manual = {
			...doc,
			layout: { ...doc.layout, mode: 'manual' as const, positions: { X: [5, 6, 0, 0] } as never }
		};
		const g = computeGeometry(manual, 'TB', measure);
		expect(layoutCalls()).toBe(0);
		expect([g.X.x, g.X.y]).toEqual([5, 6]);
	});

	it('fehlende Position: Auto-Layout als Rückfall', () => {
		const g = computeGeometry(
			withPositions({ A: [0, 0, 0, 0], C: [100, 100, 0, 0], D: [300, 200, 0, 0] }),
			'LR',
			measure
		);
		expect(layoutCalls()).toBe(1);
		expect(Number.isFinite(g.B.x)).toBe(true);
	});
});

describe('Mess-Cache (V-29)', () => {
	it('Label-Größen je Text zwischengespeichert, auch über neue Dokumente', () => {
		const spy = vi.fn((s: string) => s.length * 8);
		toFlow(parseOk(SAMPLE), state, spy);
		const calls = spy.mock.calls.length;
		expect(calls).toBeGreaterThan(0);
		toFlow(parseOk(SAMPLE), state, spy);
		expect(spy.mock.calls.length).toBe(calls);
		toFlow(parseOk(SAMPLE.replace('B{Frage}', 'B{Frage neu}')), state, spy);
		expect(spy.mock.calls.length).toBeGreaterThan(calls);
		// Größe hängt nicht von der Form ab: Formwechsel misst nicht neu, Form und Pfad stimmen.
		const shapeChange = spy.mock.calls.length;
		const diamond = toFlow(parseOk(SAMPLE), state, spy).nodes.find((n) => n.id === 'B')!;
		const flow = toFlow(parseOk(SAMPLE.replace('B{Frage}', 'B[Frage]')), state, spy);
		expect(spy.mock.calls.length).toBe(shapeChange);
		const square = flow.nodes.find((n) => n.id === 'B')!;
		expect(square.data.shape).toBe('square');
		expect([square.width, square.height]).toEqual([diamond.width, diamond.height]);
		expect(square.data.path).not.toBe(diamond.data.path);
	});

	it(`Überlauf: ab ${BOX_CACHE_MAX} Einträgen wird der Label-Cache geleert`, () => {
		const spy = vi.fn((s: string) => s.length * 8);
		// Knoten aus einer Vorlage (Parsen von 5000 Zeilen wäre zu langsam).
		const one = parseOk('flowchart LR\n  N\n');
		const manual = (count: number, from = 0): DiagramDocument => {
			const ids = Array.from({ length: count }, (_, i) => `N${from + i}`);
			const nodes = ids.map((id) => ({ ...one.nodes[0], id, label: id }));
			const positions = Object.fromEntries(ids.map((id) => [id, [0, 0, 0, 0]]));
			return {
				...one,
				nodes,
				layout: { ...one.layout, mode: 'manual', positions: positions as never }
			};
		};
		computeGeometry(manual(BOX_CACHE_MAX + 1), 'LR', spy);
		const calls = spy.mock.calls.length;
		computeGeometry(manual(1, BOX_CACHE_MAX), 'LR', spy);
		expect(spy.mock.calls.length).toBe(calls);
		computeGeometry(manual(1), 'LR', spy);
		expect(spy.mock.calls.length).toBeGreaterThan(calls);
	}, 30_000); // 5000 Label-Bereinigungen unter jsdom: einige Sekunden, unter Last mehr.

	it('Cache je Messfunktion getrennt (Schrift)', () => {
		const narrow = vi.fn((s: string) => s.length * 4);
		const wide = vi.fn((s: string) => s.length * 20);
		const doc = parseOk('flowchart TB\n  A[Ein langes Label]\n');
		const a = toFlow(doc, state, narrow).nodes[0].width;
		const b = toFlow(parseOk('flowchart TB\n  A[Ein langes Label]\n'), state, wide).nodes[0].width;
		expect(b).toBeGreaterThan(a!);
		expect(wide).toHaveBeenCalled();
	});

	it('canvasMeasure misst jeden Text je Schrift nur einmal', () => {
		const measureText = vi.fn((t: string) => ({ width: t.length * 5 }));
		const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
		spy.mockReturnValue({ font: '', measureText } as never);
		const m = canvasMeasure('12px serif');
		expect(m('abcd')).toBe(20);
		expect(m('abcd')).toBe(20);
		expect(m('abc')).toBe(15);
		expect(measureText).toHaveBeenCalledTimes(2);
		spy.mockRestore();
	});
});

describe('onlyRenderVisibleElements (V-29)', () => {
	const chain = (n: number) =>
		['flowchart LR', ...Array.from({ length: n }, (_, i) => `  N${i} --> N${i + 1}`), ''].join(
			'\n'
		);
	const rendered = (target: HTMLElement) => target.querySelectorAll('.svelte-flow__node').length;

	it(`unter ${VISIBLE_ONLY_FROM} Knoten: alle Knoten im DOM`, async () => {
		const { target } = await mountCanvas(chain(VISIBLE_ONLY_FROM - 2));
		expect(rendered(target)).toBe(VISIBLE_ONLY_FROM - 1);
	});

	it(`ab ${VISIBLE_ONLY_FROM} Knoten: nur sichtbare (jsdom-Fläche 0 x 0 -> keine)`, async () => {
		const { target } = await mountCanvas(chain(VISIBLE_ONLY_FROM));
		expect(rendered(target)).toBe(0);
	});

	it(`ab ${VISIBLE_ONLY_FROM} Knoten: Einpassen wartet nicht auf DOM-Messung`, async () => {
		let control: { fit(): void } | null = null;
		await mountCanvas(chain(VISIBLE_ONLY_FROM), { oncontrol: (c: never) => (control = c) });
		fits.length = 0;
		control!.fit();
		const timeout = new Promise((r) => setTimeout(() => r('timeout'), 50));
		expect(await Promise.race([fits[0], timeout])).toBe(true);
	});
});

describe('measured ab VISIBLE_ONLY_FROM (O-87, Nachtrag C1 I2)', () => {
	const prev = (width: number, height: number, measured?: { width: number; height: number }) => ({
		width,
		height,
		measured
	});

	it('ohne Vorgänger: berechnete Größe', () => {
		expect(presetMeasured({ width: 100, height: 40 })).toEqual({ width: 100, height: 40 });
	});

	it('abweichende DOM-Messung gewinnt bei unveränderter berechneter Größe', () => {
		const dom = { width: 120, height: 44 };
		expect(presetMeasured({ width: 100, height: 40 }, prev(100, 40, dom))).toBe(dom);
	});

	it('geänderte berechnete Größe verdrängt alte DOM-Messung', () => {
		const next = { width: 150, height: 40 };
		expect(presetMeasured(next, prev(100, 40, { width: 120, height: 44 }))).toEqual(next);
		expect(
			presetMeasured({ width: 100, height: 60 }, prev(100, 40, { width: 120, height: 44 }))
		).toEqual({
			width: 100,
			height: 60
		});
	});

	it('DOM-Messung gleich alter berechneter Größe: neue berechnete Größe', () => {
		expect(
			presetMeasured({ width: 150, height: 40 }, prev(100, 40, { width: 100, height: 40 }))
		).toEqual({
			width: 150,
			height: 40
		});
	});
});
