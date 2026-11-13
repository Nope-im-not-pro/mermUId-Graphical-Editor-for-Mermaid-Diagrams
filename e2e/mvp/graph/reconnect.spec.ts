// T130 (F-03): Kantenende per Drag auf einen anderen Knoten umhängen. Ziel und Quelle ändern sich
// im Code, genau ein Undo-Schritt; Ablage ins Leere ändert nichts und legt keinen Schritt an.
import { expect, test, type Page } from '@playwright/test';
import { node, openText, startApp } from '../sync/helpers-actions';

const CODE = ['flowchart LR', '  A --> B', '  C', '  D', ''].join('\n');

const edge = (page: Page) => page.locator('.svelte-flow__edge[data-id="e1"]');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' });
const undoButton = (page: Page) =>
	bar(page).getByRole('button', { name: 'Rückgängig', exact: true });

/** Code-Text über das Code-Panel; danach zurück zu den Eigenschaften. */
async function codeText(page: Page): Promise<string> {
	await page.getByRole('tab', { name: 'Code' }).click();
	const lines = await page.locator('#shell-code .cm-line').allInnerTexts();
	await page.getByRole('tab', { name: 'Eigenschaften' }).click();
	return lines.map((l) => (l === '\n' ? '' : l)).join('\n');
}

/** Code-Zeilen ohne Layout-Kommentar und Leerzeilen, getrimmt. */
async function body(page: Page): Promise<string[]> {
	return (await codeText(page))
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l !== '' && !l.startsWith('%% @mermuid:'));
}

async function centerOf(loc: ReturnType<Page['locator']>, what: string) {
	const b = await loc.boundingBox();
	if (!b) throw new Error(`${what} ohne Box`);
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function selectEdge(page: Page): Promise<void> {
	await edge(page).locator('path.hit').click({ force: true });
	await expect(edge(page)).toHaveClass(/selected/);
}

/** Zieht den Umhäng-Griff `end` der Kante e1 auf den Punkt `to`. */
async function dragEnd(page: Page, end: 'source' | 'target', to: { x: number; y: number }) {
	await selectEdge(page);
	const from = await centerOf(page.locator(`.svelte-flow__edgeupdater-${end}`), `Griff ${end}`);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
}

/** Freier Punkt in der Fläche (kein Knoten darunter). */
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
	const pane = page.locator('.svelte-flow__pane');
	const b = await pane.boundingBox();
	if (!b) throw new Error('Fläche ohne Box');
	const p = { x: b.x + b.width / 2, y: b.y + b.height * 0.8 };
	const onNode = await page.evaluate(
		({ x, y }) => document.elementFromPoint(x, y)?.closest('.svelte-flow__node') !== null,
		p
	);
	expect(onNode, 'Ablagepunkt liegt auf keinem Knoten').toBe(false);
	return p;
}

test('Kante umhängen: Ziel, Quelle, ins Leere, ein Undo-Schritt', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await startApp(page);
	await openText(page, 'umhaengen.mmd', CODE);
	await expect(node(page, 'D')).toBeVisible();
	await expect(edge(page)).toBeVisible();
	const original = await codeText(page);
	await expect(undoButton(page)).toBeDisabled();

	// Ins Leere: Code unverändert, kein Undo-Schritt.
	await dragEnd(page, 'target', await emptyPoint(page));
	expect(await codeText(page)).toBe(original);
	await expect(undoButton(page)).toBeDisabled();

	// Ziel umhängen: B -> C.
	await dragEnd(page, 'target', await centerOf(node(page, 'C'), 'C'));
	await expect.poll(() => body(page)).toContain('A --> C');
	expect(await body(page)).not.toContain('A --> B');

	// Genau ein Undo-Schritt.
	await undoButton(page).click();
	await expect.poll(() => codeText(page)).toBe(original);
	await expect(undoButton(page)).toBeDisabled();

	// Quelle umhängen: A -> D.
	await dragEnd(page, 'source', await centerOf(node(page, 'D'), 'D'));
	await expect.poll(() => body(page)).toContain('D --> B');
	expect(await body(page)).not.toContain('A --> B');
	await undoButton(page).click();
	await expect.poll(() => codeText(page)).toBe(original);
	await expect(undoButton(page)).toBeDisabled();

	expect(errors).toEqual([]);
});
