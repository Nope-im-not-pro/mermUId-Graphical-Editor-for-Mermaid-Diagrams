import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * T116 (V-31): WCAG-2.2-Kontraste der Design-Tokens aus `theme.css`, beide Themes.
 * Text 4,5:1 (1.4.3), UI-Grenzen 3:1 (1.4.11). Hell erbt nicht überschriebene Tokens von dunkel.
 */

// Kommentare entfernen, damit `--x: …;` in Kommentaren nicht als Token zählt.
const css = readFileSync(
	join(__dirname, '../../../../src/lib/views/shell/theme.css'),
	'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
	const start = css.indexOf(`${selector} {`);
	expect(start, `Block ${selector} fehlt`).toBeGreaterThanOrEqual(0);
	const body = css.slice(start, css.indexOf('}', start));
	const tokens: Record<string, string> = {};
	for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
	return tokens;
}

const dark = block('.shell');
const themes = { dunkel: dark, hell: { ...dark, ...block(".shell[data-theme='light']") } };

function color(tokens: Record<string, string>, name: string, depth = 0): string {
	const raw = tokens[name];
	expect(raw, `Token ${name} fehlt`).toBeDefined();
	const ref = /^var\((--[\w-]+)\)$/.exec(raw);
	if (ref && depth < 5) return color(tokens, ref[1], depth + 1);
	expect(raw, `${name} ist kein deckendes #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i);
	return raw;
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'];
const WHITE = '#ffffff';

describe('Kontrast-Rechnung', () => {
	it('liefert die WCAG-Referenzwerte', () => {
		expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(ratio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
	});
});

describe.each(Object.entries(themes))('Kontraste %s', (_name, tokens) => {
	it.each(['--text-3', '--ok', '--warn'])('%s auf allen Flächen >= 4,5:1', (text) => {
		for (const surface of SURFACES) {
			const r = ratio(color(tokens, text), color(tokens, surface));
			expect(r, `${text} auf ${surface}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it.each(['--accent-fill', '--accent-fill-2'])('Weiß auf %s (Primärknopf) >= 4,5:1', (fill) => {
		const r = ratio(WHITE, color(tokens, fill));
		expect(r, `#fff auf ${fill}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
	});

	it('--syn-comment (Codekommentar) auf Editorgrund --surface-2 >= 4,5:1', () => {
		const r = ratio(color(tokens, '--syn-comment'), color(tokens, '--surface-2'));
		expect(r, `--syn-comment auf --surface-2: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
	});

	it('--node-line gegen Canvas >= 3:1', () => {
		const r = ratio(color(tokens, '--node-line'), color(tokens, '--canvas-bg'));
		expect(r, `--node-line auf --canvas-bg: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
	});

	it('Feldrahmen --line gegen Feldgrund und Umgebung >= 3:1', () => {
		for (const surface of ['--surface-2', '--surface']) {
			const r = ratio(color(tokens, '--line'), color(tokens, surface));
			expect(r, `--line auf ${surface}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
		}
	});
});
