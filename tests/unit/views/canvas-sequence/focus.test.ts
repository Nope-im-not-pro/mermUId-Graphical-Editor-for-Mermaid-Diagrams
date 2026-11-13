// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync } from 'svelte';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { FIT_MARGIN } from '../../../../src/lib/views/canvas/common/viewport';
import { focusRing, RING_GAP } from '../../../../src/lib/views/canvas/sequence/interaction';
import type { SequenceControl } from '../../../../src/lib/views/canvas/sequence/SequenceCanvas.svelte';
import { SAMPLE } from './helpers';
import { itemEl, mountSequence, unmountAll } from './mount';

/*
 * T124 C2 (V-32): sichtbarer Tastatur-Fokus der Sequenz-Abschnitte. jsdom rendert
 * `:focus-visible` nicht: geprüft werden Ring-Element, kompilierte Stilregel und Kontrast.
 */

afterEach(unmountAll);

const src = (path: string) => readFileSync(join(__dirname, '../../../../src', path), 'utf8');

/** Kompiliertes, gescoptes CSS der Komponente ohne Kommentare und Hash-Klassen. */
const css = compile(src('lib/views/canvas/sequence/SequenceCanvas.svelte'), {
	filename: 'SequenceCanvas.svelte',
	css: 'external'
})
	.css!.code.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/:where\(\.svelte-[\w-]+\)|\.svelte-[\w-]+/g, '');

/** Deklarationen aller Regeln, deren Selektorliste `selector` enthält. */
function rule(selector: string): string {
	const bodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter(([, sel]) => sel.split(',').some((s) => s.trim() === selector))
		.map(([, , body]) => body);
	expect(bodies, `Regel ${selector} fehlt`).not.toHaveLength(0);
	return bodies.join(';');
}

describe('Fokusring: Lage', () => {
	const box = { x: 10, y: 20, w: 100, h: 40 };

	it.each([0.25, 1, 4])('Abstand bleibt %s-fach skaliert RING_GAP Bildschirm-Pixel', (zoom) => {
		const ring = focusRing(box, zoom);
		const gap = RING_GAP / zoom;
		expect(ring).toEqual({ x: 10 - gap, y: 20 - gap, w: 100 + 2 * gap, h: 40 + 2 * gap });
		expect((box.x - ring.x) * zoom).toBeCloseTo(RING_GAP, 10);
	});
});

describe('Fokusring: Elemente', () => {
	it('jedes fokussierbare Element hat tabindex und genau einen Ring um seine Box', async () => {
		const { target } = await mountSequence(SAMPLE);
		const items = [...target.querySelectorAll<SVGGElement>('svg [data-id]')];
		const types = new Set(items.map((el) => [...el.classList].find((c) => c !== 'item')));
		for (const t of ['participant', 'actor', 'message', 'note', 'container', 'section'])
			expect(types, t).toContain(t);
		for (const el of items) {
			expect(el.getAttribute('tabindex'), el.dataset.id).toBe('0');
			const rings = el.querySelectorAll('rect.ring');
			expect(rings, el.dataset.id).toHaveLength(1);
			expect(rings[0].getAttribute('aria-hidden')).toBe('true');
			expect(el.lastElementChild).toBe(rings[0]);
		}
	});

	it('Ringabstand folgt dem Zoom (25 % und 400 %)', async () => {
		let control!: SequenceControl;
		const { target } = await mountSequence(SAMPLE, {
			oncontrol: (c: SequenceControl) => (control = c)
		});
		const surface = target.querySelector<HTMLElement>('[role="application"]')!;
		const [, , width, height] = target
			.querySelector('svg')!
			.getAttribute('viewBox')!
			.split(' ')
			.map(Number);
		const gapAt = (zoom: number) => {
			const frame = (size: number) => ({ configurable: true, value: (size * zoom) / FIT_MARGIN });
			Object.defineProperty(surface, 'clientWidth', frame(width));
			Object.defineProperty(surface, 'clientHeight', frame(height));
			control.fit();
			flushSync();
			const el = itemEl(target, 'A')!;
			const box = Number(el.querySelector('rect:not(.ring)')!.getAttribute('x'));
			const ring = Number(el.querySelector('rect.ring')!.getAttribute('x'));
			return (box - ring) * control.viewport().zoom;
		};
		expect(gapAt(0.25)).toBeCloseTo(RING_GAP, 6);
		expect(gapAt(4)).toBeCloseTo(RING_GAP, 6);
	});
});

describe('Fokusring: Stilregel', () => {
	it('Ring standardmäßig unsichtbar und ohne Zeiger-Treffer', () => {
		const base = rule('.item rect.ring');
		expect(base).toMatch(/fill:\s*none/);
		expect(base).toMatch(/stroke:\s*none/);
		expect(base).toMatch(/pointer-events:\s*none/);
	});

	it('nur :focus-visible zeigt den Ring, Strich unabhängig vom Zoom', () => {
		const ring = rule('.item:focus-visible rect.ring');
		expect(ring).toMatch(/stroke:\s*var\(--focus\b/);
		expect(ring).toMatch(/stroke-width:\s*2px/);
		expect(ring).toMatch(/vector-effect:\s*non-scaling-stroke/);
	});

	it('Ring durchgezogen, auch an Containern (gewinnt gegen gestrichelte rect-Regeln)', () => {
		const ring = '.item:focus-visible rect.ring';
		expect(rule(ring)).toMatch(/stroke-dasharray:\s*none/);
		/* Spezifität (Klassen + Pseudoklassen, Typen) des gestrippten Selektors; Scope-Klasse zählt überall einmal. */
		const spec = (sel: string) => [
			(sel.match(/[.:][\w-]+/g) ?? []).length,
			(sel.match(/(^|[\s>+~])[a-z]+/g) ?? []).length
		];
		const [ringCls, ringType] = spec(ring);
		const dashed = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, , body]) => /stroke-dasharray/.test(body))
			.flatMap(([, sel]) => sel.split(',').map((s) => s.trim()))
			.filter((s) => /(^|\s)rect\b/.test(s) && s !== ring);
		expect(dashed).toContain('.item.container rect');
		for (const sel of dashed) {
			const [cls, type] = spec(sel);
			expect(ringCls > cls || (ringCls === cls && ringType > type), sel).toBe(true);
		}
	});

	it('Mausfokus ändert die Darstellung nicht (keine :focus-Strichregel)', () => {
		expect(css).not.toMatch(/\.item:focus\s+(rect|path)/);
		expect(rule('.item:focus')).toMatch(/outline:\s*none/);
	});
});

/* Kontrast des Rings (WCAG 1.4.11 / 2.4.7) gegen den Canvas-Grund, beide Themes. */
const theme = src('lib/views/shell/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
	const start = theme.indexOf(`${selector} {`);
	expect(start, `Block ${selector} fehlt`).toBeGreaterThanOrEqual(0);
	const body = theme.slice(start, theme.indexOf('}', start));
	return Object.fromEntries(
		[...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
	);
}

function color(tokens: Record<string, string>, name: string): string {
	const raw = tokens[name];
	const ref = /^var\((--[\w-]+)\)$/.exec(raw ?? '');
	if (ref) return color(tokens, ref[1]);
	expect(raw, `${name} ist kein #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i);
	return raw;
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

const dark = block('.shell');
const themes = { dunkel: dark, hell: { ...dark, ...block(".shell[data-theme='light']") } };

describe.each(Object.entries(themes))('Fokusring-Kontrast %s', (_name, tokens) => {
	it.each(['--canvas-bg', '--node'])('--focus gegen %s >= 3:1', (surface) => {
		const r = ratio(color(tokens, '--focus'), color(tokens, surface));
		expect(r, `--focus auf ${surface}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
	});
});
