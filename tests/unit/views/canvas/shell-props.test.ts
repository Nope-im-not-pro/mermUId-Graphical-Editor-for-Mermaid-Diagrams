// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { get } from 'svelte/store';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FIT_PADDING } from '../../../../src/lib/views/canvas/graph/fit';
import GraphCanvas from '../../../../src/lib/views/canvas/graph/GraphCanvas.svelte';
import { createSync } from '../../../../src/lib/controllers/sync';
import { fakeAdapters } from '../../controllers/sync/helpers';
import {
	docOf,
	installBrowserStubs,
	measure,
	mountCanvas,
	nodeEl,
	settle,
	unmountAll
} from './helpers';

/** jsdom hat keine Pane-Maße; Zoom/Fit werden daher an der API-Naht gemessen. */
const calls = vi.hoisted(() => [] as string[]);
/** Optionen der fitView-Aufrufe (T126 C1, M-12). */
const fits = vi.hoisted(() => [] as unknown[]);
vi.mock('@xyflow/svelte', async (original) => {
	const real = await original<typeof import('@xyflow/svelte')>();
	return {
		...real,
		useSvelteFlow: () => {
			const api = real.useSvelteFlow();
			return {
				...api,
				setZoom: (z: number, o?: unknown) => (
					calls.push(`zoom:${z.toFixed(3)}:${JSON.stringify(o)}`),
					api.setZoom(z, o as never)
				),
				fitView: (o?: unknown) => (calls.push('fit'), fits.push(o), api.fitView(o as never)),
				setCenter: (x: number, y: number, o?: unknown) => (
					calls.push(`center:${x},${y}:${JSON.stringify(o)}`),
					api.setCenter(x, y, o as never)
				)
			};
		}
	};
});

beforeAll(installBrowserStubs);
afterEach(unmountAll);

const TWO = 'flowchart LR\n  A --> B\n';

type Control = {
	zoomIn(): void;
	zoomOut(): void;
	fit(): void;
	viewport(): { x: number; y: number; zoom: number };
	select(ids: string[], center?: boolean): void;
	selection(): string[];
	geometry(): Record<string, { x: number; y: number; w: number; h: number }>;
	toggleGrid(): void;
	focus(): void;
};

const press = (el: Element, key: string, mods: KeyboardEventInit = {}) =>
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));

function focusNode(target: HTMLElement, id: string) {
	const el = nodeEl(target, id)!;
	el.focus();
	return el;
}

function click(target: HTMLElement, id: string, ctrlKey = false) {
	if (ctrlKey) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey }));
	nodeEl(target, id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey }));
	if (ctrlKey) window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
	flushSync();
}

describe('GraphCanvas: additive Props der Shell (T21)', () => {
	it('onselect meldet die Auswahl bei jeder Änderung genau einmal', async () => {
		const onselect = vi.fn();
		const { target } = await mountCanvas(TWO, { onselect });
		expect(onselect).not.toHaveBeenCalled();
		click(target, 'A');
		expect(onselect).toHaveBeenLastCalledWith(['A']);
		click(target, 'B', true);
		expect(onselect).toHaveBeenLastCalledWith(['A', 'B']);
		const calls = onselect.mock.calls.length;
		click(target, 'B', true);
		click(target, 'B', true);
		expect(onselect.mock.calls.length).toBeGreaterThan(calls);
		expect(onselect).toHaveBeenLastCalledWith(['A', 'B']);
	});

	it('Auswahl bleibt nach Modell-Änderung, ohne erneuten Aufruf', async () => {
		const onselect = vi.fn();
		const { sync, target } = await mountCanvas(TWO, { onselect });
		click(target, 'A');
		const calls = onselect.mock.calls.length;
		await sync.execute({ label: 'x', do: (d) => ({ ...d, title: 'T' }) });
		await settle();
		expect(onselect.mock.calls.length).toBe(calls);
	});

	it('oncontrol liefert Zoom, Fit und Viewport', async () => {
		let control: Control | null = null;
		await mountCanvas(TWO, { oncontrol: (c: Control) => (control = c) });
		expect(control).not.toBeNull();
		calls.length = 0;
		control!.zoomIn();
		control!.zoomOut();
		control!.fit();
		await settle();
		expect(calls).toEqual(['zoom:1.200:{"duration":0}', 'zoom:1.000:{"duration":0}', 'fit']);
		expect(control!.viewport()).toEqual({ x: 0, y: 0, zoom: 1 });
	});

	it('Zoom-Schritte bleiben in den Grenzen 25 bis 400 %', async () => {
		let control: Control | null = null;
		await mountCanvas(TWO, { oncontrol: (c: Control) => (control = c) });
		for (let i = 0; i < 20; i++) control!.zoomIn();
		await settle();
		expect(control!.viewport().zoom).toBe(4);
		for (let i = 0; i < 30; i++) control!.zoomOut();
		await settle();
		expect(control!.viewport().zoom).toBe(0.25);
	});

	it('ohne neue Props unverändertes Verhalten', async () => {
		const { sync, target } = await mountCanvas(TWO);
		click(target, 'A');
		expect(docOf(sync).nodes).toHaveLength(2);
		expect(nodeEl(target, 'A')!.classList.contains('selected')).toBe(true);
	});

	it('control.select setzt Auswahl und zentriert bei gleichem Zoom', async () => {
		let control: Control | null = null;
		const onselect = vi.fn();
		const { target } = await mountCanvas(TWO, {
			onselect,
			oncontrol: (c: Control) => (control = c)
		});
		calls.length = 0;
		control!.select(['B']);
		await settle();
		expect(control!.selection()).toEqual(['B']);
		expect(nodeEl(target, 'B')!.classList.contains('selected')).toBe(true);
		expect(onselect).toHaveBeenLastCalledWith(['B']);
		const box = control!.geometry().B;
		expect(calls).toEqual([
			`center:${box.x + box.w / 2},${box.y + box.h / 2}:{"zoom":1,"duration":0}`
		]);
		calls.length = 0;
		control!.select(['A', 'B'], false);
		await settle();
		expect(control!.selection()).toEqual(['A', 'B']);
		expect(calls).toEqual([]);
	});

	it('control.toggleGrid blendet das Raster aus und ein, focus fokussiert den Canvas', async () => {
		let control: Control | null = null;
		const { target } = await mountCanvas(TWO, { oncontrol: (c: Control) => (control = c) });
		expect(target.querySelector('.svelte-flow__background')).not.toBeNull();
		control!.toggleGrid();
		flushSync();
		expect(target.querySelector('.svelte-flow__background')).toBeNull();
		control!.toggleGrid();
		flushSync();
		expect(target.querySelector('.svelte-flow__background')).not.toBeNull();
		control!.focus();
		expect(document.activeElement).toBe(target.querySelector('.graph-canvas'));
	});

	it('beforedelete: false bricht ab, Shift-Entf meldet force', async () => {
		const answers: boolean[] = [false, true];
		const beforedelete = vi.fn(async () => answers.shift()!);
		const { sync, target } = await mountCanvas(TWO, { beforedelete });
		press(focusNode(target, 'A'), 'Delete');
		await settle();
		expect(beforedelete).toHaveBeenLastCalledWith(['A'], false);
		expect(docOf(sync).nodes).toHaveLength(2);
		press(focusNode(target, 'A'), 'Delete', { shiftKey: true });
		await settle();
		expect(beforedelete).toHaveBeenLastCalledWith(['A'], true);
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['B']);
	});
});

/** Maße der Graph-Fläche (jsdom misst nicht); nur `.graph-canvas`, übrige Elemente messen 0. */
function stubFrame(width: number, height: number) {
	const proto = HTMLElement.prototype;
	const size = { clientWidth: width, clientHeight: height };
	const keys = ['clientWidth', 'clientHeight'] as const;
	const saved = keys.map((key) => Object.getOwnPropertyDescriptor(proto, key));
	for (const key of keys) {
		Object.defineProperty(proto, key, {
			configurable: true,
			get(this: HTMLElement) {
				return this.classList.contains('graph-canvas') ? size[key] : 0;
			}
		});
	}
	return () =>
		keys.forEach((key, i) => {
			if (saved[i]) Object.defineProperty(proto, key, saved[i]);
			else delete (proto as unknown as Record<string, unknown>)[key];
		});
}

/**
 * Graph-Canvas mit reaktivem `reserve` (Getter auf einer SvelteMap): `mountCanvas` kopiert die
 * Props per Spread und verliert damit die Reaktivität.
 */
async function mountLive(initial: { right: number; bottom: number }) {
	const props = new SvelteMap<'reserve', { right: number; bottom: number }>([['reserve', initial]]);
	let control: Control | null = null;
	const sync = await createSync(TWO, { adapters: fakeAdapters, timer: liveTimer });
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(GraphCanvas, {
		target,
		props: {
			sync,
			measure,
			oncontrol: (c: Control) => (control = c),
			get reserve() {
				return props.get('reserve');
			}
		}
	});
	flushSync();
	live.push(() => {
		unmount(app);
		target.remove();
		sync.dispose();
	});
	return {
		sync,
		target,
		control: () => control!,
		reserve: (r: { right: number; bottom: number }) => (props.set('reserve', r), flushSync())
	};
}
const liveTimer = { set: () => 0, clear: () => {} };
const live: (() => void)[] = [];
afterEach(() => {
	while (live.length > 0) live.pop()!();
});

describe('GraphCanvas: Einpassen mit Vorschau-Rand, Raster-Schalter in der Shell (T126 C1)', () => {
	let restore: (() => void) | null = null;
	afterEach(() => {
		restore?.();
		restore = null;
	});

	// Fläche 600x500, Rand 300x60: unten kostet 60/500 < 300/600 -> unten 60 px aussparen.
	const reserve = { right: 300, bottom: 60 };
	const reserved = { top: FIT_PADDING, left: FIT_PADDING, right: FIT_PADDING, bottom: '60px' };

	it('control.fit spart den gemeldeten Rand aus, ohne Rand Standard-Abstand', async () => {
		restore = stubFrame(600, 500);
		let control: Control | null = null;
		await mountCanvas(TWO, { oncontrol: (c: Control) => (control = c) });
		fits.length = 0;
		control!.fit();
		await settle();
		expect(fits).toEqual([{ padding: FIT_PADDING }]);
		unmountAll();
		await mountCanvas(TWO, { oncontrol: (c: Control) => (control = c), reserve });
		fits.length = 0;
		control!.fit();
		await settle();
		expect(fits).toEqual([{ padding: reserved }]);
	});

	it('Rand-Meldung ohne Nutzer-Bewegung: nachpassen; ohne Rand nicht', async () => {
		restore = stubFrame(600, 500);
		fits.length = 0;
		await mountCanvas(TWO);
		await settle();
		expect(fits).toEqual([]);
		unmountAll();
		await mountCanvas(TWO, { reserve });
		await settle();
		expect(fits).toEqual([{ maxZoom: 1, padding: reserved }]);
	});

	// Fläche 600x500, Rand 300x80: unten 80 px aussparen.
	const next = { right: 300, bottom: 80 };
	const nextPadding = { ...reserved, bottom: '80px' };

	it('geänderter Rand ohne Bewegung und ohne Modell-Änderung: nachpassen (Gegenprobe)', async () => {
		restore = stubFrame(600, 500);
		const live = await mountLive(reserve);
		await settle();
		fits.length = 0;
		live.reserve(next);
		await settle();
		expect(fits).toEqual([{ maxZoom: 1, padding: nextPadding }]);
	});

	it('geänderter Rand nach Zoom über die Shell: kein Einpassen', async () => {
		restore = stubFrame(600, 500);
		const live = await mountLive(reserve);
		await settle();
		live.control().zoomIn();
		fits.length = 0;
		live.reserve(next);
		await settle();
		expect(fits).toEqual([]);
	});

	// `click` entsteht bei Maus und bei Enter/Leertaste auf dem Knopf (C1-Review 3).
	it('geänderter Rand nach Klick auf die Flow-Controls (Maus oder Tastatur): kein Einpassen', async () => {
		restore = stubFrame(600, 500);
		const live = await mountLive(reserve);
		await settle();
		const button = live.target.querySelector<HTMLButtonElement>('.svelte-flow__controls button')!;
		button.click();
		fits.length = 0;
		live.reserve(next);
		await settle();
		expect(fits).toEqual([]);
	});

	it('geänderter Rand nach Modell-Änderung: kein Einpassen, auch nach Rückkehr zum Ausgangscode', async () => {
		restore = stubFrame(600, 500);
		const live = await mountLive(reserve);
		await settle();
		live.sync.editCode('flowchart LR\n  A --> B\n  B --> C\n');
		await live.sync.flush();
		await settle();
		fits.length = 0;
		live.reserve(next);
		await settle();
		expect(fits).toEqual([]);
		live.sync.editCode(TWO);
		await live.sync.flush();
		await settle();
		// Bisher nicht gemeldeter Rand (C1-Review 2): weder `reserve` noch `next`.
		live.reserve({ right: 300, bottom: 100 });
		await settle();
		expect(fits).toEqual([]);
	});

	it('geänderter Rand, nachdem sich nur die Fehlerliste änderte: kein Einpassen', async () => {
		restore = stubFrame(600, 500);
		const live = await mountLive(reserve);
		await settle();
		const doc = docOf(live.sync);
		live.sync.editCode(TWO + '  %%FEHLER\n');
		await live.sync.flush();
		await settle();
		// Ungültiger Code: Modell bleibt, nur die Fehlerliste ändert sich (C1-Review 1).
		expect(docOf(live.sync)).toBe(doc);
		expect(get(live.sync).errors.length).toBeGreaterThan(0);
		fits.length = 0;
		live.reserve(next);
		await settle();
		expect(fits).toEqual([]);
	});

	it('Rohblöcke oben links, unten links nur die Controls (O-141 c)', async () => {
		const { target } = await mountCanvas('flowchart LR\n  accTitle: Titel\n  A --> B\n');
		const raw = target.querySelector('[data-testid="raw-blocks"]')!;
		expect(raw.closest('.svelte-flow__panel.top.left')).not.toBeNull();
		const bottomLeft = [...target.querySelectorAll('.svelte-flow__panel.bottom.left')];
		expect(bottomLeft).toHaveLength(1);
		expect(bottomLeft[0].classList.contains('svelte-flow__controls')).toBe(true);
	});

	it('keine eigenen Raster-Schalter (CanvasBar), ongrid meldet die Sichtbarkeit', async () => {
		let control: Control | null = null;
		const ongrid = vi.fn();
		const { target } = await mountCanvas(TWO, {
			ongrid,
			oncontrol: (c: Control) => (control = c)
		});
		const toggles = [...target.querySelectorAll('button')].filter((b) =>
			['Raster', 'Einrasten', 'Grid', 'Snap'].includes(b.textContent?.trim() ?? '')
		);
		expect(toggles).toEqual([]);
		expect(target.querySelector('button[aria-pressed]')).toBeNull();
		expect(target.querySelector('.svelte-flow__panel.top.right')).toBeNull();
		expect(ongrid).toHaveBeenLastCalledWith(true);
		control!.toggleGrid();
		flushSync();
		expect(ongrid).toHaveBeenLastCalledWith(false);
	});
});
