import { expect, test } from '@playwright/test';

test('Sprach-Button neben dem Farbschema schaltet auf Englisch, Reload behält die Wahl', async ({
	page
}) => {
	await page.goto('/');
	const toolbar = page.getByRole('toolbar', { name: 'Werkzeugleiste' });
	const lang = toolbar.getByRole('button', { name: 'EN (Englisch)' });
	const theme = toolbar.getByRole('button', { name: 'Helles Farbschema' });
	await expect(lang).toBeVisible();
	await expect(lang).toHaveText('EN');
	await expect(lang).toHaveAttribute('aria-pressed', 'false');

	// Direkt neben dem Farbschema-Button (gleiche Zeile, unmittelbar davor).
	const a = (await lang.boundingBox())!;
	const b = (await theme.boundingBox())!;
	expect(Math.abs(a.y - b.y)).toBeLessThan(2);
	expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(0);
	expect(b.x - (a.x + a.width)).toBeLessThan(16);
	expect(await lang.evaluate((el) => el.nextElementSibling?.getAttribute('aria-label'))).toBe(
		'Helles Farbschema'
	);

	await lang.click();
	const en = page.getByRole('toolbar', { name: 'Toolbar' });
	await expect(en.getByRole('button', { name: 'Save' })).toBeVisible();
	await expect(en.getByRole('button', { name: 'Open' })).toBeVisible();
	await expect(en.getByRole('button', { name: 'Search' })).toBeVisible();
	await expect(en.getByRole('button', { name: 'Light theme' })).toBeVisible();
	await expect(en.getByRole('button', { name: 'DE (German)' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	await page.reload();
	await expect(page.getByRole('toolbar', { name: 'Toolbar' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'DE (German)' })).toHaveText('DE');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	await page.getByRole('button', { name: 'DE (German)' }).click();
	await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test.describe('Browsersprache Englisch ohne gespeicherte Wahl', () => {
	test.use({ locale: 'en-US' });
	test('startet auf Englisch', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('toolbar', { name: 'Toolbar' })).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	});
});

test('Meldung wechselt Sprache (T114, V-19)', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Neu', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Neues Diagramm' })
		.getByRole('button', { name: 'Anlegen' })
		.click();
	const message = page.getByTestId('message');
	await expect(message).toHaveText('Neues Diagramm.');
	// Erfolg verschwindet nach einigen Sekunden: Sprachwechsel direkt danach.
	await page.getByRole('button', { name: 'EN (Englisch)' }).click();
	await expect(message).toHaveText('New diagram.');
	await expect(page.getByRole('status').filter({ hasText: 'Parser:' })).toContainText(
		'Sync: diagram=code'
	);
	await page.getByRole('button', { name: 'DE (German)' }).click();
	await expect(message).toHaveText('Neues Diagramm.');
});
