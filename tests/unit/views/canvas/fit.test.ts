// @vitest-environment jsdom
// T26 E1: "Einpassen" muss auch nach Code-Eingabe wirken. jsdom misst nichts; die Stubs liefern
// Knotenmaße aus dem Inline-Style und melden jeden beobachteten Knoten einmal wie ein Browser.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIT_PADDING, fitFrame, fitPadding } from '../../../../src/lib/views/canvas/graph/fit';
import { docOf, installBrowserStubs, mountCanvas, settle, unmountAll } from './helpers';

type Box = { x: number; y: number; w: number; h: number };
type Control = {
	fit(): void;
	zoomIn(): void;
	viewport(): { x: number; y: number; zoom: number };
	geometry(): Record<string, Box>;
};

beforeAll(() => {
	const g = globalThis as Record<string, unknown>;
	g.ResizeObserver = class {
		constructor(private cb: (entries: { target: Element }[]) => void) {}
		observe(target: Element) {
			if (target.classList.contains('svelte-flow__node')) {
				queueMicrotask(() => this.cb([{ target }]));
			}
		}
		unobserve() {}
		disconnect() {}
	};
	const px = (el: HTMLElement, key: 'width' | 'height') => parseFloat(el.style[key]) || 0;
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
		configurable: true,
		get(this: HTMLElement) {
			return px(this, 'width');
		}
	});
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
		configurable: true,
		get(this: HTMLElement) {
			return px(this, 'height');
		}
	});
	installBrowserStubs();
});
afterEach(unmountAll);

const TWO = 'flowchart LR\n  A --> B\n';

/** Zoom weg vom Einpass-Wert, dann einpassen; liefert Zoom davor und danach. */
async function zoomThenFit(control: Control) {
	control.zoomIn();
	await settle();
	const before = control.viewport().zoom;
	control.fit();
	await settle();
	return { before, after: control.viewport().zoom };
}

describe('GraphFlow: Einpassen nach Code-Eingabe (T26 E1)', () => {
	it('Einpassen wirkt vor und nach gültiger Code-Eingabe gleich', async () => {
		let control: Control | null = null;
		const { sync } = await mountCanvas(TWO, { oncontrol: (c: Control) => (control = c) });
		await settle();

		const start = await zoomThenFit(control!);
		expect(start.after).not.toBe(start.before);

		sync.editCode('flowchart LR\n  A --> B\n  B --> C\n');
		await sync.flush();
		await settle();
		const edited = await zoomThenFit(control!);
		expect(edited.after).not.toBe(edited.before);
		expect(edited.after).toBe(start.after);
	});

	it('Einpassen wirkt nach Rückkehr von ungültigem zu gültigem Code', async () => {
		let control: Control | null = null;
		const { sync } = await mountCanvas(TWO, { oncontrol: (c: Control) => (control = c) });
		await settle();
		const start = await zoomThenFit(control!);

		sync.editCode('flowchart LR\n  A --> B\n  %%FEHLER\n');
		await sync.flush();
		await settle();
		sync.editCode(TWO);
		await sync.flush();
		await settle();
		const back = await zoomThenFit(control!);
		expect(back.after).not.toBe(back.before);
		expect(back.after).toBe(start.after);
	});
});

// T122 (V-21): Fläche 400x300 nur für den Canvas-Wrapper (jsdom misst nichts).
const PANE = { width: 400, height: 300 };

describe('GraphFlow: neuer Knoten im Auto-Layout sichtbar (T122)', () => {
	beforeAll(() => {
		for (const [key, value] of [
			['clientWidth', PANE.width],
			['clientHeight', PANE.height]
		] as const) {
			Object.defineProperty(HTMLElement.prototype, key, {
				configurable: true,
				get(this: HTMLElement) {
					return this.classList.contains('graph-canvas') ? value : 0;
				}
			});
		}
	});

	const inside = (b: Box, v: { x: number; y: number; zoom: number }) =>
		b.x * v.zoom + v.x >= 0 &&
		b.y * v.zoom + v.y >= 0 &&
		(b.x + b.w) * v.zoom + v.x <= PANE.width &&
		(b.y + b.h) * v.zoom + v.y <= PANE.height;

	it('5 Knoten nacheinander: jeder neue Knoten vollständig sichtbar, Zoom bleibt, keine pos', async () => {
		let control: Control | null = null;
		const { sync, target } = await mountCanvas('flowchart LR\n  A --> B\n', {
			oncontrol: (c: Control) => (control = c)
		});
		await settle();
		for (let i = 0; i < 4; i++) control!.zoomIn();
		await settle();
		const zoom = control!.viewport().zoom;
		const pane = target.querySelector('.svelte-flow__pane')!;
		let moved = 0;
		for (let k = 1; k <= 5; k++) {
			const before = control!.viewport();
			pane.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 5, clientY: 5 }));
			await settle();
			const doc = docOf(sync);
			const id = doc.nodes.at(-1)!.id;
			expect(doc.nodes).toHaveLength(2 + k);
			expect(doc.layout.positions[id]).toBeUndefined();
			const view = control!.viewport();
			expect(view.zoom).toBe(zoom);
			expect(inside(control!.geometry()[id], view)).toBe(true);
			if (view.x !== before.x || view.y !== before.y) moved++;
		}
		expect(moved).toBeGreaterThan(0);
		expect(docOf(sync).layout.mode).toBe('auto');
	});
});

// Aus shell-props.test.ts hierher verschoben (O-141 b: fitPadding in graph/fit.ts).
describe('fitPadding: Vorschau-Rand beim Einpassen aussparen (T126 C1, M-12)', () => {
	const frame = { width: 600, height: 500 };

	it('ohne Rand oder ohne Maße: Standard-Abstand', () => {
		expect(fitPadding(null, frame)).toBe(FIT_PADDING);
		expect(fitPadding(undefined, frame)).toBe(FIT_PADDING);
		expect(fitPadding({ right: 0, bottom: 40 }, frame)).toBe(FIT_PADDING);
		expect(fitPadding({ right: 240, bottom: 40 }, { width: 0, height: 0 })).toBe(FIT_PADDING);
	});

	it('zugeklappte Karte (flach): unten aussparen, übrige Seiten Standard', () => {
		expect(fitPadding({ right: 242, bottom: 50 }, frame)).toEqual({
			top: FIT_PADDING,
			left: FIT_PADDING,
			right: FIT_PADDING,
			bottom: '50px'
		});
	});

	it('hohe Karte bei breiter Fläche: rechts aussparen (kleinerer Anteil)', () => {
		expect(fitPadding({ right: 242, bottom: 300 }, { width: 1200, height: 500 })).toEqual({
			top: FIT_PADDING,
			left: FIT_PADDING,
			right: '242px',
			bottom: FIT_PADDING
		});
	});

	it('Bruchteile werden aufgerundet', () => {
		expect(fitPadding({ right: 500, bottom: 41.2 }, frame)).toMatchObject({ bottom: '42px' });
	});

	it('schmale Fläche: kostet auch die günstigere Seite mehr als die Hälfte, Standard-Abstand', () => {
		const narrow = { width: 700, height: 300 };
		expect(fitPadding({ right: 380, bottom: 160 }, narrow)).toBe(FIT_PADDING);
		// Genau die Hälfte bleibt ausgespart.
		expect(fitPadding({ right: 350, bottom: 200 }, narrow)).toMatchObject({ right: '350px' });
	});
});

describe('fitFrame: Rahmen ohne Vorschau-Rand für das Sequenz-Einpassen (T126 C3, O-141)', () => {
	const frame = { width: 600, height: 500 };

	it('ohne Rand, ohne Überlappung oder ohne Maße: unveränderter Rahmen', () => {
		expect(fitFrame(frame, null)).toEqual(frame);
		expect(fitFrame(frame, undefined)).toEqual(frame);
		expect(fitFrame(frame, { right: 0, bottom: 40 })).toEqual(frame);
		expect(fitFrame(frame, { right: 240, bottom: -5 })).toEqual(frame);
		expect(fitFrame({ width: 0, height: 0 }, { right: 240, bottom: 40 })).toEqual({
			width: 0,
			height: 0
		});
	});

	it('gleiche Seitenwahl wie fitPadding: flache Karte unten, hohe Karte rechts', () => {
		expect(fitFrame(frame, { right: 242, bottom: 50 })).toEqual({ width: 600, height: 450 });
		expect(fitFrame({ width: 1200, height: 500 }, { right: 242, bottom: 300 })).toEqual({
			width: 958,
			height: 500
		});
		expect(fitFrame(frame, { right: 500, bottom: 41.2 })).toEqual({ width: 600, height: 458 });
	});

	it('schmale Fläche: Standard (kein Abzug), genau die Hälfte wird abgezogen', () => {
		const narrow = { width: 700, height: 300 };
		expect(fitFrame(narrow, { right: 380, bottom: 160 })).toEqual(narrow);
		expect(fitFrame(narrow, { right: 350, bottom: 200 })).toEqual({ width: 350, height: 300 });
	});
});
