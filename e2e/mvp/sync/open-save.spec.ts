// T23 C2b: E2E Öffnen + Speichern ohne Änderung (AK-M05). Öffnen über den Upload-Fallback
// (`filechooser`), Speichern über den Download-Pfad (O-36); die heruntergeladene Datei muss
// byte-gleich zur Referenz-Datei unter tests/fixtures/golden/open-save/ sein.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const DIR = 'tests/fixtures/golden/open-save';

/** Referenz-Dateien; `block` = zu wählender Mermaid-Block bei mehreren Blöcken in `.md`. */
const REFERENCES: { file: string; what: string; type: string; block?: string }[] = [
	{ file: '01-flowchart-kommentare.mmd', what: 'Flowchart mit %%-Kommentaren', type: 'flowchart' },
	{ file: '02-flowchart-frontmatter.mmd', what: 'Flowchart mit Frontmatter', type: 'flowchart' },
	{
		file: '03-flowchart-direktive.mmd',
		what: 'Flowchart mit %%{init}%%-Direktive',
		type: 'flowchart'
	},
	{
		file: '04-flowchart-unbekannt.mmd',
		what: 'Flowchart mit nicht unterstützter Syntax',
		type: 'flowchart'
	},
	{
		file: '05-flowchart-leerzeilen-einrueckung.mmd',
		what: 'Flowchart mit Leerzeilen und gemischter Einrückung',
		type: 'flowchart'
	},
	{ file: '06-sequence-kommentare.mmd', what: 'Sequence mit %%-Kommentaren', type: 'sequence' },
	{
		file: '07-sequence-frontmatter-direktive.mmd',
		what: 'Sequence mit Frontmatter und Direktive',
		type: 'sequence'
	},
	{
		file: '08-sequence-unbekannt.mmd',
		what: 'Sequence mit nicht unterstützter Syntax',
		type: 'sequence'
	},
	{ file: '09-flowchart-block.md', what: '.md mit einem Flowchart-Block', type: 'flowchart' },
	{
		file: '10-sequence-block.md',
		what: '.md mit Frontmatter, zweitem Block als Sequence ohne EOL am Ende',
		type: 'sequence',
		block: 'Block 2: %%{init: {"theme": "base"}}%%'
	}
];

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
			Object.defineProperty(window, name, { value: undefined, configurable: true });
		}
	});
	await page.goto('/');
	await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
});

async function openFixture(page: Page, path: string): Promise<void> {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
	await (await chooser).setFiles(path);
}

for (const ref of REFERENCES) {
	test(`AK-M05: ${ref.what} (${ref.file}) öffnen und speichern ist byte-gleich`, async ({
		page
	}) => {
		const path = `${DIR}/${ref.file}`;
		const original = await readFile(path);
		await openFixture(page, path);
		if (ref.block) {
			const dialog = page.getByRole('dialog', { name: 'Mermaid-Block wählen' });
			await dialog.getByRole('button', { name: ref.block, exact: true }).click();
		}
		await expect(page.getByTestId('message')).toHaveText(`Geöffnet: ${ref.file}`);
		await expect(page.getByTestId('type')).toContainText(ref.type);
		await expect(page.getByTestId('file')).toHaveText(`Datei: ${ref.file}`);

		const pending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Speichern', exact: true }).click();
		const download = await pending;
		expect(download.suggestedFilename()).toBe(ref.file);
		await expect(page.getByTestId('message')).toHaveText(`Als Download gespeichert: ${ref.file}`);
		await expect(page.getByTestId('file')).toHaveText(`Datei: ${ref.file}`);

		const saved = await readFile(await download.path());
		expect(saved.toString('utf8')).toBe(original.toString('utf8'));
		expect(saved.equals(original), 'Download byte-gleich zur Referenz-Datei').toBe(true);
	});
}
