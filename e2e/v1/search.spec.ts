// T139 C1 (V-33): Canvas-Suche (Strg-F bzw. Knopf "Suchen"). Teilstring in Label oder ID ohne
// Groß/Klein, Treffer werden ausgewählt, Enter/"Weiter" springt zyklisch weiter, Esc schließt und
// gibt den Fokus an den Canvas zurück.
import { expect, test, type Page } from '@playwright/test';
import { node, openText, startApp } from '../mvp/sync/helpers-actions';

const CODE = [
	'flowchart LR',
	'  N1[Bahnhof] --> N2[Ziel]',
	'  N2 --> N3[Bahnsteig]',
	'  Gleis7[Weiche]',
	''
].join('\n');

const bar = (page: Page) => page.getByRole('search', { name: 'Canvas-Suche' });
const field = (page: Page) => bar(page).getByRole('searchbox', { name: 'Suchen' });
const result = (page: Page) => page.getByTestId('search-result');
const selectedIds = (page: Page) =>
	page
		.locator('.svelte-flow__node.selected')
		.evaluateAll((es) => es.map((e) => e.getAttribute('data-id')));

test.describe('Canvas-Suche (T139 C1)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test.beforeEach(async ({ page }) => {
		await startApp(page);
		await openText(page, 'suche.mmd', CODE);
		await expect(page.locator('.svelte-flow__node')).toHaveCount(4);
	});

	test('Treffer im Label ohne Groß/Klein, Enter und Weiter springen zyklisch', async ({ page }) => {
		await page
			.getByRole('toolbar', { name: 'Werkzeugleiste' })
			.getByRole('button', { name: 'Suchen', exact: true })
			.click();
		await expect(field(page)).toBeFocused();
		await expect(result(page)).toHaveText('');

		await field(page).fill('BAHN');
		await expect(result(page)).toHaveText('1 von 2');
		await expect.poll(() => selectedIds(page)).toEqual(['N1']);

		await field(page).press('Enter');
		await expect(result(page)).toHaveText('2 von 2');
		await expect.poll(() => selectedIds(page)).toEqual(['N3']);
		// Fokus bleibt im Suchfeld.
		await expect(field(page)).toBeFocused();

		await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click();
		await expect(result(page)).toHaveText('1 von 2');
		await expect.poll(() => selectedIds(page)).toEqual(['N1']);
	});

	test('Treffer über die ID; ohne Treffer Meldung und Weiter gesperrt', async ({ page }) => {
		await page.getByRole('application', { name: 'Graph-Canvas' }).focus();
		await page.keyboard.press('ControlOrMeta+f');
		await expect(field(page)).toBeFocused();

		await field(page).fill('gleis');
		await expect(result(page)).toHaveText('1 von 1');
		await expect(node(page, 'Gleis7')).toHaveClass(/\bselected\b/);

		await field(page).fill('xyz');
		await expect(result(page)).toHaveText('Keine Treffer');
		await expect(bar(page).getByRole('button', { name: 'Weiter', exact: true })).toBeDisabled();
	});

	test('Esc schließt, Fokus zurück im Canvas; Schließen-Knopf ebenso', async ({ page }) => {
		const canvas = page.getByRole('application', { name: 'Graph-Canvas' });
		await canvas.focus();
		await page.keyboard.press('ControlOrMeta+f');
		await field(page).fill('ziel');
		await expect(node(page, 'N2')).toHaveClass(/\bselected\b/);
		await field(page).press('Escape');
		await expect(bar(page)).toBeHidden();
		await expect(canvas).toBeFocused();
		// Auswahl bleibt nach dem Schließen erhalten.
		await expect(node(page, 'N2')).toHaveClass(/\bselected\b/);

		await page.keyboard.press('ControlOrMeta+f');
		await expect(field(page)).toBeFocused();
		await bar(page).getByRole('button', { name: 'Suche schließen', exact: true }).click();
		await expect(bar(page)).toBeHidden();
	});
});
