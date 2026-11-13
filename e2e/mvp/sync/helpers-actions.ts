// T23 C2a: gemeinsame Helfer für AK-M04 und AK-M06. Öffnen über den Upload-Fallback
// (`filechooser`), Speichern über den Download-Pfad (O-36); die File System Access API wird
// ausgeblendet, damit Chromium keinen nativen Dialog öffnet.
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

/** Blendet die File System Access API aus und lädt die App. */
export async function startApp(page: Page): Promise<void> {
	await page.addInitScript(() => {
		for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
			Object.defineProperty(window, name, { value: undefined, configurable: true });
		}
	});
	await page.goto('/');
	await expect(page.getByRole('toolbar', { name: 'Werkzeugleiste' })).toBeVisible();
}

/** Öffnet `content` (Text oder Bytes) als Datei `name` über den Öffnen-Dialog. */
export async function openText(page: Page, name: string, content: string | Buffer): Promise<void> {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
	const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
	await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer });
	await expect(page.getByTestId('message')).toHaveText(`Geöffnet: ${name}`);
}

/** Speichert über den Download-Pfad und liefert die Bytes der Datei. */
export async function saveBytes(page: Page): Promise<Buffer> {
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	return readFile(await (await pending).path());
}

export const node = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);

export const properties = (page: Page) => page.getByRole('region', { name: 'Eigenschaften' });

export const seqTools = (page: Page) => page.getByRole('toolbar', { name: 'Sequenz-Werkzeuge' });

export const seqSurface = (page: Page) =>
	page.getByRole('application', { name: 'Sequenzdiagramm' });

/** Inline-Editor öffnen (Doppelklick), Text setzen, mit Enter übernehmen. */
export async function relabel(
	page: Page,
	target: ReturnType<Page['locator']>,
	text: string
): Promise<void> {
	await target.dblclick();
	const editor = page.getByRole('textbox', { name: 'Label bearbeiten' });
	await editor.fill(text);
	await editor.press('Enter');
	await expect(editor).toBeHidden();
}

/** Zieht eine Kante vom rechten Anschluss von `from` auf den linken Anschluss von `to`. */
export async function connect(page: Page, from: string, to: string): Promise<void> {
	const src = await node(page, from).locator('.svelte-flow__handle-right').boundingBox();
	const dst = await node(page, to).locator('.svelte-flow__handle-left').boundingBox();
	if (!src || !dst) throw new Error(`Anschlüsse ${from}/${to} fehlen`);
	await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
	await page.mouse.down();
	await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 });
	await page.mouse.up();
}
