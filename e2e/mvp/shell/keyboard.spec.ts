import { expect, test, type Page } from '@playwright/test';

/**
 * T129 C2 (V-32): Tastaturwege der Shell.
 * - Tabs der Seitenleiste (einzige `role="tablist"`): Pfeil links/rechts und Home/End wählen,
 *   `aria-selected` und Fokus folgen, roving tabindex.
 * - Enter auf dem bewaffneten Paletten-Werkzeug legt den Knoten an: im Code vorhanden, sichtbar
 *   mittig in der Canvas-Fläche, genau ein Undo-Schritt.
 */

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const nodes = (page: Page) => page.locator('.svelte-flow__node');
const codeLines = (page: Page) => page.locator('#shell-code .cm-line');

/** Diagramm per Datei-Drop öffnen (wie sequence.spec.ts). */
async function open(page: Page, text: string) {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();
	const dataTransfer = await page.evaluateHandle((content) => {
		const dt = new DataTransfer();
		dt.items.add(new File([content], 'tasten.mmd', { type: 'text/plain' }));
		return dt;
	}, text);
	await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
	await expect(page.getByTestId('message')).toContainText('tasten.mmd');
}

test.describe('Tastaturwege der Shell (T129 C2)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('Seitenleiste: Tabs per Pfeiltaste, aria-selected folgt', async ({ page }) => {
		await page.goto('/');
		await page.locator('.svelte-flow__pane').waitFor();
		const props = tab(page, 'Eigenschaften');
		const code = tab(page, 'Code');
		await expect(props).toHaveAttribute('aria-selected', 'true');
		await expect(props).toHaveAttribute('tabindex', '0');
		await expect(code).toHaveAttribute('tabindex', '-1');

		await props.focus();
		await page.keyboard.press('ArrowRight');
		await expect(code).toBeFocused();
		await expect(code).toHaveAttribute('aria-selected', 'true');
		await expect(props).toHaveAttribute('aria-selected', 'false');
		await expect(code).toHaveAttribute('tabindex', '0');
		await expect(props).toHaveAttribute('tabindex', '-1');
		await expect(page.locator('#shell-code')).toBeVisible();

		await page.keyboard.press('ArrowLeft');
		await expect(props).toBeFocused();
		await expect(props).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('End');
		await expect(code).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Home');
		await expect(props).toHaveAttribute('aria-selected', 'true');
		// Zyklisch: links vom ersten Tab liegt der letzte.
		await page.keyboard.press('ArrowLeft');
		await expect(code).toHaveAttribute('aria-selected', 'true');
	});

	test('Enter auf bewaffnetem Werkzeug: Knoten im Code, mittig sichtbar, ein Undo', async ({
		page
	}) => {
		await open(page, 'flowchart TD\n  A\n');
		await expect(nodes(page)).toHaveCount(1);

		const tool = page
			.getByRole('navigation', { name: 'Palette' })
			.getByRole('button', { name: 'Rechteck', exact: true });
		await tool.focus();
		await page.keyboard.press('Enter');
		await expect(tool).toHaveAttribute('aria-pressed', 'true');
		await expect(nodes(page)).toHaveCount(1);

		await page.keyboard.press('Enter');
		await expect(nodes(page)).toHaveCount(2);
		await expect(tool).toHaveAttribute('aria-pressed', 'false');
		const added = page.locator('.svelte-flow__node:not([data-id="A"])');
		const id = await added.getAttribute('data-id');
		expect(id).not.toBeNull();
		await expect(added).toHaveClass(/\bselected\b/);

		// Sichtbar mittig: Knotenmitte nahe der Flächenmitte.
		const area = (await page.locator('.shell-canvas').boundingBox())!;
		await expect
			.poll(async () => {
				const b = (await added.boundingBox())!;
				return Math.max(
					Math.abs(b.x + b.width / 2 - (area.x + area.width / 2)),
					Math.abs(b.y + b.height / 2 - (area.y + area.height / 2))
				);
			})
			.toBeLessThan(24);

		// Im Code vorhanden.
		await tab(page, 'Code').click();
		await expect(codeLines(page).filter({ hasText: id! })).not.toHaveCount(0);

		// Genau ein Undo-Schritt: danach wieder nur A, Rückgängig erschöpft.
		await page
			.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' })
			.getByRole('button', { name: 'Rückgängig', exact: true })
			.click();
		await expect(nodes(page)).toHaveCount(1);
		await expect(codeLines(page).filter({ hasText: id! })).toHaveCount(0);
		await expect(
			page
				.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' })
				.getByRole('button', { name: 'Rückgängig', exact: true })
		).toBeDisabled();
	});
});
