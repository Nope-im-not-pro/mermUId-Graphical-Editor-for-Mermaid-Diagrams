import { expect, test } from '@playwright/test';

test('App-Shell lädt ohne CSP-Fehler', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(err.message));

	await page.goto('/');
	await expect(page).toHaveTitle(/ - mermUId$/);
	await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
	expect(errors.filter((e) => /content security policy/i.test(e))).toEqual([]);
});
