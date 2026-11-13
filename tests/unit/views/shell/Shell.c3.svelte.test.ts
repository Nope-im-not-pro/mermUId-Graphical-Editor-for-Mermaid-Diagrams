// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileEnv } from '../../../../src/lib/services/file';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import { place } from '../../controllers/sync/helpers';
import { gridSettings } from '../../../../src/lib/views/canvas/common/grid';
import { CONFIRM_KEY } from '../../../../src/lib/views/shell/confirm';
import { installBrowserStubs, nodeEl } from '../canvas/helpers';
import { button, docOf, mountShell, settle, SVG, unmountShells } from './helpers';

/** HelpPanel rendert Beispiele über services/render; im Test ohne mermaid. */
vi.mock('../../../../src/lib/services/render', () => ({
	renderSvg: async () => ({ ok: true, svg: SVG })
}));

beforeAll(installBrowserStubs);
afterEach(() => {
	unmountShells();
	vi.restoreAllMocks();
});

const TWO = 'flowchart LR\n  A\n  B\n';
const LINKED = 'flowchart LR\n  A --> B\n';
const SEQ = 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n';
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const message = (target: HTMLElement) => text(target.querySelector('[data-testid="message"]'));
const dialog = () => document.querySelector<HTMLElement>('.dialog[role="dialog"]');

function press(el: Element, key: string, init: KeyboardEventInit = {}) {
	const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(e);
	flushSync();
	return e;
}

function click(el: Element) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	flushSync();
}

function dialogButton(label: string) {
	const b = [...dialog()!.querySelectorAll('button')].find((x) => text(x) === label);
	if (!b) throw new Error(`Dialog-Button fehlt: ${label}`);
	return b;
}

function canvas(target: HTMLElement) {
	const el = target.querySelector<HTMLElement>('.graph-canvas')!;
	el.focus();
	return el;
}

function fakeEnv(extra: Partial<FileEnv> = {}) {
	const blobs: Blob[] = [];
	const names: string[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		names.push(this.download);
	});
	const env: FileEnv = {
		document,
		createObjectURL: (b: Blob) => (blobs.push(b), 'blob:x'),
		revokeObjectURL: () => {},
		...extra
	};
	return { env, blobs, names };
}

/** Feste Positionen: A links, B rechts (Nachbarsuche braucht Geometrie). */
async function placed(sync: { execute: (c: Command) => Promise<unknown> }) {
	await sync.execute(place('A', [0, 0, 80, 40]));
	await sync.execute(place('B', [200, 0, 80, 40]));
	await settle();
}

const picker = (name: string, content: string) => ({
	showOpenFilePicker: async () => [{ name, getFile: async () => new File([content], name) }]
});

describe('Shell C3: Layout-Umschalter (P3 b)', () => {
	it('zwei schnelle Klicks erzeugen genau einen Undo-Schritt', async () => {
		const { sync, target } = await mountShell(TWO);
		const execute = vi.spyOn(sync, 'execute');
		click(button(target, 'Manuell'));
		click(button(target, 'Manuell'));
		await settle();
		expect(execute).toHaveBeenCalledTimes(1);
		expect(docOf(sync).layout.mode).toBe('manual');
		await sync.undo();
		await settle();
		expect(docOf(sync).layout.mode).toBe('auto');
		expect(button(target, 'Rückgängig').disabled).toBe(true);
	});
});

describe('Shell C3: Strg-Kürzel', () => {
	it('F1 und Button "Hilfe" öffnen die Hilfe, Kürzel ruhen bei offener Hilfe', async () => {
		const { target } = await mountShell(TWO);
		expect(press(document.body, 'F1').defaultPrevented).toBe(true);
		expect(document.querySelector('[aria-labelledby="help-title"]')).not.toBeNull();
		expect(press(document.body, 's', { ctrlKey: true }).defaultPrevented).toBe(false);
		const close = [...document.querySelectorAll('button')].find((b) =>
			/schließen/i.test(b.getAttribute('aria-label') ?? b.textContent ?? '')
		)!;
		click(close);
		expect(document.querySelector('[aria-labelledby="help-title"]')).toBeNull();
		click(button(target, 'Hilfe'));
		expect(document.querySelector('[aria-labelledby="help-title"]')).not.toBeNull();
	});

	it('Strg-S speichert per Download-Fallback, Datei danach sauber', async () => {
		const { env, blobs, names } = fakeEnv();
		const { sync, target } = await mountShell(TWO, { fileEnv: env });
		sync.editCode('flowchart LR\n  A\n  B\n  C\n');
		await sync.flush();
		await settle();
		expect(text(target.querySelector('[data-testid="file"]'))).toBe(
			'Datei: diagramm.mmd (geändert)'
		);
		expect(press(document.body, 's', { ctrlKey: true }).defaultPrevented).toBe(true);
		await settle();
		expect(names).toEqual(['diagramm.mmd']);
		expect(await blobs[0].text()).toBe('flowchart LR\n  A\n  B\n  C\n');
		expect(message(target)).toBe('Als Download gespeichert: diagramm.mmd');
		expect(text(target.querySelector('[data-testid="file"]'))).toBe('Datei: diagramm.mmd');
	});

	it('Speichern-Fehler erscheint als Meldung', async () => {
		const env = fakeEnv({
			showSaveFilePicker: async () => {
				throw new Error('kaputt');
			}
		}).env;
		const { target } = await mountShell(TWO, { fileEnv: env });
		click(button(target, 'Speichern'));
		await settle();
		expect(message(target)).not.toBe('');
		expect(message(target)).not.toContain('kaputt');
	});

	it('Strg-Z / Strg-Y über den Sync-Controller, nicht im Eingabefeld', async () => {
		const { sync, target } = await mountShell(TWO);
		click(button(target, 'Manuell'));
		await settle();
		press(document.body, 'z', { ctrlKey: true });
		await settle();
		expect(docOf(sync).layout.mode).toBe('auto');
		press(document.body, 'y', { ctrlKey: true });
		await settle();
		expect(docOf(sync).layout.mode).toBe('manual');
		const input = document.createElement('input');
		target.querySelector('.shell')!.append(input);
		input.focus();
		expect(press(input, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
	});

	it('Strg-E schaltet das Code-Panel, Fokus außerhalb der App: nichts', async () => {
		const { target } = await mountShell(TWO);
		press(document.body, 'e', { ctrlKey: true });
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(false);
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();
		expect(press(outside, 'e', { ctrlKey: true }).defaultPrevented).toBe(false);
		outside.remove();
	});

	it('Strg-Plus/Minus/0 und Strg-A wirken auf den Graph-Canvas', async () => {
		const { target } = await mountShell(TWO);
		const el = canvas(target);
		for (const key of ['+', '-', '0']) {
			expect(press(el, key, { ctrlKey: true }).defaultPrevented).toBe(true);
		}
		press(el, 'a', { ctrlKey: true });
		await settle();
		expect(nodeEl(target, 'A')!.classList.contains('selected')).toBe(true);
		expect(nodeEl(target, 'B')!.classList.contains('selected')).toBe(true);
	});
});

describe('Shell T126 C3: Zoom-Kürzel im Sequenz-Canvas', () => {
	it('Strg-Plus/Minus/0 ändern die Zoomanzeige wie die Knöpfe; im Code-Editor nicht', async () => {
		const { target } = await mountShell(SEQ);
		await settle();
		const zoom = () => text(target.querySelector('[data-testid="zoom"]'));
		expect(zoom()).toBe('100 %');
		const surface = target.querySelector<HTMLElement>('.sequence-canvas .surface')!;
		surface.focus();
		expect(press(surface, '+', { ctrlKey: true }).defaultPrevented).toBe(true);
		expect(zoom()).toBe('120 %');
		expect(press(surface, '=', { ctrlKey: true }).defaultPrevented).toBe(true);
		expect(zoom()).toBe('144 %');
		press(surface, '-', { ctrlKey: true });
		press(surface, '-', { ctrlKey: true });
		expect(zoom()).toBe('100 %');
		Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 4000 });
		Object.defineProperty(surface, 'clientHeight', { configurable: true, value: 4000 });
		expect(press(surface, '0', { ctrlKey: true }).defaultPrevented).toBe(true);
		const fitted = zoom();
		expect(fitted).not.toBe('100 %');
		press(document.body, 'e', { ctrlKey: true });
		await settle();
		const cm = target.querySelector<HTMLElement>('#shell-code .cm-content')!;
		cm.focus();
		expect(press(cm, '+', { ctrlKey: true }).defaultPrevented).toBe(false);
		expect(zoom()).toBe(fitted);
	});
});

describe('Shell T126 C3: Zoom-Kürzel nur im passenden Modus', () => {
	it('Wechsel Sequenz -> nur Code: Strg-0/+/- ohne preventDefault, Zoom gesperrt', async () => {
		const { sync, target } = await mountShell(SEQ);
		await settle();
		expect(press(document.body, '0', { ctrlKey: true }).defaultPrevented).toBe(true);
		sync.editCode('pie\n  "a": 1\n');
		await sync.flush();
		await settle();
		expect(target.querySelector('.sequence-canvas')).toBeNull();
		// Ein abgebautes Control darf nicht mehr gerufen werden (Fehler im Listener).
		const errors: unknown[] = [];
		const onerror = (e: ErrorEvent) => (errors.push(e.error), e.preventDefault());
		window.addEventListener('error', onerror);
		try {
			for (const key of ['0', '+', '-']) {
				expect(press(document.body, key, { ctrlKey: true }).defaultPrevented, key).toBe(false);
			}
		} finally {
			window.removeEventListener('error', onerror);
		}
		expect(errors).toEqual([]);
		expect(button(target, 'Einpassen').disabled).toBe(true);
		expect(target.querySelector('[data-testid="zoom"]')).toBeNull();
	});
});

describe('Shell C3: Canvas-Suche (Strg-F)', () => {
	it('Treffer wählt aus, Weiter springt, Esc schließt und fokussiert den Canvas', async () => {
		const { target } = await mountShell(TWO);
		press(document.body, 'f', { ctrlKey: true });
		await settle();
		const input = target.querySelector<HTMLInputElement>('[role="search"] input')!;
		expect(document.activeElement).toBe(input);
		input.value = 'b';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(text(target.querySelector('[data-testid="search-result"]'))).toBe('1 von 1');
		expect(nodeEl(target, 'B')!.classList.contains('selected')).toBe(true);
		press(input, 'Escape');
		await settle();
		expect(target.querySelector('[role="search"]')).toBeNull();
		expect(document.activeElement).toBe(target.querySelector('.graph-canvas'));
	});

	it('Button "Suchen" öffnet, im Modus "nur Code" deaktiviert', async () => {
		const { target } = await mountShell('pie\n  "a": 1\n');
		expect(button(target, 'Suchen').disabled).toBe(true);
		expect(press(document.body, 'f', { ctrlKey: true }).defaultPrevented).toBe(false);
	});

	it('Sequenz: Suche wählt Teilnehmer', async () => {
		const { target } = await mountShell(SEQ);
		click(button(target, 'Suchen'));
		await settle();
		const input = target.querySelector<HTMLInputElement>('[role="search"] input')!;
		input.value = 'B';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		const b = target.querySelector('.sequence-canvas [data-id="B"]')!;
		expect(b.classList.contains('selected')).toBe(true);
		click(button(target, 'Suche schließen'));
		expect(target.querySelector('[role="search"]')).toBeNull();
	});
});

describe('Shell C3: Einzeltasten im Graph-Canvas', () => {
	it('G blendet das Raster, Shift-G schaltet Einrasten über Sync', async () => {
		const { sync, target } = await mountShell(TWO);
		const el = canvas(target);
		press(el, 'g');
		expect(target.querySelector('.svelte-flow__background')).toBeNull();
		press(el, 'G', { shiftKey: true });
		await settle();
		expect(docOf(sync).layout.snap).toBe(true);
		el.blur();
		expect(press(document.body, 'g').defaultPrevented).toBe(false);
	});

	it('Tab wechselt die Auswahl in Dokument-Reihenfolge, am Ende verlässt Tab den Canvas', async () => {
		const { target } = await mountShell(TWO);
		const el = canvas(target);
		expect(press(el, 'Tab').defaultPrevented).toBe(true);
		await settle();
		expect(nodeEl(target, 'A')!.classList.contains('selected')).toBe(true);
		press(el, 'Tab');
		await settle();
		expect(nodeEl(target, 'B')!.classList.contains('selected')).toBe(true);
		expect(press(el, 'Tab').defaultPrevented).toBe(false);
		expect(press(el, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
	});

	it('Shift-Pfeil verschiebt um 10 Rasterschritte', async () => {
		const { sync, target } = await mountShell(TWO);
		const el = canvas(target);
		expect(press(el, 'ArrowRight', { shiftKey: true }).defaultPrevented).toBe(false);
		press(el, 'Tab');
		await settle();
		const before = docOf(sync);
		const x = before.layout.positions.A?.[0];
		expect(press(el, 'ArrowRight', { shiftKey: true }).defaultPrevented).toBe(true);
		await settle();
		const after = docOf(sync);
		const step = gridSettings(after.layout).size * 10;
		expect(after.layout.positions.A[0] - (x ?? after.layout.positions.A[0] - step)).toBe(step);
	});

	it('Alt-Pfeil verbindet mit dem Nachbarn', async () => {
		const { sync, target } = await mountShell(TWO);
		await placed(sync);
		const el = canvas(target);
		press(el, 'Tab');
		await settle();
		press(el, 'ArrowRight', { altKey: true });
		await settle();
		expect(docOf(sync).edges.map((e) => [e.sourceId, e.targetId])).toEqual([['A', 'B']]);
		press(el, 'ArrowLeft', { altKey: true });
		await settle();
		expect(message(target)).toBe('Kein Nachbar in dieser Richtung.');
	});

	it('C: Verbinden-Modus mit Pfeil, Enter, Esc', async () => {
		const { sync, target } = await mountShell(TWO);
		await placed(sync);
		const el = canvas(target);
		press(el, 'c');
		expect(message(target)).toBe('Zum Verbinden zuerst einen Knoten auswählen.');
		press(el, 'Tab');
		await settle();
		press(el, 'c');
		press(el, 'ArrowLeft');
		expect(message(target)).toBe('Kein Nachbar in dieser Richtung.');
		press(el, 'ArrowRight');
		expect(message(target)).toBe('Verbinden: Ziel B, Enter bestätigt.');
		press(el, 'Escape');
		expect(message(target)).toBe('Verbinden abgebrochen.');
		press(el, 'c');
		press(el, 'Enter');
		expect(message(target)).toBe('Kein Ziel gewählt.');
		press(el, 'c');
		press(el, 'ArrowRight');
		press(el, 'Enter');
		await settle();
		expect(docOf(sync).edges.map((e) => [e.sourceId, e.targetId])).toEqual([['A', 'B']]);
	});

	it('Inline-Editor offen: Einzeltasten ruhen', async () => {
		const { target } = await mountShell(TWO);
		const el = canvas(target);
		const editor = document.createElement('div');
		editor.className = 'inline-editor';
		el.append(editor);
		expect(press(el, 'g').defaultPrevented).toBe(false);
		editor.remove();
	});
});

describe('Shell C3: Datei Neu / Öffnen / Drop', () => {
	it('Neu fragt bei Änderungen nach; Abbrechen behält, Verwerfen lädt neu', async () => {
		const { sync, target } = await mountShell(TWO);
		sync.editCode('flowchart LR\n  X\n');
		await sync.flush();
		await settle();
		click(button(target, 'Neu'));
		await settle();
		expect(text(dialog()!.querySelector('h2'))).toBe('Ungespeicherte Änderungen');
		click(dialogButton('Abbrechen'));
		await settle();
		expect(dialog()).toBeNull();
		expect(nodeEl(target, 'X')).not.toBeNull();
		click(button(target, 'Neu'));
		await settle();
		press(document.activeElement!, 'Escape');
		await settle();
		expect(dialog()).toBeNull();
		click(button(target, 'Neu'));
		await settle();
		click(dialogButton('Verwerfen'));
		await settle();
		// T105 C1: nach der Rückfrage folgt der Neu-Dialog; "Anlegen" wählt die Standardvorlage.
		expect(text(dialog()!.querySelector('h2'))).toBe('Neues Diagramm');
		click(dialogButton('Anlegen'));
		await settle();
		expect(message(target)).toBe('Neues Diagramm.');
		expect(nodeEl(target, 'X')).toBeNull();
		expect(text(target.querySelector('[data-testid="file"]'))).toBe('Datei: diagramm.mmd');
	});

	it('Öffnen: .md mit mehreren Blöcken fragt nach dem Block', async () => {
		const md =
			'```mermaid\nflowchart TD\n  P\n```\n\n```mermaid\nsequenceDiagram\n  participant Q\n```\n';
		const { env } = fakeEnv(picker('doku.md', md));
		const { target } = await mountShell(TWO, { fileEnv: env });
		click(button(target, 'Öffnen'));
		await settle();
		expect(text(dialog()!.querySelector('h2'))).toBe('Mermaid-Block wählen');
		click(dialogButton('Block 2: sequenceDiagram'));
		await settle();
		expect(message(target)).toBe('Geöffnet: doku.md');
		expect(target.querySelector('.sequence-canvas')).not.toBeNull();
		expect(text(target.querySelector('[data-testid="file"]'))).toBe('Datei: doku.md');
		click(button(target, 'Öffnen'));
		await settle();
		click(dialogButton('Abbrechen'));
		await settle();
		expect(message(target)).toBe('Geöffnet: doku.md');
	});

	it('Öffnen: .mmd lädt direkt, Fehler als Meldung', async () => {
		const { env } = fakeEnv(picker('a.mmd', 'flowchart TD\n  Z\n'));
		const { target } = await mountShell(TWO, { fileEnv: env });
		click(button(target, 'Öffnen'));
		await settle();
		expect(nodeEl(target, 'Z')).not.toBeNull();
		const bad = fakeEnv(picker('x.md', '# kein Block\n')).env;
		unmountShells();
		const second = await mountShell(TWO, { fileEnv: bad });
		click(button(second.target, 'Öffnen'));
		await settle();
		expect(message(second.target)).toBe('x.md enthält keinen Mermaid-Block.');
	});

	it('Öffnen: Laden schlägt fehl -> Meldung', async () => {
		const { env } = fakeEnv(picker('a.mmd', 'flowchart TD\n'));
		const { target } = await mountShell(TWO, {
			fileEnv: env,
			create: async () => {
				throw new Error('kein Parser');
			}
		});
		click(button(target, 'Öffnen'));
		await settle();
		expect(message(target)).toBe('Laden fehlgeschlagen: kein Parser');
	});

	it('Drop einer .mmd-Datei lädt sie, andere Dateien werden abgewiesen', async () => {
		const { target } = await mountShell(TWO);
		const shell = target.querySelector('.shell')!;
		const dropFile = async (file: File) => {
			const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
			for (const type of ['dragover', 'drop']) {
				const e = new MouseEvent(type, { bubbles: true, cancelable: true });
				Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
				shell.dispatchEvent(e);
				expect(e.defaultPrevented).toBe(true);
			}
			await settle();
		};
		await dropFile(new File(['x'], 'bild.png'));
		expect(message(target)).toBe('Nur .mmd- und .md-Dateien werden unterstützt.');
		await dropFile(new File(['flowchart TD\n  D\n'], 'd.mmd'));
		expect(nodeEl(target, 'D')).not.toBeNull();
		expect(message(target)).toBe('Geöffnet: d.mmd');
	});
});

describe('Shell C3: Export-Dialog', () => {
	const VIEWBOX =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>x</text></svg>';

	it('SVG aus Mermaid-Render als Download, Abbrechen schließt', async () => {
		const { env, blobs, names } = fakeEnv();
		const { target } = await mountShell(TWO, { fileEnv: env });
		click(button(target, 'Export'));
		const form = dialog()!;
		expect(form.getAttribute('aria-modal')).toBe('true');
		click(dialogButton('Abbrechen'));
		expect(dialog()).toBeNull();
		click(button(target, 'Export'));
		click(dialogButton('Exportieren'));
		await settle();
		expect(names).toEqual(['diagramm.svg']);
		expect(blobs[0].type).toBe('image/svg+xml');
		expect(message(target)).toBe('Exportiert: diagramm.svg');
	});

	it('PNG mit Maßstab über den Rasterizer, Fehler als Meldung', async () => {
		const { env, names } = fakeEnv();
		const rasterize = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
		const { target } = await mountShell(TWO, {
			fileEnv: env,
			rasterize,
			render: async () => ({ ok: true, svg: VIEWBOX })
		});
		click(button(target, 'Export'));
		click(dialog()!.querySelector<HTMLInputElement>('input[value="png"]')!);
		const select = dialog()!.querySelector('select')!;
		select.value = '2';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		click(dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
		click(dialogButton('Exportieren'));
		await settle();
		expect(rasterize).toHaveBeenCalledWith(
			expect.objectContaining({ scale: 2, background: '#ffffff' })
		);
		expect(names).toEqual(['diagramm.png']);
		rasterize.mockRejectedValueOnce(new Error('Canvas fehlt'));
		click(button(target, 'Export'));
		click(dialog()!.querySelector<HTMLInputElement>('input[value="png"]')!);
		click(dialogButton('Exportieren'));
		await settle();
		expect(message(target)).toBe('Canvas fehlt');
	});

	it('PNG ohne viewBox und Render-Fehler: Meldung statt Download', async () => {
		const { env, names } = fakeEnv();
		let broken = false;
		const { target } = await mountShell(TWO, {
			fileEnv: env,
			rasterize: vi.fn(),
			render: async () =>
				broken ? { ok: false, error: { message: 'Render kaputt' } } : { ok: true, svg: SVG }
		});
		click(button(target, 'Export'));
		click(dialog()!.querySelector<HTMLInputElement>('input[value="png"]')!);
		click(dialogButton('Exportieren'));
		await settle();
		expect(message(target)).toBe('SVG ohne gültige viewBox.');
		broken = true;
		click(button(target, 'Export'));
		click(dialogButton('Exportieren'));
		await settle();
		expect(message(target)).toBe('Render kaputt');
		expect(names).toEqual([]);
	});

	it('Editor-SVG wählbar bei Graph; Markdown in die Zwischenablage', async () => {
		const { env, blobs } = fakeEnv();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const { target } = await mountShell(TWO, { fileEnv: env });
		click(button(target, 'Export'));
		const editor = dialog()!.querySelector<HTMLInputElement>('input[value="editor"]')!;
		expect(editor.disabled).toBe(false);
		click(editor);
		click(dialogButton('Exportieren'));
		await settle();
		expect(await blobs[0].text()).toContain('<svg');
		click(button(target, 'Export'));
		click(dialog()!.querySelector<HTMLInputElement>('input[value="markdown"]')!);
		click(dialogButton('Exportieren'));
		await settle();
		expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^```mermaid\nflowchart LR/));
		expect(message(target)).toMatch(/^Als Markdown kopiert\./);
		writeText.mockRejectedValueOnce(new Error('verweigert'));
		click(button(target, 'Export'));
		click(dialog()!.querySelector<HTMLInputElement>('input[value="markdown"]')!);
		click(dialogButton('Exportieren'));
		await settle();
		expect(message(target)).toBe('Export fehlgeschlagen: verweigert');
	});

	it('Sequenz: Editor-SVG wählbar, Auswahl-Export gesperrt', async () => {
		const { env, blobs } = fakeEnv();
		const { target } = await mountShell(SEQ, { fileEnv: env });
		click(button(target, 'Export'));
		const editor = dialog()!.querySelector<HTMLInputElement>('input[value="editor"]')!;
		expect(editor.disabled).toBe(false);
		click(editor);
		flushSync();
		const boxes = dialog()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
		expect(boxes).toHaveLength(2);
		expect(boxes[1].disabled).toBe(true);
		click(dialogButton('Exportieren'));
		await settle();
		const svg = await blobs[0].text();
		expect(svg).toMatch(/^<svg xmlns=/);
		expect(svg).toContain('class="lifeline"');
		expect(svg).toContain('>hi</text>');
		press(target, 'Escape');
	});
});

describe('Shell C3: Löschen-Rückfrage (D-10)', () => {
	const memory = () => {
		const data = new Map<string, string>();
		return {
			data,
			storage: () => ({
				getItem: (k: string) => data.get(k) ?? null,
				setItem: (k: string, v: string) => void data.set(k, v)
			})
		};
	};

	it('Knoten mit Kante fragt; Abbrechen behält, "Nicht mehr fragen" speichert', async () => {
		const { data, storage } = memory();
		const { sync, target } = await mountShell(LINKED, { storage });
		const node = nodeEl(target, 'A')!;
		node.focus();
		press(node, 'Delete');
		await settle();
		expect(text(dialog()!.querySelector('h2'))).toBe('Löschen bestätigen');
		click(dialogButton('Abbrechen'));
		await settle();
		expect(docOf(sync).nodes).toHaveLength(2);
		nodeEl(target, 'A')!.focus();
		press(nodeEl(target, 'A')!, 'Delete');
		await settle();
		click(dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
		click(dialogButton('Löschen'));
		await settle();
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['B']);
		expect(data.get(CONFIRM_KEY)).toBe('false');
	});

	it('Shift-Entf ohne Rückfrage; Storage-Fehler hält die Rückfrage aktiv', async () => {
		const storage = () => {
			throw new Error('SecurityError');
		};
		const { sync, target } = await mountShell('flowchart LR\n  A --> B\n  B --> C\n', {
			storage
		});
		nodeEl(target, 'A')!.focus();
		press(nodeEl(target, 'A')!, 'Delete', { shiftKey: true });
		await settle();
		expect(dialog()).toBeNull();
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['B', 'C']);
		nodeEl(target, 'B')!.focus();
		press(nodeEl(target, 'B')!, 'Delete');
		await settle();
		click(dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
		click(dialogButton('Löschen'));
		await settle();
		expect(message(target)).toBe('Einstellung nicht gespeichert: die Rückfrage bleibt aktiv.');
	});

	it('Sequenz: Teilnehmer mit Nachrichten fragt ebenfalls', async () => {
		const { storage } = memory();
		const { sync, target } = await mountShell(SEQ, { storage });
		const a = target.querySelector<HTMLElement>('.sequence-canvas [data-id="A"]')!;
		a.focus();
		press(a, 'Delete');
		await settle();
		expect(text(dialog()!.querySelector('h2'))).toBe('Löschen bestätigen');
		click(dialogButton('Löschen'));
		await settle();
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['B']);
	});
});

describe('Shell C3: Fehlerlisten-Sprung auf Canvas-Elemente (P3 a)', () => {
	it('Graph: Modell-Befund wählt das Element im Canvas', async () => {
		const { sync, target } = await mountShell(LINKED);
		await sync.execute({
			label: 'x',
			do: (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === 'A' ? n : { ...n, id: 'A' })) })
		});
		await settle();
		const entry = [
			...target.querySelectorAll<HTMLButtonElement>('[aria-label="Fehlerliste"] button')
		].find((b) => !b.disabled)!;
		click(entry);
		await settle();
		expect(nodeEl(target, 'A')!.classList.contains('selected')).toBe(true);
	});
});
