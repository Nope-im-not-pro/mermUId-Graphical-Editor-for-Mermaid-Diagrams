// T139 C1 (V-33): helles Farbschema. Umschalten über die Werkzeugleiste (aria-pressed,
// data-theme, color-scheme, heller Hintergrund), Wahl übersteht Reload, ohne Wahl folgt der Start
// `prefers-color-scheme: light`. Im hellen Schema sind Pfeilspitzen (Sequenz), Knotenrand und
// Kanten (Graph) vom Hintergrund unterscheidbar (Gegenstück zu V-05 in
// e2e/mvp/graph/sequence.spec.ts), die Vorschau rendert ohne Fehler.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { node, openText, seqSurface, startApp } from '../mvp/sync/helpers-actions';

const shell = (page: Page) => page.locator('.shell');
const themeButton = (page: Page) =>
	page
		.getByRole('toolbar', { name: 'Werkzeugleiste' })
		.getByRole('button', { name: 'Helles Farbschema', exact: true });

/** Relative Leuchtdichte (WCAG) einer `rgb()`/`rgba()`-Farbe. */
function luminance(color: string): number {
	const [r, g, b] = color
		.match(/[\d.]+/g)!
		.slice(0, 3)
		.map((v) => {
			const c = Number(v) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Erste nicht transparente Hintergrundfarbe von `el` aufwärts. */
function background(target: Locator): Promise<string> {
	return target.evaluate((el) => {
		for (let n: Element | null = el; n; n = n.parentElement) {
			const c = getComputedStyle(n).backgroundColor;
			if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
		}
		return 'rgba(0, 0, 0, 0)';
	});
}

async function toLight(page: Page): Promise<void> {
	await themeButton(page).click();
	await expect(shell(page)).toHaveAttribute('data-theme', 'light');
}

test.describe('Helles Farbschema (T139 C1)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('Umschalten: aria-pressed, data-theme, color-scheme, Hintergrund hell; Reload behält', async ({
		page
	}) => {
		await startApp(page);
		await expect(shell(page)).toHaveAttribute('data-theme', 'dark');
		await expect(themeButton(page)).toHaveAttribute('aria-pressed', 'false');
		expect(luminance(await background(page.locator('.svelte-flow__pane')))).toBeLessThan(0.2);

		await toLight(page);
		await expect(themeButton(page)).toHaveAttribute('aria-pressed', 'true');
		expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light');
		expect(luminance(await background(page.locator('.svelte-flow__pane')))).toBeGreaterThan(0.6);

		await page.reload();
		await expect(shell(page)).toHaveAttribute('data-theme', 'light');
		await expect(themeButton(page)).toHaveAttribute('aria-pressed', 'true');

		await themeButton(page).click();
		await expect(shell(page)).toHaveAttribute('data-theme', 'dark');
		expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
	});

	test.describe('System hell', () => {
		test.use({ colorScheme: 'light' });

		test('ohne gespeicherte Wahl startet die App hell', async ({ page }) => {
			await startApp(page);
			await expect(shell(page)).toHaveAttribute('data-theme', 'light');
			await expect(themeButton(page)).toHaveAttribute('aria-pressed', 'true');
		});
	});

	test('Sequenz: Pfeilspitzen im hellen Schema sichtbar (nicht Hintergrund, nicht Weiß)', async ({
		page
	}) => {
		await startApp(page);
		await toLight(page);
		await openText(page, 'pfeile.mmd', 'sequenceDiagram\nA->>B: m\nA-|\\B: h\n');
		const surface = seqSurface(page);
		await expect(surface.getByRole('button', { name: 'Nachricht: m', exact: true })).toBeVisible();

		const bg = await background(surface);
		const fills = await surface.evaluate((el) =>
			['arrow', 'half'].map(
				(head) => getComputedStyle(el.querySelector(`marker[id$="-${head}"] path`)!).fill
			)
		);
		expect(luminance(bg)).toBeGreaterThan(0.6);
		for (const fill of fills) {
			expect(fill).not.toBe(bg);
			expect(fill).not.toBe('rgb(255, 255, 255)');
			expect(Math.abs(luminance(fill) - luminance(bg))).toBeGreaterThan(0.3);
		}
	});

	test('Graph: Knotenrand und Kante heben sich ab, Vorschau gerendert', async ({ page }) => {
		await startApp(page);
		await toLight(page);
		await openText(page, 'hell.mmd', 'flowchart LR\n  A[Start] --> B[Ende]\n');
		await expect(node(page, 'A')).toBeVisible();

		const bg = await background(page.locator('.svelte-flow__pane'));
		const outline = await node(page, 'A')
			.locator('path.outline')
			.evaluate((el) => getComputedStyle(el).stroke);
		const edge = await page
			.locator('.svelte-flow__edge path.line')
			.first()
			.evaluate((el) => getComputedStyle(el).stroke);
		for (const color of [outline, edge]) {
			expect(color).toMatch(/^rgba?\(/);
			expect(Math.abs(luminance(color) - luminance(bg))).toBeGreaterThan(0.2);
		}
		const label = await node(page, 'A')
			.locator('svg.label')
			.evaluate((el) => getComputedStyle(el).color);
		expect(Math.abs(luminance(label) - luminance(bg))).toBeGreaterThan(0.4);

		const preview = page.locator('.center > .preview');
		await expect(preview.locator('.state')).toHaveText('gerendert');
		await expect(preview.locator('.preview-body svg')).toBeVisible();
	});
});
