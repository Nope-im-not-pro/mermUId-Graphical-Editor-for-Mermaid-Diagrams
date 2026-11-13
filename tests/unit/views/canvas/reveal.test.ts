// @vitest-environment jsdom
// T123 C3 (O-118, O-123): CanvasControl.reveal(id) holt einen Knoten bei gleichem Zoom ins Sichtfeld.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CanvasControl } from '../../../../src/lib/views/canvas/graph/GraphFlow.svelte';
import { installBrowserStubs, mountCanvas, settle, unmountAll } from './helpers';

type Box = { x: number; y: number; w: number; h: number };
type View = { x: number; y: number; zoom: number };
/** Fläche nur für den Canvas-Wrapper (jsdom misst nichts), wie T122 in fit.test.ts. */
const PANE = { width: 400, height: 300 };

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
	for (const [key, size, pane] of [
		['offsetWidth', 'width', 'clientWidth'],
		['offsetHeight', 'height', 'clientHeight']
	] as const) {
		Object.defineProperty(HTMLElement.prototype, key, {
			configurable: true,
			get(this: HTMLElement) {
				return px(this, size);
			}
		});
		Object.defineProperty(HTMLElement.prototype, pane, {
			configurable: true,
			get(this: HTMLElement) {
				return this.classList.contains('graph-canvas') ? PANE[size] : 0;
			}
		});
	}
	installBrowserStubs();
});
afterEach(unmountAll);

const CHAIN = 'flowchart LR\n  A --> B --> C --> D --> E --> F\n';

const inside = (b: Box, v: View) =>
	b.x * v.zoom + v.x >= 0 &&
	b.y * v.zoom + v.y >= 0 &&
	(b.x + b.w) * v.zoom + v.x <= PANE.width &&
	(b.y + b.h) * v.zoom + v.y <= PANE.height;

async function zoomedChain() {
	let control: CanvasControl | null = null;
	await mountCanvas(CHAIN, { oncontrol: (c: CanvasControl) => (control = c) });
	await settle();
	for (let i = 0; i < 4; i++) control!.zoomIn();
	await settle();
	return control!;
}

describe('CanvasControl.reveal (T123 C3)', () => {
	it('Knoten außerhalb: danach vollständig sichtbar, Zoom unverändert', async () => {
		const control = await zoomedChain();
		const before = control.viewport();
		const geometry = control.geometry();
		const hidden = ['A', 'B', 'C', 'D', 'E', 'F'].filter((id) => !inside(geometry[id], before));
		expect(hidden.length).toBeGreaterThan(0);
		for (const id of hidden) {
			control.reveal(id);
			await settle();
			const view = control.viewport();
			expect(view.zoom).toBe(before.zoom);
			expect(inside(control.geometry()[id], view)).toBe(true);
		}
	});

	it('sichtbarer Knoten: Ansicht bleibt', async () => {
		const control = await zoomedChain();
		control.reveal('F');
		await settle();
		const before = control.viewport();
		expect(inside(control.geometry()['F'], before)).toBe(true);
		control.reveal('F');
		await settle();
		expect(control.viewport()).toEqual(before);
	});

	it('unbekannte ID: Ansicht bleibt', async () => {
		const control = await zoomedChain();
		const before = control.viewport();
		control.reveal('fehlt');
		await settle();
		expect(control.viewport()).toEqual(before);
	});
});
