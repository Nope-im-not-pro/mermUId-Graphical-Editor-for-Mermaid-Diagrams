// T132 C1 (F-13): Ungespeicherte Änderungen landen verzögert als Entwurf (Code, Dateiname) in
// localStorage. Neuladen fragt "wiederherstellen?"; Wiederherstellen stellt den Code her,
// Verwerfen löscht den Entwurf, Speichern löscht ihn ebenfalls; Esc behält ihn.
// T132 C2 (M-15 a): "Zuletzt geöffnet" über Handles in IndexedDB, nur mit File System Access
// (Chromium; Firefox ohne Liste). Echte Handles aus dem Origin Private File System statt Dialog.
import { expect, test, type Page } from '@playwright/test';
import { node, openText, relabel, saveBytes, startApp } from '../sync/helpers-actions';

const TWO = 'flowchart LR\n  A\n  B\n';
const KEY = 'mermuid.draft';

const draftDialog = (page: Page) => page.getByRole('dialog', { name: 'Entwurf gefunden' });
const fileLabel = (page: Page) => page.getByTestId('file');
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

async function reload(page: Page) {
	await page.reload();
	await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
}

test.describe('Entwurf', () => {
	test.beforeEach(async ({ page }) => {
		// Neuladen mit ungespeicherten Änderungen löst `beforeunload` aus: bestätigen.
		page.on('dialog', (d) => void d.accept());
		await startApp(page);
		await openText(page, 'zwei.mmd', TWO);
	});

	/** Label ändern und warten, bis der verzögerte Entwurf geschrieben ist. */
	async function makeDraft(page: Page) {
		await relabel(page, node(page, 'A'), 'Neu');
		await expect(fileLabel(page)).toHaveText('Datei: zwei.mmd (geändert)');
		await expect.poll(() => stored(page)).toContain('Neu');
		const draft = JSON.parse((await stored(page))!);
		expect(Object.keys(draft).sort()).toEqual(['code', 'name']);
		expect(draft.name).toBe('zwei.mmd');
	}

	test('ohne Änderung kein Entwurf und keine Rückfrage', async ({ page }) => {
		expect(await stored(page)).toBeNull();
		await reload(page);
		await expect(draftDialog(page)).toBeHidden();
	});

	test('Entwurf entsteht, Neuladen fragt, Wiederherstellen stellt Code her', async ({ page }) => {
		await makeDraft(page);
		await reload(page);
		await expect(draftDialog(page)).toBeVisible();
		await expect(draftDialog(page)).toContainText('zwei.mmd');
		const buttons = draftDialog(page).getByRole('button');
		await expect(buttons).toHaveText(['Wiederherstellen', 'Verwerfen']);
		await buttons.first().click();
		await expect(draftDialog(page)).toBeHidden();
		await expect(page.getByTestId('message')).toHaveText('Entwurf wiederhergestellt: zwei.mmd');
		await expect(fileLabel(page)).toHaveText('Datei: zwei.mmd (geändert)');
		await expect(node(page, 'A')).toContainText('Neu');
	});

	test('Verwerfen löscht den Entwurf', async ({ page }) => {
		await makeDraft(page);
		await reload(page);
		await draftDialog(page).getByRole('button', { name: 'Verwerfen' }).click();
		await expect(draftDialog(page)).toBeHidden();
		await expect.poll(() => stored(page)).toBeNull();
		await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
		await reload(page);
		await expect(draftDialog(page)).toBeHidden();
	});

	test('Speichern löscht den Entwurf', async ({ page }) => {
		await makeDraft(page);
		await saveBytes(page);
		await expect(fileLabel(page)).toHaveText('Datei: zwei.mmd');
		await expect.poll(() => stored(page)).toBeNull();
		await reload(page);
		await expect(draftDialog(page)).toBeHidden();
	});

	test('Esc behält den Entwurf bis zur nächsten Änderung', async ({ page }) => {
		await makeDraft(page);
		const before = await stored(page);
		await reload(page);
		await expect(draftDialog(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(draftDialog(page)).toBeHidden();
		await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
		expect(await stored(page)).toBe(before);
		await reload(page);
		await expect(draftDialog(page)).toBeVisible();
	});
});

const recentList = (page: Page) => page.getByRole('navigation', { name: 'Zuletzt geöffnet' });
const LIST = 'flowchart LR\n  L\n';

test.describe('Zuletzt geöffnet', () => {
	// Nur Smoke-Test: Öffnen ohne Handle legt keinen Eintrag an, die Liste bleibt leer. Die
	// eigentliche Prüfung "nicht gerendert trotz gespeicherter Einträge" steht im Unit-Test
	// tests/unit/views/shell/draft.test.ts ("ohne File System Access nicht gerendert ...").
	test('ohne File System Access nicht gerendert', async ({ page }) => {
		await startApp(page);
		await openText(page, 'zwei.mmd', TWO);
		await expect(fileLabel(page)).toHaveText('Datei: zwei.mmd');
		await expect(recentList(page)).toHaveCount(0);
	});

	test.describe('mit File System Access', () => {
		test.skip(({ browserName }) => browserName !== 'chromium', 'File System Access nur Chromium');

		test.beforeEach(async ({ page }) => {
			page.on('dialog', (d) => void d.accept());
			// Öffnen-Dialog liefert ein echtes Handle aus dem OPFS (in IndexedDB speicherbar).
			await page.addInitScript((text) => {
				Object.defineProperty(window, 'showOpenFilePicker', {
					configurable: true,
					value: async () => {
						const dir = await navigator.storage.getDirectory();
						const handle = await dir.getFileHandle('liste.mmd', { create: true });
						const writable = await handle.createWritable();
						await writable.write(text);
						await writable.close();
						return [handle];
					}
				});
			}, LIST);
			await page.goto('/');
			await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
			await expect(recentList(page)).toHaveCount(0);
			await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
			await expect(page.getByTestId('message')).toHaveText('Geöffnet: liste.mmd');
			await expect(
				recentList(page).getByRole('button', { name: 'liste.mmd', exact: true })
			).toBeVisible();
			await reload(page);
			await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
		});

		test('Eintrag bleibt nach Neuladen und öffnet die Datei', async ({ page }) => {
			await recentList(page).getByRole('button', { name: 'liste.mmd', exact: true }).click();
			await expect(page.getByTestId('message')).toHaveText('Geöffnet: liste.mmd');
			await expect(fileLabel(page)).toHaveText('Datei: liste.mmd');
			await expect(node(page, 'L')).toBeVisible();
		});

		test('× entfernt den Eintrag dauerhaft', async ({ page }) => {
			await recentList(page)
				.getByRole('button', { name: 'liste.mmd aus der Liste entfernen' })
				.click();
			await expect(recentList(page)).toHaveCount(0);
			await reload(page);
			await expect(recentList(page)).toHaveCount(0);
		});

		test('verweigerte Berechtigung: Meldung, Dokument bleibt', async ({ page }) => {
			await page.evaluate(() => {
				const proto = FileSystemFileHandle.prototype as unknown as Record<string, unknown>;
				proto.queryPermission = async () => 'prompt';
				proto.requestPermission = async () => 'denied';
			});
			await recentList(page).getByRole('button', { name: 'liste.mmd', exact: true }).click();
			await expect(page.getByTestId('message')).toHaveText(
				'Kein Zugriff auf liste.mmd: Berechtigung verweigert. Eintrag mit × entfernen oder die Datei über Öffnen wählen.'
			);
			await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
		});

		test('Dirty-Schutz: Rückfrage vor dem Öffnen, Abbrechen behält die Änderung', async ({
			page
		}) => {
			await recentList(page).getByRole('button', { name: 'liste.mmd', exact: true }).click();
			await expect(fileLabel(page)).toHaveText('Datei: liste.mmd');
			await relabel(page, node(page, 'L'), 'Neu');
			await expect(fileLabel(page)).toHaveText('Datei: liste.mmd (geändert)');
			await recentList(page).getByRole('button', { name: 'liste.mmd', exact: true }).click();
			const unsaved = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
			await expect(unsaved).toBeVisible();
			await unsaved.getByRole('button', { name: 'Abbrechen' }).click();
			await expect(unsaved).toBeHidden();
			await expect(fileLabel(page)).toHaveText('Datei: liste.mmd (geändert)');
			await expect(node(page, 'L')).toContainText('Neu');
		});
	});
});
