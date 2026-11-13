// T139 C1 (V-33): Zustände der Mermaid-Vorschau. Fehlerzustand bei ungültigem Code (Kopf
// "Fehler", Fehlertext statt SVG), Rückkehr zu "gerendert", Einklappen während des Fehlers,
// fest offene Vorschau im Modus "nur Code" (Knopf gesperrt, Grund verknüpft).
// Bestand: Einklappen/Ausklappen mit Einpassen in e2e/mvp/graph/zoom.spec.ts und
// e2e/mvp/graph/layout-zones.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { openText, startApp } from '../mvp/sync/helpers-actions';

const card = (page: Page) => page.locator('.center > .preview');
const head = (page: Page) => card(page).locator('.state');
const body = (page: Page) => card(page).locator('.preview-body');

/** Ersetzt den gesamten Code-Text im Editor wie eine Nutzer-Eingabe. */
async function typeCode(page: Page, text: string): Promise<void> {
	await page.getByRole('tab', { name: 'Code', exact: true }).click();
	await page.locator('#shell-code .cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

test.describe('Vorschau-Zustände (T139 C1)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test.beforeEach(async ({ page }) => {
		await startApp(page);
	});

	test('ungültiger Code: Fehler statt SVG; gültig: wieder gerendert', async ({ page }) => {
		await openText(page, 'vorschau.mmd', 'flowchart LR\n  A --> B\n');
		await expect(head(page)).toHaveText('gerendert');
		await expect(body(page).locator('svg')).toBeVisible();

		await typeCode(page, 'flowchart LR\n  A --> B -->\n');
		await expect(head(page)).toHaveText('Fehler');
		await expect(body(page).locator('.help-error')).toBeVisible();
		await expect(body(page).locator('svg')).toHaveCount(0);
		await expect(card(page)).toHaveAttribute('aria-label', 'Mermaid-Vorschau');

		// Einklappen während des Fehlers: Körper weg, beim Ausklappen weiter Fehler.
		const toggle = card(page).getByRole('button', { name: 'Mermaid-Vorschau einklappen' });
		await toggle.click();
		const expand = card(page).getByRole('button', { name: 'Mermaid-Vorschau ausklappen' });
		await expect(expand).toHaveAttribute('aria-expanded', 'false');
		await expect(body(page)).toHaveCount(0);
		await expect(head(page)).toHaveCount(0);
		await expand.click();
		await expect(head(page)).toHaveText('Fehler');

		await typeCode(page, 'flowchart LR\n  A --> B --> C\n');
		await expect(head(page)).toHaveText('gerendert');
		await expect(body(page).locator('svg')).toBeVisible();
		await expect(body(page).locator('.help-error')).toHaveCount(0);
		await expect(body(page)).toHaveAttribute('aria-busy', 'false');
	});

	test('Modus "nur Code": Vorschau fest offen, Knopf gesperrt mit Grund', async ({ page }) => {
		await openText(page, 'kuchen.mmd', 'pie title Anteile\n  "a" : 1\n  "b" : 2\n');
		const toggle = card(page).getByRole('button', { name: 'Mermaid-Vorschau einklappen' });
		await expect(toggle).toBeDisabled();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		const reason = await toggle.getAttribute('aria-describedby');
		expect(reason).toBeTruthy();
		await expect(page.locator(`[id="${reason}"]`)).toHaveText(/nur über Code/);
		await expect(head(page)).toHaveText('gerendert');
		await expect(body(page).locator('svg')).toBeVisible();
	});
});
