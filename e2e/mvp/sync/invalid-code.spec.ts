// T23 C3b: E2E ungültiger Code (AK-M09, KONZEPT §5 und §6.1). Fehleranzeige mit Zeile/Spalte,
// Canvas im letzten gültigen Stand editierbar, Grafik-Änderung überschreibt den ungültigen Text
// nicht, Konflikt-Banner mit [Grafik behalten] [Code behalten] [Diff ansehen]. Die Fixtures
// unter tests/fixtures/sync/invalid/ sind absichtlich nicht mermaid-gültig (Ausnahme von O-37).
// O-44 (D1): reiner Parse-Fehler zeigt nur den Fehlerhinweis (Überlagerung, ohne Wahlknöpfe);
// der Konflikt entsteht erst mit einer Grafik-Änderung bei ungültigem Code.
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	node,
	relabel,
	openText,
	saveBytes,
	seqSurface,
	seqTools,
	startApp
} from './helpers-actions';

const DIR = 'tests/fixtures/sync/invalid';

const FLOW = 'flowchart TD\n    A[Start] --> B[Ende]\n';
/** Zeile 3: eckige Klammer nicht geschlossen (mermaid-Fehler mit Spalte). */
const FLOW_BAD = 'flowchart TD\n    A[Start] --> B[Ende]\n    B --> C[Ziel\n';
const SEQ = 'sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hallo\n';
/** Zeile 4: Doppelpunkt vor dem Nachrichtentext fehlt (mermaid-Fehler mit Spalte). */
const SEQ_BAD =
	'sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob Hallo\n';

const banner = (page: Page) => page.getByRole('alert').filter({ hasText: 'Konflikt:' });
/** Fehlerhinweis ohne Konflikt: `role="status"` (O-58), Konflikt-Banner bleibt `alert`. */
const errorBanner = (page: Page) => page.getByRole('status').filter({ hasText: 'Syntaxfehler:' });
const CHOICES = ['Grafik behalten', 'Code behalten', 'Diff ansehen'];
const errorList = (page: Page) => page.getByRole('region', { name: 'Fehlerliste' });
const status = (page: Page) => page.getByRole('status').filter({ hasText: 'Parser:' });
/** Ganze Statuszeile inkl. Cursor (Cursor liegt außerhalb der Live-Region, T114). */
const statusBar = (page: Page) => page.locator('.statusbar');
/**
 * Live-Region erst nach Ende von "ausstehend": währenddessen hält sie den alten Endzustand
 * (T114 I3), eine Endzustand-Prüfung könnte sonst zu früh bestehen.
 */
async function settledStatus(page: Page) {
	await expect(statusBar(page)).not.toContainText('Sync: Code wird geprüft');
	return status(page);
}
const codeLines = (page: Page) => page.locator('#shell-code .cm-line');

/** Code-Text aus dem Code-Panel (Tab "Code" muss offen sein). */
async function codeText(page: Page): Promise<string> {
	// Eine leere Zeile liefert als innerText einen Zeilenumbruch.
	const lines = await codeLines(page).allInnerTexts();
	return lines.map((l) => (l === '\n' ? '' : l)).join('\n');
}

/** Ersetzt den gesamten Code-Text im Editor wie eine Nutzer-Eingabe. */
async function typeCode(page: Page, text: string): Promise<void> {
	await page.getByRole('tab', { name: 'Code' }).click();
	await page.locator('#shell-code .cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

/**
 * Erwartete Fehleranzeige: Fehlerliste und Banner mit Zeile/Spalte, Statuszeile mit Zeile.
 * `conflict`: nach Grafik-Änderung Konflikt-Banner, sonst Fehlerhinweis ohne Konflikt (O-44).
 */
async function expectError(
	page: Page,
	line: number,
	column: number,
	conflict: boolean
): Promise<void> {
	const entry = errorList(page).getByRole('button', { name: /^Fehler Zeile/ });
	await expect(entry).toHaveCount(1);
	await expect(entry).toContainText(`Zeile ${line}, Spalte ${column}: `);
	const shown = conflict ? banner(page) : errorBanner(page);
	await expect(shown).toContainText(`Ungültiger Code in Zeile ${line}, Spalte ${column}: `);
	await expect(shown).toContainText('Die Grafik zeigt den letzten gültigen Stand.');
	await expect(status(page)).toContainText(`Parser: Fehler in Zeile ${line}`);
	if (conflict) await expect(status(page)).toContainText('Sync: Konflikt');
	else await expect(status(page)).toContainText('Sync: Code ungültig');
	// Sprung aus der Fehlerliste setzt den Cursor genau auf Zeile:Spalte.
	await entry.click();
	await expect(statusBar(page)).toContainText(`Z ${line}:${column}`);
}

/** Öffnet eine Fixture-Datei über den Öffnen-Dialog und zeigt danach den Code-Tab. */
async function openFixture(page: Page, file: string): Promise<void> {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
	await (await chooser).setFiles(`${DIR}/${file}`);
	await expect(page.getByTestId('message')).toHaveText(`Geöffnet: ${file}`);
	await page.getByRole('tab', { name: 'Code' }).click();
}

/** Doppelklick auf eine freie Stelle der Fläche (legt einen Knoten an). */
async function dblclickFree(page: Page): Promise<void> {
	const pb = await page.locator('.svelte-flow__pane').boundingBox();
	if (!pb) throw new Error('Fläche ohne Box');
	await page.mouse.dblclick(pb.x + pb.width * 0.85, pb.y + pb.height / 2);
}

async function expectBannerActions(page: Page): Promise<void> {
	const b = banner(page);
	await expect(b).toBeVisible();
	for (const label of CHOICES) {
		await expect(b.getByRole('button', { name: label, exact: true })).toBeVisible();
	}
}

/** Fehlerhinweis ohne Konflikt: sichtbar, keine Wahlknöpfe, kein Konflikt-Banner (O-44). */
async function expectErrorOnly(page: Page): Promise<void> {
	const b = errorBanner(page);
	await expect(b).toBeVisible();
	await expect(banner(page)).toHaveCount(0);
	for (const label of CHOICES) {
		await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
	}
}

/**
 * T101 C3 I2: Der Fehlerhinweis überdeckt keine Bedienelemente der Fläche, und die Fläche
 * behält ihre Box (D1). `show` macht den Code ungültig.
 */
async function expectHintApart(
	page: Page,
	show: () => Promise<void>,
	controls: Locator[]
): Promise<void> {
	const canvas = page.locator('.shell-canvas');
	const before = await canvas.boundingBox();
	await show();
	await expect(errorBanner(page)).toBeVisible();
	expect(await canvas.boundingBox(), 'Canvas-Box unverändert').toEqual(before);
	const hint = await errorBanner(page).boundingBox();
	if (!hint) throw new Error('Fehlerhinweis ohne Box');
	await expect(
		errorBanner(page).getByRole('button', { name: /Zeile \d+, Spalte \d+/ })
	).toBeVisible();
	for (const control of controls) {
		const box = await control.boundingBox();
		if (!box) throw new Error('Bedienelement ohne Box');
		const apart =
			hint.x + hint.width <= box.x ||
			box.x + box.width <= hint.x ||
			hint.y + hint.height <= box.y ||
			box.y + box.height <= hint.y;
		expect(apart, `Fehlerhinweis überdeckt ${String(control)}`).toBe(true);
	}
}

/**
 * Das Konflikt-Banner (im Spaltenfluss, anders als der Fehlerhinweis als Überlagerung) und die
 * Fehlertexte verkleinern die Fläche; je nach Schriftmetrik (Firefox) liegt B danach am unteren
 * Rand außerhalb des sichtbaren Ausschnitts. Der Nutzer verkleinert dann die Ansicht.
 */
async function fitCanvas(page: Page): Promise<void> {
	const b = node(page, 'B');
	await expect(async () => {
		const visible = await expect(b)
			.toBeInViewport({ ratio: 1, timeout: 300 })
			.then(
				() => true,
				() => false
			);
		if (visible) return;
		await page.getByRole('button', { name: 'Zoom - verkleinern', exact: true }).click();
		throw new Error('Knoten B noch nicht vollständig sichtbar');
	}).toPass({ timeout: 10_000 });
}

/** Flowchart: gültig öffnen, Code ungültig machen, Knoten B grafisch umbenennen. */
async function flowConflict(page: Page): Promise<void> {
	await openText(page, 'flow.mmd', FLOW);
	await typeCode(page, FLOW_BAD);
	await expectErrorOnly(page);
	await fitCanvas(page);
	await relabel(page, node(page, 'B'), 'Fertig');
	await expect(node(page, 'B')).toHaveText('Fertig');
	await expectBannerActions(page);
}

test.beforeEach(async ({ page }) => {
	await startApp(page);
});

test.describe('flowchart', () => {
	test('AK-M09: flowchart ungültiger Code zeigt Fehler mit Zeile und Spalte', async ({ page }) => {
		await openText(page, 'flow.mmd', FLOW);
		await expect(errorList(page)).toHaveText('Keine Fehler.');
		await typeCode(page, FLOW_BAD);
		await expectError(page, 3, 13, false);
	});

	test('T101 C3: flowchart Fehlerhinweis überdeckt Controls, CanvasBar und Vorschau nicht', async ({
		page
	}) => {
		await openText(page, 'flow.mmd', FLOW);
		await expectHintApart(page, () => typeCode(page, FLOW_BAD), [
			page.locator('.svelte-flow__controls'),
			page.getByRole('toolbar', { name: 'Bearbeiten und Ansicht' }),
			page.locator('.preview')
		]);
	});

	test('AK-M09: flowchart Canvas bleibt mit letztem gültigen Modell editierbar', async ({
		page
	}) => {
		await openText(page, 'flow.mmd', FLOW);
		await typeCode(page, FLOW_BAD);
		await expect(errorBanner(page)).toBeVisible();
		// Letztes gültiges Modell: A und B mit einer Kante, der ungültige Knoten C fehlt.
		await expect(page.locator('.svelte-flow__node')).toHaveCount(2);
		await expect(node(page, 'A')).toHaveText('Start');
		await expect(node(page, 'B')).toHaveText('Ende');
		await expect(node(page, 'C')).toHaveCount(0);
		await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);
		// Grafik-Aktionen wirken: umbenennen und Knoten per Doppelklick anlegen.
		await fitCanvas(page);
		await relabel(page, node(page, 'B'), 'Fertig');
		await expect(node(page, 'B')).toHaveText('Fertig');
		await dblclickFree(page);
		await expect(page.locator('.svelte-flow__node')).toHaveCount(3);
	});

	test('AK-M09: flowchart Grafik-Änderung überschreibt den ungültigen Code nicht', async ({
		page
	}) => {
		await flowConflict(page);
		await expect.poll(() => codeText(page)).toBe(FLOW_BAD);
		await expectError(page, 3, 13, true);
		const saved = await saveBytes(page);
		expect(saved.toString('utf8'), 'gespeichert wird der ungültige Nutzertext').toBe(FLOW_BAD);
	});

	test('AK-M09: flowchart Konflikt-Banner, Auflösung "Grafik behalten" mit Undo', async ({
		page
	}) => {
		await flowConflict(page);
		await banner(page).getByRole('button', { name: 'Grafik behalten', exact: true }).click();
		await expect(banner(page)).toHaveCount(0);
		await expect(errorList(page)).toHaveText('Keine Fehler.');
		await expect(await settledStatus(page)).toContainText('Sync: Grafik=Code');
		await expect.poll(() => codeText(page)).toBe('flowchart TD\n    A[Start] --> B[Fertig]\n');
		// Der ungültige Text bleibt als Undo-Schritt erhalten.
		await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
		await expect.poll(() => codeText(page)).toBe(FLOW_BAD);
		await expect(banner(page)).toBeVisible();
		await expect(node(page, 'B')).toHaveText('Fertig');
	});

	test('AK-M09: flowchart Konflikt-Banner, Auflösung "Code behalten" verwirft Grafik-Änderung', async ({
		page
	}) => {
		await flowConflict(page);
		await banner(page).getByRole('button', { name: 'Code behalten', exact: true }).click();
		await expect(banner(page)).toHaveCount(0);
		await expect(node(page, 'B')).toHaveText('Ende');
		await expect.poll(() => codeText(page)).toBe(FLOW_BAD);
		// Nach der Wahl ist der Code weiter ungültig: nur Fehlerhinweis, kein Konflikt (O-44).
		await expectErrorOnly(page);
		// Code bleibt zum Korrigieren offen: Fehler steht weiter in der Liste.
		await expect(errorList(page)).toContainText('Zeile 3, Spalte 13: ');
		await typeCode(page, 'flowchart TD\n    A[Start] --> B[Ende]\n    B --> C[Ziel]\n');
		await expect(errorList(page)).toHaveText('Keine Fehler.');
		await expect(node(page, 'C')).toHaveText('Ziel');
		await expect(await settledStatus(page)).toContainText('Sync: Grafik=Code');
	});

	test('AK-M09: flowchart Konflikt-Banner, "Diff ansehen" zeigt Code gegen Grafik', async ({
		page
	}) => {
		await flowConflict(page);
		await banner(page).getByRole('button', { name: 'Diff ansehen', exact: true }).click();
		const diff = page.getByRole('region', { name: 'Unterschiede Code und Grafik' });
		await expect(diff).toBeFocused();
		await expect(diff).toContainText(
			'Konflikt: Zeilen mit - nur im Code, mit + nur in der Grafik.'
		);
		await expect(diff).toContainText('-     B --> C[Ziel');
		await expect(diff).toContainText('+     A[Start] --> B[Fertig]');
		await expect(banner(page)).toBeVisible();
	});

	test('AK-M09: flowchart Banner bleibt bis zur Wahl, auch wenn der Code wieder gültig ist', async ({
		page
	}) => {
		await flowConflict(page);
		await typeCode(page, 'flowchart TD\n    A[Start] --> B[Ende]\n    B --> C[Ziel]\n');
		await expect(errorList(page)).toHaveText('Keine Fehler.');
		await expect(banner(page)).toContainText('Konflikt zwischen Grafik und Code.');
		await expect(status(page)).toContainText('Sync: Konflikt');
		// Bis zur Wahl bleiben beide Stände erhalten: Grafik mit B "Fertig", Code mit C.
		await expect(node(page, 'B')).toHaveText('Fertig');
		await expect(node(page, 'C')).toHaveCount(0);
		await banner(page).getByRole('button', { name: 'Code behalten', exact: true }).click();
		await expect(banner(page)).toHaveCount(0);
		await expect(node(page, 'B')).toHaveText('Ende');
		await expect(node(page, 'C')).toHaveText('Ziel');
	});
});

test.describe('sequence', () => {
	async function seqConflict(page: Page): Promise<void> {
		await openText(page, 'seq.mmd', SEQ);
		await typeCode(page, SEQ_BAD);
		await expectErrorOnly(page);
		await seqTools(page).getByRole('button', { name: '+ Teilnehmer', exact: true }).click();
		await expect(
			seqSurface(page).getByRole('button', { name: 'Teilnehmer: Teilnehmer1', exact: true })
		).toBeVisible();
		await expectBannerActions(page);
	}

	test('AK-M09: sequence ungültiger Code zeigt Fehler mit Zeile und Spalte', async ({ page }) => {
		await openText(page, 'seq.mmd', SEQ);
		await expect(errorList(page)).toHaveText('Keine Fehler.');
		await typeCode(page, SEQ_BAD);
		await expectError(page, 4, 13, false);
	});

	test('T101 C3: sequence Fehlerhinweis überdeckt Werkzeugleiste und Vorschau nicht', async ({
		page
	}) => {
		await openText(page, 'seq.mmd', SEQ);
		await expectHintApart(page, () => typeCode(page, SEQ_BAD), [
			seqTools(page),
			page.locator('.preview')
		]);
	});

	test('AK-M09: sequence Canvas bleibt mit letztem gültigen Modell editierbar', async ({
		page
	}) => {
		await openText(page, 'seq.mmd', SEQ);
		await typeCode(page, SEQ_BAD);
		await expect(errorBanner(page)).toBeVisible();
		const surface = seqSurface(page);
		await expect(
			surface.getByRole('button', { name: 'Nachricht: Hallo', exact: true })
		).toBeVisible();
		await expect(
			surface.getByRole('button', { name: 'Teilnehmer: Alice', exact: true })
		).toBeVisible();
		await expect(
			surface.getByRole('button', { name: 'Teilnehmer: Bob', exact: true })
		).toBeVisible();
		await relabel(
			page,
			surface.getByRole('button', { name: 'Nachricht: Hallo', exact: true }),
			'Servus'
		);
		await expect(
			surface.getByRole('button', { name: 'Nachricht: Servus', exact: true })
		).toBeVisible();
		await seqTools(page).getByRole('button', { name: '+ Teilnehmer', exact: true }).click();
		await expect(
			surface.getByRole('button', { name: 'Teilnehmer: Teilnehmer1', exact: true })
		).toBeVisible();
	});

	test('AK-M09: sequence Grafik-Änderung überschreibt den ungültigen Code nicht', async ({
		page
	}) => {
		await seqConflict(page);
		await expect.poll(() => codeText(page)).toBe(SEQ_BAD);
		await expectError(page, 4, 13, true);
		const saved = await saveBytes(page);
		expect(saved.toString('utf8'), 'gespeichert wird der ungültige Nutzertext').toBe(SEQ_BAD);
	});

	test('AK-M09: sequence Konflikt-Banner, Auflösung "Grafik behalten" und "Code behalten"', async ({
		page
	}) => {
		await seqConflict(page);
		await banner(page).getByRole('button', { name: 'Grafik behalten', exact: true }).click();
		await expect(banner(page)).toHaveCount(0);
		await expect(errorList(page)).toHaveText('Keine Fehler.');
		await expect.poll(() => codeText(page)).toMatch(/^\s*participant Teilnehmer1$/m);
		await expect.poll(() => codeText(page)).toMatch(/^\s*Alice->>Bob: Hallo$/m);

		// Zweiter Konflikt, diesmal mit "Code behalten": Teilnehmer2 wird verworfen.
		const valid = await codeText(page);
		const bad = valid.replace('Alice->>Bob: Hallo', 'Alice->>Bob Hallo');
		await typeCode(page, bad);
		await expect(errorBanner(page)).toBeVisible();
		await seqTools(page).getByRole('button', { name: '+ Teilnehmer', exact: true }).click();
		const added = seqSurface(page).getByRole('button', {
			name: 'Teilnehmer: Teilnehmer2',
			exact: true
		});
		await expect(added).toBeVisible();
		await banner(page).getByRole('button', { name: 'Code behalten', exact: true }).click();
		await expect(banner(page)).toHaveCount(0);
		await expect(added).toHaveCount(0);
		await expect.poll(() => codeText(page)).toBe(bad);
		await expect(errorList(page)).toContainText('Zeile ');
	});
});

test.describe('ungültige Datei öffnen', () => {
	test('AK-M09: ungültige flowchart-Datei öffnen zeigt Fehler, Canvas editierbar, Text bleibt', async ({
		page
	}) => {
		const file = 'flowchart-klammer-offen.mmd';
		const original = await readFile(`${DIR}/${file}`, 'utf8');
		await openFixture(page, file);
		await expect(page.getByTestId('type')).toContainText('flowchart');
		await expectErrorOnly(page);
		await expectError(page, 4, 13, false);
		// Kein gültiger Stand vorhanden: leere Fläche, trotzdem editierbar.
		await expect(page.locator('.svelte-flow__node')).toHaveCount(0);
		await dblclickFree(page);
		await expect(node(page, 'n1')).toBeVisible();
		await expectBannerActions(page);
		await expect.poll(() => codeText(page)).toBe(original);
		const saved = await saveBytes(page);
		expect(saved.toString('utf8')).toBe(original);
	});

	test('AK-M09: ungültige sequence-Datei öffnen zeigt Fehler, Canvas editierbar, Text bleibt', async ({
		page
	}) => {
		const file = 'sequence-loop-offen.mmd';
		const original = await readFile(`${DIR}/${file}`, 'utf8');
		await openFixture(page, file);
		await expect(page.getByTestId('type')).toContainText('sequence');
		await expectErrorOnly(page);
		// Der eigene Parser meldet den offenen Block an der letzten Zeile (dort fehlt "end").
		await expectError(page, 5, 1, false);
		await expect(errorList(page)).toContainText('Block "loop" nicht geschlossen');
		await seqTools(page).getByRole('button', { name: '+ Teilnehmer', exact: true }).click();
		await expect(
			seqSurface(page)
				.getByRole('button', { name: /^Teilnehmer: / })
				.first()
		).toBeVisible();
		await expectBannerActions(page);
		await expect.poll(() => codeText(page)).toBe(original);
		const saved = await saveBytes(page);
		expect(saved.toString('utf8')).toBe(original);
	});

	test('AK-M09: Fehlerliste springt bei geschlossenem Code-Tab auf Zeile und Spalte', async ({
		page
	}) => {
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
		await (await chooser).setFiles(`${DIR}/flowchart-klammer-offen.mmd`);
		await expect(page.getByTestId('message')).toHaveText('Geöffnet: flowchart-klammer-offen.mmd');
		await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'false');
		// Ein Klick auf den Eintrag öffnet den Code-Tab und setzt den Cursor auf die Fehlerstelle.
		await errorList(page)
			.getByRole('button', { name: /^Fehler Zeile 4, Spalte 13: / })
			.click();
		await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
		await expect(page.locator('#shell-code .cm-content')).toBeFocused();
		await expect(statusBar(page)).toContainText('Z 4:13');
	});

	test('AK-M09: Banner-Link springt auf Zeile und Spalte', async ({ page }) => {
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
		await (await chooser).setFiles(`${DIR}/flowchart-klammer-offen.mmd`);
		await expect(page.getByTestId('message')).toHaveText('Geöffnet: flowchart-klammer-offen.mmd');
		await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'false');
		await expect(errorBanner(page)).toContainText('Ungültiger Code in Zeile 4, Spalte 13: ');
		// Ein Klick auf den Zeilen-Link öffnet den Code-Tab und setzt den Cursor auf den ersten Fehler.
		await errorBanner(page)
			.getByRole('button', { name: 'Zeile 4, Spalte 13', exact: true })
			.click();
		await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
		await expect(page.locator('#shell-code .cm-content')).toBeFocused();
		await expect(statusBar(page)).toContainText('Z 4:13');
	});
});

test.describe('Fehler ohne Konflikt (O-44, D1)', () => {
	test('D1: Tipp-Pause mit unfertigem Code, danach vervollständigt: Sync OK, Canvas aktuell', async ({
		page
	}) => {
		await openText(page, 'flow.mmd', FLOW);
		await typeCode(page, `${FLOW}    A --> C[`);
		await expectErrorOnly(page);
		// Tipp-Pause deutlich über dem Debounce (500 ms): darf keinen Konflikt auslösen.
		await page.waitForTimeout(2000);
		await expect(banner(page)).toHaveCount(0);
		await page.keyboard.insertText('c]');
		await expect(errorList(page)).toHaveText('Keine Fehler.');
		await expect(await settledStatus(page)).toContainText('Sync: Grafik=Code');
		await expect(errorBanner(page)).toHaveCount(0);
		await expect(banner(page)).toHaveCount(0);
		await expect(node(page, 'C')).toHaveText('c');
		await expect(page.locator('.svelte-flow__edge')).toHaveCount(2);
	});

	test('D1: Fehlerhinweis ohne Wahlknöpfe als Überlagerung, Canvas-Box unverändert', async ({
		page
	}) => {
		await openText(page, 'flow.mmd', FLOW);
		await page.getByRole('tab', { name: 'Code' }).click();
		await expect(await settledStatus(page)).toContainText('Sync: Grafik=Code');
		const boxes = () =>
			Promise.all(['.main', '.shell-canvas'].map((sel) => page.locator(sel).first().boundingBox()));
		const before = await boxes();
		expect(before.every((b) => b !== null)).toBe(true);
		await typeCode(page, FLOW_BAD);
		await expectErrorOnly(page);
		expect(await boxes()).toEqual(before);
	});
});
