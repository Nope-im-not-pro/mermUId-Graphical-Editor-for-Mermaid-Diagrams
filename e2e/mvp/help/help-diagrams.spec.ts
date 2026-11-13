// T24 C2: E2E Hilfe (AK-M16). Die Hilfe öffnet per F1 und per Toolbar; jeder ```mermaid-Block
// aus static/help/hilfe.md (Locale de-DE) bzw. static/help/help.md (Locale en-US, T109)
// erscheint als gerendertes SVG, ohne Fehleranzeige und ohne Konsolenfehler.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

interface HelpLocale {
	locale: string;
	file: string;
	toolbar: string;
	help: string;
	renderError: string;
	loading: string;
}

const LOCALES: HelpLocale[] = [
	{
		locale: 'de-DE',
		file: 'static/help/hilfe.md',
		toolbar: 'Werkzeugleiste',
		help: 'Hilfe',
		renderError: 'Diagramm nicht darstellbar',
		loading: 'Diagramm wird geladen'
	},
	{
		locale: 'en-US',
		file: 'static/help/help.md',
		toolbar: 'Toolbar',
		help: 'Help',
		renderError: 'Diagram cannot be displayed',
		loading: 'Loading diagram'
	}
];

async function countMermaidBlocks(file: string): Promise<number> {
	const text = await readFile(file, 'utf8');
	return (text.match(/^```mermaid[ \t]*$/gm) ?? []).length;
}

for (const lang of LOCALES) {
	test.describe(`Hilfe ${lang.file} (${lang.locale})`, () => {
		test.use({ locale: lang.locale });

		const openers: { name: string; open: (page: Page) => Promise<void> }[] = [
			{ name: 'F1', open: (page) => page.keyboard.press('F1') },
			{
				name: 'Toolbar',
				open: (page) =>
					page
						.getByRole('toolbar', { name: lang.toolbar })
						.getByRole('button', { name: lang.help, exact: true })
						.click()
			}
		];

		for (const opener of openers) {
			test(`AK-M16: Hilfe per ${opener.name} rendert alle Mermaid-Blöcke fehlerfrei`, async ({
				page
			}) => {
				const errors: string[] = [];
				page.on('console', (msg) => {
					if (msg.type() === 'error') errors.push(msg.text());
				});
				page.on('pageerror', (err) => errors.push(err.message));

				const expected = await countMermaidBlocks(lang.file);
				expect(expected, 'Hilfe enthält Mermaid-Blöcke').toBeGreaterThan(0);

				await page.goto('/');
				await expect(page.getByRole('toolbar', { name: lang.toolbar })).toBeVisible();
				await opener.open(page);

				const help = page.getByRole('dialog', { name: lang.help });
				await expect(help).toBeVisible();
				const blocks = help.locator('.help-mermaid');
				await expect(blocks).toHaveCount(expected);
				for (const block of await blocks.all()) {
					await expect(block).toHaveAttribute('aria-busy', 'false');
				}
				await expect(help.locator('.help-mermaid > svg')).toHaveCount(expected);
				for (const svg of await help.locator('.help-mermaid > svg').all()) {
					await expect(svg).toBeVisible();
					expect(await svg.locator('g').count(), 'SVG mit Inhalt').toBeGreaterThan(0);
				}
				await expect(help.getByRole('alert')).toHaveCount(0);
				await expect(help.getByText(lang.renderError)).toHaveCount(0);
				await expect(help.getByText(lang.loading)).toHaveCount(0);
				expect(errors, 'Keine Konsolen- oder Seitenfehler').toEqual([]);

				await page.keyboard.press('Escape');
				await expect(help).toBeHidden();
			});
		}
	});
}
