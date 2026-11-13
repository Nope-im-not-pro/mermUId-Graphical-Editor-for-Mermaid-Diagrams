// T23 C2b: E2E Kommentar-Erhalt (AK-M07). Fünf grafische Edit-Szenarien an Dateien mit
// %%-Kommentaren; die gespeicherte Datei wird ohne die app-verwaltete Metadaten-Zeile
// `%% @mermuid:` (KONZEPT 6.2, von FA-08 ausgenommen) byte-genau gegen ein Golden-File unter
// tests/fixtures/golden/comments/ geprüft. Zusätzlich: alle Nutzer-Kommentare unverändert und
// in derselben Reihenfolge, jeweils mit unverändertem Vorgänger. Öffnen per `filechooser`,
// Speichern per Download (O-36).
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const DIR = 'tests/fixtures/golden/comments';
const FLOWCHART = `${DIR}/flowchart-kommentare.mmd`;
const SEQUENCE = `${DIR}/sequence-kommentare.mmd`;
const META = '%% @mermuid:';

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
	await expect(page.getByTestId('message')).toHaveText(`Geöffnet: ${path.split('/').pop()}`);
}

/** Speichert per Download und liefert den Text samt abgetrennter Metadaten-Zeile. */
async function save(page: Page): Promise<{ text: string; meta: string | null }> {
	const name = (await page.getByTestId('file').innerText()).replace(/^Datei: | \(geändert\)$/g, '');
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	const download = await pending;
	await expect(page.getByTestId('message')).toHaveText(`Als Download gespeichert: ${name}`);
	const lines = (await readFile(await download.path(), 'utf8')).split('\n');
	const metaLines = lines.filter((l) => l.trim().startsWith(META));
	expect(metaLines.length, 'höchstens eine Metadaten-Zeile').toBeLessThanOrEqual(1);
	return {
		text: lines.filter((l) => !l.trim().startsWith(META)).join('\n'),
		meta: metaLines[0] ?? null
	};
}

const isComment = (l: string) => /^\s*%%(?!\{)/.test(l) && !l.trim().startsWith(META);

/** Nutzer-Kommentare mit ihrer Vorgänger-Zeile (Nachbar oberhalb). */
function commentsWithPredecessor(text: string): [string, string][] {
	const lines = text.split('\n');
	return lines.flatMap((l, i) =>
		isComment(l) ? [[lines[i - 1] ?? '', l] as [string, string]] : []
	);
}

async function expectComments(source: string, saved: string, golden: string): Promise<void> {
	const before = await readFile(source, 'utf8');
	const expected = await readFile(`${DIR}/${golden}`, 'utf8');
	expect(saved).toBe(expected);
	const comments = (t: string) => t.split('\n').filter(isComment);
	expect(comments(saved), 'alle Kommentare in gleicher Reihenfolge').toEqual(comments(before));
	// Jeder Kommentar steht hinter derselben Zeile wie vorher, sofern diese Zeile unverändert ist.
	const savedPairs = commentsWithPredecessor(saved);
	const savedLines = new Set(saved.split('\n'));
	for (const [prev, comment] of commentsWithPredecessor(before)) {
		if (!savedLines.has(prev)) continue;
		expect(savedPairs, `Vorgänger von "${comment.trim()}"`).toContainEqual([prev, comment]);
	}
}

const node = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);

async function renameVia(page: Page, target: () => Promise<void>, text: string): Promise<void> {
	await target();
	const editor = page.getByRole('textbox', { name: 'Label bearbeiten' });
	await editor.fill(text);
	await editor.press('Enter');
}

test('AK-M07: Flowchart Knoten umbenennen, Kommentare bleiben an Position', async ({ page }) => {
	await openFixture(page, FLOWCHART);
	await renameVia(page, () => node(page, 'B').dblclick(), 'Kontrolle');
	await expect(node(page, 'B')).toContainText('Kontrolle');
	const { text } = await save(page);
	await expectComments(FLOWCHART, text, '01-flowchart-umbenennen.mmd');
});

test('AK-M07: Flowchart Knoten hinzufügen, Kommentare bleiben an Position', async ({ page }) => {
	await openFixture(page, FLOWCHART);
	const pane = page.locator('.svelte-flow__pane');
	const box = await pane.boundingBox();
	if (!box) throw new Error('Fläche ohne Box');
	await pane.dblclick({ position: { x: box.width * 0.5, y: box.height * 0.85 } });
	await expect(node(page, 'n1')).toBeVisible();
	const { text, meta } = await save(page);
	// Auto-Layout: keine Klickposition, ohne andere Meta-Änderung keine Metadaten-Zeile (O-48).
	expect(meta).toBeNull();
	await expectComments(FLOWCHART, text, '02-flowchart-knoten-hinzufuegen.mmd');
});

test('AK-M07: Flowchart Kante löschen, Kommentare bleiben an Position', async ({ page }) => {
	await openFixture(page, FLOWCHART);
	await page.getByLabel('Edge from B to C').click();
	await page.keyboard.press('Delete');
	await expect(page.getByLabel('Edge from B to C')).toHaveCount(0);
	const { text } = await save(page);
	await expectComments(FLOWCHART, text, '03-flowchart-kante-loeschen.mmd');
});

test('AK-M07: Flowchart Knoten verschieben, Kommentare bleiben an Position', async ({ page }) => {
	await openFixture(page, FLOWCHART);
	const b = await node(page, 'C').boundingBox();
	if (!b) throw new Error('C ohne Box');
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 80, { steps: 10 });
	await page.mouse.up();
	await expect(page.getByTestId('file')).toHaveText('Datei: flowchart-kommentare.mmd (geändert)');
	const { text, meta } = await save(page);
	expect(meta).toMatch(/"layout":"manual"/);
	expect(meta).toMatch(/"C":\[/);
	await expectComments(FLOWCHART, text, '04-flowchart-knoten-verschieben.mmd');
});

test('AK-M07: Sequence Nachricht ändern, Kommentare bleiben an Position', async ({ page }) => {
	await openFixture(page, SEQUENCE);
	await renameVia(
		page,
		() => page.getByRole('button', { name: 'Nachricht: Bestätigung' }).dblclick(),
		'Lieferzusage'
	);
	await expect(page.getByRole('button', { name: 'Nachricht: Lieferzusage' })).toBeVisible();
	const { text, meta } = await save(page);
	expect(meta).toBeNull();
	await expectComments(SEQUENCE, text, '05-sequence-nachricht-aendern.mmd');
});
