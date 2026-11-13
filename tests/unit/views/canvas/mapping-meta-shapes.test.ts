// @vitest-environment jsdom
// T138 C2: Canvas-Knoten der fünf `@{ shape }`-Formen (F-07).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { labelArea, META_SHAPE_NAMES, shapePath } from '../../../../src/lib/services/shapes';
import { nodeAriaLabel, toFlow } from '../../../../src/lib/views/canvas/graph/mapping';
import { updateNode } from '../../../../src/lib/model/operations';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import { installBrowserStubs, measure, mountCanvas, nodeEl, parseOk, unmountAll } from './helpers';

const state = { direction: 'LR', errors: [] };

beforeAll(installBrowserStubs);
afterEach(() => {
	unmountAll();
	applyLocale('de');
});

describe('toFlow: neue Formen', () => {
	it.each([...META_SHAPE_NAMES])('%s: eigener Pfad, Label-Fläche fasst den Text', (shape) => {
		const doc = parseOk(`flowchart LR\nA@{ shape: ${shape}, label: "Ein Text" } --> B\n`);
		const flow = toFlow(doc, state, measure);
		const a = flow.nodes.find((n) => n.id === 'A')!;
		const b = flow.nodes.find((n) => n.id === 'B')!;
		expect(a.data.shape).toBe(shape);
		expect(a.data.path).toBe(shapePath(shape, a.data.width, a.data.height));
		expect(a.data.path).not.toBe(shapePath('square', a.data.width, a.data.height));
		// Text (8 px je Zeichen, 18 px Zeile) samt Innenabstand passt in die Label-Fläche.
		const area = labelArea(shape, a.data.width, a.data.height);
		expect(area.w).toBeGreaterThanOrEqual(measure('Ein Text') + 32 - 0.01);
		expect(area.h).toBeGreaterThanOrEqual(18 + 24 - 0.01);
		// Bestandsform unverändert.
		expect([b.data.width, b.data.height]).toEqual([80, 42]);
	});

	it('manuelles Layout nutzt dieselbe Größe', () => {
		const doc = parseOk('flowchart LR\nA@{ shape: lin-cyl }\n');
		const auto = toFlow(doc, state, measure).nodes[0];
		const manual = toFlow(
			{ ...doc, layout: { ...doc.layout, mode: 'manual', positions: { A: [0, 0, 1, 1] } } },
			state,
			measure
		).nodes[0];
		expect([manual.data.width, manual.data.height]).toEqual([auto.data.width, auto.data.height]);
	});

	it('Formwechsel Klammer -> neue Form rechnet die Größe neu (Layout-Cache)', () => {
		const doc = parseOk('flowchart LR\nA[Text] --> B\n');
		const before = toFlow(doc, state, measure).nodes.find((n) => n.id === 'A')!;
		const next = updateNode(doc, 'A', { shape: 'doc' });
		const after = toFlow(next, state, measure).nodes.find((n) => n.id === 'A')!;
		expect(after.data.height).toBeGreaterThan(before.data.height);
		const back = toFlow(updateNode(next, 'A', { shape: 'square' }), state, measure).nodes[0];
		expect([back.data.width, back.data.height]).toEqual([before.data.width, before.data.height]);
	});

	it('zugänglicher Name nennt die Form (DE/EN)', () => {
		applyLocale('de');
		expect(nodeAriaLabel('shape', 'doc', 'X')).toBe('Dokument: X');
		expect(nodeAriaLabel('shape', 'lin-cyl', '')).toBe('Zylinder mit Linie (Festplatte)');
		applyLocale('en');
		expect(nodeAriaLabel('shape', 'delay', 'X')).toBe('Delay: X');
		expect(nodeAriaLabel('shape', 'sl-rect', 'X')).toBe('Manual input: X');
		expect(nodeAriaLabel('shape', 'h-cyl', 'X')).toBe(
			'Horizontal cylinder (direct access storage): X'
		);
	});
});

describe('ShapeNode: neue Formen', () => {
	it.each([...META_SHAPE_NAMES])(
		'%s: Umriss aus shapePath, Label mittig in der Label-Fläche',
		async (shape) => {
			const { target } = await mountCanvas(`flowchart LR\nA@{ shape: ${shape}, label: "Text" }\n`);
			const el = nodeEl(target, 'A')!;
			const w = parseFloat(el.querySelector<HTMLElement>('.shape')!.style.width);
			const h = parseFloat(el.querySelector<HTMLElement>('.shape')!.style.height);
			expect(el.querySelector('path.outline')!.getAttribute('d')).toBe(shapePath(shape, w, h));
			const span = el.querySelector('tspan')!;
			const area = labelArea(shape, w, h);
			expect(Number(span.getAttribute('x'))).toBeCloseTo(area.x + area.w / 2, 5);
			expect(Number(span.getAttribute('y'))).toBeCloseTo(area.y + area.h / 2, 5);
			expect(span.textContent).toBe('Text');
		}
	);
});
