// T139 C1 I2 (V-33): Touch-Bedienung bei schmaler Breite (899 px, Schublade wie
// e2e/mvp/shell/narrow.spec.ts). Tippen auf einen Knoten wählt ihn aus; Tippen auf einen
// Paletten-Eintrag bewaffnet das Werkzeug, Tippen auf die Fläche legt den Knoten dort an
// (Workspace.svelte canvasClick); Tippen auf den Menü-Knopf der CanvasBar öffnet, zweites Tippen
// schließt (CanvasBar.svelte wasOpen: click kann auf Touch in einem späteren Task folgen).
import { expect, test, type Page } from '@playwright/test';
import { node, openText, startApp } from '../mvp/sync/helpers-actions';

const CODE = ['flowchart LR', '  A[Start] --> B[Mitte]', '  A --> C[Ende]', ''].join('\n');

const nodes = (page: Page) => page.locator('.svelte-flow__node');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' });
const paletteToggle = (page: Page) => page.getByRole('button', { name: 'Palette', exact: true });
const palette = (page: Page) => page.getByRole('navigation', { name: 'Palette' });

test.describe('Touch bei schmaler Breite (T139 C1)', () => {
	test.use({ viewport: { width: 899, height: 768 }, hasTouch: true });

	test.beforeEach(async ({ page }) => {
		await startApp(page);
		await openText(page, 'touch.mmd', CODE);
		await expect(nodes(page)).toHaveCount(3);
	});

	test('Tippen auf Knoten wählt ihn aus, Tippen auf die Fläche hebt die Auswahl auf', async ({
		page
	}) => {
		await node(page, 'B').tap();
		await expect(node(page, 'B')).toHaveClass(/\bselected\b/);
		await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(1);

		await node(page, 'C').tap();
		await expect(node(page, 'C')).toHaveClass(/\bselected\b/);
		await expect(node(page, 'B')).not.toHaveClass(/\bselected\b/);

		const box = (await page.locator('.svelte-flow__pane').boundingBox())!;
		await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.9);
		await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
	});

	test('Tippen auf Paletten-Eintrag, dann auf die Fläche: Knoten dort, im Code', async ({
		page
	}) => {
		await page.getByRole('button', { name: 'Manuell', exact: true }).tap();
		await expect(page.getByRole('button', { name: 'Manuell', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await paletteToggle(page).tap();
		await expect(palette(page)).toBeVisible();
		const tool = palette(page).getByRole('button', { name: 'Rechteck', exact: true });
		await tool.tap();
		await expect(tool).toHaveAttribute('aria-pressed', 'true');
		// Schublade zu (Knopf erneut), das Werkzeug bleibt bewaffnet.
		await paletteToggle(page).tap();
		await expect(palette(page)).toBeHidden();
		await expect(page.locator('.shell-canvas')).toHaveClass(/\barmed\b/);

		const box = (await page.locator('.svelte-flow__pane').boundingBox())!;
		const drop = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.75 };
		await page.touchscreen.tap(drop.x, drop.y);
		await expect(nodes(page)).toHaveCount(4);
		await expect(page.locator('.shell-canvas')).not.toHaveClass(/\barmed\b/);

		const added = page.locator(
			'.svelte-flow__node:not([data-id="A"], [data-id="B"], [data-id="C"])'
		);
		// Ohne Raster-Fang liegt die linke obere Ecke des Knotens am Tippunkt (palette.ts canvasPoint).
		const b = (await added.boundingBox())!;
		expect(Math.abs(b.x - drop.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(b.y - drop.y)).toBeLessThanOrEqual(2);

		// Code-Tab liegt bei schmaler Breite in der Seitenleisten-Schublade.
		const id = (await added.getAttribute('data-id'))!;
		await page.getByRole('button', { name: 'Seitenleiste', exact: true }).tap();
		await page.getByRole('tab', { name: 'Code', exact: true }).tap();
		await expect(page.locator('#shell-code .cm-content')).toContainText(id);
	});

	test('CanvasBar-Menü: Tippen öffnet, zweites Tippen schließt, Eintrag wirkt', async ({
		page
	}) => {
		await bar(page).getByRole('button', { name: 'Alles auswählen', exact: true }).tap();
		await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(3);
		const align = bar(page).getByRole('button', { name: 'Ausrichten', exact: true });
		await expect(align).toBeEnabled();

		await align.tap();
		await expect(page.getByRole('menu')).toBeVisible();
		await align.tap();
		await expect(page.getByRole('menu')).toHaveCount(0);

		await align.tap();
		await page.getByRole('menuitem', { name: 'Links ausrichten' }).tap();
		await expect(page.getByRole('menu')).toHaveCount(0);
		const xOf = async (id: string) => (await node(page, id).boundingBox())!.x;
		await expect.poll(async () => Math.abs((await xOf('A')) - (await xOf('C')))).toBeLessThan(1);
	});
});
