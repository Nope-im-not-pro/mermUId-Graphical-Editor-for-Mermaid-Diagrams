// T23 C3c: AK-M10, Undo/Redo über 100 gemischte Schritte (FA-06, D-09). Feste Schrittliste
// (Knoten anlegen, umbenennen, verschieben, Kante ziehen, löschen, Code-Edit, Richtung), nach
// jedem Schritt ein Text-Snapshot aus dem Code-Panel. Danach 100x Undo (Vorzustand je Schritt,
// Ende == Start) und 100x Redo (Ende == Snapshot nach Schritt 100). Undo/Redo per Tastatur
// (Strg+Z, Strg+Umschalt+Z, Strg+Y), jeder zehnte Schritt über die Toolbar.
import { expect, test, type Page } from '@playwright/test';
import { connect, node, openText, properties, relabel, startApp } from './helpers-actions';

const START = 'flowchart TD\n    A[Start] --> B[Mitte]\n    B --> C[Ende]\n';
const STEPS = 100;
const KINDS = [
	'add',
	'rename',
	'connect',
	'move',
	'code',
	'delete',
	'direction',
	'add',
	'rename',
	'delete'
] as const;
const DIRECTIONS = ['LR', 'BT', 'RL', 'TD'] as const;

type Kind = (typeof KINDS)[number];

const codeLines = (page: Page) => page.locator('#shell-code .cm-line');

/** Code-Text aus dem sichtbaren Code-Panel (Tab „Code“ muss aktiv sein); leere Zeile = "". */
async function codeText(page: Page): Promise<string> {
	const lines = await codeLines(page).allInnerTexts();
	return lines.map((l) => l.replace(/\n$/, '')).join('\n');
}

async function showTab(page: Page, name: 'Code' | 'Eigenschaften'): Promise<void> {
	const tab = page.getByRole('tab', { name });
	if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
	await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Wartet, bis der Code-Text sich gegenüber `prev` geändert hat und stabil ist. */
async function settledChange(page: Page, prev: string): Promise<string> {
	await showTab(page, 'Code');
	let last = '';
	await expect
		.poll(
			async () => {
				const now = await codeText(page);
				const stable = now === last;
				last = now;
				return stable && now !== prev;
			},
			{ intervals: [100, 100, 150, 250], timeout: 10_000 }
		)
		.toBe(true);
	return last;
}

/** IDs der Knoten, die vollständig im sichtbaren Bereich der Fläche liegen. */
async function nodeIds(page: Page): Promise<string[]> {
	const pane = await page.locator('.svelte-flow__pane').boundingBox();
	if (!pane) throw new Error('Fläche ohne Box');
	const nodes = await page.locator('.svelte-flow__node').evaluateAll((es) =>
		es.map((e) => ({
			id: e.getAttribute('data-id') ?? '',
			r: e.getBoundingClientRect().toJSON()
		}))
	);
	const inside = (r: DOMRect) =>
		r.left > pane.x + 10 &&
		r.top > pane.y + 10 &&
		r.right < pane.x + pane.width - 10 &&
		r.bottom < pane.y + pane.height - 10;
	return nodes
		.filter((n) => n.id && inside(n.r as DOMRect))
		.map((n) => n.id)
		.sort();
}

/**
 * Freier Punkt der Fläche (Abstand zu allen Knoten), relativ zur Fläche. Punkte unter
 * schwebenden Bedienelementen (Befehlsleiste, Vorschau, Flow-Panels) und auf Kanten (Trefferpfad
 * wählt die Kante statt die Auswahl aufzuheben) scheiden aus.
 */
async function freeSpot(page: Page, k: number): Promise<{ x: number; y: number }> {
	const pane = await page.locator('.svelte-flow__pane').boundingBox();
	if (!pane) throw new Error('Fläche ohne Box');
	const boxes = await page
		.locator('.svelte-flow__node')
		.evaluateAll((es) => es.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
	const grid: { x: number; y: number }[] = [];
	for (let gy = 0.08; gy < 0.95; gy += 0.07)
		for (let gx = 0.08; gx < 0.95; gx += 0.07)
			grid.push({ x: pane.x + gx * pane.width, y: pane.y + gy * pane.height });
	const onPane = await page.evaluate(
		(points) =>
			points.map((p) => {
				const el = document.elementFromPoint(p.x, p.y);
				return (
					el?.closest('.svelte-flow__pane') != null && el.closest('.svelte-flow__edge') == null
				);
			}),
		grid
	);
	const margin = 60;
	const free = grid
		.filter((_, i) => onPane[i])
		.filter((p) =>
			boxes.every(
				(b) =>
					p.x < b.left - margin ||
					p.x > b.right + margin ||
					p.y < b.top - margin ||
					p.y > b.bottom + margin
			)
		);
	if (free.length === 0) throw new Error('Kein freier Punkt auf der Fläche');
	const p = free[k % free.length];
	return { x: p.x - pane.x, y: p.y - pane.y };
}

async function clearSelection(page: Page, k: number): Promise<void> {
	const pane = page.locator('.svelte-flow__pane');
	await pane.click({ position: await freeSpot(page, k) });
	await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
}

/** Führt Schritt `i` aus; die Auswahl der Knoten hängt nur von `i` und dem Zustand ab. */
async function runStep(page: Page, kind: Kind, i: number): Promise<void> {
	const ids = await nodeIds(page);
	const pick = (offset: number) => ids[(i + offset) % ids.length];
	switch (kind) {
		case 'add': {
			await showTab(page, 'Eigenschaften');
			const before = await page.locator('.svelte-flow__node').count();
			await page.locator('.svelte-flow__pane').dblclick({ position: await freeSpot(page, i) });
			await expect(page.locator('.svelte-flow__node')).toHaveCount(before + 1);
			return;
		}
		case 'rename':
			await relabel(page, node(page, pick(0)), `Name ${i}`);
			return;
		case 'connect':
			await connect(page, pick(0), pick(1));
			return;
		case 'move': {
			const b = await node(page, pick(2)).boundingBox();
			if (!b) throw new Error(`${pick(2)} ohne Box`);
			const dx = i % 20 < 10 ? 40 : -40;
			const dy = i % 3 === 0 ? 30 : -20;
			await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
			await page.mouse.down();
			await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 });
			await page.mouse.up();
			return;
		}
		case 'code': {
			await showTab(page, 'Code');
			const edges = await page.locator('.svelte-flow__edge').count();
			await page.locator('#shell-code .cm-content').click();
			await page.keyboard.press('Control+End');
			const addNode = i % 20 < 10;
			const line = addNode ? `    K${i}[Code ${i}]` : `    ${pick(0)} -.-> ${pick(1)}`;
			await page.keyboard.insertText(`\n${line}`);
			// Warten auf `codeApply` (Debounce): neuer Knoten bzw. neue Kante im Canvas.
			if (addNode) await expect(node(page, `K${i}`)).toBeVisible();
			else await expect(page.locator('.svelte-flow__edge')).toHaveCount(edges + 1);
			await showTab(page, 'Eigenschaften');
			return;
		}
		case 'delete': {
			const target = pick(3);
			await node(page, target).click();
			await page.keyboard.press('Delete');
			const dialog = page.getByRole('dialog');
			if (await dialog.isVisible()) {
				await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
			}
			await expect(node(page, target)).toHaveCount(0);
			return;
		}
		case 'direction':
			await showTab(page, 'Eigenschaften');
			await clearSelection(page, i);
			await properties(page)
				.getByLabel('Richtung')
				.selectOption(DIRECTIONS[Math.floor(i / KINDS.length) % DIRECTIONS.length]);
			return;
	}
}

test('AK-M10: 100 gemischte Schritte, 100x Undo bis zum Start, 100x Redo bis zum Endzustand', async ({
	page
}) => {
	test.setTimeout(120_000);
	await startApp(page);
	await openText(page, 'undo.mmd', START);
	await page.getByRole('button', { name: 'Manuell', exact: true }).click();
	// Mehr Platz für den Canvas: Vorschau einklappen, einmal herauszoomen.
	await page.getByRole('button', { name: 'Mermaid-Vorschau einklappen' }).click();
	await page.getByRole('button', { name: 'Zoom - verkleinern' }).click();
	await showTab(page, 'Code');
	await expect(page.getByText('Layout: manuell', { exact: true })).toBeVisible();
	await expect.poll(() => codeText(page)).toBe(START);

	const snaps: string[] = [await codeText(page)];
	for (let i = 0; i < STEPS; i++) {
		const kind = KINDS[i % KINDS.length];
		await test.step(`Schritt ${i + 1}: ${kind}`, async () => {
			await runStep(page, kind, i);
			snaps.push(await settledChange(page, snaps[i]));
		});
	}
	expect(snaps).toHaveLength(STEPS + 1);

	await showTab(page, 'Code');
	const undoButton = page.getByRole('button', { name: 'Rückgängig', exact: true });
	const redoButton = page.getByRole('button', { name: 'Wiederholen', exact: true });

	for (let k = STEPS; k > 0; k--) {
		if (k % 10 === 0) await undoButton.click();
		else await page.keyboard.press('Control+z');
		await expect
			.poll(() => codeText(page), { message: `Undo von Schritt ${k}` })
			.toBe(snaps[k - 1]);
	}
	expect(await codeText(page), 'Endzustand nach 100x Undo == Start').toBe(snaps[0]);

	for (let k = 1; k <= STEPS; k++) {
		if (k % 10 === 0) await redoButton.click();
		else await page.keyboard.press(k % 2 === 0 ? 'Control+Shift+z' : 'Control+y');
		await expect.poll(() => codeText(page), { message: `Redo von Schritt ${k}` }).toBe(snaps[k]);
	}
	expect(await codeText(page), 'Endzustand nach 100x Redo == Schritt 100').toBe(snaps[STEPS]);
	await expect(redoButton).toBeDisabled();
});
