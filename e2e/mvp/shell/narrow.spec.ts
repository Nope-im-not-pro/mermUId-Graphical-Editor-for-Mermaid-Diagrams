import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * T129 C1 (M-09, D6, V-23): schmale Fenster.
 * - >= 900 px: Palette und Seitenleiste per Knopf in der Kopfzeile einklappbar
 *   (`aria-expanded`/`aria-controls`), ab 1100 px Raster `232px 1fr 340px` unverändert.
 * - < 900 px: Leisten als Schublade über der Canvas-Fläche (Zeile unter der CanvasBar),
 *   Knopf öffnet, Fokus wandert hinein, Esc schließt, Fokus zurück zum Auslöser.
 * - 640 px und 899 px: sichtbare Bedienelemente von Kopfzeile, CanvasBar und Statuszeile
 *   überlappen sich nicht, auch nicht mit geöffneter Schublade.
 * - < 640 px (639, 375 px): Mindestbreiten-Hinweis statt der App; kein sichtbares
 *   Bedienelement überlappt.
 * - T129 C2 (C1-Review 2): Grenze 900 px (keine Schublade, Leisten offen, nichts überlappt) und
 *   sequence bei 640 px (Seitenleisten-Schublade, kein Paletten-Knopf).
 */

type Box = { x: number; y: number; width: number; height: number };

/** Überlappung mit 0.5-px-Toleranz (Subpixel-Kanten in Firefox), wie layout-zones.spec.ts. */
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

const header = (page: Page) => page.getByRole('toolbar', { name: 'Werkzeugleiste' });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' });
const status = (page: Page) => page.locator('.statusbar');
const paletteToggle = (page: Page) => page.getByRole('button', { name: 'Palette', exact: true });
const inspectorToggle = (page: Page) =>
	page.getByRole('button', { name: 'Seitenleiste', exact: true });
const palette = (page: Page) => page.locator('#shell-palette');
const inspector = (page: Page) => page.locator('#shell-inspector');
const hint = (page: Page) => page.locator('.too-narrow');

/** Sichtbare Bedienelemente eines Bereichs (Knöpfe, Felder, Tabs). */
const controlsOf = (scope: Locator | Page) =>
	scope.locator('button:visible, input:visible, select:visible, [role="tab"]:visible');

/** Paarweise überlappungsfrei, vollständig im Fenster, am Mittelpunkt nicht verdeckt. */
async function expectControlsClear(page: Page, scopes: (Locator | Page)[]) {
	const view = page.viewportSize()!;
	const frame = { x: 0, y: 0, width: view.width, height: view.height };
	const measured: [string, Box][] = [];
	for (const scope of scopes) {
		const controls = controlsOf(scope);
		const count = await controls.count();
		for (let i = 0; i < count; i++) {
			const control = controls.nth(i);
			const name =
				(await control.getAttribute('aria-label')) ??
				((await control.textContent())?.trim() || `#${i}`);
			const box = await boxOf(name, control);
			expect(inside(box, frame), `${name} im Fenster`).toBe(true);
			const hit = await control.evaluate((el) => {
				const r = el.getBoundingClientRect();
				const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
				return top !== null && (top === el || el.contains(top));
			});
			expect(hit, `${name} nicht verdeckt`).toBe(true);
			measured.push([name, box]);
		}
	}
	for (let i = 0; i < measured.length; i++) {
		for (let j = i + 1; j < measured.length; j++) {
			const [a, boxA] = measured[i];
			const [b, boxB] = measured[j];
			expect(overlap(boxA, boxB), `${a} überlappt ${b}`).toBe(false);
		}
	}
}

/** Zonen paarweise überlappungsfrei. */
async function expectZonesClear(zones: Record<string, Locator>) {
	const measured: [string, Box][] = [];
	for (const [name, locator] of Object.entries(zones)) {
		measured.push([name, await boxOf(name, locator)]);
	}
	for (let i = 0; i < measured.length; i++) {
		for (let j = i + 1; j < measured.length; j++) {
			const [a, boxA] = measured[i];
			const [b, boxB] = measured[j];
			expect(overlap(boxA, boxB), `${a} überlappt ${b}`).toBe(false);
		}
	}
}

/**
 * App geladen: Canvas-Fläche eingehängt. Unter der Mindestbreite ist sie per
 * `visibility: hidden` verborgen, dort genügt `attached`.
 */
async function load(page: Page, state: 'visible' | 'attached' = 'visible') {
	await page.goto('/');
	await page.locator('.svelte-flow__pane').waitFor({ state });
}

for (const width of [375, 639]) {
	test.describe(`unter der Mindestbreite: ${width} px`, () => {
		test.use({ viewport: { width, height: width === 375 ? 812 : 768 } });

		test('Mindestbreiten-Hinweis statt der App, kein überlappendes Bedienelement', async ({
			page
		}) => {
			await load(page, 'attached');
			await expect(hint(page)).toBeVisible();
			await expect(hint(page)).toContainText('Fenster zu schmal');
			await expect(hint(page)).toContainText('640 px');
			await expect(header(page)).toBeHidden();
			await expect(bar(page)).toBeHidden();
			await expect(controlsOf(page), 'kein sichtbares Bedienelement').toHaveCount(0);
			await expectControlsClear(page, [page]);

			// Tastatur: `visibility: hidden` nimmt die App aus der Tab-Reihenfolge.
			for (let i = 0; i < 5; i++) {
				await page.keyboard.press('Tab');
				const reachable = await page.evaluate(() => {
					const el = document.activeElement;
					if (!el || el === document.body) return null;
					return el.checkVisibility({ visibilityProperty: true })
						? null
						: el.outerHTML.slice(0, 80);
				});
				expect(reachable, 'Tab landet nicht auf unsichtbarem Element').toBeNull();
			}
		});
	});
}

for (const width of [640, 899]) {
	test.describe(`Schublade: ${width} px`, () => {
		test.use({ viewport: { width, height: 768 } });

		test('Leisten zu, Knöpfe mit aria-expanded/aria-controls, nichts überlappt', async ({
			page
		}) => {
			await load(page);
			await expect(hint(page)).toBeHidden();
			for (const [toggle, id] of [
				[paletteToggle(page), 'shell-palette'],
				[inspectorToggle(page), 'shell-inspector']
			] as const) {
				await expect(toggle).toHaveAttribute('aria-expanded', 'false');
				await expect(toggle).toHaveAttribute('aria-controls', id);
				await expect(page.locator(`#${id}`)).toHaveCount(1);
				await expect(page.locator(`#${id}`)).toBeHidden();
			}
			await expectZonesClear({
				Kopfzeile: header(page),
				CanvasBar: bar(page),
				Statuszeile: status(page),
				Vorschau: page.locator('.preview'),
				Controls: page.locator('.svelte-flow__controls')
			});
			await expectControlsClear(page, [header(page), bar(page), status(page)]);
		});

		for (const [name, toggle, drawer, focused] of [
			[
				'Palette',
				paletteToggle,
				palette,
				(page: Page) => palette(page).locator('input[type="search"]')
			],
			[
				'Seitenleiste',
				inspectorToggle,
				inspector,
				(page: Page) => page.getByRole('tab', { name: 'Eigenschaften' })
			]
		] as const) {
			test(`${name}: Schublade per Knopf, Fokus hinein, Esc schließt, Fokus zurück`, async ({
				page
			}) => {
				await load(page);
				await toggle(page).click();
				await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
				await expect(drawer(page)).toBeVisible();
				await expect(focused(page)).toBeFocused();

				// Schublade liegt unter der CanvasBar und über der Statuszeile, im Fenster.
				await expectZonesClear({
					Kopfzeile: header(page),
					CanvasBar: bar(page),
					Statuszeile: status(page),
					Schublade: drawer(page)
				});
				const view = page.viewportSize()!;
				const box = await boxOf('Schublade', drawer(page));
				expect(inside(box, { x: 0, y: 0, ...view }), 'Schublade im Fenster').toBe(true);
				await expectControlsClear(page, [header(page), bar(page), status(page)]);

				await page.keyboard.press('Escape');
				await expect(drawer(page)).toBeHidden();
				await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
				await expect(toggle(page)).toBeFocused();
			});
		}

		test('höchstens eine Schublade offen', async ({ page }) => {
			await load(page);
			await paletteToggle(page).click();
			await expect(palette(page)).toBeVisible();
			await inspectorToggle(page).click();
			await expect(inspector(page)).toBeVisible();
			await expect(palette(page)).toBeHidden();
			await expect(paletteToggle(page)).toHaveAttribute('aria-expanded', 'false');
		});
	});
}

test.describe('Grenze ohne Schublade: 900 px', () => {
	test.use({ viewport: { width: 900, height: 768 } });

	test('Leisten offen statt Schublade; Kopfzeile, CanvasBar, Statuszeile überlappen nicht', async ({
		page
	}) => {
		await load(page);
		await expect(hint(page)).toBeHidden();
		await expect(page.locator('.main')).not.toHaveClass(/\bnarrow\b/);
		await expect(paletteToggle(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(inspectorToggle(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(palette(page)).toBeVisible();
		await expect(inspector(page)).toBeVisible();
		await expectZonesClear({
			Kopfzeile: header(page),
			CanvasBar: bar(page),
			Statuszeile: status(page),
			Palette: palette(page),
			Seitenleiste: inspector(page)
		});
		await expectControlsClear(page, [header(page), bar(page), status(page)]);
	});
});

test.describe('sequence in der Schublade: 640 px', () => {
	test.use({ viewport: { width: 640, height: 768 } });

	test('kein Paletten-Knopf; Seitenleisten-Schublade überlappt nichts, Esc schließt', async ({
		page
	}) => {
		await load(page);
		const dataTransfer = await page.evaluateHandle(() => {
			const dt = new DataTransfer();
			dt.items.add(
				new File(['sequenceDiagram\n  A->>B: hallo\n'], 'ablauf.mmd', { type: 'text/plain' })
			);
			return dt;
		});
		await page.locator('.shell').dispatchEvent('drop', { dataTransfer });
		const tools = page.getByRole('toolbar', { name: 'Sequenz-Werkzeuge' });
		await expect(tools).toBeVisible();
		await expect(paletteToggle(page)).toHaveCount(0);
		await expect(inspectorToggle(page)).toHaveAttribute('aria-expanded', 'false');
		await expectZonesClear({
			Kopfzeile: header(page),
			CanvasBar: bar(page),
			Statuszeile: status(page),
			Vorschau: page.locator('.preview')
		});
		await expectControlsClear(page, [header(page), bar(page), status(page), tools]);

		await inspectorToggle(page).click();
		await expect(inspector(page)).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Eigenschaften' })).toBeFocused();
		await expectZonesClear({
			Kopfzeile: header(page),
			CanvasBar: bar(page),
			Statuszeile: status(page),
			Schublade: inspector(page)
		});
		await expectControlsClear(page, [header(page), bar(page), status(page)]);
		await page.keyboard.press('Escape');
		await expect(inspector(page)).toBeHidden();
		await expect(inspectorToggle(page)).toBeFocused();
	});
});

test.describe('einklappbar ohne Schublade: 1024 px', () => {
	test.use({ viewport: { width: 1024, height: 768 } });

	test('Standard offen; Einklappen gibt der Fläche Platz, Ausklappen stellt her', async ({
		page
	}) => {
		await load(page);
		await expect(paletteToggle(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(inspectorToggle(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(palette(page)).toBeVisible();
		await expect(inspector(page)).toBeVisible();
		const area = page.locator('.shell-canvas');
		const before = await boxOf('Fläche', area);

		await paletteToggle(page).click();
		await expect(paletteToggle(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(palette(page)).toBeHidden();
		await inspectorToggle(page).click();
		await expect(inspector(page)).toBeHidden();
		await expect
			.poll(async () => (await boxOf('Fläche', area)).width)
			.toBeGreaterThan(before.width + 300);
		await expectControlsClear(page, [header(page), bar(page), status(page)]);

		await paletteToggle(page).click();
		await inspectorToggle(page).click();
		await expect(palette(page)).toBeVisible();
		await expect(inspector(page)).toBeVisible();
		await expect.poll(async () => (await boxOf('Fläche', area)).width).toBe(before.width);
	});
});

test.describe('Bestand ab 1100 px: 1280 px', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('Raster 232px 1fr 340px, kein Hinweis, Leisten offen', async ({ page }) => {
		await load(page);
		await expect(hint(page)).toBeHidden();
		expect((await boxOf('Palette', palette(page))).width).toBeCloseTo(232, 0);
		expect((await boxOf('Seitenleiste', inspector(page))).width).toBeCloseTo(340, 0);
		await expect(page.locator('.logo')).toBeVisible();
	});
});
