// T101 C1 (V-02): Tab schließen/neu laden warnt per `beforeunload`, solange ungespeicherte
// Änderungen vorliegen. Ohne Änderung kein Dialog. Öffnen über den Upload-Fallback (O-36).
// T101 C2 (V-03): Ungespeichert-Dialog Speichern (primär, fokussiert) / Verwerfen / Abbrechen;
// Speichern läuft über den Download-Pfad (File System Access API ausgeblendet).
// T101 C3: Öffnen nach Speichern im Ungespeichert-Dialog lädt die gewählte Datei.
import { expect, test, type Dialog, type Page } from '@playwright/test';
import { node, openText, relabel, startApp } from '../sync/helpers-actions';

const TWO = 'flowchart LR\n  A\n  B\n';

test.beforeEach(async ({ page }) => {
	await startApp(page);
	await openText(page, 'zwei.mmd', TWO);
});

test('ohne Änderung: Schließen ohne beforeunload-Dialog', async ({ page }) => {
	const dialogs: string[] = [];
	page.on('dialog', (d: Dialog) => {
		dialogs.push(d.type());
		void d.accept();
	});
	await expect(page.getByTestId('file')).toHaveText('Datei: zwei.mmd');
	const closed = page.waitForEvent('close');
	await page.close({ runBeforeUnload: true });
	await closed;
	expect(dialogs).toEqual([]);
});

test('ungespeichert: Schließen löst beforeunload-Dialog aus', async ({ page }) => {
	await relabel(page, node(page, 'A'), 'Neu');
	await expect(page.getByTestId('file')).toHaveText('Datei: zwei.mmd (geändert)');
	const dialog = page.waitForEvent('dialog');
	await page.close({ runBeforeUnload: true });
	const shown = await dialog;
	expect(shown.type()).toBe('beforeunload');
	await shown.dismiss();
	expect(page.isClosed()).toBe(false);
	await expect(page.getByTestId('file')).toHaveText('Datei: zwei.mmd (geändert)');
});

const fileLabel = (page: Page) => page.getByTestId('file');
const unsaved = (page: Page) => page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
const newDialog = (page: Page) => page.getByRole('dialog', { name: 'Neues Diagramm' });

/** Ändert ein Label und löst `Neu` aus; liefert den Neu-Button (Auslöser des Dialogs). */
async function dirtyNew(page: Page) {
	await relabel(page, node(page, 'A'), 'Geändert');
	await expect(fileLabel(page)).toHaveText('Datei: zwei.mmd (geändert)');
	const trigger = page.getByRole('button', { name: 'Neu', exact: true });
	await trigger.click();
	await expect(unsaved(page)).toBeVisible();
	return trigger;
}

async function expectUnchanged(page: Page) {
	await expect(unsaved(page)).toBeHidden();
	await expect(node(page, 'A')).toBeVisible();
	await expect(fileLabel(page)).toHaveText('Datei: zwei.mmd (geändert)');
}

test('Ungespeichert-Dialog: Speichern zuerst und fokussiert', async ({ page }) => {
	await dirtyNew(page);
	const buttons = unsaved(page).getByRole('button');
	await expect(buttons).toHaveText(['Speichern', 'Verwerfen', 'Abbrechen']);
	await expect(buttons.first()).toBeFocused();
});

test('Neu gefolgt von Enter speichert und legt danach neu an', async ({ page }) => {
	await dirtyNew(page);
	const download = page.waitForEvent('download');
	await page.keyboard.press('Enter');
	expect((await download).suggestedFilename()).toBe('zwei.mmd');
	// T105 C1: danach Typwahl; zweites Enter legt die Standardvorlage an (O-69).
	await expect(newDialog(page)).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('message')).toHaveText('Neues Diagramm.');
	await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
	await expect(node(page, 'A')).toHaveCount(0);
});

test('Verwerfen legt neu an, ohne zu speichern', async ({ page }) => {
	const downloads: string[] = [];
	page.on('download', (d) => downloads.push(d.suggestedFilename()));
	await dirtyNew(page);
	await unsaved(page).getByRole('button', { name: 'Verwerfen' }).click();
	// T105 C1: Typwahl bestätigen (O-69).
	await newDialog(page).getByRole('button', { name: 'Anlegen' }).click();
	await expect(page.getByTestId('message')).toHaveText('Neues Diagramm.');
	await expect(node(page, 'A')).toHaveCount(0);
	expect(downloads).toEqual([]);
});

test('Abbrechen und Esc behalten das Dokument, Fokus zurück auf Neu', async ({ page }) => {
	const trigger = await dirtyNew(page);
	await unsaved(page).getByRole('button', { name: 'Abbrechen' }).click();
	await expectUnchanged(page);
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(unsaved(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expectUnchanged(page);
	await expect(trigger).toBeFocused();
});

test('Öffnen: Speichern im Dialog speichert, danach wird die Datei geöffnet', async ({ page }) => {
	await relabel(page, node(page, 'A'), 'Geändert');
	await expect(fileLabel(page)).toHaveText('Datei: zwei.mmd (geändert)');
	await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
	await expect(unsaved(page)).toBeVisible();
	const download = page.waitForEvent('download');
	const chooser = page.waitForEvent('filechooser');
	await unsaved(page).getByRole('button', { name: 'Speichern' }).click();
	expect((await download).suggestedFilename()).toBe('zwei.mmd');
	const buffer = Buffer.from('flowchart TD\n  Z\n', 'utf8');
	await (await chooser).setFiles({ name: 'drei.mmd', mimeType: 'text/plain', buffer });
	await expect(page.getByTestId('message')).toHaveText('Geöffnet: drei.mmd');
	await expect(fileLabel(page)).toHaveText('Datei: drei.mmd');
	await expect(node(page, 'Z')).toBeVisible();
	await expect(node(page, 'A')).toHaveCount(0);
});
