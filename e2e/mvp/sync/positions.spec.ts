// T23 C3a: AK-M08, manuelle Positionen überstehen Speichern + Öffnen, Neuladen und den Wechsel
// Auto -> Manuell -> Auto -> Manuell (KONZEPT 5 und 6.2). Positionen werden im Canvas über die
// Svelte-Flow-Koordinaten der Knoten (Toleranz <= 1 px) und über die `%% @mermuid`-Zeile der
// gespeicherten Datei verglichen. Die App stellt nach Neuladen keinen Dokumentzustand her
// (kein Browser-Speicher für Dokumente), die Positionen kommen dort über die Datei zurück.
import { expect, test, type Page } from '@playwright/test';
import { node, openText, saveBytes, startApp } from './helpers-actions';

const FLOW = 'flowchart LR\n    A[Start] --> B[Prüfen]\n    B --> C[Weiter]\n    C --> D[Ende]\n';
const MOVED = ['A', 'B', 'C'] as const;

type Coords = Record<string, [number, number]>;

interface Meta {
	layout: string;
	pos: Record<string, number[]>;
}

/**
 * Verschiebung (x, y) aus einem CSS-Transform. Browser serialisieren unterschiedlich:
 * `translate(Xpx, Ypx)`, `translate(Xpx)` (Firefox bei Y = 0) oder `matrix(a, b, c, d, X, Y)`.
 */
function translation(transform: string): [number, number] | null {
	const num = '(-?[\\d.]+(?:e-?\\d+)?)';
	const t = new RegExp(`translate\\(\\s*${num}px(?:\\s*,\\s*${num}px)?\\s*\\)`).exec(transform);
	if (t) return [Number(t[1]), t[2] === undefined ? 0 : Number(t[2])];
	const m = /matrix\(([^)]*)\)/.exec(transform);
	if (m) {
		const v = m[1].split(',').map(Number);
		if (v.length === 6 && v.every(Number.isFinite)) return [v[4], v[5]];
	}
	return null;
}

/** Knoten-Koordinaten im Flow-System aus dem `transform` der Knoten. */
async function coords(page: Page): Promise<Coords> {
	const list = await page
		.locator('.svelte-flow__node')
		.evaluateAll((es) =>
			es.map((e): [string, string] => [
				e.getAttribute('data-id') ?? '',
				(e as HTMLElement).style.transform
			])
		);
	const out: Coords = {};
	for (const [id, transform] of list) {
		const xy = translation(transform);
		if (!xy) throw new Error(`Knoten ${id} ohne translate: ${transform}`);
		out[id] = xy;
	}
	return out;
}

/** Abstand pro Knoten höchstens 1 px. */
function near(actual: Coords, expected: Coords, ids: readonly string[]): boolean {
	return ids.every(
		(id) =>
			actual[id] !== undefined &&
			Math.abs(actual[id][0] - expected[id][0]) <= 1 &&
			Math.abs(actual[id][1] - expected[id][1]) <= 1
	);
}

/** Wartet, bis die Canvas-Koordinaten `expected` (Toleranz 1 px) entsprechen. */
async function expectCoords(page: Page, expected: Coords, ids: readonly string[]): Promise<void> {
	await expect
		.poll(async () => near(await coords(page), expected, ids), {
			message: `Positionen ${ids.join(', ')} innerhalb 1 px`
		})
		.toBe(true);
}

/** Inhalt der `%% @mermuid`-Zeile; sie muss die letzte nicht leere Zeile sein (6.2). */
function metaOf(text: string): Meta {
	const lines = text.split('\n').filter((l) => l.trim() !== '');
	const last = lines[lines.length - 1];
	const m = /^%% @mermuid: (.*)$/.exec(last);
	if (!m) throw new Error(`Keine @mermuid-Zeile am Ende:\n${text}`);
	return JSON.parse(m[1]) as Meta;
}

/** Positionen der Metadaten (x, y) als Koordinaten. */
function metaCoords(meta: Meta): Coords {
	const out: Coords = {};
	for (const [id, p] of Object.entries(meta.pos)) out[id] = [p[0], p[1]];
	return out;
}

/** Zieht Knoten `id` um (dx, dy) Bildschirm-Pixel. */
async function drag(page: Page, id: string, dx: number, dy: number): Promise<void> {
	const box = await node(page, id).boundingBox();
	if (!box) throw new Error(`Knoten ${id} nicht sichtbar`);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y + dy, { steps: 12 });
	await page.mouse.up();
}

const layoutButton = (page: Page, name: 'Auto' | 'Manuell') =>
	page
		.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' })
		.getByRole('button', { name, exact: true });

/**
 * Öffnet FLOW, merkt das Auto-Layout und verschiebt A, B, C. Liefert Auto- und manuelle
 * Koordinaten; jeder verschobene Knoten liegt danach sichtbar abseits des Auto-Layouts.
 */
async function moveThree(page: Page): Promise<{ auto: Coords; manual: Coords }> {
	await openText(page, 'pos.mmd', FLOW);
	await expect(page.locator('.svelte-flow__node')).toHaveCount(4);
	await expect(layoutButton(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
	const auto = await coords(page);

	await drag(page, 'A', 0, 140);
	await drag(page, 'B', 30, -120);
	await drag(page, 'C', -40, 160);
	await expect(layoutButton(page, 'Manuell')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('file')).toHaveText('Datei: pos.mmd (geändert)');

	const manual = await coords(page);
	for (const id of MOVED) {
		const dist = Math.hypot(manual[id][0] - auto[id][0], manual[id][1] - auto[id][1]);
		expect(dist, `Knoten ${id} verschoben`).toBeGreaterThan(20);
	}
	return { auto, manual };
}

test.beforeEach(async ({ page }) => {
	await startApp(page);
});

test('AK-M08: manuelle Positionen überstehen Speichern und erneutes Öffnen', async ({ page }) => {
	const { manual } = await moveThree(page);

	const saved = (await saveBytes(page)).toString('utf8');
	const meta = metaOf(saved);
	expect(meta.layout).toBe('manual');
	expect(near(metaCoords(meta), manual, MOVED), '@mermuid-Positionen = Canvas').toBe(true);

	await openText(page, 'pos.mmd', saved);
	await expect(layoutButton(page, 'Manuell')).toHaveAttribute('aria-pressed', 'true');
	await expectCoords(page, manual, MOVED);

	const again = (await saveBytes(page)).toString('utf8');
	expect(again, 'erneutes Speichern unverändert').toBe(saved);
});

test('AK-M08: manuelle Positionen überstehen Neuladen der Seite (über die gespeicherte Datei)', async ({
	page
}) => {
	const { manual } = await moveThree(page);
	const saved = (await saveBytes(page)).toString('utf8');
	expect(metaOf(saved).layout).toBe('manual');

	await page.reload();
	await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
	// Verhalten laut KONZEPT: kein Wiederherstellen des Dokuments aus dem Browser-Speicher.
	await expect(page.getByTestId('file')).not.toContainText('pos.mmd');

	await openText(page, 'pos.mmd', saved);
	await expect(layoutButton(page, 'Manuell')).toHaveAttribute('aria-pressed', 'true');
	await expectCoords(page, manual, MOVED);
	expect((await saveBytes(page)).toString('utf8'), 'Datei nach Neuladen unverändert').toBe(saved);
});

test('AK-M08: Auto -> Manuell -> Auto -> Manuell stellt manuelle Positionen wieder her', async ({
	page
}) => {
	const { auto, manual } = await moveThree(page);
	const ids = Object.keys(auto);

	for (let round = 1; round <= 2; round++) {
		await layoutButton(page, 'Auto').click();
		await expect(layoutButton(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
		// Auto-Layout ignoriert die manuellen Positionen ...
		await expectCoords(page, auto, ids);
		// ... verwirft sie aber nicht: die Zeile bleibt mit "layout":"auto" erhalten (6.2).
		const autoMeta = metaOf((await saveBytes(page)).toString('utf8'));
		expect(autoMeta.layout, `Runde ${round}: Modus auto`).toBe('auto');
		expect(near(metaCoords(autoMeta), manual, MOVED), `Runde ${round}: pos erhalten`).toBe(true);

		await layoutButton(page, 'Manuell').click();
		await expect(layoutButton(page, 'Manuell')).toHaveAttribute('aria-pressed', 'true');
		await expectCoords(page, manual, ids);
		const manualMeta = metaOf((await saveBytes(page)).toString('utf8'));
		expect(manualMeta.layout, `Runde ${round}: Modus manual`).toBe('manual');
		expect(near(metaCoords(manualMeta), manual, MOVED), `Runde ${round}: pos gleich`).toBe(true);
	}
});
