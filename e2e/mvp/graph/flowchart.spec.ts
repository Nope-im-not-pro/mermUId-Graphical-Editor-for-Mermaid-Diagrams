import { expect, test, type Page } from '@playwright/test';

/** Liest den Mermaid-Text über das Code-Panel (nur lesen) und kehrt zu den Eigenschaften zurück. */
async function readCode(page: Page): Promise<string> {
	await page.getByRole('tab', { name: 'Code' }).click();
	const lines = await page.locator('#shell-code .cm-line').allInnerTexts();
	await page.getByRole('tab', { name: 'Eigenschaften' }).click();
	return lines.join('\n');
}

type Pos = Record<string, [number, number, number, number]>;

/** Positionen aus dem Layout-Kommentar `%% @mermuid: {...}`. */
function positions(code: string): Pos {
	const line = code.split('\n').find((l) => l.trim().startsWith('%% @mermuid:'));
	if (!line) return {};
	const meta = JSON.parse(line.trim().slice('%% @mermuid:'.length)) as { pos?: Pos };
	return meta.pos ?? {};
}

const node = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);

async function center(page: Page, id: string): Promise<{ x: number; y: number }> {
	const b = await node(page, id).boundingBox();
	if (!b) throw new Error(`Knoten ${id} ohne Box`);
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Leeres Diagramm, manuelles Layout, Knoten n1 bis n3 per Doppelklick auf die Fläche. */
async function setupThreeNodes(page: Page, offsets: [number, number][]): Promise<void> {
	await page.goto('/');
	const pane = page.locator('.svelte-flow__pane');
	await pane.waitFor();
	await page.getByRole('button', { name: 'Manuell', exact: true }).click();
	await pane.dblclick({ position: { x: 100, y: 100 } });
	await expect(node(page, 'n1')).toBeVisible();
	// Der erste Knoten löst fitView aus (höchstens 100 %); danach über die Toolbar herauszoomen.
	await expect(page.getByTestId('zoom')).toHaveText('100 %');
	await page.getByRole('button', { name: 'Zoom - verkleinern' }).click();
	await expect(page.getByTestId('zoom')).toHaveText('83 %');
	const b1 = await node(page, 'n1').boundingBox();
	if (!b1) throw new Error('n1 ohne Box');
	for (const [dx, dy] of offsets) await page.mouse.dblclick(b1.x + dx, b1.y + dy);
	await expect(page.locator('.svelte-flow__node')).toHaveCount(1 + offsets.length);
}

async function clearSelection(page: Page): Promise<void> {
	const pb = await page.locator('.svelte-flow__pane').boundingBox();
	if (!pb) throw new Error('Fläche ohne Box');
	// Freie Stelle rechts in der Fläche, abseits von Knoten, Steuerelementen und Umschaltern.
	await page.mouse.click(pb.x + pb.width * 0.85, pb.y + pb.height / 2);
	await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0);
}

async function selectedIds(page: Page): Promise<string[]> {
	const ids = await page
		.locator('.svelte-flow__node.selected')
		.evaluateAll((es) => es.map((e) => e.getAttribute('data-id') ?? ''));
	return ids.sort();
}

async function contextAction(page: Page, onNode: string, item: string): Promise<void> {
	const c = await center(page, onNode);
	await page.mouse.click(c.x, c.y, { button: 'right' });
	await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('AK-M01 flowchart: Knoten anlegen, verschieben, umbenennen, verbinden, löschen ohne Code-Panel', async ({
	page
}) => {
	await setupThreeNodes(page, [[250, 10]]);
	await expect.poll(() => readCode(page)).toMatch(/^flowchart TD\n\s*n1\[n1\]\n\s*n2\[n2\]\n/);

	// Verschieben: n1 per Maus ziehen, Position im Layout-Kommentar ändert sich.
	const before = positions(await readCode(page)).n1;
	expect(before).toBeDefined();
	const c1 = await center(page, 'n1');
	await page.mouse.move(c1.x, c1.y);
	await page.mouse.down();
	await page.mouse.move(c1.x + 40, c1.y + 60, { steps: 10 });
	await page.mouse.up();
	await expect
		.poll(async () => {
			const p = positions(await readCode(page)).n1;
			return [Math.round(p[0] - before[0]), Math.round(p[1] - before[1])];
		})
		.not.toEqual([0, 0]);
	const after = positions(await readCode(page)).n1;
	expect(after[0] - before[0]).toBeGreaterThan(20);
	expect(after[1] - before[1]).toBeGreaterThan(30);

	// Verbinden: rechter Anschluss n1 auf linken Anschluss n2.
	const src = await node(page, 'n1').locator('.svelte-flow__handle-right').boundingBox();
	const dst = await node(page, 'n2').locator('.svelte-flow__handle-left').boundingBox();
	if (!src || !dst) throw new Error('Anschlüsse fehlen');
	await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
	await page.mouse.down();
	await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => readCode(page)).toMatch(/^\s*n1 --> n2$/m);

	// Umbenennen per Doppelklick und per F2.
	const editor = page.getByLabel('Label bearbeiten');
	await node(page, 'n1').dblclick();
	await editor.fill('Start');
	await editor.press('Enter');
	await node(page, 'n2').click();
	await page.keyboard.press('F2');
	await editor.fill('Ende');
	await editor.press('Enter');
	await expect.poll(() => readCode(page)).toMatch(/^\s*n1\[Start\]$/m);
	expect(await readCode(page)).toMatch(/^\s*n2\[Ende\]$/m);
	expect(await readCode(page)).toMatch(/^\s*n1 --> n2$/m);

	// Löschen: n2 hat eine Kante, daher Bestätigungsdialog.
	await node(page, 'n2').click();
	await page.keyboard.press('Delete');
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Löschen bestätigen');
	await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
	await expect(node(page, 'n2')).toHaveCount(0);
	const final = await readCode(page);
	expect(final).not.toMatch(/n2/);
	expect(final).not.toMatch(/-->/);
	expect(final).toMatch(/^\s*n1\[Start\]$/m);
});

test('AK-M02 flowchart: Mehrfachauswahl, Gruppieren, Gruppen-Drag, Ausrichten und Verteilen', async ({
	page
}) => {
	await setupThreeNodes(page, [
		[200, 60],
		[60, 160]
	]);

	// Shift-Klick-Auswahl.
	await node(page, 'n1').click();
	await node(page, 'n2').click({ modifiers: ['Shift'] });
	await node(page, 'n3').click({ modifiers: ['Shift'] });
	expect(await selectedIds(page)).toEqual(['n1', 'n2', 'n3']);
	await clearSelection(page);

	// Lasso-Auswahl über alle drei Knoten.
	const b1 = await node(page, 'n1').boundingBox();
	if (!b1) throw new Error('n1 ohne Box');
	await page.mouse.move(b1.x - 30, b1.y - 30);
	await page.mouse.down();
	await page.mouse.move(b1.x + 330, b1.y + 260, { steps: 10 });
	await page.mouse.up();
	expect(await selectedIds(page)).toEqual(['n1', 'n2', 'n3']);

	// Links ausrichten: alle x gleich.
	await contextAction(page, 'n1', 'Links ausrichten');
	await expect
		.poll(async () => {
			const p = positions(await readCode(page));
			return new Set(['n1', 'n2', 'n3'].map((id) => p[id]?.[0])).size;
		})
		.toBe(1);

	// Vertikal verteilen: gleiche vertikale Abstände (Knoten gleicher Höhe).
	await contextAction(page, 'n1', 'Vertikal verteilen');
	await expect
		.poll(async () => {
			const p = positions(await readCode(page));
			const ys = ['n1', 'n2', 'n3'].map((id) => p[id][1]).sort((a, b) => a - b);
			return Math.round(Math.abs(ys[1] - ys[0] - (ys[2] - ys[1])));
		})
		.toBeLessThanOrEqual(1);
	const distributed = positions(await readCode(page));

	// Gruppieren in einen Subgraph.
	await contextAction(page, 'n1', 'In Subgraph gruppieren');
	await expect.poll(() => readCode(page)).toMatch(/^\s*subgraph (\w+)/m);
	const groupId = /^\s*subgraph (\w+)/m.exec(await readCode(page))?.[1] ?? '';
	expect(await readCode(page)).toMatch(/subgraph \w+[^\n]*\n(\s*n[123]\[n[123]\]\n){3}\s*end/);
	await clearSelection(page);

	// Gruppen-Drag: Container an der Ecke greifen, alle Mitglieder wandern um dasselbe Delta.
	const cb = await node(page, groupId).boundingBox();
	if (!cb) throw new Error('Gruppe ohne Box');
	await page.mouse.move(cb.x + 6, cb.y + 6);
	await page.mouse.down();
	await page.mouse.move(cb.x + 106, cb.y + 56, { steps: 10 });
	await page.mouse.up();
	await expect
		.poll(async () => positions(await readCode(page)).n1[0] - distributed.n1[0])
		.toBeGreaterThan(50);
	const moved = positions(await readCode(page));
	const delta = ['n1', 'n2', 'n3'].map((id) => [
		Math.round(moved[id][0] - distributed[id][0]),
		Math.round(moved[id][1] - distributed[id][1])
	]);
	expect(delta[0][1]).toBeGreaterThan(25);
	expect(delta[1]).toEqual(delta[0]);
	expect(delta[2]).toEqual(delta[0]);
});

/** Freier Punkt der Fläche (kein Knoten, keine Kante, kein Steuerelement), relativ zur Fläche. */
async function freeSpot(page: Page): Promise<{ x: number; y: number }> {
	const pane = await page.locator('.svelte-flow__pane').boundingBox();
	if (!pane) throw new Error('Fläche ohne Box');
	const spot = await page.evaluate(({ x, y, width, height }) => {
		for (let fy = 2; fy <= 8; fy++) {
			for (let fx = 1; fx <= 9; fx++) {
				const px = x + (width * fx) / 10;
				const py = y + (height * fy) / 10;
				const el = document.elementFromPoint(px, py);
				const free = !el?.closest('.svelte-flow__node, .svelte-flow__edge');
				if (el?.closest('.svelte-flow__pane') && free) return { x: px - x, y: py - y };
			}
		}
		return null;
	}, pane);
	if (!spot) throw new Error('Kein freier Punkt auf der Fläche');
	return spot;
}

/** Knoten liegt vollständig innerhalb der Fläche. */
async function insidePane(page: Page, id: string): Promise<boolean> {
	const p = await page.locator('.svelte-flow__pane').boundingBox();
	const b = await node(page, id).boundingBox();
	if (!p || !b) return false;
	return (
		b.x >= p.x && b.y >= p.y && b.x + b.width <= p.x + p.width && b.y + b.height <= p.y + p.height
	);
}

test('V-21 flowchart: neue Knoten im Auto-Layout sichtbar, ohne Positionszeile (M-08)', async ({
	page
}) => {
	await page.goto('/');
	const pane = page.locator('.svelte-flow__pane');
	await pane.waitFor();
	let zoom = '';
	for (let k = 1; k <= 5; k++) {
		await pane.dblclick({ position: await freeSpot(page) });
		await expect(node(page, `n${k}`)).toBeVisible();
		await expect
			.poll(() => insidePane(page, `n${k}`), { message: `n${k} im Sichtbereich` })
			.toBe(true);
		// Kein Zoom-Sprung: nach dem ersten Knoten (Einpassen beim Start) bleibt der Zoom.
		if (k === 1) zoom = await page.getByTestId('zoom').innerText();
		else await expect(page.getByTestId('zoom')).toHaveText(zoom);
	}
	await expect(page.locator('.svelte-flow__node')).toHaveCount(5);
	const code = await readCode(page);
	expect(code).toMatch(/^flowchart TD(\n\s*n[1-5]\[n[1-5]\]){5}/);
	expect(code).not.toContain('%% @mermuid');

	// Wechsel auf "Manuell": der Knoten bleibt an der angezeigten Stelle.
	const shown = await node(page, 'n5').boundingBox();
	if (!shown) throw new Error('n5 ohne Box');
	await page.getByRole('button', { name: 'Manuell', exact: true }).click();
	await expect(page.getByText('Layout: manuell', { exact: true })).toBeVisible();
	const kept = await node(page, 'n5').boundingBox();
	if (!kept) throw new Error('n5 ohne Box');
	expect(Math.abs(kept.x - shown.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(kept.y - shown.y)).toBeLessThanOrEqual(1);

	// Modus Manuell: Einfügen schreibt weiter die Klickposition.
	await pane.dblclick({ position: await freeSpot(page) });
	await expect(node(page, 'n6')).toBeVisible();
	await expect.poll(async () => positions(await readCode(page)).n6).toBeDefined();
});
