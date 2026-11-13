// T133 (F-01): Kopieren, Ausschneiden, Einfügen auf der Flowchart-Auswahl. Chromium liest mit
// Clipboard-Recht die System-Zwischenablage, Firefox (kein Leserecht `clipboard-read`) fügt aus dem
// fensterinternen Puffer ein. Ein Undo-Schritt je Einfügen/Ausschneiden.
import { expect, test, type Page } from '@playwright/test';
import { node, openText, startApp } from '../sync/helpers-actions';

const CODE = ['flowchart LR', '  A[Start] --> B[Ende]', '  C[Rest]', ''].join('\n');
const ORIGINAL = ['A', 'B', 'C'];

const nodes = (page: Page) => page.locator('.svelte-flow__node');
const edges = (page: Page) => page.locator('.svelte-flow__edge');
const status = (page: Page) => page.locator('.graph-canvas p.status');
const undoButton = (page: Page) =>
	page
		.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' })
		.getByRole('button', { name: 'Rückgängig', exact: true });

async function ids(page: Page): Promise<string[]> {
	return nodes(page).evaluateAll((es) => es.map((e) => e.getAttribute('data-id') ?? ''));
}

/** A und B auswählen (Klick, Strg/Cmd-Klick); der Fokus liegt danach im Canvas. */
async function selectAB(page: Page): Promise<void> {
	await node(page, 'A').click();
	await node(page, 'B').click({ modifiers: ['ControlOrMeta'] });
	await expect(node(page, 'A')).toHaveClass(/\bselected\b/);
	await expect(node(page, 'B')).toHaveClass(/\bselected\b/);
}

test.beforeEach(async ({ page, context, browserName }) => {
	if (browserName === 'chromium') {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	}
	await startApp(page);
	await openText(page, 'clip.mmd', CODE);
	await expect(nodes(page)).toHaveCount(3);
});

test('Kopieren + Einfügen: neue IDs, eingefügte Knoten ausgewählt, ein Undo entfernt alles', async ({
	page
}) => {
	await selectAB(page);
	await page.keyboard.press('ControlOrMeta+c');
	await page.keyboard.press('ControlOrMeta+v');

	await expect(nodes(page)).toHaveCount(5);
	await expect(edges(page)).toHaveCount(2);
	const added = (await ids(page)).filter((id) => !ORIGINAL.includes(id));
	expect(added).toHaveLength(2);
	for (const id of added) await expect(node(page, id)).toHaveClass(/\bselected\b/);
	await expect(node(page, 'A')).not.toHaveClass(/\bselected\b/);
	await expect(page.locator('.svelte-flow__node', { hasText: 'Start' })).toHaveCount(2);

	// Zweites Einfügen: wieder neue IDs, nie die des ersten.
	await page.keyboard.press('ControlOrMeta+v');
	await expect(nodes(page)).toHaveCount(7);
	const second = (await ids(page)).filter((id) => !ORIGINAL.includes(id) && !added.includes(id));
	expect(second).toHaveLength(2);

	await undoButton(page).click();
	await expect(nodes(page)).toHaveCount(5);
	await undoButton(page).click();
	await expect(nodes(page)).toHaveCount(3);
	await expect(edges(page)).toHaveCount(1);
	expect(await ids(page)).toEqual(ORIGINAL);
	await expect(undoButton(page)).toBeDisabled();
});

test('Ausschneiden + Einfügen per Tastatur ohne Refokus: je ein Undo-Schritt', async ({ page }) => {
	await selectAB(page);
	await page.keyboard.press('ControlOrMeta+x');
	await expect(nodes(page)).toHaveCount(1);
	await expect(edges(page)).toHaveCount(0);

	await page.keyboard.press('ControlOrMeta+v');
	await expect(nodes(page)).toHaveCount(3);
	await expect(edges(page)).toHaveCount(1);
	const added = (await ids(page)).filter((id) => id !== 'C');
	expect(added.some((id) => ORIGINAL.includes(id))).toBe(false);

	await undoButton(page).click();
	await expect(nodes(page)).toHaveCount(1);
	await undoButton(page).click();
	await expect(nodes(page)).toHaveCount(3);
	expect(await ids(page)).toEqual(ORIGINAL);
});

test('Ungültiger Fremdtext fügt nichts ein und meldet den Grund', async ({ page, browserName }) => {
	test.skip(
		browserName !== 'chromium',
		'Fremdtext nur mit Leserecht (Chromium); Firefox liest nur den eigenen Puffer'
	);
	await page.evaluate(() => navigator.clipboard.writeText('Einkaufsliste: Milch, Brot'));
	await page.getByRole('application', { name: 'Graph-Canvas' }).focus();
	await page.keyboard.press('ControlOrMeta+v');
	await expect(status(page)).toContainText('kein Flowchart-Diagramm');
	await expect(nodes(page)).toHaveCount(3);
	await expect(undoButton(page)).toBeDisabled();

	await page.evaluate(() => navigator.clipboard.writeText('flowchart LR\n  A[offen --> B\n'));
	await page.keyboard.press('ControlOrMeta+v');
	await expect(status(page)).toContainText('ungültig');
	await expect(nodes(page)).toHaveCount(3);
	await expect(undoButton(page)).toBeDisabled();
});

test('Firefox ohne Leserecht: Einfügen aus dem Fensterpuffer', async ({ page, browserName }) => {
	test.skip(browserName !== 'firefox', 'Fensterpuffer-Pfad (kein clipboard-read)');
	const readable = await page.evaluate(async () => {
		try {
			await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
			return true;
		} catch {
			return false;
		}
	});
	expect(readable).toBe(false);
	await node(page, 'C').click();
	await page.keyboard.press('ControlOrMeta+c');
	await page.keyboard.press('ControlOrMeta+v');
	await expect(nodes(page)).toHaveCount(4);
	await expect(page.locator('.svelte-flow__node', { hasText: 'Rest' })).toHaveCount(2);
});

test('Kürzel im Code-Editor wirken nicht auf den Canvas', async ({ page, browserName }) => {
	await node(page, 'A').click();
	await expect(node(page, 'A')).toHaveClass(/\bselected\b/);
	await page.getByRole('tab', { name: 'Code' }).click();
	await page.locator('#shell-code .cm-content').click();
	// Strg-C im Editor kopiert höchstens Code (CodeMirror), nie die Canvas-Auswahl.
	await page.keyboard.press('ControlOrMeta+c');
	await expect(nodes(page)).toHaveCount(3);

	// Einfügen im Canvas legt daher keinen Knoten an: Chromium liest die Code-Zeile (kein
	// Fragment, Meldung), Firefox hat einen leeren Puffer.
	await page.getByRole('application', { name: 'Graph-Canvas' }).focus();
	await page.keyboard.press('ControlOrMeta+v');
	if (browserName === 'chromium') await expect(status(page)).toContainText('Einfügen abgelehnt');

	// Gegenprobe: Kopieren im Canvas fügt genau einen Knoten ein (kein früheres Einfügen nachgeholt).
	await node(page, 'C').click();
	await page.keyboard.press('ControlOrMeta+c');
	await page.keyboard.press('ControlOrMeta+v');
	await expect(nodes(page)).toHaveCount(4);
	await expect(page.locator('.svelte-flow__node', { hasText: 'Start' })).toHaveCount(1);
});
