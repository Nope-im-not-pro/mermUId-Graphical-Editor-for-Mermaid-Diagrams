import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * T126 C1 (V-15, M-12 a): feste Zonen im Canvas bei 1024x768. CanvasBar, Vorschau-Karte,
 * Outline-Liste (sequence), Flow-Controls (flowchart) und die Raster-Knöpfe überlappen sich
 * nicht: paarweiser Bounding-Box-Vergleich der Geschwister-Zonen; Raster/Einrasten liegen in
 * der CanvasBar (Enthaltensein) und überlappen sich gegenseitig nicht. Einpassen (Knopf und
 * Initial-Einpassen nach dem Laden) spart den Rand der Vorschau aus.
 * T126 C2 (F-04): Ausrichten/Verteilen/Richtung in der CanvasBar, aktiv ab 2 bzw. 3 Knoten,
 * Richtung TD/LR schaltet die Deklaration im Code.
 */
test.use({ viewport: { width: 1024, height: 768 } });

type Box = { x: number; y: number; width: number; height: number };

/** Überlappung mit 0.5-px-Toleranz (Nachbar-Knöpfe, Subpixel-Kanten in Firefox) wie `inside`. */
const overlap = (a: Box, b: Box) =>
	a.x < b.x + b.width - 0.5 &&
	b.x < a.x + a.width - 0.5 &&
	a.y < b.y + b.height - 0.5 &&
	b.y < a.y + a.height - 0.5;

const inside = (inner: Box, outer: Box) =>
	inner.x >= outer.x - 0.5 &&
	inner.y >= outer.y - 0.5 &&
	inner.x + inner.width <= outer.x + outer.width + 0.5 &&
	inner.y + inner.height <= outer.y + outer.height + 0.5;

async function boxOf(name: string, locator: Locator): Promise<Box> {
	await expect(locator, name).toBeVisible();
	const box = await locator.boundingBox();
	expect(box, name).not.toBeNull();
	expect(box!.width * box!.height, `${name} hat Fläche`).toBeGreaterThan(0);
	return box!;
}

/** Alle Paare überlappungsfrei; jede Box liegt vollständig im Fenster. */
async function expectNoOverlap(page: Page, zones: Record<string, Locator>) {
	const boxes = Object.entries(zones);
	const measured: [string, Box][] = [];
	for (const [name, locator] of boxes) measured.push([name, await boxOf(name, locator)]);
	const view = { x: 0, y: 0, width: 1024, height: 768 };
	for (const [name, box] of measured) expect(inside(box, view), `${name} im Fenster`).toBe(true);
	for (let i = 0; i < measured.length; i++) {
		for (let j = i + 1; j < measured.length; j++) {
			const [a, boxA] = measured[i];
			const [b, boxB] = measured[j];
			expect(overlap(boxA, boxB), `${a} überlappt ${b}`).toBe(false);
		}
	}
}

/** Raster-Knöpfe vollständig in der CanvasBar und am Mittelpunkt nicht verdeckt. */
async function expectGridButtons(page: Page, bar: Locator) {
	const barBox = await boxOf('CanvasBar', bar);
	for (const name of ['Raster', 'Einrasten']) {
		const button = bar.getByRole('button', { name, exact: true });
		const box = await boxOf(name, button);
		expect(inside(box, barBox), `${name} in der CanvasBar`).toBe(true);
		const hit = await page.evaluate(
			({ x, y, label }) => {
				const el = document.elementFromPoint(x, y);
				return el?.closest('button')?.textContent?.trim() === label;
			},
			{ x: box.x + box.width / 2, y: box.y + box.height / 2, label: name }
		);
		expect(hit, `${name} nicht verdeckt`).toBe(true);
	}
}

async function openFile(page: Page, name: string, text: string) {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();
	const dataTransfer = await page.evaluateHandle(
		([n, t]) => {
			const dt = new DataTransfer();
			dt.items.add(new File([t], n, { type: 'text/plain' }));
			return dt;
		},
		[name, text]
	);
	await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
	await expect(page.getByTestId('message')).toContainText(name);
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' });
const gridButtons = (page: Page) => ({
	Raster: bar(page).getByRole('button', { name: 'Raster', exact: true }),
	Einrasten: bar(page).getByRole('button', { name: 'Einrasten', exact: true })
});
const preview = (page: Page) => page.locator('.center > .preview');

/** Kartengröße stabil: zwei aufeinanderfolgende Messungen gleich (Auf-/Zuklapp-Übergang). */
async function cardStable(page: Page) {
	let last = '';
	await expect
		.poll(async () => {
			const box = JSON.stringify(await preview(page).boundingBox());
			const same = box === last;
			last = box;
			return same;
		})
		.toBe(true);
}

/** Vorschau fertig gerendert (Kartengröße stabil, reservierter Rand nachgeführt). */
async function previewReady(page: Page) {
	await expect(preview(page).locator('.state')).toBeVisible();
	await expect(preview(page).locator('.preview-body svg')).toBeVisible();
}

test('flowchart: CanvasBar, Vorschau-Karte, Controls und Raster-Knöpfe überlappen nicht', async ({
	page
}) => {
	await openFile(page, 'zonen.mmd', 'flowchart LR\n  A --> B --> C --> D\n  B --> E\n');
	await previewReady(page);
	await expectNoOverlap(page, {
		CanvasBar: bar(page),
		Vorschau: preview(page),
		Controls: page.locator('.svelte-flow__controls')
	});
	await expectNoOverlap(page, gridButtons(page));
	await expectGridButtons(page, bar(page));
	// Raster-Knöpfe nur in der CanvasBar, nicht zusätzlich im Canvas.
	await expect(page.getByRole('button', { name: 'Raster', exact: true })).toHaveCount(1);
});

/** Hohes TD-Diagramm: ohne ausgesparten Rand lägen untere Knoten unter der Vorschau-Karte. */
const TALL = 'flowchart TD\n  A --> B --> C --> D --> E --> F\n';

/** Kein Knoten überlappt die Vorschau-Karte. */
async function expectNodesBesideCard(page: Page, when: string) {
	const card = await boxOf('Vorschau', preview(page));
	const nodes = page.locator('.svelte-flow__node');
	await expect(nodes).toHaveCount(6);
	for (let i = 0; i < 6; i++) {
		const box = await boxOf(`Knoten ${i}`, nodes.nth(i));
		expect(overlap(box, card), `${when}: Knoten ${i} unter der Vorschau`).toBe(false);
	}
}

test('flowchart: Initial-Einpassen nach dem Laden spart die Vorschau-Karte aus (M-12)', async ({
	page
}) => {
	await openFile(page, 'initial.mmd', TALL);
	await previewReady(page);
	await expect(async () => expectNodesBesideCard(page, 'nach dem Laden')).toPass();
});

test('flowchart: Einpassen spart die Vorschau-Karte aus, Karte auf und zu (M-12)', async ({
	page
}) => {
	await openFile(page, 'einpassen.mmd', TALL);
	await previewReady(page);
	const fit = page.getByRole('button', { name: 'Einpassen', exact: true });
	await cardStable(page);
	await fit.click();
	await expectNodesBesideCard(page, 'Karte offen');
	const toggle = preview(page).locator('button[aria-expanded]');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await cardStable(page);
	await fit.click();
	await expectNodesBesideCard(page, 'Karte zu');
	await toggle.click();
	await previewReady(page);
	await cardStable(page);
	await fit.click();
	await expectNodesBesideCard(page, 'Karte wieder offen');
});

test('sequence: CanvasBar an gleicher Stelle, keine Überlappung mit Outline, Vorschau, Werkzeugen', async ({
	page
}) => {
	await openFile(
		page,
		'zonen-seq.mmd',
		[
			'sequenceDiagram',
			'  participant A',
			'  participant B',
			'  A->>B: hallo',
			'  loop wieder',
			'    B-->>A: antwort',
			'  end',
			''
		].join('\n')
	);
	await page.getByRole('application', { name: 'Sequenzdiagramm' }).waitFor();
	await previewReady(page);
	const outline = page.getByTestId('outline');
	await expect(outline.locator('li').first()).toBeVisible();
	await expectNoOverlap(page, {
		CanvasBar: bar(page),
		Vorschau: preview(page),
		Outline: outline,
		'Sequenz-Werkzeuge': page.getByRole('toolbar', { name: 'Sequenz-Werkzeuge' })
	});
	await expectNoOverlap(page, gridButtons(page));
	await expectGridButtons(page, bar(page));
	// Gleiche Stelle wie im flowchart: oberhalb der Canvas-Fläche.
	const area = await boxOf('Canvas-Fläche', page.locator('.shell-canvas'));
	const barBox = await boxOf('CanvasBar', bar(page));
	expect(barBox.y + barBox.height).toBeLessThanOrEqual(area.y + 0.5);
});

/** Erste Code-Zeile aus dem Code-Panel (Tab "Code" aktivieren). */
async function firstCodeLine(page: Page): Promise<string> {
	const tab = page.getByRole('tab', { name: 'Code' });
	if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
	return (await page.locator('#shell-code .cm-line').first().innerText()).trim();
}

test('flowchart: Ausrichten/Verteilen/Richtung in der CanvasBar (T126 C2, F-04)', async ({
	page
}) => {
	await openFile(page, 'ausrichten.mmd', 'flowchart LR\n  A --> B\n  A --> C --> D\n');
	await previewReady(page);
	const align = bar(page).getByRole('button', { name: 'Ausrichten', exact: true });
	const spread = bar(page).getByRole('button', { name: 'Verteilen', exact: true });
	const td = bar(page).getByRole('button', { name: 'TD', exact: true });
	const lr = bar(page).getByRole('button', { name: 'LR', exact: true });
	// Alle neuen Knöpfe vollständig in der CanvasBar; Leiste überlappt die Zonen nicht.
	const barBox = await boxOf('CanvasBar', bar(page));
	for (const [name, button] of Object.entries({ align, spread, td, lr })) {
		expect(inside(await boxOf(name, button), barBox), `${name} in der CanvasBar`).toBe(true);
	}
	await expectNoOverlap(page, {
		CanvasBar: bar(page),
		Vorschau: preview(page),
		Controls: page.locator('.svelte-flow__controls')
	});

	await expect(align).toBeDisabled();
	await expect(align).toHaveAttribute('title', 'Ausrichten: mindestens 2 Knoten auswählen');
	await expect(spread).toBeDisabled();
	await page.locator('.svelte-flow__node[data-id="B"]').click();
	await page.locator('.svelte-flow__node[data-id="C"]').click({ modifiers: ['Control'] });
	await expect(align).toBeEnabled();
	await expect(spread).toBeDisabled();
	await page.locator('.svelte-flow__node[data-id="D"]').click({ modifiers: ['Control'] });
	await expect(spread).toBeEnabled();

	// Ausrichten: Menü mit den Einträgen des Kontextmenüs, Wahl verschiebt die Knoten.
	const xOf = async (id: string) =>
		(await boxOf(id, page.locator(`.svelte-flow__node[data-id="${id}"]`))).x;
	await align.click();
	await page.getByRole('menuitem', { name: 'Links ausrichten' }).click();
	await expect(page.getByRole('menu')).toHaveCount(0);
	await expect.poll(async () => Math.abs((await xOf('B')) - (await xOf('D')))).toBeLessThan(1);

	// Richtung: LR gedrückt, TD schaltet den Code, Undo stellt LR her.
	await expect(lr).toHaveAttribute('aria-pressed', 'true');
	await td.click();
	await expect(td).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => firstCodeLine(page)).toBe('flowchart TD');
	await bar(page).getByRole('button', { name: 'Rückgängig', exact: true }).click();
	await expect.poll(() => firstCodeLine(page)).toBe('flowchart LR');
	await expect(lr).toHaveAttribute('aria-pressed', 'true');
});
