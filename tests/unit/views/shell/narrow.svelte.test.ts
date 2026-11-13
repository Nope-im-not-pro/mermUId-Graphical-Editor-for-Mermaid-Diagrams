// @vitest-environment jsdom
// T129 C1 (M-09, D6): Einklapp-Knöpfe der Kopfzeile, Schublade unter 900 px mit Esc und
// Fokusführung, Mindestbreiten-Hinweis. Geometrie prüft e2e/mvp/shell/narrow.spec.ts.
import { flushSync, tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MIN_QUERY, NARROW_QUERY } from '../../../../src/lib/views/shell/panels';
import type { MediaAccess } from '../../../../src/lib/views/shell/theme';
import { installBrowserStubs } from '../canvas/helpers';
import { button, mountShell, settle, SVG, unmountShells } from './helpers';

/** HelpPanel rendert Beispiele über services/render; im Test ohne mermaid (wie Shell.c3). */
vi.mock('../../../../src/lib/services/render', () => ({
	renderSvg: async () => ({ ok: true, svg: SVG })
}));

beforeAll(installBrowserStubs);
afterEach(unmountShells);

const FLOW = 'flowchart TD\n  A --> B\n';
const SEQ = 'sequenceDiagram\n  A->>B: hallo\n';

/** matchMedia-Attrappe: nur NARROW_QUERY reagiert; `set()` meldet einen Wechsel. */
function media(narrow: boolean) {
	const listeners = new Set<(e: { matches: boolean }) => void>();
	const state = { narrow };
	const access: MediaAccess = (query: string) => ({
		get matches() {
			return query === NARROW_QUERY && state.narrow;
		},
		addEventListener: (_: 'change', l: (e: { matches: boolean }) => void) => void listeners.add(l),
		removeEventListener: (_: 'change', l: (e: { matches: boolean }) => void) => listeners.delete(l)
	});
	return {
		access,
		set(value: boolean) {
			state.narrow = value;
			for (const l of listeners) l({ matches: value });
			flushSync();
		}
	};
}

const palette = (target: HTMLElement) => target.querySelector<HTMLElement>('#shell-palette');
const inspector = (target: HTMLElement) => target.querySelector<HTMLElement>('#shell-inspector');

function click(el: HTMLElement) {
	el.click();
	flushSync();
}

async function settleFocus() {
	await tick();
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

function escape(el: HTMLElement) {
	el.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
	);
	flushSync();
}

describe('Leisten einklappen (breit, >= 900 px)', () => {
	it('Knöpfe mit aria-expanded/aria-controls, Standard ausgeklappt', async () => {
		const { target } = await mountShell(FLOW, { media: media(false).access });
		const p = button(target, 'Palette');
		const i = button(target, 'Seitenleiste');
		expect(p.getAttribute('aria-controls')).toBe('shell-palette');
		expect(i.getAttribute('aria-controls')).toBe('shell-inspector');
		expect(p.getAttribute('aria-expanded')).toBe('true');
		expect(i.getAttribute('aria-expanded')).toBe('true');
		expect(palette(target)!.matches('nav[aria-label="Palette"]')).toBe(true);
		expect(palette(target)!.hidden).toBe(false);
		expect(inspector(target)!.hidden).toBe(false);
		const main = target.querySelector('.main')!;
		expect(main.classList.contains('with-palette')).toBe(true);
		expect(main.classList.contains('narrow')).toBe(false);
	});

	it('Palette und Seitenleiste klappen unabhängig ein; Raster folgt', async () => {
		const { target } = await mountShell(FLOW, { media: media(false).access });
		const main = target.querySelector('.main')!;
		click(button(target, 'Palette'));
		expect(button(target, 'Palette').getAttribute('aria-expanded')).toBe('false');
		expect(palette(target)!.hidden).toBe(true);
		expect(main.classList.contains('with-palette')).toBe(false);
		click(button(target, 'Seitenleiste'));
		expect(button(target, 'Seitenleiste').getAttribute('aria-expanded')).toBe('false');
		expect(inspector(target)!.hidden).toBe(true);
		expect(main.classList.contains('no-side')).toBe(true);
		click(button(target, 'Palette'));
		expect(palette(target)!.hidden).toBe(false);
		expect(main.classList.contains('with-palette')).toBe(true);
	});

	it('Sequenz ohne Palette: kein Paletten-Knopf, Seitenleisten-Knopf bleibt', async () => {
		const { target } = await mountShell(SEQ, { media: media(false).access });
		expect(() => button(target, 'Palette')).toThrow();
		expect(button(target, 'Seitenleiste').getAttribute('aria-expanded')).toBe('true');
	});
});

describe('Schublade (schmal, < 900 px)', () => {
	it('Schubladen starten zu; Knopf öffnet, Fokus wandert hinein', async () => {
		const { target } = await mountShell(FLOW, { media: media(true).access });
		const main = target.querySelector('.main')!;
		expect(main.classList.contains('narrow')).toBe(true);
		expect(palette(target)!.hidden).toBe(true);
		expect(inspector(target)!.hidden).toBe(true);
		const p = button(target, 'Palette');
		expect(p.getAttribute('aria-expanded')).toBe('false');
		p.focus();
		click(p);
		await settleFocus();
		expect(p.getAttribute('aria-expanded')).toBe('true');
		expect(palette(target)!.hidden).toBe(false);
		expect(palette(target)!.contains(document.activeElement)).toBe(true);
	});

	it('Esc schließt die Schublade, Fokus kehrt zum Auslöser zurück', async () => {
		const { target } = await mountShell(FLOW, { media: media(true).access });
		const i = button(target, 'Seitenleiste');
		i.focus();
		click(i);
		await settleFocus();
		const inside = document.activeElement as HTMLElement;
		expect(inspector(target)!.contains(inside)).toBe(true);
		escape(inside);
		await settleFocus();
		expect(inspector(target)!.hidden).toBe(true);
		expect(i.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(i);
	});

	it('höchstens eine Schublade offen', async () => {
		const { target } = await mountShell(FLOW, { media: media(true).access });
		click(button(target, 'Palette'));
		click(button(target, 'Seitenleiste'));
		await settleFocus();
		expect(palette(target)!.hidden).toBe(true);
		expect(inspector(target)!.hidden).toBe(false);
		expect(button(target, 'Palette').getAttribute('aria-expanded')).toBe('false');
	});

	it('Wechsel auf breit: Schublade zu, Leisten im Einklapp-Zustand', async () => {
		const m = media(true);
		const { target } = await mountShell(FLOW, { media: m.access });
		click(button(target, 'Palette'));
		m.set(false);
		const main = target.querySelector('.main')!;
		expect(main.classList.contains('narrow')).toBe(false);
		expect(palette(target)!.hidden).toBe(false);
		expect(inspector(target)!.hidden).toBe(false);
		m.set(true);
		expect(palette(target)!.hidden).toBe(true);
	});

	it('Wechsel auf sequence schließt die Paletten-Schublade, zurück bleibt sie zu (C1-Review 1)', async () => {
		const { sync, target } = await mountShell(FLOW, { media: media(true).access });
		click(button(target, 'Palette'));
		expect(palette(target)!.hidden).toBe(false);
		sync.editCode(SEQ);
		await sync.flush();
		await settle();
		expect(palette(target)).toBeNull();
		sync.editCode(FLOW);
		await sync.flush();
		await settle();
		expect(palette(target)!.hidden).toBe(true);
		expect(button(target, 'Palette').getAttribute('aria-expanded')).toBe('false');
	});

	it('Wechsel auf sequence lässt die Seitenleisten-Schublade offen (Code-Eingabe dort)', async () => {
		const { sync, target } = await mountShell(FLOW, { media: media(true).access });
		click(button(target, 'Seitenleiste'));
		sync.editCode(SEQ);
		await sync.flush();
		await settle();
		expect(inspector(target)!.hidden).toBe(false);
	});

	it('neue Sitzung (Neu) schließt die offene Schublade (C1-Review 1)', async () => {
		const { target } = await mountShell(FLOW, { media: media(true).access });
		click(button(target, 'Seitenleiste'));
		expect(inspector(target)!.hidden).toBe(false);
		click(button(target, 'Neu'));
		await settle();
		const create = document.activeElement as HTMLElement;
		create.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		if (create instanceof HTMLButtonElement) create.click();
		await settle();
		expect(document.querySelector('.dialog[role="dialog"]')).toBeNull();
		expect(inspector(target)!.hidden).toBe(true);
		expect(button(target, 'Seitenleiste').getAttribute('aria-expanded')).toBe('false');
	});
});

describe('Mindestbreiten-Hinweis (M-09 b, unter 640 px)', () => {
	it('Hinweis im DOM mit Mindestbreite; Sichtbarkeit regelt CSS', async () => {
		const { target } = await mountShell(FLOW, { media: media(false).access });
		const hint = target.querySelector<HTMLElement>('.too-narrow');
		expect(hint).not.toBeNull();
		expect(hint!.textContent).toContain('640 px');
		expect(hint!.querySelectorAll('button')).toHaveLength(0);
	});
});

/** matchMedia-Attrappe nach Fensterbreite: Schublade unter 900 px, Hinweis unter 640 px. */
const width =
	(px: number): MediaAccess =>
	(query: string) => ({
		matches: (query === NARROW_QUERY && px < 900) || (query === MIN_QUERY && px < 640),
		addEventListener() {},
		removeEventListener() {}
	});

function press(key: string, init: KeyboardEventInit = {}) {
	const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
	document.body.dispatchEvent(e);
	flushSync();
	return e;
}

const help = () => document.querySelector('[aria-labelledby="help-title"]');

describe('Hinweis-Modus: globale Kürzel ruhen (C1-Review 3)', () => {
	it('unter 640 px: F1 und Strg-E ohne Wirkung', async () => {
		const { target } = await mountShell(FLOW, { media: width(639) });
		document.body.focus();
		expect(press('F1').defaultPrevented).toBe(false);
		expect(help()).toBeNull();
		expect(press('e', { ctrlKey: true }).defaultPrevented).toBe(false);
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(true);
	});

	it('ab 640 px wirken sie (Gegenprobe)', async () => {
		await mountShell(FLOW, { media: width(640) });
		document.body.focus();
		expect(press('F1').defaultPrevented).toBe(true);
		expect(help()).not.toBeNull();
	});
});
