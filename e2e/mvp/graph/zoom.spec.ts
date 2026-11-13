import { expect, test, type Page } from '@playwright/test';

/** Ersetzt den gesamten Code-Text im Editor wie eine Nutzer-Eingabe. */
async function typeCode(page: Page, text: string): Promise<void> {
	await page.getByRole('tab', { name: 'Code' }).click();
	await page.locator('#shell-code .cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

test('Zoom: erster Knoten höchstens 100 %, Toolbar Zoom -/+ und Strg-Minus/Plus wirken', async ({
	page
}) => {
	await page.goto('/');
	const pane = page.locator('.svelte-flow__pane');
	await pane.waitFor();
	const zoom = page.getByTestId('zoom');

	// fitView beim ersten Knoten zoomt nicht über 100 % (kein 400-%-Sprung).
	await page.getByRole('button', { name: 'Manuell', exact: true }).click();
	await pane.dblclick({ position: { x: 100, y: 100 } });
	await expect(page.locator('.svelte-flow__node[data-id="n1"]')).toBeVisible();
	await expect(zoom).toHaveText('100 %');

	// Toolbar-Schaltflächen.
	await page.getByRole('button', { name: 'Zoom - verkleinern' }).click();
	await expect(zoom).toHaveText('83 %');
	await page.getByRole('button', { name: 'Zoom + vergrößern' }).click();
	await expect(zoom).toHaveText('100 %');
	await page.getByRole('button', { name: 'Zoom + vergrößern' }).click();
	await expect(zoom).toHaveText('120 %');

	// Tastatur: Strg-Minus und Strg-Plus (Taste "=" ohne Umschalt) bei Fokus im Canvas.
	await page.getByRole('application', { name: 'Graph-Canvas' }).focus();
	await page.keyboard.press('Control+Minus');
	await expect(zoom).toHaveText('100 %');
	await page.keyboard.press('Control+Minus');
	await expect(zoom).toHaveText('83 %');
	await page.keyboard.press('Control+Equal');
	await expect(zoom).toHaveText('100 %');
});

test('Einpassen nach Code-Eingabe (gültig und nach Rückkehr zu gültig) ändert den Zoom', async ({
	page
}) => {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor();
	const zoom = page.getByTestId('zoom');
	const nodes = page.locator('.svelte-flow__node');
	const fit = page.getByRole('button', { name: 'Einpassen', exact: true });

	/** Bis an die Untergrenze verkleinern, dann einpassen: der Zoom muss sich lösen. */
	async function zoomOutThenFit() {
		const out = page.getByRole('button', { name: 'Zoom - verkleinern' });
		for (let i = 0; i < 12; i++) await out.click();
		await expect(zoom).toHaveText('25 %');
		await fit.click();
		await expect(zoom).not.toHaveText('25 %');
	}

	const node = (id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
	const hint = page.getByRole('status').filter({ hasText: 'Syntaxfehler:' });
	const code = (c: string) => `flowchart LR\n    A[Start] --> B[Mitte]\n    B --> ${c}\n`;

	// Erste Eingabe: neue Knoten werden gemessen, Einpassen wirkt.
	await typeCode(page, code('C[Ende]'));
	await expect(nodes).toHaveCount(3);
	await zoomOutThenFit();

	// Gültige Änderung bei gleichen Knoten-IDs.
	await typeCode(page, code('C[Ziel]'));
	await expect(node('C')).toHaveText('Ziel');
	await zoomOutThenFit();

	// Ungültig, dann zurück zu gültig: ohne Grafik-Änderung kein Konflikt, gültiger Code wird
	// ohne Wahl übernommen (O-44).
	await typeCode(page, code('C[Ziel'));
	await expect(hint).toBeVisible();
	await typeCode(page, code('C[Ende]'));
	await expect(hint).toHaveCount(0);
	await expect(node('C')).toHaveText('Ende');
	await zoomOutThenFit();
});

/** Drei Teilnehmer, viele Nachrichten: Knöpfe und Kürzel (Prozentanzeige, Anzeigegröße). */
const SEQ_TALL = [
	'sequenceDiagram',
	'    participant A',
	'    participant B',
	'    participant C',
	...Array.from(
		{ length: 14 },
		(_, i) => `    ${'ABC'[i % 3]}->>${'BCA'[i % 3]}: Nachricht ${i + 1}`
	),
	''
].join('\n');

/**
 * Fünf Teilnehmer, zwölf Nachrichten: bei 207 % in beiden Achsen scrollbar (viewport-Vertrag,
 * Vorbedingung mit eigener Meldung).
 */
const SEQ_WIDE = [
	'sequenceDiagram',
	...['A', 'B', 'C', 'D', 'E'].map((p) => `    participant ${p} as Teilnehmer ${p}`),
	...Array.from(
		{ length: 12 },
		(_, i) => `    ${'ABCDE'[i % 5]}->>${'BCDEA'[i % 5]}: Nachricht ${i + 1}`
	),
	''
].join('\n');

/**
 * Karten-Test (Einpassen spart die Karte aus): fünf Teilnehmer, sechs Nachrichten, letzte von A
 * nach E über die volle Breite. Die Outline unter der Fläche hat nur eine Zeile je Nachricht und
 * bleibt kurz, damit die offene Karte weit in die Fläche ragt; die Mehrzeilen-Beschriftungen
 * (`<br>`) machen nur die mermaid-Vorschau hoch (Karte bis zur Höhenbegrenzung), nicht die
 * Canvas-Zeilen. 11 Elemente (> 10 für `expectItemsBesideCard`).
 */
const SEQ_CARD = [
	'sequenceDiagram',
	...['A', 'B', 'C', 'D', 'E'].map((p) => `    participant ${p} as Teilnehmer ${p}`),
	...['A->>B', 'B->>C', 'C->>D', 'D->>E', 'E->>A', 'A->>E'].map(
		(m, i) => `    ${m}: N${i + 1}<br>a<br>b<br>c<br>d<br>e`
	),
	''
].join('\n');

type Box = { x: number; y: number; width: number; height: number };
/** Schnittrechteck-Maße zweier Boxen (0 ohne Überdeckung). */
const overlapSize = (a: Box, b: Box) => ({
	width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
	height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
});
const intersects = (a: Box, b: Box) =>
	a.x < b.x + b.width - 0.5 &&
	b.x < a.x + a.width - 0.5 &&
	a.y < b.y + b.height - 0.5 &&
	b.y < a.y + a.height - 0.5;

/** T126 C3: CanvasBar-Zoom und Strg-+/-/0 im Sequenz-Canvas, Einpassen spart die Karte aus. */
test.describe('Sequenz-Zoom (T126 C3)', () => {
	test.use({ viewport: { width: 1024, height: 768 } });

	const surface = (page: Page) => page.getByRole('application', { name: 'Sequenzdiagramm' });
	const card = (page: Page) => page.locator('.center > .preview');
	const svgWidth = (page: Page) =>
		surface(page)
			.locator('svg')
			.first()
			.evaluate((el) => Number(el.getAttribute('width')));

	/** Boxen aller Elemente des Sequenz-Canvas (Bildschirm-Koordinaten). */
	const itemBoxes = (page: Page) =>
		surface(page)
			.locator('[data-id]')
			.evaluateAll((els) =>
				els.map((el) => {
					const r = el.getBoundingClientRect();
					return {
						id: el.getAttribute('data-id'),
						x: r.x,
						y: r.y,
						width: r.width,
						height: r.height
					};
				})
			);

	/** Kein Element des Sequenz-Canvas überlappt die Vorschau-Karte. */
	async function expectItemsBesideCard(page: Page, when: string) {
		const box = await card(page).boundingBox();
		expect(box, when).not.toBeNull();
		const items = await itemBoxes(page);
		expect(items.length, when).toBeGreaterThan(10);
		for (const r of items) {
			expect(intersects(r, box!), `${when}: ${r.id} unter der Vorschau`).toBe(false);
		}
	}

	/** Zoom in Prozent aus der Anzeige ("83 %"). */
	const percent = async (page: Page) =>
		Number((await page.getByTestId('zoom').textContent())!.replace(/[^0-9]/g, ''));

	/** Kartengröße stabil (Auf-/Zuklapp-Übergang, Rand nachgeführt). */
	async function cardStable(page: Page) {
		let last = '';
		await expect
			.poll(async () => {
				const box = JSON.stringify(await card(page).boundingBox());
				const same = box === last;
				last = box;
				return same;
			})
			.toBe(true);
	}

	test('Knöpfe und Kürzel ändern Prozentanzeige und Darstellung; nicht im Code-Editor', async ({
		page
	}) => {
		await page.goto('/');
		await page.locator('.svelte-flow__pane').waitFor();
		await typeCode(page, SEQ_TALL);
		await surface(page).waitFor();
		const zoom = page.getByTestId('zoom');
		await expect(zoom).toHaveText('100 %');
		const base = await svgWidth(page);

		await page.getByRole('button', { name: 'Zoom - verkleinern' }).click();
		await expect(zoom).toHaveText('83 %');
		expect(await svgWidth(page)).toBeCloseTo(base / 1.2, 0);
		await page.getByRole('button', { name: 'Zoom + vergrößern' }).click();
		await page.getByRole('button', { name: 'Zoom + vergrößern' }).click();
		await expect(zoom).toHaveText('120 %');
		expect(await svgWidth(page)).toBeCloseTo(base * 1.2, 0);

		// Kürzel bei Fokus im Sequenz-Canvas.
		await surface(page).focus();
		await page.keyboard.press('Control+Minus');
		await expect(zoom).toHaveText('100 %');
		await page.keyboard.press('Control+Equal');
		await expect(zoom).toHaveText('120 %');
		await page.keyboard.press('Control+NumpadSubtract');
		await expect(zoom).toHaveText('100 %');
		await page.keyboard.press('Control+NumpadAdd');
		await expect(zoom).toHaveText('120 %');
		await page.keyboard.press('Control+Digit0');
		await expect(zoom).not.toHaveText('120 %');
		const fitted = await zoom.textContent();

		// Im Code-Editor bleibt der Canvas-Zoom unverändert.
		await page.locator('#shell-code .cm-content').click();
		await page.keyboard.press('Control+Minus');
		await expect(zoom).toHaveText(fitted!);
	});

	test('Einpassen spart die Vorschau-Karte aus, Karte auf und zu', async ({ page }) => {
		// Eigene Fensterhöhe: die Fläche (Höhe = Fenster - Kopf/CanvasBar/Werkzeuge - Outline -
		// Statuszeile) soll etwa das Seitenverhältnis von SEQ_CARD haben, damit das Diagramm
		// zugeklappt eingepasst bis in die rechte untere Ecke reicht; die Karte ragt um
		// Kartenhöhe + 14 px - Outline-Höhe in die Fläche (unabhängig von der Fensterhöhe).
		await page.setViewportSize({ width: 1024, height: 720 });
		await page.goto('/');
		await page.locator('.svelte-flow__pane').waitFor();
		await typeCode(page, SEQ_CARD);
		await surface(page).waitFor();
		await expect(card(page).locator('.preview-body svg')).toBeVisible();
		await cardStable(page);
		const fit = page.getByRole('button', { name: 'Einpassen', exact: true });
		const zoom = page.getByTestId('zoom');
		const openBox = (await card(page).boundingBox())!;
		const area = (await surface(page).boundingBox())!;
		const geometry = `Karte ${JSON.stringify(openBox)}, Fläche ${JSON.stringify(area)}`;
		expect(
			intersects(openBox, area),
			`Vorbedingung: offene Karte überdeckt die Sequenz-Fläche (${geometry})`
		).toBe(true);
		const covered = overlapSize(openBox, area);
		expect(
			covered.width >= 50 && covered.height >= 50,
			`Vorbedingung: Karte überdeckt mindestens 50x50 px der Fläche, ist ${covered.width.toFixed(1)}x${covered.height.toFixed(1)} (${geometry})`
		).toBe(true);

		await fit.click();
		await expectItemsBesideCard(page, 'Karte offen');
		const withCard = await percent(page);

		const toggle = card(page).locator('button[aria-expanded]');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await cardStable(page);
		await fit.click();
		await expectItemsBesideCard(page, 'Karte zu');
		const closed = await percent(page);
		// Schon mit dem kleineren Zoom der zugeklappten Karte reicht der Inhalt in den Bereich der
		// offenen Karte: ohne Aussparung (Zoom >= diesem) läge er darunter.
		const items = await itemBoxes(page);
		const reach = items.reduce(
			(m, r) => ({
				right: Math.max(m.right, r.x + r.width),
				bottom: Math.max(m.bottom, r.y + r.height)
			}),
			{ right: 0, bottom: 0 }
		);
		expect(
			items.some((r) => intersects(r, openBox)),
			`Vorbedingung: Diagramm reicht eingepasst bis in den Bereich der offenen Karte (Inhalt bis ${JSON.stringify(reach)}, ${closed} %, ${geometry})`
		).toBe(true);
		// Wirkung: die offene Karte kostet mehr Fläche als die zugeklappte.
		expect(withCard, 'Zoom mit offener Karte kleiner als mit zugeklappter').toBeLessThan(closed);

		await toggle.click();
		await expect(card(page).locator('.preview-body svg')).toBeVisible();
		await cardStable(page);
		await surface(page).focus();
		await page.keyboard.press('Control+Digit0');
		await expect(zoom).toHaveText(`${withCard} %`);
		await expectItemsBesideCard(page, 'Karte wieder offen (Strg-0)');
	});

	test('viewport-Vertrag (O-124) bei Scroll und minX != 0: Modell = (Client - Fläche - x) / zoom', async ({
		page
	}) => {
		await page.goto('/');
		await page.locator('.svelte-flow__pane').waitFor();
		await typeCode(page, SEQ_WIDE);
		await surface(page).waitFor();
		const plus = page.getByRole('button', { name: 'Zoom + vergrößern' });
		for (let i = 0; i < 4; i++) await plus.click();
		await expect(page.getByTestId('zoom')).toHaveText('207 %');
		// Die Fläche wächst nicht mit dem Inhalt aus der Mittelspalte/dem Fenster (Grid-Spur
		// `minmax(0, 1fr)` in `.center`), sondern scrollt.
		const fits = await surface(page).evaluate((el) => {
			const r = el.getBoundingClientRect();
			const c = el.closest('.center')!.getBoundingClientRect();
			return { left: r.left, right: r.right, cLeft: c.left, cRight: c.right, win: innerWidth };
		});
		expect(
			fits.left >= 0 && fits.right <= fits.win,
			`Fläche bei 207 % im Fenster: ${JSON.stringify(fits)}`
		).toBe(true);
		expect(
			fits.left >= fits.cLeft - 0.5 && fits.right <= fits.cRight + 0.5,
			`Fläche bei 207 % in der Mittelspalte: ${JSON.stringify(fits)}`
		).toBe(true);
		const room = await surface(page).evaluate((el) => ({
			x: el.scrollWidth - el.clientWidth,
			y: el.scrollHeight - el.clientHeight
		}));
		expect(room.x, 'Vorbedingung: Fläche bei 207 % horizontal scrollbar').toBeGreaterThan(30);
		expect(room.y, 'Vorbedingung: Fläche bei 207 % vertikal scrollbar').toBeGreaterThan(20);
		const result = await surface(page).evaluate((el) => {
			el.scrollLeft = 30;
			el.scrollTop = 20;
			const svg = el.querySelector('svg')!;
			const [minX, minY, width] = svg.getAttribute('viewBox')!.split(' ').map(Number);
			const zoom = Number(svg.getAttribute('width')) / width;
			// x/y wie `SequenceControl.viewport()` (O-124 Nachtrag).
			const x = -el.scrollLeft - minX * zoom;
			const y = -el.scrollTop - minY * zoom;
			const area = el.getBoundingClientRect();
			const rect = el.querySelector('[data-id="A"] rect')!;
			const client = rect.getBoundingClientRect();
			return {
				minX,
				scroll: [el.scrollLeft, el.scrollTop],
				model: [Number(rect.getAttribute('x')), Number(rect.getAttribute('y'))],
				mapped: [(client.left - area.left - x) / zoom, (client.top - area.top - y) / zoom]
			};
		});
		expect(result.minX).not.toBe(0);
		expect(result.scroll).toEqual([30, 20]);
		// Toleranz 1 Modell-Einheit je Achse: Client-Rechtecke runden auf Subpixel (Firefox z. B.
		// 1/60 px), geteilt durch 2,07 bleibt bis gut 0,5 Einheiten Abweichung (-0,508 gemessen);
		// ein Fehler im Vertrag (Scroll oder minX vergessen) wiche um >= 9 Einheiten ab.
		for (const axis of [0, 1]) {
			const delta = result.mapped[axis] - result.model[axis];
			expect(
				Math.abs(delta) <= 1,
				`Achse ${'xy'[axis]}: abgebildet ${result.mapped[axis]}, Modell ${result.model[axis]}, Δ ${delta}`
			).toBe(true);
		}
	});
});
