// @vitest-environment jsdom
// T123 C3 (O-118, O-123): Palette-Einfügen im Auto-Layout holt den neuen Knoten ins Sichtfeld.
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installBrowserStubs } from '../canvas/helpers';
import { DRAG_TYPE } from '../../../../src/lib/views/shell/palette';
import { button, docOf, mountShell, settle, unmountShells } from './helpers';

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
afterEach(unmountShells);

function drop(target: Element, data: string) {
	const dataTransfer = { types: [DRAG_TYPE], getData: () => data, dropEffect: 'none' };
	for (const type of ['dragover', 'drop']) {
		const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
		Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
		target.dispatchEvent(e);
	}
	flushSync();
}

/** Viewport aus dem Transform der Flow-Ebene, Knotenrechteck aus Transform und Inline-Größe. */
function viewOf(target: HTMLElement) {
	const t = target.querySelector<HTMLElement>('.svelte-flow__viewport')!.style.transform;
	const [, x, y, zoom] = /translate\(([-\d.e]+)px, ?([-\d.e]+)px\) scale\(([\d.e]+)\)/.exec(t)!;
	return { x: Number(x), y: Number(y), zoom: Number(zoom) };
}

function boxOf(target: HTMLElement, id: string) {
	const el = target.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${id}"]`)!;
	const [, x, y] = /translate\(([-\d.e]+)px, ?([-\d.e]+)px\)/.exec(el.style.transform)!;
	return { x: Number(x), y: Number(y), w: el.offsetWidth, h: el.offsetHeight };
}

describe('Shell: Palette-Einfügen im Auto-Layout (T123 C3)', () => {
	it('neuer Knoten nach Drop vollständig sichtbar, Zoom unverändert', async () => {
		const { sync, target } = await mountShell('flowchart LR\n  A --> B --> C\n');
		await settle();
		const zoomIn = button(target, 'Zoom + vergrößern');
		for (let i = 0; i < 4; i++) zoomIn.click();
		await settle();
		const zoom = viewOf(target).zoom;
		let moved = 0;
		for (let k = 1; k <= 3; k++) {
			const before = viewOf(target);
			drop(target.querySelector('.shell-canvas')!, 'shape:diamond');
			await settle();
			const doc = docOf(sync);
			expect(doc.layout.mode).toBe('auto');
			expect(doc.nodes).toHaveLength(3 + k);
			const id = doc.nodes.at(-1)!.id;
			const view = viewOf(target);
			const b = boxOf(target, id);
			expect(view.zoom).toBe(zoom);
			expect(b.x * view.zoom + view.x).toBeGreaterThanOrEqual(0);
			expect(b.y * view.zoom + view.y).toBeGreaterThanOrEqual(0);
			expect((b.x + b.w) * view.zoom + view.x).toBeLessThanOrEqual(PANE.width);
			expect((b.y + b.h) * view.zoom + view.y).toBeLessThanOrEqual(PANE.height);
			if (view.x !== before.x || view.y !== before.y) moved++;
		}
		expect(moved).toBeGreaterThan(0);
	});
});
