// T136 C2 (F-11): Teilen per Link. "Link kopieren" legt den Code komprimiert im URL-Fragment ab;
// Start mit Fragment fragt vor dem Laden, lädt über die Prüfpfade des Datei-Öffnens und entfernt
// das Fragment aus der Adresszeile. Netzwerk-Mitschnitt: kein Request trägt Fragment oder Code.
// Die Zwischenablage wird per Init-Skript ersetzt (Firefox kennt keine Clipboard-Berechtigung).
// Auflage C1: kein Fall mit angehängten Zeichen hinter der Nutzlast (Node/Browser weichen ab).
import { expect, test, type Page, type Request } from '@playwright/test';
import { node, openText, startApp } from '../sync/helpers-actions';

const MARKER = 'Geheimknoten';
const CODE = `flowchart TD\n  G[${MARKER}] --> H\n`;
const PREFIX = 'code=v1:';

const shareDialog = (page: Page) => page.getByRole('dialog', { name: 'Geteiltes Diagramm laden?' });
const message = (page: Page) => page.getByTestId('message');
const fileLabel = (page: Page) => page.getByTestId('file');

/** Alle Requests der Seite (auch Navigation, Assets, Hilfe). */
function recordRequests(page: Page): Request[] {
	const seen: Request[] = [];
	page.on('request', (r) => seen.push(r));
	return seen;
}

/**
 * Was ein Request tatsächlich sendet: URL ohne Fragment (das Fragment gehört nie zum
 * Request-Target; Playwright meldet es je nach Browser bei Navigationen mit), Header, Body.
 */
async function sentText(request: Request): Promise<string> {
	const url = request.url().split('#')[0];
	const headers = Object.values(request.headers()).join('\n');
	return [url, headers, request.postData() ?? ''].join('\n');
}

async function expectNoLeak(requests: Request[], needles: string[]) {
	expect(requests.length).toBeGreaterThan(0);
	for (const request of requests) {
		const text = await sentText(request);
		for (const needle of needles) expect(text, request.url()).not.toContain(needle);
	}
}

async function stubClipboard(page: Page) {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					(window as unknown as { __copied: string }).__copied = text;
				}
			}
		});
	});
}

const copied = (page: Page) =>
	page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? null);

async function gotoApp(page: Page, hash: string) {
	await page.goto('/' + hash);
	await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
}

test.describe('Teilen per Link', () => {
	test('Link kopieren, Link öffnen, laden; kein Request enthält Fragment oder Code', async ({
		page,
		context
	}) => {
		// Neuladen mit ungespeichertem geteiltem Inhalt löst `beforeunload` aus: bestätigen.
		page.on('dialog', (d) => void d.accept());
		const requests = recordRequests(page);
		await stubClipboard(page);
		await startApp(page);
		await openText(page, 'geheim.mmd', CODE);

		const before = page.url();
		await page.getByRole('button', { name: 'Link kopieren' }).click();
		await expect(message(page)).toHaveText(
			'Link kopiert. Der Code steht im Link, es wird nichts hochgeladen.'
		);
		const link = await copied(page);
		expect(link).not.toBeNull();
		const { origin, pathname } = new URL(before);
		expect(link!.startsWith(`${origin}${pathname}#${PREFIX}`)).toBe(true);
		expect(link).not.toContain(MARKER);
		// Kopieren ändert die Adresszeile nicht.
		expect(page.url()).toBe(before);
		const fragment = link!.slice(link!.indexOf('#') + 1);
		const payload = fragment.slice(PREFIX.length);

		// Zweite Seite im selben Kontext: Start mit Fragment.
		const second = await context.newPage();
		second.on('dialog', (d) => void d.accept());
		const secondRequests = recordRequests(second);
		await second.goto(link!);
		await expect(shareDialog(second)).toBeVisible();
		// Fragment schon vor der Antwort entfernt (Reload fragt nicht erneut).
		expect(new URL(second.url()).hash).toBe('');
		await shareDialog(second).getByRole('button', { name: 'Laden' }).click();
		await expect(shareDialog(second)).toBeHidden();
		await expect(message(second)).toHaveText(
			'Geteiltes Diagramm geladen (ungespeichert): geteilt.mmd'
		);
		await expect(fileLabel(second)).toHaveText('Datei: geteilt.mmd (geändert)');
		await expect(node(second, 'G')).toContainText(MARKER);

		await second.reload();
		await expect(second.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
		await expect(shareDialog(second)).toBeHidden();

		await expectNoLeak([...requests, ...secondRequests], [payload, fragment, MARKER]);
	});

	test('Abbrechen lädt nichts, Fragment trotzdem entfernt', async ({ page }) => {
		// Abbrechen dekodiert nicht: die Nutzlast muss nicht gültig sein.
		await gotoApp(page, '#code=v1:abc');
		await expect(shareDialog(page)).toBeVisible();
		await shareDialog(page).getByRole('button', { name: 'Abbrechen' }).click();
		await expect(shareDialog(page)).toBeHidden();
		expect(new URL(page.url()).hash).toBe('');
		await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
	});

	test('defektes Fragment: Meldung, nichts geladen', async ({ page }) => {
		await gotoApp(page, '#code=v1:!!!');
		await shareDialog(page).getByRole('button', { name: 'Laden' }).click();
		await expect(message(page)).toHaveText('Link beschädigt oder unvollständig: nichts geladen.');
		await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
		expect(new URL(page.url()).hash).toBe('');
	});

	test('zu langes Fragment: Meldung, nichts geladen', async ({ page }) => {
		await gotoApp(page, '#code=v1:' + 'A'.repeat(8200));
		await shareDialog(page).getByRole('button', { name: 'Laden' }).click();
		await expect(message(page)).toHaveText(
			'Link zu lang (höchstens 8192 Zeichen): nichts geladen.'
		);
		await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
	});

	test('unbekannte Version: Meldung, nichts geladen', async ({ page }) => {
		await gotoApp(page, '#code=v9:abc');
		await shareDialog(page).getByRole('button', { name: 'Laden' }).click();
		await expect(message(page)).toHaveText(
			'Link stammt aus einer neueren Version von mermUId: nichts geladen.'
		);
		await expect(fileLabel(page)).toHaveText('Datei: diagramm.mmd');
	});
});
