// T24 C2: E2E Sicherheit (AK-M14). Die 8 Fälle aus tests/fixtures/security/xss-labels.json
// landen als Knoten-Label im Diagramm, einmal über Datei-Öffnen (Code, Upload-Fallback) und
// einmal über die grafische Umbenennung (Inline-Editor). Geprüft werden Canvas, Mermaid-Vorschau
// und Export-SVG (Mermaid-Render und Editor-SVG): kein ausgeführtes Skript, kein aktives Markup
// im DOM, Label als Text sichtbar oder neutralisiert.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

interface XssCase {
	id: string;
	input: string;
	init?: Record<string, unknown>;
}

const CASES: XssCase[] = JSON.parse(
	await readFile('tests/fixtures/security/xss-labels.json', 'utf8')
);

/** Sichtbarer Klartext je Fall, der nach dem Neutralisieren übrig bleiben muss. */
const VISIBLE: Record<string, string> = {
	script: 'Start',
	'img-onerror': 'Bild',
	'javascript-link': 'Link',
	'data-url': 'Daten',
	'svg-onload': 'Kreis',
	'entity-bypass': 'Text',
	iframe: 'Rahmen',
	'init-loose': 'Knoten'
};

/**
 * Chromium meldet Inline-Handler auch beim Parsen in inerten Dokumenten (DOMParser in
 * DOMPurify) als CSP-Verstoß. Solche Meldungen zählen nur, wenn das Ziel im Live-Dokument hängt;
 * das prüft `liveViolations` über das `securitypolicyviolation`-Ereignis.
 */
const INERT_CSP = /^Executing inline event handler violates the following Content Security Policy/;

declare global {
	interface Window {
		__xssFired?: string[];
		__cspLive?: string[];
	}
}

interface Watch {
	dialogs: string[];
	errors: string[];
}

async function watch(page: Page): Promise<Watch> {
	const seen: Watch = { dialogs: [], errors: [] };
	await page.addInitScript(() => {
		for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
			Object.defineProperty(window, name, { value: undefined, configurable: true });
		}
		window.__xssFired = [];
		window.__cspLive = [];
		for (const name of ['alert', 'confirm', 'prompt'] as const) {
			const original = window[name].bind(window);
			Object.defineProperty(window, name, {
				configurable: true,
				value: (...args: unknown[]) => {
					window.__xssFired!.push(`${name}(${args.map(String).join(',')})`);
					return (original as (...a: unknown[]) => unknown)(...args);
				}
			});
		}
		document.addEventListener(
			'securitypolicyviolation',
			(e) => {
				const target = e.target as Node | null;
				const inert = target !== null && target.ownerDocument !== document;
				if (!inert)
					window.__cspLive!.push(`${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}`);
			},
			true
		);
	});
	page.on('dialog', (d) => {
		seen.dialogs.push(`${d.type()}: ${d.message()}`);
		void d.dismiss();
	});
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !INERT_CSP.test(msg.text())) seen.errors.push(msg.text());
	});
	page.on('pageerror', (err) => seen.errors.push(err.message));
	return seen;
}

async function expectNothingExecuted(page: Page, seen: Watch): Promise<void> {
	const state = await page.evaluate(() => ({
		fired: window.__xssFired ?? ['Init-Script fehlt'],
		live: window.__cspLive ?? ['Init-Script fehlt']
	}));
	expect(seen.dialogs, 'Kein Dialog (alert/confirm/prompt)').toEqual([]);
	expect(state.fired, 'Kein Aufruf von alert/confirm/prompt').toEqual([]);
	expect(state.live, 'Kein blockierter Inline-Code im Live-Dokument').toEqual([]);
	expect(seen.errors, 'Keine Konsolen- oder Seitenfehler').toEqual([]);
}

/** Aktives Markup in einem Teilbaum: Skript, Rahmen, on*-Attribute, javascript:/data:-Ziele. */
function activeMarkup(root: Element): string[] {
	const found: string[] = [];
	const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'data'];
	for (const el of [root, ...root.querySelectorAll('*')]) {
		const tag = el.localName.toLowerCase();
		if (['script', 'iframe', 'object', 'embed'].includes(tag)) found.push(`<${tag}>`);
		for (const { name, localName, value } of el.attributes) {
			const v = [...value]
				.filter((ch) => ch.charCodeAt(0) > 32)
				.join('')
				.toLowerCase();
			if (name.toLowerCase().startsWith('on')) found.push(`${tag}[${name}]`);
			else if (v.startsWith('javascript:')) found.push(`${tag}[${name}=javascript:]`);
			else if (URL_ATTRS.includes(localName.toLowerCase()) && v.startsWith('data:'))
				found.push(`${tag}[${name}=data:]`);
		}
	}
	return found;
}

const canvasNode = (page: Page) => page.locator('.svelte-flow__node[data-id="A"]');
const preview = (page: Page) => page.locator('.preview-body');

async function expectSafeView(page: Page, c: XssCase): Promise<void> {
	const word = VISIBLE[c.id];
	await expect(canvasNode(page)).toContainText(word);
	await expect(preview(page).locator('svg').first()).toBeVisible();
	await expect(preview(page)).toContainText(word);
	await expect(preview(page).getByRole('alert')).toHaveCount(0);
	for (const [name, el] of [
		['Canvas', page.getByRole('application', { name: 'Graph-Canvas' })],
		['Vorschau', preview(page)]
	] as const) {
		expect(await el.evaluate(activeMarkup), `${name}: kein aktives Markup`).toEqual([]);
	}
}

async function exportSvg(page: Page, source: 'Mermaid-Render' | 'Editor-SVG'): Promise<string> {
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Export' });
	await dialog.getByRole('radio', { name: 'SVG', exact: true }).check();
	await dialog.getByRole('radio', { name: source }).check();
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Exportieren' }).click();
	const download = await pending;
	await expect(dialog).toBeHidden();
	return readFile((await download.path())!, 'utf8');
}

async function expectSafeExports(page: Page, c: XssCase): Promise<void> {
	for (const source of ['Mermaid-Render', 'Editor-SVG'] as const) {
		const svg = await exportSvg(page, source);
		const result = await page.evaluate(
			({ text, check }) => {
				const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
				const scan = new Function(`return (${check})`)() as (root: Element) => string[];
				return {
					errors: doc.getElementsByTagName('parsererror').length,
					root: doc.documentElement.localName,
					active: scan(doc.documentElement),
					text: doc.documentElement.textContent ?? ''
				};
			},
			{ text: svg, check: activeMarkup.toString() }
		);
		expect(result.errors, `${source}: SVG parsebar`).toBe(0);
		expect(result.root).toBe('svg');
		expect(result.active, `${source}: kein aktives Markup`).toEqual([]);
		expect(result.text, `${source}: Label als Text`).toContain(VISIBLE[c.id]);
	}
}

/** Mermaid-Code für ein Knoten-Label: `"` als Mermaid-Entität, `init` als Direktive. */
function diagramFor(c: XssCase): string {
	const directive = c.init ? `%%{init: ${JSON.stringify(c.init)}}%%\n` : '';
	return `${directive}flowchart LR\n  A["${c.input.replaceAll('"', '#quot;')}"] --> B[Ende]\n`;
}

async function openText(page: Page, name: string, text: string): Promise<void> {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
	await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
	await expect(page.getByTestId('message')).toHaveText(`Geöffnet: ${name}`);
}

for (const c of CASES) {
	test(`AK-M14: ${c.id} über Datei-Öffnen in Canvas, Vorschau und Export-SVG neutralisiert`, async ({
		page
	}) => {
		const seen = await watch(page);
		await page.goto('/');
		await openText(page, `xss-${c.id}.mmd`, diagramFor(c));
		await expect(page.getByTestId('type')).toContainText('flowchart');
		await expectSafeView(page, c);
		await expectSafeExports(page, c);
		await expectNothingExecuted(page, seen);
	});

	test(`AK-M14: ${c.id} über grafische Umbenennung in Canvas, Vorschau und Export-SVG neutralisiert`, async ({
		page
	}) => {
		const seen = await watch(page);
		await page.goto('/');
		await openText(page, `rename-${c.id}.mmd`, 'flowchart LR\n  A[Alt] --> B[Ende]\n');
		await canvasNode(page).dblclick();
		const editor = page.getByRole('textbox', { name: 'Label bearbeiten' });
		await editor.fill(c.input);
		await editor.press('Enter');
		await expect(editor).toBeHidden();
		await expect(page.getByTestId('file')).toHaveText(`Datei: rename-${c.id}.mmd (geändert)`);
		await expect(canvasNode(page)).not.toContainText('Alt');
		await expectSafeView(page, c);
		await expectSafeExports(page, c);
		await expectNothingExecuted(page, seen);
	});
}
