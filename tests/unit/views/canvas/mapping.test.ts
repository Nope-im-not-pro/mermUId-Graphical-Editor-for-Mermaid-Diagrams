// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shapePath } from '../../../../src/lib/services/shapes';
import { validateModel } from '../../../../src/lib/services/validator';
import {
	canvasMeasure,
	computeGeometry,
	displayLines,
	documentOrder,
	editorText,
	handleSides,
	labelFromEditor,
	nodeAriaLabel,
	nodeSize,
	toFlow
} from '../../../../src/lib/views/canvas/graph/mapping';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import {
	SAMPLE,
	installBrowserStubs,
	measure,
	mountCanvas,
	nodeEl,
	parseOk,
	unmountAll
} from './helpers';

// Zählt Aufrufe von sanitizeLabel (Durchreichung des Originals) für den Cache-Nachweis.
const sanitizeCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../../src/lib/services/security', async (orig) => {
	const mod = await orig<typeof import('../../../../src/lib/services/security')>();
	return {
		...mod,
		sanitizeLabel: (text: string) => {
			sanitizeCalls.count++;
			return mod.sanitizeLabel(text);
		}
	};
});

const state = { direction: 'LR', errors: [] };

describe('Label-Anzeige', () => {
	it('trennt an <br>, entfernt Markup, bricht um', () => {
		expect(displayLines('Start<br>zwei', 200, measure)).toEqual(['Start', 'zwei']);
		expect(displayLines('<b>fett</b> <img src=x onerror=alert(1)>', 200, measure)).toEqual([
			'fett'
		]);
		expect(displayLines('aaaa bbbb', 40, measure)).toEqual(['aaaa', 'bbbb']);
		expect(displayLines('', 200, measure)).toEqual(['']);
	});

	it('Editor-Text und Rückweg', () => {
		expect(editorText('a<br>b<br/>c')).toBe('a\nb\nc');
		expect(labelFromEditor('a\nb')).toBe('a<br>b');
	});

	it('Knotengröße aus Zeilen, mit Mindestbreite', () => {
		expect(nodeSize(['ab'], measure)).toEqual({ width: 80, height: 42 });
		const wide = nodeSize(['x'.repeat(20)], measure);
		expect(wide.width).toBe(20 * 8 + 32);
		expect(nodeSize(['a', 'b'], measure).height).toBe(60);
	});
});

describe('toFlow', () => {
	const doc = parseOk(SAMPLE);
	const flow = toFlow(doc, { ...state, issues: validateModel(doc) }, measure);
	const byId = Object.fromEntries(flow.nodes.map((n) => [n.id, n]));

	it('Knoten mit Form aus services/shapes und Text-Zeilen', () => {
		const a = byId.A;
		expect(a.type).toBe('shape');
		expect(a.data.lines).toEqual(['Start', 'zwei']);
		expect(a.data.path).toBe(shapePath('square', a.data.width, a.data.height));
		expect(byId.B.data.path).toBe(shapePath('diamond', byId.B.data.width, byId.B.data.height));
	});

	it('Container vor Kindern, Kinder relativ zum Container', () => {
		const ids = flow.nodes.map((n) => n.id);
		expect(ids.indexOf('S1')).toBeLessThan(ids.indexOf('C'));
		expect(byId.S1.type).toBe('container');
		expect(byId.C.parentId).toBe('S1');
		const g = flow.geometry;
		expect(byId.C.position).toEqual({ x: g.C.x - g.S1.x, y: g.C.y - g.S1.y });
		expect(byId.A.position).toEqual({ x: g.A.x, y: g.A.y });
	});

	it('Container-ID-Knoten wird nicht getrennt abgebildet', () => {
		expect(flow.nodes.filter((n) => n.id === 'S1')).toHaveLength(1);
		expect(byId.S1.data.issues.some((i) => i.severity === 'hint')).toBe(true);
	});

	it('Kanten typisiert mit Handles und Modell-Stil', () => {
		const e1 = flow.edges.find((e) => e.id === 'e1')!;
		expect(e1).toMatchObject({ source: 'A', target: 'B', type: 'typed' });
		expect(e1.data).toMatchObject({ lineStyle: 'solid', arrowHead: 'arrow', lines: [] });
		expect(e1.sourceHandle).toBe('e');
		expect(e1.targetHandle).toBe('w');
	});

	it('RawBlocks ohne Deklaration als nicht grafisch editierbar', () => {
		const acc = doc.rawBlocks.find((b) => b.rawText.includes('accTitle'))!;
		expect(flow.rawBlocks).toEqual([
			{ id: acc.id, text: 'accTitle: Titel', note: 'nicht grafisch editierbar' }
		]);
	});

	it('Reihenfolge für Tab: Container, Knoten, Kanten', () => {
		expect(flow.order).toEqual(documentOrder(doc));
		expect(flow.order).toEqual(['S1', 'A', 'B', 'C', 'D', 'e1', 'e2', 'e3']);
	});

	it('Syntaxfehler als Canvas-Marker mit Icon und Text', () => {
		const f = toFlow(
			doc,
			{ direction: 'LR', errors: [{ line: 3, column: 1, message: 'kaputt' }] },
			measure
		);
		expect(f.canvasIssues).toEqual([{ severity: 'error', icon: '⚠', text: 'Zeile 3: kaputt' }]);
	});

	it('Fehler unsichtbarer Elemente landen am Canvas', () => {
		const d = parseOk('flowchart TB\n  A --> B\n');
		const dangling = { ...d, nodes: d.nodes.filter((n) => n.id !== 'B') };
		const f = toFlow(dangling, { ...state, issues: validateModel(dangling) }, measure);
		expect(f.edges).toHaveLength(0);
		expect(f.canvasIssues.some((i) => i.text.startsWith('e1:'))).toBe(true);
	});

	it('doppelte Knoten-IDs nur einmal', () => {
		const d = parseOk('flowchart TB\n  A\n');
		const twice = { ...d, nodes: [...d.nodes, d.nodes[0]] };
		const f = toFlow(twice, { ...state, issues: validateModel(twice) }, measure);
		expect(f.nodes).toHaveLength(1);
		expect(f.nodes[0].data.issues[0]).toMatchObject({ severity: 'error', icon: '⚠' });
	});

	it('Kantenlabel als Text-Zeilen', () => {
		const d = parseOk('flowchart TB\n  A -->|ja<br>nein| B\n');
		expect(toFlow(d, state, measure).edges[0].data!.lines).toEqual(['ja', 'nein']);
	});
});

describe('Geometrie', () => {
	it('Richtung nur aus SyncState.direction', () => {
		const doc = parseOk('flowchart TB\n  A --> B\n');
		const lr = computeGeometry(doc, 'LR', measure);
		const tb = computeGeometry(doc, 'TB', measure);
		expect(lr.B.x).toBeGreaterThan(lr.A.x);
		expect(lr.B.y).toBe(lr.A.y);
		expect(tb.B.y).toBeGreaterThan(tb.A.y);
	});

	it('manuell: Positionen aus Metadaten, Größe gemessen, Container umschließt Kinder', () => {
		const doc = parseOk(SAMPLE);
		const manual = {
			...doc,
			layout: {
				...doc.layout,
				mode: 'manual' as const,
				positions: { C: [100, 100, 0, 0], D: [300, 200, 0, 0], A: [0, 0, 0, 0] } as never
			}
		};
		const g = computeGeometry(manual, 'LR', measure);
		expect(g.C).toEqual({ x: 100, y: 100, w: 80, h: 42 });
		expect(g.S1.x).toBeLessThan(100);
		expect(g.S1.y).toBeLessThan(100);
		expect(g.S1.x + g.S1.w).toBeGreaterThan(380);
		expect(g.S1.y + g.S1.h).toBeGreaterThan(242);
		// ohne Metadaten-Position: Auto-Layout als Rückfall
		expect(Number.isFinite(g.B.x)).toBe(true);
	});

	it('manuell: leerer Container behält eigene Position', () => {
		const doc = parseOk('flowchart TB\n  subgraph X\n  end\n');
		const manual = {
			...doc,
			layout: { ...doc.layout, mode: 'manual' as const, positions: { X: [5, 6, 0, 0] } as never }
		};
		const g = computeGeometry(manual, 'TB', measure);
		expect([g.X.x, g.X.y]).toEqual([5, 6]);
		expect(g.X.w).toBeGreaterThan(0);
	});

	it('Handle-Seiten aus relativer Lage', () => {
		const r = (x: number, y: number) => ({ x, y, w: 10, h: 10 });
		expect(handleSides(r(0, 0), r(100, 0))).toEqual({ source: 'e', target: 'w' });
		expect(handleSides(r(100, 0), r(0, 0))).toEqual({ source: 'w', target: 'e' });
		expect(handleSides(r(0, 0), r(0, 100))).toEqual({ source: 's', target: 'n' });
		expect(handleSides(r(0, 100), r(0, 0))).toEqual({ source: 'n', target: 's' });
	});
});

describe('Geometrie: verschachtelt und Messung', () => {
	it('manuell: innerer Container zuerst, äußerer umschließt ihn', () => {
		const doc = parseOk('flowchart TB\n  subgraph O\n    subgraph I\n      A\n    end\n  end\n');
		const manual = {
			...doc,
			layout: {
				...doc.layout,
				mode: 'manual' as const,
				positions: { A: [200, 200, 0, 0] } as never
			}
		};
		const g = computeGeometry(manual, 'TB', measure);
		expect(g.I.x).toBeLessThan(200);
		expect(g.O.x).toBeLessThan(g.I.x);
		expect(g.O.x + g.O.w).toBeGreaterThan(g.I.x + g.I.w);
	});

	it('canvasMeasure nutzt measureText, ohne Kontext Rückfall auf Zeichenzahl', () => {
		const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
		spy.mockReturnValue({
			font: '',
			measureText: (t: string) => ({ width: t.length * 5 })
		} as never);
		expect(canvasMeasure()('abcd')).toBe(20);
		spy.mockReturnValue(null);
		expect(canvasMeasure()('abcd')).toBe(32);
		spy.mockRestore();
	});
});

describe('Stile (V-06)', () => {
	const text = [
		'flowchart LR',
		'  classDef rot fill:#f00,stroke:#900,stroke-width:3px',
		'  A --> B',
		'  B --> C:::rot',
		'  subgraph S [Gruppe]',
		'    D',
		'  end',
		'  S --> A',
		'  style A fill:#00aa00,color:#fff',
		'  class B rot',
		'  style S fill:#eef,stroke-dasharray:4 2',
		'  style C fill:url(#x)',
		'  linkStyle 1 stroke:#0000ff,stroke-width:2px,stroke-dasharray:5 5',
		''
	].join('\n');
	const flow = toFlow(parseOk(text), state, measure);
	const byId = Object.fromEntries(flow.nodes.map((n) => [n.id, n]));

	it('style A färbt den Knoten', () => {
		expect(byId.A.data.style).toEqual({ fill: '#00aa00', color: '#fff' });
	});

	it('classDef über class und ::: färbt Knoten', () => {
		expect(byId.B.data.style).toEqual({ fill: '#f00', stroke: '#900', strokeWidth: 3 });
	});

	it('unzulässiger eigener Wert fällt auf classDef zurück', () => {
		expect(byId.C.data.style.fill).toBe('#f00');
	});

	it('Knoten ohne Stil: leeres Objekt', () => {
		expect(byId.D.data.style).toEqual({});
	});

	it('Container übernimmt Stil seines ID-Knotens', () => {
		expect(byId.S.data.style).toEqual({ fill: '#eef', strokeDasharray: '4 2' });
	});

	it('Kanten aus linkStyle, andere Kanten ohne Stil', () => {
		const style = (id: string) => flow.edges.find((e) => e.id === id)!.data!.style;
		expect(style('e2')).toEqual({ stroke: '#0000ff', strokeWidth: 2, strokeDasharray: '5 5' });
		expect(style('e1')).toEqual({});
	});

	it('Textfarbe: eigene color, sonst aus der Füllung, sonst Theme', () => {
		expect(byId.A.data.textColor).toBe('#fff');
		expect(byId.B.data.textColor).toBe('#000000');
		expect(byId.S.data.textColor).toBe('#000000');
		expect(byId.D.data.textColor).toBeUndefined();
	});
});

describe('Stile: classDef default (V-06)', () => {
	const text = [
		'flowchart LR',
		'  classDef default fill:#222,stroke:#f0f',
		'  A',
		'  subgraph S [Gruppe]',
		'    D',
		'  end',
		'  S --> A',
		'  style S stroke:#0f0',
		''
	].join('\n');
	const flow = toFlow(parseOk(text), state, measure);
	const byId = Object.fromEntries(flow.nodes.map((n) => [n.id, n]));

	it('gilt für Knoten, Textfarbe hell auf dunkler Füllung', () => {
		expect(byId.A.data.style).toEqual({ fill: '#222', stroke: '#f0f' });
		expect(byId.A.data.textColor).toBe('#ffffff');
	});

	it('gilt nicht für Container (Mermaid wendet default nicht auf Subgraphen an)', () => {
		expect(byId.S.data.kind).toBe('container');
		expect(byId.S.data.style).toEqual({ stroke: '#0f0' });
		expect(byId.S.data.textColor).toBeUndefined();
	});
});

describe('Namen im Canvas (V-32, T125)', () => {
	afterEach(() => {
		unmountAll();
		applyLocale('de');
	});

	it('ariaLabel "<Form>: <Label>" je Knoten, Container als Subgraph', () => {
		const flow = toFlow(parseOk(SAMPLE), state, measure);
		const label = Object.fromEntries(flow.nodes.map((n) => [n.id, n.ariaLabel]));
		expect(label.A).toBe('Rechteck: Start zwei');
		expect(label.B).toBe('Raute (Entscheidung): Frage');
		expect(label.C).toBe('Rechteck: C');
		expect(label.S1).toBe('Subgraph: Gruppe');
	});

	it('Formname übersetzt, Markup entfernt, leeres Label ohne Doppelpunkt', () => {
		expect(nodeAriaLabel('shape', 'circle', '<b>Ok?</b>')).toBe('Kreis: Ok?');
		expect(nodeAriaLabel('shape', 'diamond', '')).toBe('Raute (Entscheidung)');
		expect(nodeAriaLabel('shape', 'unbekannt', ' <br> ')).toBe('Knoten');
		applyLocale('en');
		expect(nodeAriaLabel('shape', 'diamond', 'Ok?')).toBe('Diamond (decision): Ok?');
		expect(nodeAriaLabel('container', 'rect', 'Gruppe')).toBe('Subgraph: Gruppe');
		expect(toFlow(parseOk(SAMPLE), state, measure).nodes.find((n) => n.id === 'A')!.ariaLabel).toBe(
			'Rectangle: Start zwei'
		);
	});

	it('Canvas: Knoten-Namen folgen dem Sprachwechsel, Handles mit Richtungsnamen', async () => {
		installBrowserStubs();
		const { target } = await mountCanvas(SAMPLE);
		const a = nodeEl(target, 'A')!;
		expect(a.getAttribute('aria-label')).toBe('Rechteck: Start zwei');
		for (const id of ['A', 'S1']) {
			const names = [...nodeEl(target, id)!.querySelectorAll('.svelte-flow__handle')].map((h) =>
				h.getAttribute('aria-label')
			);
			expect(names).toEqual([
				'Verbindungspunkt oben',
				'Verbindungspunkt rechts',
				'Verbindungspunkt unten',
				'Verbindungspunkt links'
			]);
		}
		applyLocale('en');
		flushSync();
		expect(nodeEl(target, 'A')!.getAttribute('aria-label')).toBe('Rectangle: Start zwei');
		expect(
			nodeEl(target, 'A')!.querySelector('.svelte-flow__handle')!.getAttribute('aria-label')
		).toBe('Connection point top');
	});

	it('Label-Text aus dem Mess-Cache: zweiter toFlow-Lauf ruft sanitizeLabel nicht erneut', () => {
		const doc = parseOk(SAMPLE);
		const first = toFlow(doc, state, measure);
		sanitizeCalls.count = 0;
		const second = toFlow(doc, state, measure);
		expect(sanitizeCalls.count).toBe(0);
		expect(second.nodes.map((n) => n.ariaLabel)).toEqual(first.nodes.map((n) => n.ariaLabel));
		applyLocale('en');
		const english = toFlow(doc, state, measure);
		expect(sanitizeCalls.count).toBe(0);
		expect(english.nodes.find((n) => n.id === 'A')!.ariaLabel).toBe('Rectangle: Start zwei');
	});

	it('Rollenbeschreibung übersteuert xyflow "node" und folgt dem Sprachwechsel', async () => {
		installBrowserStubs();
		const { target } = await mountCanvas(SAMPLE);
		expect(nodeEl(target, 'A')!.getAttribute('aria-roledescription')).toBe('Knoten');
		expect(nodeEl(target, 'S1')!.getAttribute('aria-roledescription')).toBe('Subgraph');
		applyLocale('en');
		flushSync();
		expect(nodeEl(target, 'A')!.getAttribute('aria-roledescription')).toBe('node');
		expect(nodeEl(target, 'S1')!.getAttribute('aria-roledescription')).toBe('subgraph');
	});
});
