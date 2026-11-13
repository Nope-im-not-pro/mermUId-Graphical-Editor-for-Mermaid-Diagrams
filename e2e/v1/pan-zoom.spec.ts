// T139 C1 (V-33): Pan und Rad-Zoom im Graph-Canvas (FLOW_INPUT, canvas/common/viewport.ts).
// Rad ohne Taste verschiebt, Strg+Rad zoomt (Anzeige folgt, 25-400 %), mittlere Maustaste und
// Leertaste+Ziehen verschieben ohne Zoom; kein Pan ändert Code oder Undo.
// Bestand: Knöpfe und Strg-Plus/Minus/0 in e2e/mvp/graph/zoom.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { openText, startApp } from '../mvp/sync/helpers-actions';

const CODE = ['flowchart LR', '  A[Start] --> B[Ende]', ''].join('\n');

const zoom = (page: Page) => page.getByTestId('zoom');
const pane = (page: Page) => page.locator('.svelte-flow__pane');
const undo = (page: Page) =>
	page
		.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' })
		.getByRole('button', { name: 'Rückgängig', exact: true });

/** Verschiebung und Skalierung der Flow-Ebene aus der berechneten Transformation. */
async function viewport(page: Page): Promise<{ x: number; y: number; z: number }> {
	return page.locator('.svelte-flow__viewport').evaluate((el) => {
		const m = new DOMMatrix(getComputedStyle(el).transform);
		return { x: m.e, y: m.f, z: m.a };
	});
}

/** Verschiebung der Flow-Ebene gegenüber `before` stimmt auf ±2 px (Subpixel, Firefox). */
async function expectShift(
	page: Page,
	before: { x: number; y: number },
	dx: number,
	dy: number
): Promise<void> {
	await expect
		.poll(async () => {
			const now = await viewport(page);
			return Math.max(Math.abs(now.x - before.x - dx), Math.abs(now.y - before.y - dy));
		})
		.toBeLessThanOrEqual(2);
}

/** Maus auf eine freie Stelle der Fläche (Mitte oben, nicht auf Knoten/Panels). */
async function hover(page: Page): Promise<{ x: number; y: number }> {
	const b = (await pane(page).boundingBox())!;
	const p = { x: b.x + b.width * 0.5, y: b.y + b.height * 0.15 };
	await page.mouse.move(p.x, p.y);
	return p;
}

test.describe('Pan und Rad-Zoom (T139 C1)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test.beforeEach(async ({ page }) => {
		await startApp(page);
		await openText(page, 'pan.mmd', CODE);
		await expect(page.locator('.svelte-flow__node')).toHaveCount(2);
		await expect(undo(page)).toBeDisabled();
	});

	test('Rad ohne Taste verschiebt, Zoom bleibt', async ({ page }) => {
		const before = await viewport(page);
		const shown = await zoom(page).innerText();
		await hover(page);
		await page.mouse.wheel(0, 200);
		await expect.poll(async () => (await viewport(page)).y).toBeLessThan(before.y - 50);
		await page.mouse.wheel(150, 0);
		await expect.poll(async () => (await viewport(page)).x).toBeLessThan(before.x - 50);
		expect((await viewport(page)).z).toBeCloseTo(before.z, 5);
		await expect(zoom(page)).toHaveText(shown);
		await expect(undo(page)).toBeDisabled();
	});

	test('Strg+Rad zoomt hinein und heraus, Anzeige folgt, Grenzen 25/400 %', async ({ page }) => {
		const before = await viewport(page);
		await hover(page);
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -200);
		await expect.poll(async () => (await viewport(page)).z).toBeGreaterThan(before.z * 1.05);
		const zoomedIn = await viewport(page);
		await expect(zoom(page)).toHaveText(`${Math.round(zoomedIn.z * 100)} %`);

		for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -400);
		await expect(zoom(page)).toHaveText('400 %');
		for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
		await page.keyboard.up('Control');
		await expect(zoom(page)).toHaveText('25 %');
		await expect(undo(page)).toBeDisabled();
	});

	test('mittlere Maustaste zieht die Fläche, ohne Auswahl-Lasso', async ({ page }) => {
		const before = await viewport(page);
		const p = await hover(page);
		await page.mouse.down({ button: 'middle' });
		await page.mouse.move(p.x + 120, p.y + 80, { steps: 8 });
		await page.mouse.up({ button: 'middle' });
		await expectShift(page, before, 120, 80);
		await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
		await expect(undo(page)).toBeDisabled();
	});

	test('Leertaste + Ziehen verschiebt die Fläche', async ({ page }) => {
		await page.getByRole('application', { name: 'Graph-Canvas' }).focus();
		const before = await viewport(page);
		const p = await hover(page);
		await page.keyboard.down('Space');
		await page.mouse.down();
		await page.mouse.move(p.x - 90, p.y + 60, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Space');
		await expectShift(page, before, -90, 60);
		await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
		await expect(undo(page)).toBeDisabled();
	});
});
