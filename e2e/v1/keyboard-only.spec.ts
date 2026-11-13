// T139 C1 (V-33): reine Tastaturbedienung des Graph-Canvas. Tab-Zyklus (Dokument-Reihenfolge,
// am Rand verlässt Tab den Canvas), C-Verbinden mit Pfeil/Enter/Esc, Alt+Pfeil, Shift+F10
// (Kontextmenü), Strg-D/S/E/F. Ohne Maus: nur das Öffnen der Datei läuft über den Upload-Helfer.
// Bestand: Tabs der Seitenleiste per Pfeiltaste und Enter auf bewaffnetem Werkzeug in
// e2e/mvp/shell/keyboard.spec.ts, Strg-Plus/Minus/0 in e2e/mvp/graph/zoom.spec.ts,
// Strg-C/X/V in e2e/mvp/graph/clipboard.spec.ts.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { node, openText, startApp } from '../mvp/sync/helpers-actions';

const CODE = ['flowchart LR', '  A[Start] --> B[Mitte]', '  B --> C[Ende]', ''].join('\n');

const canvas = (page: Page) => page.getByRole('application', { name: 'Graph-Canvas' });
const nodes = (page: Page) => page.locator('.svelte-flow__node');
const edges = (page: Page) => page.locator('.svelte-flow__edge');
const message = (page: Page) => page.getByTestId('message');
const selected = (page: Page) => page.locator('.svelte-flow__node.selected');
const codeTab = (page: Page) => page.getByRole('tab', { name: 'Code', exact: true });

/** Code-Text aus dem Editor (Code-Tab wird dafür geöffnet). */
async function code(page: Page): Promise<string> {
	if ((await codeTab(page).getAttribute('aria-selected')) !== 'true') {
		await codeTab(page).focus();
		await page.keyboard.press('Enter');
	}
	return (await page.locator('#shell-code .cm-content').innerText()).replace(/\u00a0/g, ' ');
}

/**
 * Fokus per Tab-Taste vom ersten Knopf der Werkzeugleiste bis in den Canvas. Startpunkt fest
 * gesetzt: nach `blur()` beginnt Firefox die Tab-Folge am alten Element, nicht am Seitenanfang.
 */
async function tabIntoCanvas(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Neu', exact: true }).focus();
	for (let i = 0; i < 150; i++) {
		await page.keyboard.press('Tab');
		if (await canvas(page).evaluate((el) => el === document.activeElement)) return;
	}
	throw new Error('Canvas per Tab nicht erreichbar');
}

/** Canvas-Fokus wie keymap.ts `onCanvas`: Wrapper, Knoten oder Kante (nicht die Controls). */
const inCanvas = (page: Page) =>
	page.evaluate(() => {
		const el = document.activeElement;
		return (
			el !== null &&
			(el.matches('.graph-canvas') || el.closest('.svelte-flow__node, .svelte-flow__edge') !== null)
		);
	});

/**
 * Knoten oder Kante `id` per Tab-Zyklus auswählen: vorwärts, sonst (Auswahl schon dahinter) nach erneutem
 * Eintritt rückwärts per Shift+Tab.
 */
async function selectByTab(page: Page, id: string): Promise<void> {
	for (const key of ['Tab', 'Shift+Tab']) {
		await tabIntoCanvas(page);
		for (let i = 0; i < 8 && (await inCanvas(page)); i++) {
			const picked = page.locator('.svelte-flow__node.selected, .svelte-flow__edge.selected');
			if ((await picked.count()) === 1 && (await picked.getAttribute('data-id')) === id) return;
			await page.keyboard.press(key);
		}
	}
	throw new Error(`Knoten ${id} per Tab nicht erreichbar`);
}

test.describe('Reine Tastaturbedienung (T139 C1)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test.beforeEach(async ({ page }) => {
		await startApp(page);
		await openText(page, 'tasten.mmd', CODE);
		await expect(nodes(page)).toHaveCount(3);
		await expect(edges(page)).toHaveCount(2);
	});

	test('Tab-Zyklus: Dokument-Reihenfolge vor und zurück, am Ende verlässt Tab den Canvas', async ({
		page
	}) => {
		await tabIntoCanvas(page);
		await expect(selected(page)).toHaveCount(0);

		for (const id of ['A', 'B', 'C']) {
			await page.keyboard.press('Tab');
			await expect(node(page, id)).toHaveClass(/\bselected\b/);
			await expect(selected(page)).toHaveCount(1);
		}
		await page.keyboard.press('Shift+Tab');
		await expect(node(page, 'B')).toHaveClass(/\bselected\b/);
		await page.keyboard.press('Shift+Tab');
		await expect(node(page, 'A')).toHaveClass(/\bselected\b/);

		// Nach den Knoten folgen die Kanten (e1, e2), danach gibt der Canvas den Fokus ab: keine
		// Tastaturfalle. Derzeit liegen Kanten und Knoten zusätzlich als eigene Tab-Stopps davor
		// (siehe fixme unten), daher Obergrenze statt genauer Anzahl.
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await expect(node(page, 'C')).toHaveClass(/\bselected\b/);
		for (const id of ['e1', 'e2']) {
			await page.keyboard.press('Tab');
			await expect(page.locator(`.svelte-flow__edge[data-id="${id}"]`)).toHaveClass(/\bselected\b/);
		}
		let left = false;
		for (let i = 0; i < 12 && !left; i++) {
			await page.keyboard.press('Tab');
			left = !(await inCanvas(page));
		}
		expect(left).toBe(true);
	});

	// Befund (T139 C1): Nach dem Zyklus-Ende (letzte Kante) landet Tab nicht außerhalb des
	// Canvas, sondern nacheinander auf jeder Kante und jedem Knoten (xyflow-Elemente mit
	// tabindex=0, role=group), erst danach verlässt der Fokus den Canvas. Bei n Elementen n
	// zusätzliche Tab-Stopps; Kanten tragen dabei den englischen xyflow-Standardnamen
	// ("Edge from A to B") trotz deutscher Oberfläche. Fix im Produktcode (GraphFlow/Mapping)
	// außerhalb des Scopes.
	test.fixme('Tab nach der letzten Kante verlässt den Canvas sofort', async ({ page }) => {
		await selectByTab(page, 'e2');
		await page.keyboard.press('Tab');
		expect(await inCanvas(page)).toBe(false);
	});

	test('C-Verbinden: Pfeil wählt Ziel, Enter verbindet; Esc bricht ab', async ({ page }) => {
		await selectByTab(page, 'A');

		// Esc bricht ab, keine neue Kante.
		await page.keyboard.press('c');
		await expect(message(page)).toContainText('Pfeiltasten');
		await page.keyboard.press('ArrowRight');
		await expect(message(page)).toContainText('Ziel Mitte');
		await page.keyboard.press('Escape');
		await expect(message(page)).toHaveText('Verbinden abgebrochen.');
		await expect(edges(page)).toHaveCount(2);

		// A -> (B) -> C: zweiter Pfeil geht vom aktuellen Ziel weiter.
		await selectByTab(page, 'A');
		await page.keyboard.press('c');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await expect(message(page)).toContainText('Ziel Ende');
		await page.keyboard.press('Enter');
		await expect(edges(page)).toHaveCount(3);
		expect(await code(page)).toMatch(/^\s*A\s*-->\s*C\s*$/m);
	});

	test('C ohne Auswahl meldet fehlende Quelle', async ({ page }) => {
		await tabIntoCanvas(page);
		await page.keyboard.press('c');
		await expect(message(page)).toHaveText('Zum Verbinden zuerst einen Knoten auswählen.');
	});

	test('Alt+Pfeil verbindet direkt mit dem Nachbarn, ohne Nachbar Meldung', async ({ page }) => {
		await selectByTab(page, 'C');
		await page.keyboard.press('Alt+ArrowLeft');
		await expect(edges(page)).toHaveCount(3);
		expect(await code(page)).toMatch(/^\s*C\s*-->\s*B\s*$/m);

		await selectByTab(page, 'C');
		await page.keyboard.press('Alt+ArrowRight');
		await expect(message(page)).toHaveText('Kein Nachbar in dieser Richtung.');
		await expect(edges(page)).toHaveCount(3);
	});

	test('Shift+F10 öffnet das Kontextmenü mit Fokus, Pfeil/Enter wählt, Esc schließt', async ({
		page
	}) => {
		await selectByTab(page, 'B');
		await page.keyboard.press('Shift+F10');
		const menu = page.getByRole('menu', { name: 'Kontextmenü' });
		await expect(menu).toBeVisible();
		await expect(menu.getByRole('menuitem').first()).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();

		await page.keyboard.press('Shift+F10');
		await expect(menu).toBeVisible();
		const duplicate = menu.getByRole('menuitem', { name: 'Duplizieren', exact: true });
		for (let i = 0; i < 8; i++) {
			if (await duplicate.evaluate((el) => el === document.activeElement)) break;
			await page.keyboard.press('ArrowDown');
		}
		await expect(duplicate).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(menu).toBeHidden();
		await expect(nodes(page)).toHaveCount(4);
	});

	test('Strg-D dupliziert die Auswahl', async ({ page }) => {
		await selectByTab(page, 'A');
		await page.keyboard.press('ControlOrMeta+d');
		await expect(nodes(page)).toHaveCount(4);
		await expect(page.locator('.svelte-flow__node', { hasText: 'Start' })).toHaveCount(2);
	});

	test('Strg-S speichert (Download-Pfad) den aktuellen Code', async ({ page }) => {
		await selectByTab(page, 'A');
		const download = page.waitForEvent('download');
		await page.keyboard.press('ControlOrMeta+s');
		const file = await download;
		expect(file.suggestedFilename()).toBe('tasten.mmd');
		expect((await readFile(await file.path())).toString('utf8')).toBe(CODE);
	});

	test('Strg-E schaltet den Code-Tab ein und aus', async ({ page }) => {
		await tabIntoCanvas(page);
		await expect(codeTab(page)).toHaveAttribute('aria-selected', 'false');
		await page.keyboard.press('ControlOrMeta+e');
		await expect(codeTab(page)).toHaveAttribute('aria-selected', 'true');
		await expect(page.locator('#shell-code')).toBeVisible();
		await page.keyboard.press('ControlOrMeta+e');
		await expect(codeTab(page)).toHaveAttribute('aria-selected', 'false');
	});

	test('Strg-F öffnet die Suche mit Fokus im Suchfeld', async ({ page }) => {
		await tabIntoCanvas(page);
		await page.keyboard.press('ControlOrMeta+f');
		const search = page.getByRole('search', { name: 'Canvas-Suche' });
		await expect(search.getByRole('searchbox', { name: 'Suchen' })).toBeFocused();
	});
});
