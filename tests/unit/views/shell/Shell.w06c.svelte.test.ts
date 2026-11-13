// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import type { FileEnv, FileHandleLike } from '../../../../src/lib/services/file';
import { place } from '../../controllers/sync/helpers';
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
const LABELED = 'flowchart LR\n  A[Start]\n  B[Ende]\n  C\n';
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

async function placed(sync: { execute: (c: Command) => Promise<unknown> }, ids = ['A', 'B']) {
	for (const [i, id] of ids.entries()) await sync.execute(place(id, [i * 200, 0, 80, 40]));
	await settle();
}

async function dropFile(target: HTMLElement, file: File) {
	const shell = target.querySelector('.shell')!;
	const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
	for (const type of ['dragover', 'drop']) {
		const e = new MouseEvent(type, { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
		shell.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(true);
	}
	await settle();
}

describe('Shell W06 C: Verbinden-Status', () => {
	it('zeigt das Label des Ziels, ohne Label die ID', async () => {
		const { sync, target } = await mountShell(LABELED);
		await placed(sync, ['A', 'B', 'C']);
		const el = canvas(target);
		press(el, 'Tab');
		await settle();
		press(el, 'c');
		press(el, 'ArrowRight');
		expect(message(target)).toBe('Verbinden: Ziel Ende, Enter bestätigt.');
		press(el, 'Escape');
		press(el, 'Tab');
		await settle();
		press(el, 'c');
		press(el, 'ArrowRight');
		expect(message(target)).toBe('Verbinden: Ziel C, Enter bestätigt.');
	});
});

describe('Shell W06 C: Typwechsel setzt Werkzeugzustand zurück', () => {
	it('flowchart -> sequence -> flowchart: Palette, Verbinden und Suche ruhen', async () => {
		const { sync, target } = await mountShell(TWO);
		await placed(sync);
		const el = canvas(target);
		press(el, 'Tab');
		await settle();
		press(el, 'c');
		click(button(target, 'Suchen'));
		await settle();
		click(target.querySelector('.palette button')!);
		expect(target.querySelector('.shell-canvas.armed')).not.toBeNull();
		expect(target.querySelector('[role="search"]')).not.toBeNull();
		const code = docOf(sync);
		expect(code.nodes).toHaveLength(2);
		sync.editCode(SEQ);
		await sync.flush();
		await settle();
		expect(target.querySelector('.sequence-canvas')).not.toBeNull();
		sync.editCode(TWO);
		await sync.flush();
		await settle();
		expect(target.querySelector('.graph-canvas')).not.toBeNull();
		expect(target.querySelector('.shell-canvas.armed')).toBeNull();
		expect(target.querySelector('[role="search"]')).toBeNull();
		const before = message(target);
		expect(press(canvas(target), 'Enter').defaultPrevented).toBe(false);
		expect(message(target)).toBe(before);
	});
});

describe('Shell W06 C: Datei-Drop bei offenem Dialog', () => {
	it('Drop während der Lösch-Rückfrage wird ignoriert, die Rückfrage bleibt gültig', async () => {
		const { sync, target } = await mountShell(LINKED);
		sync.editCode('flowchart LR\n  A --> B\n  C\n');
		await sync.flush();
		await settle();
		nodeEl(target, 'A')!.focus();
		press(nodeEl(target, 'A')!, 'Delete');
		await settle();
		expect(text(dialog()!.querySelector('h2'))).toBe('Löschen bestätigen');
		await dropFile(target, new File(['flowchart TD\n  D\n'], 'd.mmd'));
		expect(text(dialog()!.querySelector('h2'))).toBe('Löschen bestätigen');
		click(dialogButton('Löschen'));
		await settle();
		expect(dialog()).toBeNull();
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['B', 'C']);
		expect(nodeEl(target, 'D')).toBeNull();
	});
});

describe('Shell W06 C: Canvas-Fokus nur Wrapper oder Knoten', () => {
	it('Fokus auf Raster-/Controls-Button: Tab, G, C und Shift-Pfeil bleiben beim Browser', async () => {
		const { sync, target } = await mountShell(TWO);
		const raster = button(target, 'Raster');
		raster.focus();
		expect(press(raster, 'Tab').defaultPrevented).toBe(false);
		expect(press(raster, 'g').defaultPrevented).toBe(false);
		expect(press(raster, 'G', { shiftKey: true }).defaultPrevented).toBe(false);
		expect(press(raster, 'c').defaultPrevented).toBe(false);
		expect(press(raster, 'ArrowRight', { shiftKey: true }).defaultPrevented).toBe(false);
		expect(press(raster, 'a', { ctrlKey: true }).defaultPrevented).toBe(false);
		await settle();
		expect(docOf(sync).layout.snap).toBe(false);
		const control = target.querySelector<HTMLButtonElement>('.svelte-flow__controls button')!;
		control.focus();
		expect(press(control, 'Tab').defaultPrevented).toBe(false);
		const node = nodeEl(target, 'A')!;
		node.focus();
		expect(press(node, 'g').defaultPrevented).toBe(true);
		expect(press(canvas(target), 'Tab').defaultPrevented).toBe(true);
	});
});

describe('Shell W06 C: Verbinden-Modus nur bei Canvas-Fokus', () => {
	it('Pfeil/Enter/Esc im Eingabefeld gehen an das Feld', async () => {
		const { sync, target } = await mountShell(TWO);
		await placed(sync);
		const el = canvas(target);
		press(el, 'Tab');
		await settle();
		press(el, 'c');
		const input = document.createElement('input');
		target.querySelector('.shell')!.append(input);
		input.focus();
		for (const key of ['ArrowRight', 'Enter', 'Escape']) {
			expect(press(input, key).defaultPrevented, key).toBe(false);
		}
		await settle();
		expect(message(target)).not.toBe('Verbinden: Ziel B, Enter bestätigt.');
		expect(docOf(sync).edges).toEqual([]);
		input.remove();
	});
});

describe('Shell W06 C: Speichern während Öffnen', () => {
	it('Abschluss des Speicherns überschreibt die neu geöffnete Datei nicht', async () => {
		let finish!: () => void;
		const pending = new Promise<void>((r) => (finish = r));
		const saved: FileHandleLike = {
			name: 'alt.mmd',
			getFile: async () => new File([''], 'alt.mmd'),
			createWritable: async () => ({ write: async () => {}, close: async () => {} })
		};
		const env: FileEnv = {
			document,
			createObjectURL: () => 'blob:x',
			revokeObjectURL: () => {},
			showSaveFilePicker: async () => {
				await pending;
				return saved;
			},
			showOpenFilePicker: async () => [
				{ name: 'neu.mmd', getFile: async () => new File(['flowchart TD\n  N\n'], 'neu.mmd') }
			]
		};
		const { target } = await mountShell(TWO, { fileEnv: env });
		click(button(target, 'Speichern'));
		await settle();
		click(button(target, 'Öffnen'));
		await settle();
		expect(text(target.querySelector('[data-testid="file"]'))).toBe('Datei: neu.mmd');
		finish();
		await settle();
		expect(text(target.querySelector('[data-testid="file"]'))).toBe('Datei: neu.mmd');
		expect(nodeEl(target, 'N')).not.toBeNull();
	});
});

describe('Shell W06 C: Fokus auf einer Kante gilt als Canvas-Fokus', () => {
	it('Tab läuft über cycle, Strg-A und G wirken', async () => {
		const { sync, target } = await mountShell(LINKED);
		await placed(sync);
		const edge = () => target.querySelector<HTMLElement>('.graph-canvas .svelte-flow__edge')!;
		expect(edge()).not.toBeNull();
		edge().focus();
		expect(document.activeElement).toBe(edge());
		expect(press(edge(), 'Tab').defaultPrevented).toBe(true);
		await settle();
		expect(nodeEl(target, 'A')!.classList.contains('selected')).toBe(true);
		edge().focus();
		expect(press(edge(), 'a', { ctrlKey: true }).defaultPrevented).toBe(true);
		await settle();
		expect(nodeEl(target, 'A')!.classList.contains('selected')).toBe(true);
		expect(nodeEl(target, 'B')!.classList.contains('selected')).toBe(true);
		edge().focus();
		expect(press(edge(), 'g').defaultPrevented).toBe(true);
		expect(target.querySelector('.svelte-flow__background')).toBeNull();
	});
});
