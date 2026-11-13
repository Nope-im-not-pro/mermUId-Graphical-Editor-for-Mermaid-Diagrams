// @vitest-environment jsdom
// T129 C2 (V-32): Tastaturwege der Shell. Tabs der Seitenleiste nach WAI-ARIA (Pfeile, Home/End,
// roving tabindex); Enter auf dem bewaffneten Paletten-Werkzeug legt das Element in der Mitte des
// sichtbaren Ausschnitts an (ein Undo-Schritt, Auswahl und Fokus auf dem neuen Knoten).
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NARROW_QUERY } from '../../../../src/lib/views/shell/panels';
import type { MediaAccess } from '../../../../src/lib/views/shell/theme';
import { installBrowserStubs, nodeEl } from '../canvas/helpers';
import { button, docOf, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(unmountShells);

const TWO = 'flowchart LR\n  A\n  B\n';

/** Tastendruck wie im Browser: Enter auf einem Knopf löst ohne preventDefault einen Klick aus. */
function key(el: Element, k: string) {
	const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
	el.dispatchEvent(e);
	if (k === 'Enter' && !e.defaultPrevented && el instanceof HTMLButtonElement) el.click();
	flushSync();
	return e;
}

const tab = (target: HTMLElement, id: string) =>
	target.querySelector<HTMLButtonElement>(`#tab-${id}`)!;

describe('Seitenleiste: Tabs per Pfeiltaste (WAI-ARIA)', () => {
	it('Pfeil rechts/links wechselt, aria-selected und Fokus folgen, roving tabindex', async () => {
		const { target } = await mountShell(TWO);
		const props = tab(target, 'properties');
		const code = tab(target, 'code');
		expect(props.tabIndex).toBe(0);
		expect(code.tabIndex).toBe(-1);
		props.focus();
		expect(key(props, 'ArrowRight').defaultPrevented).toBe(true);
		expect(code.getAttribute('aria-selected')).toBe('true');
		expect(props.getAttribute('aria-selected')).toBe('false');
		expect(document.activeElement).toBe(code);
		expect(code.tabIndex).toBe(0);
		expect(props.tabIndex).toBe(-1);
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(false);
		key(code, 'ArrowLeft');
		expect(props.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(props);
		// Zyklisch: links vom ersten Tab liegt der letzte.
		key(props, 'ArrowLeft');
		expect(code.getAttribute('aria-selected')).toBe('true');
	});

	it('Home/End springen an den Rand; andere Tasten bleiben unbehandelt', async () => {
		const { target } = await mountShell(TWO);
		const props = tab(target, 'properties');
		props.focus();
		key(props, 'End');
		expect(tab(target, 'code').getAttribute('aria-selected')).toBe('true');
		key(tab(target, 'code'), 'Home');
		expect(props.getAttribute('aria-selected')).toBe('true');
		expect(key(props, 'ArrowDown').defaultPrevented).toBe(false);
		expect(props.getAttribute('aria-selected')).toBe('true');
	});

	it('nur Code: gesperrter Eigenschaften-Tab wird übersprungen', async () => {
		const { target } = await mountShell('pie title Haus\n  "A" : 1\n');
		await settle();
		const code = tab(target, 'code');
		expect(code.tabIndex).toBe(0);
		code.focus();
		key(code, 'ArrowRight');
		expect(code.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(code);
	});
});

/** Fläche 400x300 ab (0, 0); jsdom misst sonst nichts. */
function sizeCanvas(target: HTMLElement) {
	const box = target.querySelector<HTMLElement>('.shell-canvas')!;
	const rect = { left: 0, top: 0, x: 0, y: 0, width: 400, height: 300, right: 400, bottom: 300 };
	box.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
}

/** Viewport aus dem Transform der Flow-Ebene (wie palette-reveal.svelte.test.ts). */
function viewOf(target: HTMLElement) {
	const t = target.querySelector<HTMLElement>('.svelte-flow__viewport')!.style.transform;
	const [, x, y, zoom] = /translate\(([-\d.e]+)px, ?([-\d.e]+)px\) scale\(([\d.e]+)\)/.exec(t)!;
	return { x: Number(x), y: Number(y), zoom: Number(zoom) };
}

describe('Palette: Enter auf bewaffnetem Werkzeug legt in der Mitte an', () => {
	it('manuell: Knoten mittig im Ausschnitt, ein Undo-Schritt, Auswahl und Fokus', async () => {
		const { sync, target } = await mountShell(TWO);
		await settle();
		button(target, 'Manuell').click();
		await settle();
		sizeCanvas(target);
		const view = viewOf(target);
		const tool = button(target, 'Rechteck');
		tool.focus();
		key(tool, 'Enter');
		expect(tool.getAttribute('aria-pressed')).toBe('true');
		expect(docOf(sync).nodes).toHaveLength(2);

		expect(key(tool, 'Enter').defaultPrevented).toBe(true);
		await settle();
		const doc = docOf(sync);
		expect(doc.nodes).toHaveLength(3);
		const id = doc.nodes.at(-1)!.id;
		const [x, y, w, h] = doc.layout.positions[id];
		const cx = (200 - view.x) / view.zoom;
		const cy = (150 - view.y) / view.zoom;
		expect(Math.abs(x + w / 2 - cx)).toBeLessThanOrEqual(doc.layout.gridSize);
		expect(Math.abs(y + h / 2 - cy)).toBeLessThanOrEqual(doc.layout.gridSize);

		expect(tool.getAttribute('aria-pressed')).toBe('false');
		expect(nodeEl(target, id)!.classList.contains('selected')).toBe(true);
		expect(target.querySelector('.graph-canvas')!.contains(document.activeElement)).toBe(true);

		await sync.undo();
		await settle();
		expect(docOf(sync).nodes).toHaveLength(2);
		expect(docOf(sync).layout.mode).toBe('manual');
	});

	it('Enter auf nicht bewaffnetem Werkzeug bewaffnet nur (Bestand: Klick)', async () => {
		const { sync, target } = await mountShell(TWO);
		const tool = button(target, 'Raute (Entscheidung)');
		key(tool, 'Enter');
		await settle();
		expect(tool.getAttribute('aria-pressed')).toBe('true');
		expect(docOf(sync).nodes).toHaveLength(2);
	});

	it('Leertaste auf bewaffnetem Werkzeug löst es weiterhin, ohne anzulegen', async () => {
		const { sync, target } = await mountShell(TWO);
		const tool = button(target, 'Rechteck');
		tool.click();
		flushSync();
		expect(key(tool, ' ').defaultPrevented).toBe(false);
		tool.click();
		flushSync();
		await settle();
		expect(tool.getAttribute('aria-pressed')).toBe('false');
		expect(docOf(sync).nodes).toHaveLength(2);
	});

	it('Schublade (< 900 px): Anlegen schließt die Paletten-Schublade', async () => {
		const access: MediaAccess = (query) => ({
			matches: query === NARROW_QUERY,
			addEventListener() {},
			removeEventListener() {}
		});
		const { sync, target } = await mountShell(TWO, { media: access });
		button(target, 'Palette').click();
		flushSync();
		await settle();
		const tool = button(target, 'Rechteck');
		key(tool, 'Enter');
		key(tool, 'Enter');
		await settle();
		expect(docOf(sync).nodes).toHaveLength(3);
		expect(target.querySelector<HTMLElement>('#shell-palette')!.hidden).toBe(true);
		expect(button(target, 'Palette').getAttribute('aria-expanded')).toBe('false');
	});
});
