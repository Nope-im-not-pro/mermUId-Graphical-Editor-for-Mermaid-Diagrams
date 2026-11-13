// @vitest-environment jsdom
// T101 C3 Integration W21: Speichern übergibt BOM und erwarteten Stand (O-57, T102);
// Fehler-Variante des Banners liegt in der Canvas-Fläche, Konflikt-Variante darüber (O-58/O-50, T104).
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileEnv, FileHandleLike } from '../../../../src/lib/services/file';
import { BAD, rename } from '../../controllers/sync/helpers';
import { installBrowserStubs, nodeEl } from '../canvas/helpers';
import { button, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(() => {
	unmountShells();
	vi.restoreAllMocks();
});

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const message = (target: HTMLElement) => text(target.querySelector('[data-testid="message"]'));

function click(el: Element) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	flushSync();
}

/** Datei auf "Platte": Inhalt und Stand änderbar; Schreibvorgänge werden mitgeschrieben. */
function diskFile(name: string, content: string) {
	const disk: { bytes: Uint8Array; lastModified: number } = {
		bytes: new TextEncoder().encode(content),
		lastModified: 1000
	};
	const writes: Uint8Array[] = [];
	const handle: FileHandleLike = {
		name,
		getFile: async () =>
			new File([disk.bytes as BlobPart], name, { lastModified: disk.lastModified }),
		createWritable: async () => ({
			write: async (data) => {
				writes.push(data as Uint8Array);
				disk.bytes = data as Uint8Array;
				disk.lastModified += 1;
			},
			close: async () => {}
		})
	};
	const env: FileEnv = {
		showOpenFilePicker: async () => [handle],
		showSaveFilePicker: async () => handle,
		document,
		createObjectURL: () => 'blob:x',
		revokeObjectURL: () => {}
	};
	return { disk, writes, env };
}

/** Öffnet die Datei über den Open-Picker (liefert Handle und Stand); Speichern geht übers Handle. */
async function openVia(env: FileEnv) {
	const mounted = await mountShell('flowchart LR\n  A\n', { fileEnv: env });
	click(button(mounted.target, 'Öffnen'));
	await settle();
	expect(nodeEl(mounted.target, 'Z')).not.toBeNull();
	return mounted;
}

describe('T101 C3: Speichern mit BOM und erwartetem Stand (O-57)', () => {
	it('BOM der geöffneten Datei bleibt beim Speichern erhalten', async () => {
		const file = diskFile('bom.mmd', '﻿flowchart TD\n  Z\n');
		const { target } = await openVia(file.env);
		click(button(target, 'Speichern'));
		await settle();
		expect(file.writes).toHaveLength(1);
		expect([...file.writes[0].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		expect(message(target)).toBe('Gespeichert: bom.mmd');
	});

	it('extern geänderte Datei: kein Schreiben, Fehlermeldung', async () => {
		const file = diskFile('ext.mmd', 'flowchart TD\n  Z\n');
		const { target } = await openVia(file.env);
		file.disk.lastModified = 5000;
		click(button(target, 'Speichern'));
		await settle();
		expect(file.writes).toEqual([]);
		expect(message(target)).toBe(
			'Datei wurde außerhalb der App geändert. Nicht gespeichert, um die Änderung nicht zu überschreiben.'
		);
	});
});

const errorBanner = (target: HTMLElement) =>
	target.querySelector('.shell-canvas .banner') as HTMLElement | null;

async function invalid(code: string) {
	const mounted = await mountShell(code);
	mounted.sync.editCode(`${code}${BAD}\n`);
	await mounted.sync.flush();
	await settle();
	return mounted;
}

describe('T101 C3: Platzierung des Fehler-Banners (O-58/O-50)', () => {
	it('Graph: Fehler-Variante in der Canvas-Fläche, nur einmal', async () => {
		const { target } = await invalid('flowchart TD\n  A\n');
		expect(errorBanner(target)).not.toBeNull();
		expect(target.querySelectorAll('.banner')).toHaveLength(1);
	});

	it('Sequenz: Fehler-Variante in der Canvas-Fläche', async () => {
		const { target } = await invalid('sequenceDiagram\n  A->>B: hallo\n');
		expect(errorBanner(target)).not.toBeNull();
		expect(target.querySelectorAll('.banner')).toHaveLength(1);
	});

	it('Konflikt-Variante bleibt oberhalb des Hauptbereichs', async () => {
		const { sync, target } = await invalid('flowchart TD\n  A\n');
		await sync.execute(rename('A', 'Neu'));
		await settle();
		const banner = target.querySelector('.banner');
		expect(banner).not.toBeNull();
		expect(errorBanner(target)).toBeNull();
		expect(banner!.closest('.main')).toBeNull();
		expect(button(target, 'Code behalten')).toBeTruthy();
	});
});

/** Feste Boxen je Element (jsdom kennt kein Layout): Fläche 0..800 x 100..600. */
function layoutBoxes(boxes: Record<string, Partial<DOMRect>>) {
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		const hit = Object.keys(boxes).find((sel) => this.matches(sel));
		return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...boxes[hit!] } as DOMRect;
	});
}

const BOX = { top: 100, left: 0, right: 800, bottom: 600, width: 800, height: 500 };
const px = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);

describe('T101 C3 I2: Fehlerhinweis ohne Überdeckung von Bedienelementen', () => {
	it('Graph: unten, Live-Region polite, ohne title', async () => {
		const { target } = await invalid('flowchart TD\n  A\n');
		const hint = errorBanner(target)!;
		expect(hint.classList.contains('bottom')).toBe(true);
		expect(hint.classList.contains('top')).toBe(false);
		expect(hint.getAttribute('role')).toBe('status');
		expect(hint.getAttribute('aria-live')).toBe('polite');
		expect(hint.hasAttribute('title')).toBe(false);
	});

	it('Sequenz: oben, Live-Region polite', async () => {
		const { target } = await invalid('sequenceDiagram\n  A->>B: hallo\n');
		const hint = errorBanner(target)!;
		expect(hint.classList.contains('top')).toBe(true);
		expect(hint.classList.contains('bottom')).toBe(false);
		expect(hint.getAttribute('aria-live')).toBe('polite');
	});

	it('Sequenz: Hinweis beginnt unterhalb der Werkzeugleiste', async () => {
		layoutBoxes({
			'.shell-canvas': BOX,
			'.sequence-canvas > .toolbar': { top: 100, bottom: 172, width: 800, height: 72 }
		});
		const { target } = await invalid('sequenceDiagram\n  A->>B: hallo\n');
		expect(px(errorBanner(target)!, '--banner-top')).toBe('80px');
	});

	it('Graph: Abstand zu Controls/Rohblöcken links und Vorschau rechts', async () => {
		layoutBoxes({
			'.shell-canvas': BOX,
			'.svelte-flow__panel.bottom.left': { left: 15, right: 41, width: 26, height: 80 },
			'.preview': { left: 566, right: 786, width: 220, height: 30 }
		});
		const { target } = await invalid('flowchart TD\n  A\n');
		const hint = errorBanner(target)!;
		expect(px(hint, '--banner-left')).toBe('49px');
		expect(px(hint, '--banner-right')).toBe('242px');
	});

	it('Graph, schmale Fläche: Ränder statt Abstände, damit der Zeilen-Link sichtbar bleibt', async () => {
		layoutBoxes({
			'.shell-canvas': { ...BOX, right: 360, width: 360 },
			'.svelte-flow__panel.bottom.left': { left: 15, right: 41, width: 26, height: 80 },
			'.preview': { left: 126, right: 346, width: 220, height: 30 }
		});
		const { target } = await invalid('flowchart TD\n  A\n');
		const hint = errorBanner(target)!;
		expect(px(hint, '--banner-left')).toBe('8px');
		expect(px(hint, '--banner-right')).toBe('8px');
	});
});
