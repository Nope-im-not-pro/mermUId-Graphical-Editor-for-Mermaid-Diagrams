// T139 C1 (V-33): Palette per Drag-and-Drop. Ziehen einer Form auf den Canvas legt genau einen
// Knoten an der Ablagestelle an (manuelles Layout; im Code, ein Undo-Schritt); eine Vorlage legt
// mehrere Knoten in einem Undo-Schritt an. Ablage außerhalb des Canvas ändert nichts.
// Bestand: Klick- und Enter-Platzierung in e2e/mvp/shell/keyboard.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { openText, startApp } from '../mvp/sync/helpers-actions';

const nodes = (page: Page) => page.locator('.svelte-flow__node');
const palette = (page: Page) => page.getByRole('navigation', { name: 'Palette' });
const pane = (page: Page) => page.locator('.svelte-flow__pane');
const undo = (page: Page) =>
	page
		.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' })
		.getByRole('button', { name: 'Rückgängig', exact: true });

async function codeText(page: Page): Promise<string> {
	await page.getByRole('tab', { name: 'Code', exact: true }).click();
	return (await page.locator('#shell-code .cm-content').innerText()).replace(/\u00a0/g, ' ');
}

test.describe('Palette Drag-and-Drop (T139 C1)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test.beforeEach(async ({ page }) => {
		await startApp(page);
		await openText(page, 'dnd.mmd', 'flowchart TD\n  A\n');
		await expect(nodes(page)).toHaveCount(1);
	});

	test('Form auf den Canvas ziehen: Knoten an der Ablagestelle, im Code, ein Undo', async ({
		page
	}) => {
		// Im Auto-Layout setzt dagre die Lage; die Ablagestelle zählt nur im manuellen Layout.
		await page.getByRole('button', { name: 'Manuell', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Manuell', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		const box = (await pane(page).boundingBox())!;
		const target = { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.3) };
		await palette(page)
			.getByRole('button', { name: 'Rechteck', exact: true })
			.dragTo(pane(page), { targetPosition: target });

		await expect(nodes(page)).toHaveCount(2);
		const added = page.locator('.svelte-flow__node:not([data-id="A"])');
		const id = (await added.getAttribute('data-id'))!;
		expect(id).toBeTruthy();

		// Ohne Raster-Fang (Standard) liegt die linke obere Ecke des Knotens an der Ablagestelle
		// (palette.ts canvasPoint); Toleranz für Subpixel-Rundung.
		const b = (await added.boundingBox())!;
		const drop = { x: box.x + target.x, y: box.y + target.y };
		expect(Math.abs(b.x - drop.x)).toBeLessThanOrEqual(2);
		expect(Math.abs(b.y - drop.y)).toBeLessThanOrEqual(2);

		expect(await codeText(page)).toContain(id);

		// Ein Undo entfernt den Knoten, das nächste nimmt erst den Layout-Wechsel zurück.
		await undo(page).click();
		await expect(nodes(page)).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'Manuell', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await undo(page).click();
		await expect(page.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(undo(page)).toBeDisabled();
	});

	test('Vorlage ziehen: mehrere Knoten in einem Undo-Schritt', async ({ page }) => {
		const box = (await pane(page).boundingBox())!;
		await palette(page)
			.getByRole('button', { name: /^Vorlage: Ablauf/ })
			.dragTo(pane(page), {
				targetPosition: { x: Math.round(box.width * 0.4), y: Math.round(box.height * 0.3) }
			});
		await expect.poll(() => nodes(page).count()).toBeGreaterThan(2);
		await undo(page).click();
		await expect(nodes(page)).toHaveCount(1);
		await expect(undo(page)).toBeDisabled();
	});

	test('Ablage außerhalb des Canvas legt nichts an', async ({ page }) => {
		await palette(page)
			.getByRole('button', { name: 'Rechteck', exact: true })
			.dragTo(page.getByRole('toolbar', { name: 'Werkzeugleiste' }));
		await expect(nodes(page)).toHaveCount(1);
		await expect(undo(page)).toBeDisabled();
	});
});
