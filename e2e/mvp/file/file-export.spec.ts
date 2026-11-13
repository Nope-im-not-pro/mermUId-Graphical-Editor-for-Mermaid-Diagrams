// T24 C1: E2E Datei und Export (AK-M11, AK-M12). Öffnen über den Upload-Fallback
// (`filechooser`), Speichern und Bildexport über den Download-Pfad (O-36). Die File System
// Access API wird im Test ausgeblendet, damit Chromium keinen nativen Dialog öffnet.
import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';

const FIXTURES = 'tests/fixtures';
const THREE_BLOCKS = `${FIXTURES}/file/three-blocks.md`;

/** Referenz-Diagramme für AK-M12 (je Diagrammtyp aus tests/fixtures/<typ>/roundtrip). */
const REFERENCES = [
	{ type: 'flowchart', file: `${FIXTURES}/flowchart/roundtrip/01-basic.mmd` },
	{ type: 'flowchart', file: `${FIXTURES}/flowchart/roundtrip/04-init-subgraphs.mmd` },
	{ type: 'sequence', file: `${FIXTURES}/sequence/roundtrip/basic.mmd` }
];

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
}

async function downloadBytes(page: Page, trigger: () => Promise<void>): Promise<Buffer> {
	const pending = page.waitForEvent('download');
	await trigger();
	const download: Download = await pending;
	return readFile(await download.path());
}

/** Teilt den Text am zweiten Mermaid-Block (`~~~mermaid title="Ablauf"`) in drei Teile. */
function splitAtSecondBlock(bytes: Buffer): { head: Buffer; block: Buffer; tail: Buffer } {
	const open = Buffer.from('~~~mermaid title="Ablauf"\n');
	const start = bytes.indexOf(open);
	expect(start, 'Öffnende Fence von Block 2').toBeGreaterThanOrEqual(0);
	const contentStart = start + open.length;
	const close = bytes.indexOf(Buffer.from('\n~~~\n'), contentStart);
	expect(close, 'Schließende Fence von Block 2').toBeGreaterThan(contentStart);
	return {
		head: bytes.subarray(0, contentStart),
		block: bytes.subarray(contentStart, close),
		tail: bytes.subarray(close)
	};
}

test('AK-M11: .md mit 3 Blöcken, zweiten grafisch bearbeiten, Rest byte-gleich', async ({
	page
}) => {
	const original = await readFile(THREE_BLOCKS);
	await openFixture(page, THREE_BLOCKS);

	const chooser = page.getByRole('dialog', { name: 'Mermaid-Block wählen' });
	await expect(chooser.getByRole('button')).toHaveText([
		'Block 1: flowchart TD',
		'Block 2: sequenceDiagram',
		'Block 3: flowchart LR',
		'Abbrechen'
	]);
	await chooser.getByRole('button', { name: 'Block 2: sequenceDiagram' }).click();
	await expect(page.getByTestId('message')).toHaveText('Geöffnet: three-blocks.md');
	await expect(page.getByTestId('file')).toHaveText('Datei: three-blocks.md');

	await page.getByRole('button', { name: 'Nachricht: Hallo' }).dblclick();
	const editor = page.getByRole('textbox', { name: 'Label bearbeiten' });
	await editor.fill('Servus');
	await editor.press('Enter');
	await expect(page.getByRole('button', { name: 'Nachricht: Servus' })).toBeVisible();
	await expect(page.getByTestId('file')).toHaveText('Datei: three-blocks.md (geändert)');

	const saved = await downloadBytes(page, () =>
		page.getByRole('button', { name: 'Speichern', exact: true }).click()
	);
	await expect(page.getByTestId('message')).toHaveText('Als Download gespeichert: three-blocks.md');

	const before = splitAtSecondBlock(original);
	const after = splitAtSecondBlock(saved);
	expect(after.head.equals(before.head), 'Text bis Block 2 (inkl. Block 1) byte-gleich').toBe(true);
	expect(after.tail.equals(before.tail), 'Text ab Block 2 (inkl. Block 3) byte-gleich').toBe(true);
	expect(after.block.equals(before.block), 'Block 2 geändert').toBe(false);
	const block = after.block.toString('utf8');
	expect(block).toMatch(/^sequenceDiagram\n/);
	expect(block).toContain('Alice->>Bob: Servus');
	expect(block).not.toContain('Hallo');
});

async function exportVia(
	page: Page,
	choose: (dialog: ReturnType<Page['getByRole']>) => Promise<void>
) {
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Export' });
	await choose(dialog);
	await dialog.getByRole('button', { name: 'Exportieren' }).click();
	await expect(dialog).toBeHidden();
}

/** Breite und Höhe aus dem IHDR-Chunk eines PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } {
	expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
	expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

for (const ref of REFERENCES) {
	const name = ref.file.split('/').pop()!;
	const base = name.replace(/\.mmd$/, '');

	test(`AK-M12: Copy-as-Markdown, SVG, PNG 2x für ${ref.type} ${name}`, async ({
		page,
		context,
		browserName
	}) => {
		// Firefox kennt keine Clipboard-Permissions; der Text wird browserunabhängig über einen
		// Mitschnitt von writeText gelesen, der echte Clipboard-Aufruf läuft weiter.
		if (browserName === 'chromium') await context.grantPermissions(['clipboard-write']);
		// Die Seite ist schon geladen (beforeEach): Mitschnitt direkt im laufenden Dokument.
		await page.evaluate(() => {
			const clip = navigator.clipboard;
			const write = clip.writeText.bind(clip);
			clip.writeText = async (text: string) => {
				await write(text);
				(window as unknown as { copied?: string }).copied = text;
			};
		});
		const source = (await readFile(ref.file, 'utf8')).replace(/\n+$/, '');
		await openFixture(page, ref.file);
		await expect(page.getByTestId('message')).toHaveText(`Geöffnet: ${name}`);
		await expect(page.getByTestId('type')).toContainText(ref.type);

		// Copy-as-Markdown: ```mermaid-Fence mit dem Diagramm-Code.
		await exportVia(page, (d) => d.getByRole('radio', { name: 'Als Markdown kopieren' }).check());
		await expect(page.getByTestId('message')).toHaveText('Als Markdown kopiert.');
		const markdown = await page.evaluate(() => (window as unknown as { copied?: string }).copied);
		expect(markdown).toBe('```mermaid\n' + source + '\n```\n');

		// SVG: Download, per DOMParser als image/svg+xml ohne parsererror.
		const svg = (
			await downloadBytes(page, () =>
				exportVia(page, (d) => d.getByRole('radio', { name: 'SVG', exact: true }).check())
			)
		).toString('utf8');
		await expect(page.getByTestId('message')).toHaveText(`Exportiert: ${base}.svg`);
		const parsed = await page.evaluate((text) => {
			const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
			const root = doc.documentElement;
			return {
				errors: doc.getElementsByTagName('parsererror').length,
				root: root.localName,
				ns: root.namespaceURI,
				viewBox: root.getAttribute('viewBox')
			};
		}, svg);
		expect(parsed.errors).toBe(0);
		expect(parsed.root).toBe('svg');
		expect(parsed.ns).toBe('http://www.w3.org/2000/svg');
		const box = (parsed.viewBox ?? '')
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		expect(box).toHaveLength(4);
		const [vbWidth, vbHeight] = box.slice(2);
		expect(vbWidth).toBeGreaterThan(0);
		expect(vbHeight).toBeGreaterThan(0);

		// PNG 1x und 2x: Header lesen, 2x = doppelte Abmessung (Viewport bzw. 1x).
		const png = async (scale: '1' | '2') =>
			pngSize(
				await downloadBytes(page, () =>
					exportVia(page, async (d) => {
						await d.getByRole('radio', { name: 'PNG', exact: true }).check();
						await d.getByLabel('Maßstab').selectOption(scale);
					})
				)
			);
		const one = await png('1');
		await expect(page.getByTestId('message')).toHaveText(`Exportiert: ${base}.png`);
		const two = await png('2');
		expect(one).toEqual({ width: Math.ceil(vbWidth), height: Math.ceil(vbHeight) });
		expect(two).toEqual({ width: Math.ceil(vbWidth * 2), height: Math.ceil(vbHeight * 2) });
		expect(Math.abs(two.width - 2 * one.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(two.height - 2 * one.height)).toBeLessThanOrEqual(1);
	});
}

test('Editor-SVG: Sequenz aus dem Canvas, Theme-Farben, nur Auswahl im Graph', async ({ page }) => {
	await openFixture(page, `${FIXTURES}/sequence/roundtrip/basic.mmd`);
	await expect(page.getByTestId('type')).toContainText('sequence');
	const seq = (
		await downloadBytes(page, () =>
			exportVia(page, async (d) => {
				await d.getByRole('radio', { name: 'SVG', exact: true }).check();
				await d.getByRole('radio', { name: /^Editor-SVG/ }).check();
				await expect(d.getByRole('checkbox', { name: 'Nur Auswahl' })).toBeDisabled();
				await d.getByRole('checkbox', { name: 'Farben des aktiven Themes' }).check();
			})
		)
	).toString('utf8');
	expect(seq).toContain('class="lifeline"');
	// Standard-Theme dunkel: Hintergrund #0d0f14 aus theme.css.
	expect(seq).toMatch(/<\/title><rect [^>]*fill="#0d0f14"\/>/);

	await openFixture(page, `${FIXTURES}/flowchart/roundtrip/01-basic.mmd`);
	const nodes = page.locator('.svelte-flow__node');
	await expect(nodes.first()).toBeVisible();
	await nodes.filter({ hasText: 'Weiter' }).click();
	await nodes.filter({ hasText: 'Datenbank' }).click({ modifiers: ['Shift'] });
	const part = (
		await downloadBytes(page, () =>
			exportVia(page, async (d) => {
				await d.getByRole('radio', { name: 'SVG', exact: true }).check();
				await d.getByRole('radio', { name: /^Editor-SVG/ }).check();
				await d.getByRole('checkbox', { name: 'Nur Auswahl' }).check();
			})
		)
	).toString('utf8');
	expect(part.match(/class="node"/g)).toHaveLength(2);
	expect(part.match(/class="edge"/g)).toHaveLength(1);
	expect(part).toContain('>Weiter<');
	expect(part).not.toContain('>Start<');
});

test('PNG mit Rand (T127 C2): Rand addiert je Seite genau die Randbreite', async ({ page }) => {
	await openFixture(page, `${FIXTURES}/flowchart/roundtrip/01-basic.mmd`);
	await expect(page.getByTestId('type')).toContainText('flowchart');
	// Alle Felder je Export explizit setzen: nur der Rand unterscheidet die beiden Exporte.
	const exportPng = (margin: number) =>
		downloadBytes(page, () =>
			exportVia(page, async (d) => {
				await d.getByRole('radio', { name: 'PNG', exact: true }).check();
				await d.getByRole('radio', { name: /^Mermaid-Render/ }).check();
				await d.getByLabel('Maßstab').selectOption('1');
				await d.getByRole('checkbox', { name: 'Hintergrund' }).check();
				await d.getByLabel(/^Farbe/).fill('#ff00ff');
				await d.getByLabel('Rand (px)').fill(String(margin));
			})
		);
	// Spalten/Zeilen ohne Zeichnung (alle Pixel exakt Hintergrund) von jedem Bildrand zählen.
	// Die Zeichnung liegt selbst asymmetrisch in der viewBox, daher Vergleich Rand 0 gegen Rand 24.
	const strips = (bytes: Buffer) =>
		page.evaluate(async (base64) => {
			const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
			const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(bitmap, 0, 0);
			const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
			const bg = (x: number, y: number) => {
				const i = (y * width + x) * 4;
				return data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255 && data[i + 3] === 255;
			};
			const blankCol = (x: number) => {
				for (let y = 0; y < height; y++) if (!bg(x, y)) return false;
				return true;
			};
			const blankRow = (y: number) => {
				for (let x = 0; x < width; x++) if (!bg(x, y)) return false;
				return true;
			};
			let left = 0;
			while (left < width && blankCol(left)) left++;
			let right = 0;
			while (right < width && blankCol(width - 1 - right)) right++;
			let top = 0;
			while (top < height && blankRow(top)) top++;
			let bottom = 0;
			while (bottom < height && blankRow(height - 1 - bottom)) bottom++;
			return { left, right, top, bottom, width, height };
		}, bytes.toString('base64'));

	const margin = 24;
	const plain = await strips(await exportPng(0));
	const framed = await strips(await exportPng(margin));
	expect(plain.left, 'Zeichnung vorhanden').toBeLessThan(plain.width);
	expect(framed.left, 'Zeichnung vorhanden').toBeLessThan(framed.width);
	for (const side of ['left', 'right', 'top', 'bottom'] as const) {
		expect(Math.abs(framed[side] - plain[side] - margin), `Zuwachs ${side}`).toBeLessThanOrEqual(1);
	}
	expect(Math.abs(framed.width - plain.width - 2 * margin), 'Zuwachs Breite').toBeLessThanOrEqual(
		1
	);
	expect(Math.abs(framed.height - plain.height - 2 * margin), 'Zuwachs Höhe').toBeLessThanOrEqual(
		1
	);
});
