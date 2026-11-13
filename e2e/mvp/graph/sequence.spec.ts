import { expect, test, type Page } from '@playwright/test';

/** Liest den Mermaid-Text über das Code-Panel (nur lesen) und kehrt zu den Eigenschaften zurück. */
async function readCode(page: Page): Promise<string> {
	await page.getByRole('tab', { name: 'Code' }).click();
	const lines = await page.locator('#shell-code .cm-line').allInnerTexts();
	await page.getByRole('tab', { name: 'Eigenschaften' }).click();
	return lines.join('\n').trimEnd();
}

const lines = (...l: string[]) => l.join('\n');

test('AK-M03 sequence: Teilnehmer, Nachricht, Loop, alt/else, Notiz anlegen, umsortieren, löschen', async ({
	page
}) => {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();

	// Leeres Sequenzdiagramm per Datei-Drop öffnen.
	const dataTransfer = await page.evaluateHandle(() => {
		const dt = new DataTransfer();
		dt.items.add(new File(['sequenceDiagram\n'], 'ablauf.mmd', { type: 'text/plain' }));
		return dt;
	});
	await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
	await expect(page.getByTestId('message')).toContainText('ablauf.mmd');

	const tools = page.getByRole('toolbar', { name: 'Sequenz-Werkzeuge' });
	const surface = page.getByRole('application', { name: 'Sequenzdiagramm' });
	const tool = (name: string) => tools.getByRole('button', { name, exact: true });
	const item = (label: string) => surface.getByRole('button', { name: label, exact: true });

	// Anlegen: drei Teilnehmer, eine Nachricht, loop und alt.
	for (let i = 0; i < 3; i++) await tool('+ Teilnehmer').click();
	await tool('+ Nachricht').click();
	await tool('+ Block').click();
	await tools.getByLabel('Blockart').selectOption('alt');
	await tool('+ Block').click();

	// else-Abschnitt am alt-Block.
	await item('Block alt: Bedingung').locator('text').click();
	await tool('+ Abschnitt').click();

	// Nachricht und Notiz im loop.
	await item('Block loop: Schleife').locator('text').click();
	await tool('+ Nachricht').click();
	await tool('+ Notiz').click();

	await expect
		.poll(() => readCode(page))
		.toBe(
			lines(
				'sequenceDiagram',
				'    participant Teilnehmer1',
				'    participant Teilnehmer2',
				'    participant Teilnehmer3',
				'    Teilnehmer1->>Teilnehmer2: Nachricht',
				'    loop Schleife',
				'        Note over Teilnehmer1,Teilnehmer2: Notiz',
				'        Teilnehmer1->>Teilnehmer2: Nachricht',
				'    end',
				'    alt Bedingung',
				'    else Abschnitt',
				'    end'
			)
		);

	// Umsortieren per Tastatur: Teilnehmer1 nach rechts, erste Nachricht nach unten (in den loop).
	await item('Teilnehmer: Teilnehmer1').focus();
	await page.keyboard.press('ArrowRight');
	await item('Nachricht: Nachricht').first().focus();
	await page.keyboard.press('ArrowDown');

	await expect
		.poll(() => readCode(page))
		.toBe(
			lines(
				'sequenceDiagram',
				'    participant Teilnehmer2',
				'    participant Teilnehmer1',
				'    participant Teilnehmer3',
				'    loop Schleife',
				'        Teilnehmer1->>Teilnehmer2: Nachricht',
				'        Note over Teilnehmer1,Teilnehmer2: Notiz',
				'        Teilnehmer1->>Teilnehmer2: Nachricht',
				'    end',
				'    alt Bedingung',
				'    else Abschnitt',
				'    end'
			)
		);

	// Löschen: Notiz per Entf-Taste, alt-Block per Werkzeug „Löschen“.
	await item('Notiz: Notiz').focus();
	await page.keyboard.press('Delete');
	await item('Block alt: Bedingung').locator('text').click();
	await tool('Löschen').click();

	await expect
		.poll(() => readCode(page))
		.toBe(
			lines(
				'sequenceDiagram',
				'    participant Teilnehmer2',
				'    participant Teilnehmer1',
				'    participant Teilnehmer3',
				'    loop Schleife',
				'        Teilnehmer1->>Teilnehmer2: Nachricht',
				'        Teilnehmer1->>Teilnehmer2: Nachricht',
				'    end'
			)
		);
});

test('V-05 dunkles Theme: berechnete Füllfarbe der Pfeilspitze ungleich Hintergrund', async ({
	page
}) => {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();
	const dataTransfer = await page.evaluateHandle(() => {
		const dt = new DataTransfer();
		dt.items.add(new File(['sequenceDiagram\nA->>B: m\nA-|\\B: h\n'], 'pfeile.mmd'));
		return dt;
	});
	await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
	await expect(page.getByTestId('message')).toContainText('pfeile.mmd');
	await expect(page.locator('.shell')).toHaveAttribute('data-theme', 'dark');

	const surface = page.getByRole('application', { name: 'Sequenzdiagramm' });
	await expect(surface.getByRole('button', { name: 'Nachricht: m', exact: true })).toBeVisible();

	const colors = await surface.evaluate((el) => {
		let bg = 'rgba(0, 0, 0, 0)';
		for (let n: Element | null = el; n; n = n.parentElement) {
			const c = getComputedStyle(n).backgroundColor;
			if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
				bg = c;
				break;
			}
		}
		const fill = (head: string) =>
			getComputedStyle(el.querySelector(`marker[id$="-${head}"] path`)!).fill;
		return { bg, arrow: fill('arrow'), half: fill('half') };
	});
	expect(colors.bg).not.toBe('rgba(0, 0, 0, 0)');
	expect(colors.arrow).not.toBe(colors.bg);
	expect(colors.half).not.toBe(colors.bg);
	// SVG-Standard Schwarz wäre im dunklen Theme unsichtbar.
	expect(colors.arrow).not.toBe('rgb(0, 0, 0)');
	expect(colors.half).not.toBe('rgb(0, 0, 0)');
});
