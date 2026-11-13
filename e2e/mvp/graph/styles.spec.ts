// T106 C1/C2 (V-06): `style`, `classDef`/`class` und `linkStyle` färben den Canvas. Werte außerhalb
// der Allow-Liste (z. B. Farbnamen) fallen auf die Theme-Farbe zurück, ohne Fehler im Browser.
// `url(` selbst lehnt bereits der Mermaid-Parser ab (Syntaxfehler) und ist Unit-getestet.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { node, openText, startApp } from '../sync/helpers-actions';

const CODE = [
	'flowchart LR',
	'  classDef rot fill:#ff0000,stroke:#990000,stroke-width:3px',
	'  A --> B',
	'  B --> C',
	'  D',
	'  style A fill:#00aa00',
	'  class B rot',
	'  style C fill:red',
	'  linkStyle 1 stroke:#0000ff,stroke-width:2px',
	''
].join('\n');

const outline = (page: Page, id: string) => node(page, id).locator('path.outline');
const edgeLine = (page: Page, id: string) =>
	page.locator(`.svelte-flow__edge[data-id="${id}"] path.line`);
// Eigenschaft als Argument: Playwright serialisiert die Funktion ohne Closure.
const css = (loc: Locator, prop: string) =>
	loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test('style, classDef und linkStyle färben Knoten und Kanten im Canvas', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await startApp(page);
	await openText(page, 'stile.mmd', CODE);
	await expect(node(page, 'C')).toBeVisible();

	expect(await css(outline(page, 'A'), 'fill')).toBe('rgb(0, 170, 0)');
	expect(await css(outline(page, 'B'), 'fill')).toBe('rgb(255, 0, 0)');
	expect(await css(outline(page, 'B'), 'stroke')).toBe('rgb(153, 0, 0)');
	expect(await css(outline(page, 'B'), 'stroke-width')).toBe('3px');
	// Ohne `color`: lesbare Textfarbe aus der Füllung (helles Grün -> dunkler Text).
	expect(await css(node(page, 'A').locator('svg.label text'), 'fill')).toBe('rgb(0, 0, 0)');

	// `red` (Farbname) ist verworfen: C trägt dieselbe Füllung wie der ungestylte Knoten D.
	const fillD = await css(outline(page, 'D'), 'fill');
	expect(await css(outline(page, 'C'), 'fill')).toBe(fillD);
	expect(fillD).not.toBe('rgb(255, 0, 0)');

	expect(await css(edgeLine(page, 'e2'), 'stroke')).toBe('rgb(0, 0, 255)');
	expect(await css(edgeLine(page, 'e2'), 'stroke-width')).toBe('2px');
	expect(await css(edgeLine(page, 'e1'), 'stroke')).not.toBe('rgb(0, 0, 255)');
	expect(errors).toEqual([]);
});
