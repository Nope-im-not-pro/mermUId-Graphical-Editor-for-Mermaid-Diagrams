// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { clampZoom, FIT_MARGIN } from '../../../../src/lib/views/canvas/common/viewport';
import type { Reserve } from '../../../../src/lib/views/canvas/graph/fit';
import type { SequenceControl } from '../../../../src/lib/views/canvas/sequence/SequenceCanvas.svelte';
import { codeOf, SAMPLE } from './helpers';
import { itemEl, mountSequence, settle, unmountAll } from './mount';

afterEach(unmountAll);

async function setup(text = SAMPLE, props: Record<string, unknown> = {}) {
	let control!: SequenceControl;
	const zooms: string[] = [];
	const mounted = await mountSequence(text, {
		oncontrol: (c: SequenceControl) => (control = c),
		onzoom: (p: string) => zooms.push(p),
		...props
	});
	const surface = mounted.target.querySelector<HTMLElement>('[role="application"]')!;
	const svg = surface.querySelector('svg')!;
	const [minX, minY, width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
	/** Rahmen so stubben, dass `fit` (mit Rand) `zoom` ergibt (jsdom misst nicht). */
	const zoomTo = (zoom: number) => {
		const frame = (size: number) => ({ configurable: true, value: (size * zoom) / FIT_MARGIN });
		Object.defineProperty(surface, 'clientWidth', frame(width));
		Object.defineProperty(surface, 'clientHeight', frame(height));
		control.fit();
		flushSync();
	};
	return { ...mounted, control, zooms, surface, svg, minX, minY, width, height, zoomTo };
}

const center = (target: HTMLElement, id: string) => {
	const rect = itemEl(target, id)!.querySelector('rect')!;
	return Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
};

function dragX(target: HTMLElement, id: string, dx: number) {
	const el = itemEl(target, id)!;
	const at = { bubbles: true, clientX: 0, clientY: 0, button: 0 };
	el.dispatchEvent(new MouseEvent('pointerdown', at));
	window.dispatchEvent(new MouseEvent('pointermove', { ...at, clientX: dx }));
	window.dispatchEvent(new MouseEvent('pointerup', { ...at, clientX: dx }));
}

const aFirst = (code: string) => code.indexOf('participant A') < code.indexOf('actor B');

const ROWS = [
	'sequenceDiagram',
	'    participant A',
	'    participant B',
	'    A->>B: eins',
	'    A->>B: zwei',
	'    A->>B: drei',
	''
].join('\n');

const message = (target: HTMLElement, label: string) =>
	[...target.querySelectorAll<SVGGElement>('[data-id]')].find(
		(el) => el.querySelector('text')?.textContent === label
	)!;

const top = (target: HTMLElement, label: string) =>
	Number(message(target, label).querySelector('rect')!.getAttribute('y'));

function dragY(el: Element, dy: number) {
	const at = { bubbles: true, clientX: 0, clientY: 0, button: 0 };
	el.dispatchEvent(new MouseEvent('pointerdown', at));
	window.dispatchEvent(new MouseEvent('pointermove', { ...at, clientY: dy }));
	window.dispatchEvent(new MouseEvent('pointerup', { ...at, clientY: dy }));
}

const rows = (code: string) =>
	['eins', 'zwei', 'drei'].sort((a, b) => code.indexOf(`: ${a}`) - code.indexOf(`: ${b}`));

describe('SequenceCanvas: Zoom-Schnittstelle (T124)', () => {
	it('zoomIn, zoomOut, fit und viewport wie der Graph-Canvas', async () => {
		const { control, zooms, surface, svg, minX, minY, width, height, zoomTo } = await setup();
		expect(control.viewport()).toEqual({ x: -minX, y: -minY, zoom: 1 });
		expect(zooms.at(-1)).toBe('100 %');
		control.zoomIn();
		flushSync();
		expect(control.viewport().zoom).toBeCloseTo(1.2);
		expect(zooms.at(-1)).toBe('120 %');
		control.zoomOut();
		flushSync();
		expect(control.viewport().zoom).toBeCloseTo(1);
		zoomTo(0.5);
		expect(control.viewport().zoom).toBeCloseTo(0.5);
		expect(zooms.at(-1)).toBe('50 %');
		// CSS-Skalierung: Anzeigegröße wächst mit, viewBox bleibt im Modellmaß.
		expect(Number(svg.getAttribute('width'))).toBeCloseTo(width * 0.5);
		expect(Number(svg.getAttribute('height'))).toBeCloseTo(height * 0.5);
		expect(svg.getAttribute('viewBox')!.split(' ').map(Number).slice(2)).toEqual([width, height]);
		// fit lässt Rand: kein Rest-Scroll durch Rundung.
		expect(Number(svg.getAttribute('width'))).toBeLessThan(surface.clientWidth);
		expect(Number(svg.getAttribute('height'))).toBeLessThan(surface.clientHeight);
	});

	it('viewport rechnet wie CanvasControl: Modell = (Client - Fläche - x) / zoom', async () => {
		const { target, control, surface, minX, minY, zoomTo } = await setup();
		zoomTo(2);
		expect(minX).not.toBe(0);
		expect(minY).not.toBe(0);
		Object.defineProperty(surface, 'scrollLeft', { configurable: true, value: 30 });
		Object.defineProperty(surface, 'scrollTop', { configurable: true, value: 20 });
		const rect = itemEl(target, 'A')!.querySelector('rect')!;
		const model = { x: Number(rect.getAttribute('x')), y: Number(rect.getAttribute('y')) };
		const { left, top } = surface.getBoundingClientRect();
		const vp = control.viewport();
		// Bildschirmlage des Modellpunkts in der gescrollten, skalierten Fläche.
		const client = {
			x: left + (model.x - minX) * vp.zoom - 30,
			y: top + (model.y - minY) * vp.zoom - 20
		};
		expect((client.x - left - vp.x) / vp.zoom).toBeCloseTo(model.x);
		expect((client.y - top - vp.y) / vp.zoom).toBeCloseTo(model.y);
	});

	it('Zoom bleibt in 25 bis 400 %', async () => {
		const { control } = await setup();
		for (let i = 0; i < 30; i++) control.zoomIn();
		flushSync();
		expect(control.viewport().zoom).toBe(4);
		for (let i = 0; i < 30; i++) control.zoomOut();
		flushSync();
		expect(control.viewport().zoom).toBe(0.25);
	});
});

describe('SequenceCanvas: Ziehen und Editor bei 50 % und 200 % (T124)', () => {
	it('200 %: anderthalbfacher Abstand am Bildschirm ist im Modell zu kurz', async () => {
		const { sync, target, zoomTo } = await setup();
		zoomTo(2);
		const gap = center(target, 'B') - center(target, 'A');
		dragX(target, 'A', gap * 1.5);
		await settle();
		expect(aFirst(codeOf(sync))).toBe(true);
		dragX(target, 'A', gap * 2.5);
		await settle();
		expect(aFirst(codeOf(sync))).toBe(false);
	});

	it('50 %: dreiviertel Abstand am Bildschirm reicht im Modell', async () => {
		const { sync, target, zoomTo } = await setup();
		zoomTo(0.5);
		const gap = center(target, 'B') - center(target, 'A');
		dragX(target, 'A', gap * 0.4);
		await settle();
		expect(aFirst(codeOf(sync))).toBe(true);
		dragX(target, 'A', gap * 0.75);
		await settle();
		expect(aFirst(codeOf(sync))).toBe(false);
	});

	it.each([0.5, 2])('senkrechtes Ziehen einer Nachricht bei %s', async (zoom) => {
		const { sync, target, zoomTo } = await setup(ROWS);
		zoomTo(zoom);
		// Ungeskalierter Abstand: bei 200 % zu kurz, bei 50 % zu weit.
		dragY(message(target, 'eins'), top(target, 'drei') - top(target, 'eins'));
		await settle();
		expect(rows(codeOf(sync))).toEqual(
			zoom === 2 ? ['eins', 'zwei', 'drei'] : ['zwei', 'drei', 'eins']
		);
		unmountAll();
		const next = await setup(ROWS);
		next.zoomTo(zoom);
		const t = next.target;
		dragY(message(t, 'eins'), (top(t, 'drei') - top(t, 'eins')) * zoom);
		await settle();
		expect(rows(codeOf(next.sync))).toEqual(['zwei', 'eins', 'drei']);
	});

	it.each([
		[0.5, '10px'],
		[2, '28px']
	])('Editor-Schrift skaliert bei %s (Untergrenze 10px)', async (zoom, size) => {
		const { target, zoomTo } = await setup();
		zoomTo(zoom);
		itemEl(target, 'A')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		expect(target.querySelector<HTMLTextAreaElement>('textarea')!.style.fontSize).toBe(size);
	});

	it.each([0.5, 2])('Editor liegt bei %s über dem Element', async (zoom) => {
		const { target, svg, zoomTo } = await setup();
		zoomTo(zoom);
		const [minX, minY] = svg.getAttribute('viewBox')!.split(' ').map(Number);
		const rect = itemEl(target, 'A')!.querySelector('rect')!;
		itemEl(target, 'A')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		const editor = target.querySelector<HTMLTextAreaElement>('textarea')!;
		expect(parseFloat(editor.style.left)).toBeCloseTo(
			(Number(rect.getAttribute('x')) - minX) * zoom,
			3
		);
		expect(parseFloat(editor.style.top)).toBeCloseTo(
			(Number(rect.getAttribute('y')) - minY) * zoom,
			3
		);
	});
});

describe('SequenceCanvas: Einpassen spart die Vorschau-Karte aus (T126 C3, O-141)', () => {
	const rect = (left: number, top: number, width: number, height: number) =>
		({
			left,
			top,
			width,
			height,
			right: left + width,
			bottom: top + height,
			x: left,
			y: top
		}) as DOMRect;

	/**
	 * Rahmen 600x500; Zoom nach `fit` bei gegebenem Rand der Karte. Der Rand wird erst beim
	 * Einpassen gelesen (Getter): Karte auf/zu ändert ihn zwischen zwei `fit`. `offsets`: Abstand
	 * der Fläche zur rechten/unteren Kante der Bezugsbox des Rands (Elternelement wie
	 * `.shell-canvas`); `canvas`: Box von `.sequence-canvas` (Standard: wie die Bezugsbox).
	 */
	async function fitWith(
		reserve: (() => Reserve | null) | null,
		offsets = { right: 0, bottom: 0 },
		canvas?: DOMRect
	) {
		const live: Reserve = {
			get right() {
				return reserve?.()?.right ?? 0;
			},
			get bottom() {
				return reserve?.()?.bottom ?? 0;
			}
		};
		const mounted = await setup(SAMPLE, reserve ? { reserve: live } : {});
		const { surface, target, control } = mounted;
		Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 600 });
		Object.defineProperty(surface, 'clientHeight', { configurable: true, value: 500 });
		const box = rect(0, 0, 600 + offsets.right, 540 + offsets.bottom);
		target.getBoundingClientRect = () => box;
		const outer = target.querySelector<HTMLElement>('.sequence-canvas')!;
		outer.getBoundingClientRect = () => canvas ?? box;
		surface.getBoundingClientRect = () => rect(0, 40, 600, 500);
		const fit = () => {
			control.fit();
			flushSync();
			return control.viewport().zoom;
		};
		return { ...mounted, fit };
	}

	const expected = (frame: { width: number; height: number }, w: number, h: number) =>
		clampZoom(Math.min(frame.width / w, frame.height / h) * FIT_MARGIN);

	it('Karte rechts bzw. unten ausgespart; Karte auf/zu passt beim nächsten Einpassen neu', async () => {
		let card: Reserve | null = { right: 242, bottom: 300 };
		const { fit, width, height, surface } = await fitWith(() => card);
		// Hohe Karte bei 600x500: rechts kostet weniger (242/600 < 300/500).
		expect(fit()).toBeCloseTo(expected({ width: 358, height: 500 }, width, height));
		expect(surface.scrollLeft).toBe(0);
		card = { right: 242, bottom: 50 };
		expect(fit()).toBeCloseTo(expected({ width: 600, height: 450 }, width, height));
		card = null;
		expect(fit()).toBeCloseTo(expected({ width: 600, height: 500 }, width, height));
	});

	it('Rand gemessen an der Fläche: Outline/Status unter der Fläche zählen nicht doppelt', async () => {
		// Fläche endet 60 px über dem Canvas-Rand (Outline, Status); Karte 50 px hoch: frei.
		const { fit, width, height } = await fitWith(() => ({ right: 242, bottom: 50 }), {
			right: 0,
			bottom: 60
		});
		expect(fit()).toBeCloseTo(expected({ width: 600, height: 500 }, width, height));
	});

	it('Rand rechts: Abstand der Fläche zur rechten Kante zählt nicht doppelt', async () => {
		// Hohe Karte (rechts ausgespart), Fläche endet 20 px vor der rechten Kante: 300 - 20.
		const { fit, width, height } = await fitWith(() => ({ right: 300, bottom: 400 }), {
			right: 20,
			bottom: 0
		});
		const zoom = fit();
		// Trennscharf: die Breite begrenzt (nicht die Höhe), doppelt gezählt wäre es enger.
		expect(expected({ width: 320, height: 500 }, width, height)).toBeLessThan(
			expected({ width: 600, height: 500 }, width, height)
		);
		expect(zoom).toBeGreaterThan(expected({ width: 300, height: 500 }, width, height) + 0.01);
		expect(zoom).toBeCloseTo(expected({ width: 320, height: 500 }, width, height));
	});

	it('Rand bezogen auf die Bezugsbox, nicht auf die überstehende .sequence-canvas', async () => {
		// Bezugsbox nur 300 px hoch, .sequence-canvas (min-height) und Fläche stehen bis 540 über.
		// Karte 50 px über der Unterkante der Bezugsbox = 290 px über der Flächen-Unterkante.
		const { fit, width, height, target } = await fitWith(
			() => ({ right: 242, bottom: 50 }),
			{ right: 0, bottom: 0 },
			rect(0, 0, 600, 540)
		);
		target.getBoundingClientRect = () => rect(0, 0, 600, 300);
		// Unten kostet 290/500 > rechts 242/600: rechts ausgespart.
		expect(fit()).toBeCloseTo(expected({ width: 358, height: 500 }, width, height));
	});

	it('ohne reserve-Prop: Einpassen wie bisher (ganzer Rahmen)', async () => {
		const { fit, width, height } = await fitWith(null);
		expect(fit()).toBeCloseTo(expected({ width: 600, height: 500 }, width, height));
	});
});
