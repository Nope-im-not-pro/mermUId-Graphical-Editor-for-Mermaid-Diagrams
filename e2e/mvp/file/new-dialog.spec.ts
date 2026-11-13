// T105 C1 (V-14, F-14): "Neu" öffnet die Typwahl flowchart/sequence mit je drei Vorlagen.
// Enter legt die Standardvorlage (leeres flowchart) an, Esc bricht ab; ein Sequenzdiagramm
// entsteht ohne Code-Panel. Bei Änderungen läuft vorher die Ungespeichert-Rückfrage (T101).
import { expect, test, type Page } from '@playwright/test';
import { node, openText, relabel, seqSurface, seqTools, startApp } from '../sync/helpers-actions';

const TWO = 'flowchart LR\n  A\n  B\n';

const newDialog = (page: Page) => page.getByRole('dialog', { name: 'Neues Diagramm' });
const trigger = (page: Page) => page.getByRole('button', { name: 'Neu', exact: true });
const group = (page: Page, name: string) => newDialog(page).getByRole('group', { name });

test.beforeEach(async ({ page }) => {
	await startApp(page);
	await openText(page, 'zwei.mmd', TWO);
});

test('Typwahl mit je drei Vorlagen, Enter legt leeres flowchart an', async ({ page }) => {
	await expect(page).toHaveTitle('zwei.mmd - mermUId');
	await trigger(page).click();
	await expect(newDialog(page)).toBeVisible();
	await expect(group(page, 'Diagrammtyp').getByRole('radio')).toHaveCount(2);
	await expect(group(page, 'Vorlage').getByRole('radio')).toHaveCount(3);
	await expect(group(page, 'Diagrammtyp').getByLabel('Flussdiagramm')).toBeChecked();
	await expect(newDialog(page).getByRole('button', { name: 'Anlegen' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(newDialog(page)).toBeHidden();
	await expect(page.getByTestId('message')).toHaveText('Neues Diagramm.');
	await expect(page.getByTestId('file')).toHaveText('Datei: diagramm.mmd');
	// Tab-Titel nennt dieselbe Datei wie die Toolbar, ohne Stern (O-73).
	await expect(page).toHaveTitle('diagramm.mmd - mermUId');
	await expect(node(page, 'A')).toHaveCount(0);
});

test('Esc schließt ohne Änderung, Fokus zurück auf Neu', async ({ page }) => {
	await trigger(page).click();
	await expect(newDialog(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(newDialog(page)).toBeHidden();
	await expect(node(page, 'A')).toBeVisible();
	await expect(trigger(page)).toBeFocused();
});

test('Sequenzdiagramm aus Vorlage ohne Code-Panel, Teilnehmer grafisch ergänzt', async ({
	page
}) => {
	await trigger(page).click();
	await group(page, 'Diagrammtyp').getByLabel('Sequenzdiagramm').check();
	await expect(group(page, 'Vorlage').getByRole('radio')).toHaveCount(3);
	await group(page, 'Vorlage').getByLabel('Anfrage und Antwort').check();
	await newDialog(page).getByRole('button', { name: 'Anlegen' }).click();
	await expect(seqSurface(page)).toBeVisible();
	await expect(seqSurface(page).locator('[data-id="Client"]').first()).toBeVisible();
	await expect(seqSurface(page).locator('[data-id="Server"]').first()).toBeVisible();
	const items = seqSurface(page).locator('[data-id]');
	const before = await items.count();
	await seqTools(page).getByRole('button', { name: '+ Teilnehmer', exact: true }).click();
	await expect.poll(() => items.count()).toBeGreaterThan(before);
	await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'false');
});

test('Enter in der Radiogruppe legt die aktuelle Auswahl an', async ({ page }) => {
	await trigger(page).click();
	await group(page, 'Diagrammtyp').getByLabel('Sequenzdiagramm').check();
	const pick = group(page, 'Vorlage').getByLabel('Anfrage und Antwort');
	await pick.check();
	await expect(pick).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(newDialog(page)).toBeHidden();
	await expect(page.getByTestId('message')).toHaveText('Neues Diagramm.');
	await expect(seqSurface(page).locator('[data-id="Client"]').first()).toBeVisible();
});

test('mit Änderungen: erst Ungespeichert-Rückfrage, dann Typwahl', async ({ page }) => {
	await relabel(page, node(page, 'A'), 'Geändert');
	await trigger(page).click();
	const unsaved = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
	await expect(unsaved).toBeVisible();
	await unsaved.getByRole('button', { name: 'Verwerfen' }).click();
	await expect(newDialog(page)).toBeVisible();
	await newDialog(page).getByRole('button', { name: 'Anlegen' }).click();
	await expect(page.getByTestId('message')).toHaveText('Neues Diagramm.');
	await expect(node(page, 'A')).toHaveCount(0);
});
