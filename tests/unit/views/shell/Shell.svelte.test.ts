// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BAD, rename } from '../../controllers/sync/helpers';
import { installBrowserStubs } from '../canvas/helpers';
import { DRAG_TYPE } from '../../../../src/lib/views/shell/palette';
import { lockedReason } from '../../../../src/lib/views/shell/panels';
import { button, docOf, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(unmountShells);

const EMPTY = 'flowchart TD\n';
/** Modus manual: nur dort speichert createNode die Klick-/Drop-Position (O-48). */
const EMPTY_MANUAL = EMPTY + '%% @mermuid: {"v":1,"layout":"manual","pos":{}}\n';
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function click(el: Element) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 24 }));
	flushSync();
}

function drop(target: Element, data: string) {
	const store: Record<string, string> = { [DRAG_TYPE]: data };
	const dataTransfer = {
		types: Object.keys(store),
		getData: (t: string) => store[t] ?? '',
		setData: (t: string, v: string) => (store[t] = v),
		dropEffect: 'none',
		effectAllowed: 'all'
	};
	for (const type of ['dragover', 'drop']) {
		const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 16, clientY: 8 });
		Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
		target.dispatchEvent(e);
		if (type === 'dragover') expect(e.defaultPrevented).toBe(true);
	}
	flushSync();
}

describe('Shell C1: Layout nach Wireframe §5', () => {
	it('Toolbar, Palette, Canvas, rechte Tabs, Fehlerliste, Statuszeile', async () => {
		const { target } = await mountShell(EMPTY);
		expect(target.querySelector('[role="toolbar"]')).not.toBeNull();
		expect(target.querySelector('nav[aria-label="Palette"]')).not.toBeNull();
		expect(target.querySelector('.graph-canvas')).not.toBeNull();
		const tabs = [...target.querySelectorAll('[role="tab"]')];
		expect(tabs.map((t) => [text(t), t.getAttribute('aria-selected')])).toEqual([
			['Eigenschaften', 'true'],
			['Code', 'false']
		]);
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(true);
		expect(target.querySelector('[aria-label="Fehlerliste"]')).not.toBeNull();
		expect(text(target.querySelector('.statusbar'))).toBe(
			'Parser: OK Sync: Grafik=Code Layout: automatisch Z -:-'
		);
	});

	it('Datei- und Export-Buttons sind beschriftet und aktiv (C3)', async () => {
		const { target } = await mountShell(EMPTY);
		for (const label of ['Neu', 'Öffnen', 'Speichern', 'Export', 'Hilfe']) {
			expect(button(target, label).disabled).toBe(false);
		}
		expect(text(target.querySelector('[data-testid="file"]'))).toBe('Datei: diagramm.mmd');
		expect(text(target.querySelector('[data-testid="type"]'))).toBe('Typ: flowchart');
	});

	it('Code ein/aus klappt das Code-Panel auf und zu', async () => {
		const { target } = await mountShell(EMPTY);
		const toggle = button(target, 'Code ein/aus');
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		click(toggle);
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(false);
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		click(button(target, 'Eigenschaften'));
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(true);
	});

	it('Klick-dann-Klick legt Knoten an, Undo/Redo über Sync', async () => {
		const { sync, target } = await mountShell(EMPTY_MANUAL);
		expect(button(target, 'Rückgängig').disabled).toBe(true);
		const tool = button(target, 'Raute (Entscheidung)');
		click(tool);
		expect(tool.getAttribute('aria-pressed')).toBe('true');
		click(target.querySelector('.svelte-flow__pane')!);
		await settle();
		expect(docOf(sync).nodes.map((n) => n.shape)).toEqual(['diamond']);
		expect(docOf(sync).layout.positions[docOf(sync).nodes[0].id]).toEqual([40, 24, 80, 42]);
		expect(tool.getAttribute('aria-pressed')).toBe('false');
		click(button(target, 'Rückgängig'));
		await settle();
		expect(docOf(sync).nodes).toHaveLength(0);
		click(button(target, 'Wiederholen'));
		await settle();
		expect(docOf(sync).nodes).toHaveLength(1);
	});

	it('Klick auf Knoten mit aktivem Werkzeug legt nichts an; Esc löst', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		const tool = button(target, 'Kreis');
		click(tool);
		click(target.querySelector('.svelte-flow__node')!);
		await settle();
		expect(docOf(sync).nodes).toHaveLength(1);
		target
			.querySelector('nav[aria-label="Palette"]')!
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(tool.getAttribute('aria-pressed')).toBe('false');
	});

	it('Drag-and-Drop aus der Palette legt Vorlage an der Drop-Position an', async () => {
		const { sync, target } = await mountShell(EMPTY_MANUAL);
		const item = button(target, 'Vorlage: Ablauf');
		expect(item.draggable).toBe(true);
		const start = new MouseEvent('dragstart', { bubbles: true });
		const set = vi.fn();
		Object.defineProperty(start, 'dataTransfer', { value: { setData: set, effectAllowed: '' } });
		item.dispatchEvent(start);
		expect(set).toHaveBeenCalledWith(DRAG_TYPE, 'template:linear');
		drop(target.querySelector('.shell-canvas')!, 'template:linear');
		await settle();
		const doc = docOf(sync);
		expect(doc.nodes.map((n) => n.label)).toEqual(['Start', 'Schritt', 'Ende']);
		expect(doc.edges).toHaveLength(2);
		expect(doc.layout.positions[doc.nodes[0].id]).toEqual([16, 8, 80, 42]);
	});

	it('Drop mit unbekanntem Werkzeug ändert nichts', async () => {
		const { sync, target } = await mountShell(EMPTY);
		drop(target.querySelector('.shell-canvas')!, 'fehlt');
		await settle();
		expect(docOf(sync).nodes).toHaveLength(0);
	});

	it('abgelehnter Command erscheint als Meldung, kein Absturz', async () => {
		const { sync, target } = await mountShell(EMPTY);
		vi.spyOn(sync, 'execute').mockRejectedValueOnce(new Error('kaputt'));
		click(button(target, 'Container (Subgraph)'));
		click(target.querySelector('.svelte-flow__pane')!);
		await settle();
		expect(text(target.querySelector('[data-testid="message"]'))).toBe(
			'Container anlegen fehlgeschlagen: kaputt'
		);
		vi.spyOn(sync, 'undo').mockRejectedValueOnce('weg');
		click(button(target, 'Rückgängig'));
		await settle();
		expect(text(target.querySelector('[data-testid="message"]'))).toBe(
			'Rückgängig fehlgeschlagen: weg'
		);
	});

	it('Zoom und Einpassen sind Buttons mit Label', async () => {
		const { target } = await mountShell(EMPTY);
		for (const label of ['Zoom - verkleinern', 'Zoom + vergrößern', 'Einpassen']) {
			const b = button(target, label);
			expect(b.disabled).toBe(false);
			expect(() => click(b)).not.toThrow();
		}
	});

	it('zugänglicher Name beginnt mit dem sichtbaren Text (WCAG 2.5.3)', async () => {
		const { target } = await mountShell(EMPTY);
		for (const b of target.querySelectorAll('button')) {
			const label = b.getAttribute('aria-label');
			if (label !== null) expect(label.startsWith(text(b))).toBe(true);
		}
		expect(button(target, 'Mermaid-Vorschau einklappen').hasAttribute('aria-label')).toBe(false);
	});

	it('Auswahl im Canvas speist das Eigenschaften-Panel', async () => {
		const { target } = await mountShell('flowchart TD\n  A[Alpha]\n');
		click(target.querySelector('.svelte-flow__node')!);
		await settle();
		const field = target.querySelector<HTMLInputElement>('#shell-properties input');
		expect(field?.value).toBe('Alpha');
	});

	it('Mehrfachauswahl: Eigenschaften zeigen die erste ID (O-29)', async () => {
		const { target } = await mountShell('flowchart LR\n  A[Alpha] --> B[Beta]\n');
		const [a, b] = target.querySelectorAll('.svelte-flow__node');
		click(a);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
		b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
		window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
		flushSync();
		await settle();
		expect(target.querySelectorAll('.svelte-flow__node.selected')).toHaveLength(2);
		const field = target.querySelector<HTMLInputElement>('#shell-properties input');
		expect(field?.value).toBe('Alpha');
	});
});

describe('Shell C2', () => {
	it('Banner bei ungültigem Code, nicht-modal, mit drei Wahlen', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		expect(target.querySelector('.banner')).toBeNull();
		sync.editCode(`flowchart TD\n  A\n  ${BAD}\n`);
		await sync.flush();
		await settle();
		const hint = target.querySelector('.banner')!;
		expect(hint.getAttribute('role')).toBe('status');
		expect(hint.querySelectorAll('button')).toHaveLength(1);
		await sync.execute(rename('A', 'Neu'));
		await settle();
		const banner = target.querySelector('.banner')!;
		expect(banner.getAttribute('role')).toBe('alert');
		expect(banner.getAttribute('aria-modal')).toBeNull();
		expect(text(banner)).toContain('Ungültiger Code in Zeile 3, Spalte 1: ');
		expect(text(target.querySelector('.statusbar'))).toContain('Parser: Fehler in Zeile 3');
		const keep = vi.spyOn(sync, 'keepCode').mockResolvedValueOnce();
		click(button(target, 'Code behalten'));
		expect(keep).toHaveBeenCalledOnce();
		click(button(target, 'Diff ansehen'));
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(false);
		await settle();
		const region = target.querySelector(
			'[role="region"][aria-label="Unterschiede Code und Grafik"]'
		);
		expect(region).not.toBeNull();
		expect(document.activeElement).toBe(region);
		click(button(target, 'Grafik behalten'));
		await settle();
		expect(target.querySelector('.banner')).toBeNull();
	});

	it('Banner-Aktion abgelehnt: Meldung', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		sync.editCode(`flowchart TD\n  ${BAD}\n`);
		await sync.flush();
		await sync.execute(rename('A', 'Neu'));
		await settle();
		vi.spyOn(sync, 'keepGraphic').mockRejectedValueOnce(new Error('nein'));
		click(button(target, 'Grafik behalten'));
		await settle();
		expect(text(target.querySelector('[data-testid="message"]'))).toBe(
			'Grafik behalten fehlgeschlagen: nein'
		);
	});

	it('Vorschau-Streifen rendert Code und ist einklappbar', async () => {
		const { target, render } = await mountShell('flowchart TD\n  A\n');
		await settle();
		expect(render).toHaveBeenLastCalledWith('flowchart TD\n  A\n');
		const strip = target.querySelector('.preview-body')!;
		expect(strip.querySelector('svg')).not.toBeNull();
		const toggle = button(target, 'Mermaid-Vorschau einklappen');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.disabled).toBe(false);
		expect(toggle.hasAttribute('aria-describedby')).toBe(false);
		click(toggle);
		expect(target.querySelector('.preview-body')).toBeNull();
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(text(toggle)).toBe('Mermaid-Vorschau ausklappen');
	});

	it('Layout-Umschalter Auto/Manuell über Sync', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		const manual = button(target, 'Manuell');
		click(manual);
		await settle();
		expect(docOf(sync).layout.mode).toBe('manual');
		expect(manual.getAttribute('aria-pressed')).toBe('true');
		expect(text(target.querySelector('.statusbar'))).toContain('Layout: manuell');
		click(button(target, 'Auto'));
		await settle();
		expect(docOf(sync).layout.mode).toBe('auto');
	});

	it('Klick auf aktiven Layout-Modus erzeugt keinen Undo-Schritt', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		const execute = vi.spyOn(sync, 'execute');
		click(button(target, 'Auto'));
		await settle();
		expect(execute).not.toHaveBeenCalled();
		expect(button(target, 'Rückgängig').disabled).toBe(true);
	});

	it('übrige Typen: nur Code mit Vorschau und offenem Code-Panel', async () => {
		const { target, render } = await mountShell('pie title Haus\n  "A" : 1\n');
		await settle();
		expect(text(target.querySelector('[data-testid="type"]'))).toBe('Typ: pie (nur Code)');
		expect(target.querySelector('nav[aria-label="Palette"]')).toBeNull();
		expect(target.querySelector('.graph-canvas')).toBeNull();
		expect(text(target.querySelector('.shell-canvas'))).toContain('nur als Code');
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(false);
		expect(render).toHaveBeenCalled();
		expect(button(target, 'Auto').disabled).toBe(true);
		expect(button(target, 'Zoom + vergrößern').disabled).toBe(true);
		for (const b of [
			button(target, 'Code ein/aus'),
			button(target, 'Mermaid-Vorschau einklappen')
		]) {
			expect(b.disabled).toBe(true);
			expect(b.title).toBe(lockedReason());
			expect(text(document.getElementById(b.getAttribute('aria-describedby')!))).toBe(
				lockedReason()
			);
		}
		expect(text(target.querySelector('.statusbar'))).toContain('Sync: nur Code');
	});

	it('Sequenz: Weiche auf den Sequenz-Canvas (C3)', async () => {
		const { target } = await mountShell('sequenceDiagram\n  A->>B: hi\n');
		expect(text(target.querySelector('[data-testid="type"]'))).toBe('Typ: sequenceDiagram');
		expect(target.querySelector('.shell-canvas .sequence-canvas')).not.toBeNull();
		expect(target.querySelector('.graph-canvas')).toBeNull();
		expect(target.querySelector('nav[aria-label="Palette"]')).toBeNull();
	});

	it('Fehlerliste: Sprung auf Zeile öffnet Code', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		sync.editCode(`flowchart TD\n  ${BAD}\n`);
		await sync.flush();
		await settle();
		const entry = target.querySelector<HTMLButtonElement>('[aria-label="Fehlerliste"] button')!;
		click(entry);
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(false);
	});

	it('Fehlerliste: ein Klick bei geschlossenem Code-Tab fokussiert Zeile:Spalte', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		sync.editCode(`flowchart TD\n  A\n  ${BAD}\n`);
		await sync.flush();
		await settle();
		const box = target.querySelector<HTMLElement>('#shell-code')!;
		expect(box.hidden).toBe(true);
		// Fokus auf ein verborgenes Panel wirkt im Browser nicht: Zustand beim Fokus-Aufruf merken.
		const hiddenAtFocus: boolean[] = [];
		const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
			this: HTMLElement
		) {
			hiddenAtFocus.push(box.hasAttribute('hidden'));
			this.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		});
		click(target.querySelector<HTMLButtonElement>('[aria-label="Fehlerliste"] button')!);
		await settle();
		focus.mockRestore();
		expect(hiddenAtFocus).toEqual([false]);
		expect(text(target.querySelector('.statusbar'))).toContain('Z 3:1');
	});

	it('Banner-Zeilen-Link springt auf Zeile:Spalte des ersten Fehlers', async () => {
		const { sync, target } = await mountShell('flowchart TD\n  A\n');
		sync.editCode(`flowchart TD\n  A\n  ${BAD}\n`);
		await sync.flush();
		await settle();
		const banner = target.querySelector('.banner')!;
		expect(text(banner)).toContain(
			'Ungültiger Code in Zeile 3, Spalte 1: Syntaxfehler. Die Grafik zeigt den letzten gültigen Stand.'
		);
		const link = button(target, 'Zeile 3, Spalte 1');
		expect(banner.contains(link)).toBe(true);
		click(link);
		await settle();
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(false);
		expect(target.querySelector('.cm-content')!.contains(document.activeElement)).toBe(true);
		expect(text(target.querySelector('.statusbar'))).toContain('Z 3:1');
	});

	it('Zeile:Spalte folgt dem Cursor im Code-Panel', async () => {
		const { target } = await mountShell('flowchart TD\n  A\n');
		click(button(target, 'Code ein/aus'));
		const { EditorView } = await import('@codemirror/view');
		const view = EditorView.findFromDOM(target.querySelector<HTMLElement>('.cm-editor')!)!;
		view.dispatch({ selection: { anchor: 16 } });
		target
			.querySelector('#shell-code')!
			.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
		flushSync();
		expect(text(target.querySelector('.statusbar'))).toContain('Z 2:4');
	});
});
