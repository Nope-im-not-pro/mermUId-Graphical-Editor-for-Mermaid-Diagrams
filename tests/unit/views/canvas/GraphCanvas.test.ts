// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	SAMPLE,
	docOf,
	installBrowserStubs,
	mountCanvas,
	nodeEl,
	settle,
	unmountAll
} from './helpers';
import { setLayoutOption } from '../../../../src/lib/views/canvas/graph/commands';

beforeAll(installBrowserStubs);
afterEach(unmountAll);

const setup = mountCanvas;
/** Meta-Zeile: Modus manual ohne gespeicherte Positionen (O-48: nur dort Klickposition). */
const MANUAL = '%% @mermuid: {"v":1,"layout":"manual","pos":{}}\n';

describe('GraphCanvas: Darstellung (C1)', () => {
	it('Knoten, Container und Kanten aus dem Modell', async () => {
		const { target } = await setup(SAMPLE);
		for (const id of ['A', 'B', 'C', 'D', 'S1']) expect(nodeEl(target, id)).not.toBeNull();
		expect(target.querySelectorAll('.svelte-flow__node[data-id="S1"]')).toHaveLength(1);
		expect(target.querySelectorAll('.svelte-flow__edge')).toHaveLength(3);
		const tspans = [...nodeEl(target, 'A')!.querySelectorAll('tspan')].map((t) => t.textContent);
		expect(tspans).toEqual(['Start', 'zwei']);
		expect(nodeEl(target, 'B')!.querySelector('path.outline')!.getAttribute('d')).toBeTruthy();
	});

	it('Labels nur als Text, kein Markup', async () => {
		const { target } = await setup('flowchart TB\n  A["<img src=x onerror=alert(1)>Hallo"]\n');
		expect(target.querySelector('.svelte-flow__node img')).toBeNull();
		expect(nodeEl(target, 'A')!.textContent).toContain('Hallo');
	});

	it('RawBlock-Hinweis und Validierungs-Marker mit Icon und Text', async () => {
		const { target } = await setup(SAMPLE);
		const raw = target.querySelector('[data-testid="raw-blocks"]')!;
		expect(raw.textContent).toContain('accTitle: Titel');
		expect(raw.textContent).toContain('nicht grafisch editierbar');
		const issue = nodeEl(target, 'S1')!.querySelector('.issue')!;
		expect(issue.textContent).toMatch(/^ℹ \S/);
	});

	it('Syntaxfehler als Canvas-Marker', async () => {
		const { sync, target } = await setup('flowchart TB\n  A\n');
		sync.editCode('flowchart TB\n  A\n  %%FEHLER\n');
		await sync.flush();
		flushSync();
		const issues = target.querySelector('[data-testid="canvas-issues"]')!;
		expect(issues.textContent).toContain('⚠');
		expect(issues.textContent).toContain('Zeile 3');
	});
});

const press = (el: Element, key: string, mods: KeyboardEventInit = {}) =>
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));

const editor = (target: HTMLElement) => target.querySelector<HTMLTextAreaElement>('.inline-editor');

function focusNode(target: HTMLElement, id: string) {
	const el = nodeEl(target, id)!;
	el.focus();
	return el;
}

describe('GraphCanvas: Bearbeiten (C2)', () => {
	const TWO = 'flowchart LR\n  A[Alt] --> B\n';

	it('F2 öffnet den Inline-Editor, Enter übernimmt per Command', async () => {
		const { sync, target } = await setup(TWO);
		press(focusNode(target, 'A'), 'F2');
		await settle();
		const area = editor(target)!;
		expect(area.value).toBe('Alt');
		expect(document.activeElement).toBe(area);
		area.value = 'Neu\nZeile';
		area.dispatchEvent(new Event('input', { bubbles: true }));
		press(area, 'Enter');
		await settle();
		expect(docOf(sync).nodes.find((n) => n.id === 'A')!.label).toBe('Neu<br>Zeile');
		expect(editor(target)).toBeNull();
		expect(nodeEl(target, 'A')!.textContent).toContain('Zeile');
	});

	it('Doppelklick öffnet den Editor, Escape verwirft, Einzeltasten ruhen im Editor', async () => {
		const { sync, target } = await setup(TWO);
		focusNode(target, 'A');
		nodeEl(target, 'B')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		const area = editor(target)!;
		expect(area.value).toBe('B');
		press(area, 'Delete');
		press(area, 'Escape');
		await settle();
		expect(editor(target)).toBeNull();
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['A', 'B']);
		expect(docOf(sync).nodes[1].label).toBe('B');
	});

	it('Blur übernimmt den Editor-Text', async () => {
		const { sync, target } = await setup(TWO);
		press(focusNode(target, 'A'), 'F2');
		flushSync();
		const area = editor(target)!;
		area.value = 'Weg';
		area.dispatchEvent(new Event('input', { bubbles: true }));
		area.dispatchEvent(new FocusEvent('blur'));
		await settle();
		expect(docOf(sync).nodes[0].label).toBe('Weg');
	});

	it('Kanten-Label per Doppelklick', async () => {
		const { sync, target } = await setup(TWO);
		target
			.querySelector('.svelte-flow__edge[data-id="e1"] path')!
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		const area = editor(target)!;
		area.value = 'ja';
		area.dispatchEvent(new Event('input', { bubbles: true }));
		press(area, 'Enter');
		await settle();
		expect(docOf(sync).edges[0].label).toBe('ja');
	});

	it('Entf löscht, Strg+D dupliziert, Pfeile verschieben, alles mit Undo', async () => {
		const { sync, target } = await setup(TWO);
		press(focusNode(target, 'A'), 'd', { ctrlKey: true });
		await settle();
		expect(docOf(sync).nodes).toHaveLength(3);
		expect(docOf(sync).layout.mode).toBe('manual');

		const before = docOf(sync).layout.positions.A;
		press(focusNode(target, 'A'), 'ArrowRight');
		await settle();
		expect(docOf(sync).layout.positions.A[0]).toBe(before[0] + docOf(sync).layout.gridSize);

		press(focusNode(target, 'B'), 'Delete');
		await settle();
		expect(docOf(sync).nodes.map((n) => n.id)).not.toContain('B');
		expect(docOf(sync).edges).toHaveLength(0);
		await sync.undo();
		expect(docOf(sync).nodes.map((n) => n.id)).toContain('B');
	});

	it('Einzeltasten ohne Canvas-Fokus wirkungslos', async () => {
		const { sync, target } = await setup(TWO);
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();
		press(nodeEl(target, 'A')!, 'Delete');
		await settle();
		expect(docOf(sync).nodes).toHaveLength(2);
		outside.remove();
	});

	const dblclickPane = (target: HTMLElement) =>
		target
			.querySelector('.svelte-flow__pane')!
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 40, clientY: 50 }));

	it('Doppelklick auf die Fläche legt einen Knoten an (Auto-Layout ohne Position, O-48)', async () => {
		const { sync, target } = await setup(TWO);
		dblclickPane(target);
		await settle();
		const doc = docOf(sync);
		expect(doc.nodes).toHaveLength(3);
		const id = doc.nodes[2].id;
		expect(doc.layout.mode).toBe('auto');
		expect(doc.layout.positions[id]).toBeUndefined();
		expect(nodeEl(target, id)).not.toBeNull();
	});

	it('Doppelklick im Modus manual legt den Knoten mit Klickposition an', async () => {
		const { sync, target } = await setup(TWO + MANUAL);
		dblclickPane(target);
		await settle();
		const doc = docOf(sync);
		expect(doc.nodes).toHaveLength(3);
		const id = doc.nodes[2].id;
		expect(doc.layout.mode).toBe('manual');
		expect(doc.layout.positions[id]).toBeDefined();
		expect(nodeEl(target, id)).not.toBeNull();
	});

	it('Verbinden per Antippen zweier Handles (Touch) als Command', async () => {
		const { sync, target } = await setup('flowchart LR\n  A\n  B\n');
		const handle = (id: string, side: string) =>
			nodeEl(target, id)!.querySelector<HTMLElement>(
				`.svelte-flow__handle[data-handleid="${side}"]`
			)!;
		handle('A', 'e').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		handle('B', 'w').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await settle();
		expect(docOf(sync).edges).toHaveLength(1);
		expect(docOf(sync).edges[0]).toMatchObject({ sourceId: 'A', targetId: 'B' });
		expect(target.querySelectorAll('.svelte-flow__edge')).toHaveLength(1);
	});
});

const menu = (target: HTMLElement) => target.querySelector<HTMLElement>('[role="menu"]');
const menuItem = (target: HTMLElement, label: string) =>
	[...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) =>
		b.textContent!.startsWith(label)
	)!;

/** Mehrfachauswahl: Strg halten (Svelte Flow verfolgt die Taste am Fenster) und klicken. */
function ctrlClick(target: HTMLElement, id: string) {
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
	nodeEl(target, id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
	window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
	flushSync();
}

describe('GraphCanvas: Auswahl und Anordnung (C3)', () => {
	const TWO = 'flowchart LR\n  A --> B\n';

	it('Shift-F10 öffnet das Kontextmenü mit Tastaturfokus, Escape schließt', async () => {
		const { target } = await setup(TWO);
		press(focusNode(target, 'A'), 'F10', { shiftKey: true });
		await settle();
		expect(menu(target)).not.toBeNull();
		const items = [...target.querySelectorAll('[role="menuitem"]')];
		expect(items.map((b) => b.textContent)).toContain('In Subgraph gruppieren');
		expect(document.activeElement).toBe(items[0]);
		press(items[0], 'ArrowDown');
		await settle();
		expect(document.activeElement).toBe(items[1]);
		press(items[1], 'Escape');
		await settle();
		expect(menu(target)).toBeNull();
	});

	it('Kontextmenü im Editor und ohne Canvas-Fokus wirkungslos', async () => {
		const { target } = await setup(TWO);
		press(focusNode(target, 'A'), 'F2');
		await settle();
		press(editor(target)!, 'F10', { shiftKey: true });
		await settle();
		expect(menu(target)).toBeNull();
	});

	it('Gruppieren per Kontextmenü legt einen Subgraph als Command an', async () => {
		const { sync, target } = await setup(TWO);
		ctrlClick(target, 'A');
		ctrlClick(target, 'B');
		nodeEl(target, 'B')!.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
		);
		await settle();
		menuItem(target, 'In Subgraph gruppieren').click();
		await settle();
		const doc = docOf(sync);
		expect(doc.containers).toHaveLength(1);
		expect(doc.nodes.every((n) => n.parentId === doc.containers[0].id)).toBe(true);
		expect(menu(target)).toBeNull();
		await sync.undo();
		expect(docOf(sync).containers).toHaveLength(0);
	});

	it('Ausrichten zweier ausgewählter Knoten', async () => {
		const { sync, target } = await setup('flowchart TB\n  A --> B\n');
		ctrlClick(target, 'A');
		ctrlClick(target, 'B');
		press(focusNode(target, 'B'), 'ContextMenu');
		await settle();
		menuItem(target, 'Oben').click();
		await settle();
		const p = docOf(sync).layout.positions;
		expect(p.A[1]).toBe(p.B[1]);
	});

	it('Kontextmenü der Fläche legt Knoten an', async () => {
		const { sync, target } = await setup(TWO);
		target
			.querySelector('.svelte-flow__pane')!
			.dispatchEvent(
				new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
			);
		await settle();
		const items = [...target.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
		expect(items).toEqual(['Knoten anlegen']);
		menuItem(target, 'Knoten anlegen').click();
		await settle();
		expect(docOf(sync).nodes).toHaveLength(3);
	});

	it('Raster-Hintergrund 8 px und Zoom-Anzeige', async () => {
		let zoom = '';
		const { target } = await setup(TWO, { onzoom: (z: string) => (zoom = z) });
		expect(target.querySelector('.svelte-flow__background')).not.toBeNull();
		expect(zoom).toMatch(/^\d+ %$/);
	});
});

/** Modifikator halten (Svelte Flow verfolgt Tasten am Fenster) und Knoten klicken. */
function modClick(target: HTMLElement, id: string, key: string, mods: MouseEventInit) {
	window.dispatchEvent(new KeyboardEvent('keydown', { key, ...mods }));
	nodeEl(target, id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...mods }));
	window.dispatchEvent(new KeyboardEvent('keyup', { key }));
	flushSync();
}

describe('GraphCanvas: Auswahl, Pan und Raster (Fix E1)', () => {
	const TWO = 'flowchart LR\n  A --> B\n';

	it('Shift-Klick und Meta-Klick fügen zur Auswahl hinzu', async () => {
		const { target } = await setup('flowchart LR\n  A --> B\n  C\n');
		nodeEl(target, 'A')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		modClick(target, 'B', 'Shift', { shiftKey: true });
		modClick(target, 'C', 'Meta', { metaKey: true });
		for (const id of ['A', 'B', 'C']) expect(nodeEl(target, id)!.classList).toContain('selected');
	});

	it('Links-Drag auf der Fläche ist Lasso, Leertaste schaltet auf Pan', async () => {
		const { target } = await setup(TWO);
		const pane = target.querySelector('.svelte-flow__pane')!;
		expect(pane.classList).toContain('selection');
		expect(pane.classList).not.toContain('draggable');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
		flushSync();
		expect(pane.classList).not.toContain('selection');
		window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
		flushSync();
		expect(pane.classList).toContain('selection');
	});

	it('Raster per control.toggleGrid, Einrasten per Command mit Undo (Schalter: CanvasBar)', async () => {
		let control: { toggleGrid(): void } | null = null;
		const { sync, target } = await setup(TWO, { oncontrol: (c: typeof control) => (control = c) });
		expect(target.querySelector('.svelte-flow__background')).not.toBeNull();
		expect(docOf(sync).layout.snap).toBe(false);

		await sync.execute(setLayoutOption({ snap: true }));
		await settle();
		expect(docOf(sync).layout.snap).toBe(true);
		await sync.undo();
		flushSync();
		expect(docOf(sync).layout.snap).toBe(false);

		control!.toggleGrid();
		flushSync();
		expect(target.querySelector('.svelte-flow__background')).toBeNull();
	});

	it('Doppelklick legt ohne Snap ungerastert, mit Snap gerastert an', async () => {
		// Klickposition wird nur im Modus manual gespeichert (O-48).
		const { sync, target } = await setup(TWO + MANUAL);
		const pane = target.querySelector('.svelte-flow__pane')!;
		const create = async () => {
			pane.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 13, clientY: 17 }));
			await settle();
			const doc = docOf(sync);
			return doc.layout.positions[doc.nodes.at(-1)!.id];
		};
		const free = await create();
		await sync.execute(setLayoutOption({ snap: true }));
		await settle();
		const snapped = await create();
		const size = docOf(sync).layout.gridSize;
		expect(snapped[0] % size).toBe(0);
		expect(snapped[1] % size).toBe(0);
		expect(free[0] % size !== 0 || free[1] % size !== 0).toBe(true);
	});
});
