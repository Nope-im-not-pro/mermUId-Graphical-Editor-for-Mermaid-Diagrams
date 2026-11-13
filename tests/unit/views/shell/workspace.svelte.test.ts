// @vitest-environment jsdom
// T123 C4 (V-24): Workspace (Arbeitsfläche), SidePanel und MessageBar aus Shell.svelte gelöst.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync, mount, unmount, type Component } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import MessageBar from '../../../../src/lib/views/shell/MessageBar.svelte';
import SidePanel from '../../../../src/lib/views/shell/SidePanel.svelte';
import { fitZoom } from '../../../../src/lib/views/canvas/common/viewport';
import Workspace, { reserveOf } from '../../../../src/lib/views/shell/Workspace.svelte';
import { docOf, installBrowserStubs, measure, settle } from '../canvas/helpers';
import { button, createFake, SVG } from './helpers';

beforeAll(installBrowserStubs);
const cleanup: (() => void)[] = [];
afterEach(() => {
	while (cleanup.length > 0) cleanup.pop()!();
});

function show<P extends Record<string, unknown>>(component: Component<P>, props: P) {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(component, { target, props });
	flushSync();
	cleanup.push(() => (unmount(app), target.remove()));
	return target;
}

async function workspace(text: string, props: Record<string, unknown> = {}) {
	const sync = (props.sync as Awaited<ReturnType<typeof createFake>>) ?? (await createFake(text));
	cleanup.push(() => sync.dispose());
	return show(Workspace, {
		sync,
		render: async () => ({ ok: true as const, svg: SVG }),
		measure,
		locked: null,
		previewOpen: false,
		banner: null,
		issues: [],
		armed: null,
		control: null,
		run: async () => {},
		onundo: () => {},
		onredo: () => {},
		ontogglepreview: () => {},
		onseqcontrol: () => {},
		onbanneraction: () => {},
		onjump: () => {},
		onselect: () => {},
		beforedelete: async () => true,
		...props
	});
}

describe('Workspace', () => {
	it('Graph: Befehlsleiste, Canvas-Fläche mit Graph-Canvas, Vorschau', async () => {
		const target = await workspace('flowchart LR\n  A --> B\n');
		expect(target.querySelector('.center > .shell-canvas .graph-canvas')).not.toBeNull();
		expect(target.querySelector('.center > .preview')).not.toBeNull();
	});

	it('nur Code: Platzhalter statt Canvas', async () => {
		const target = await workspace('pie\n  "a": 1\n');
		expect(target.querySelector('.shell-canvas .placeholder')).not.toBeNull();
		expect(target.querySelector('.graph-canvas')).toBeNull();
	});
});

describe('Workspace: feste Zonen und Raster in der CanvasBar (T126 C1)', () => {
	it('Graph: CanvasBar als eigene Zeile vor der Fläche, Raster/Einrasten nur dort', async () => {
		const target = await workspace('flowchart LR\n  A --> B\n');
		const center = target.querySelector('.center')!;
		expect(center.firstElementChild!.classList.contains('cmdbar')).toBe(true);
		expect(center.querySelector('.shell-canvas .cmdbar')).toBeNull();
		const grids = [...target.querySelectorAll('button')].filter(
			(b) => b.textContent?.trim() === 'Raster'
		);
		expect(grids).toHaveLength(1);
		expect(grids[0].closest('.cmdbar')).not.toBeNull();
		// Einrasten ebenfalls nur einmal, in der CanvasBar (keine Schalter im Graph-Canvas).
		const snaps = [...target.querySelectorAll('button')].filter(
			(b) => b.textContent?.trim() === 'Einrasten'
		);
		expect(snaps).toHaveLength(1);
		expect(snaps[0].closest('.cmdbar')).not.toBeNull();
		expect(target.querySelector('.graph-canvas button[aria-pressed]')).toBeNull();
	});

	it('Graph: Raster blendet den Hintergrund aus, Einrasten läuft als Command über run', async () => {
		const sync = await createFake('flowchart LR\n  A --> B\n');
		const run = vi.fn(async (command) => void (await sync.execute(command)));
		const target = await workspace('', { sync, run });
		const grid = button(target, 'Raster');
		expect(grid.getAttribute('aria-pressed')).toBe('true');
		grid.click();
		flushSync();
		expect(grid.getAttribute('aria-pressed')).toBe('false');
		expect(target.querySelector('.svelte-flow__background')).toBeNull();
		const snap = button(target, 'Einrasten');
		expect(snap.getAttribute('aria-pressed')).toBe('false');
		snap.click();
		await settle();
		expect(run).toHaveBeenCalledTimes(1);
		expect(docOf(sync).layout.snap).toBe(true);
		expect(snap.getAttribute('aria-pressed')).toBe('true');
		await sync.undo();
		await settle();
		expect(docOf(sync).layout.snap).toBe(false);
		expect(snap.getAttribute('aria-pressed')).toBe('false');
	});

	it('Sequenz: CanvasBar an derselben Stelle, Raster-Schalter gesperrt', async () => {
		const target = await workspace('sequenceDiagram\n  A->>B: hi\n');
		const center = target.querySelector('.center')!;
		expect(center.firstElementChild!.classList.contains('cmdbar')).toBe(true);
		expect(center.querySelector('.cmdbar.bottom')).toBeNull();
		expect(button(target, 'Raster').disabled).toBe(true);
		expect(button(target, 'Einrasten').disabled).toBe(true);
	});

	it('Sequenz: Fläche setzt --reserve-right aus dem Rand der Vorschau-Karte (O-141)', async () => {
		const rect = (left: number, top: number, width: number, height: number) =>
			({
				left,
				top,
				width,
				height,
				right: left + width,
				bottom: top + height,
				x: left,
				y: top
			}) as DOMRect;
		const original = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = function (this: Element) {
			if (this.classList.contains('shell-canvas')) return rect(0, 40, 800, 600);
			if (this.classList.contains('preview')) return rect(800 - 14 - 220, 640 - 14 - 50, 220, 50);
			return original.call(this);
		};
		cleanup.push(() => (Element.prototype.getBoundingClientRect = original));
		const target = await workspace('sequenceDiagram\n  A->>B: hi\n');
		const area = target.querySelector<HTMLElement>('.shell-canvas')!;
		expect(area.style.getPropertyValue('--reserve-right')).toBe(`${14 + 220 + 8}px`);
		expect(area.querySelector('.sequence-canvas > .outline')).not.toBeNull();
	});
});

describe('Workspace: Zoom der CanvasBar im Sequenz-Canvas (T126 C3)', () => {
	const SEQ = 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n';

	it('Zoom -/+/Einpassen aktiv, Prozentanzeige folgt SequenceControl; Control an die Shell', async () => {
		const onseqcontrol = vi.fn();
		const target = await workspace(SEQ, { onseqcontrol });
		await settle();
		expect(onseqcontrol).toHaveBeenCalledOnce();
		const zoom = () => target.querySelector('[data-testid="zoom"]')?.textContent;
		expect(zoom()).toBe('100 %');
		for (const name of ['Zoom - verkleinern', 'Zoom + vergrößern', 'Einpassen']) {
			expect(button(target, name).disabled, name).toBe(false);
		}
		button(target, 'Zoom + vergrößern').click();
		flushSync();
		expect(zoom()).toBe('120 %');
		button(target, 'Zoom - verkleinern').click();
		button(target, 'Zoom - verkleinern').click();
		flushSync();
		expect(zoom()).toBe('83 %');
		// Dasselbe Control wie die Shell (Kürzel): Zoom über das gemeldete Control.
		onseqcontrol.mock.calls[0][0].zoomIn();
		flushSync();
		expect(zoom()).toBe('100 %');
		const surface = target.querySelector<HTMLElement>('.sequence-canvas [role="application"]')!;
		Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 4000 });
		Object.defineProperty(surface, 'clientHeight', { configurable: true, value: 4000 });
		button(target, 'Einpassen').click();
		flushSync();
		expect(zoom()).not.toBe('100 %');
	});

	it('Wechsel Sequenz -> nur Code: Zoom gesperrt, keine Prozentanzeige (Modus-Guard)', async () => {
		const sync = await createFake(SEQ);
		const onseqcontrol = vi.fn();
		const target = await workspace(SEQ, { sync, onseqcontrol });
		await settle();
		expect(onseqcontrol).toHaveBeenCalledOnce();
		expect(button(target, 'Einpassen').disabled).toBe(false);
		sync.editCode('pie\n  "a": 1\n');
		await sync.flush();
		await settle();
		expect(target.querySelector('.shell-canvas .placeholder')).not.toBeNull();
		for (const name of ['Zoom - verkleinern', 'Zoom + vergrößern', 'Einpassen']) {
			expect(button(target, name).disabled, name).toBe(true);
		}
		expect(target.querySelector('[data-testid="zoom"]')).toBeNull();
	});

	it('Einpassen spart den Rand der Vorschau-Karte aus (O-141)', async () => {
		const rect = (left: number, top: number, width: number, height: number) =>
			({
				left,
				top,
				width,
				height,
				right: left + width,
				bottom: top + height,
				x: left,
				y: top
			}) as DOMRect;
		const original = Element.prototype.getBoundingClientRect;
		// Flache Karte (5 px) unten rechts: Rand unten 14 + 5 + 8 = 27 px von 100 px Höhe
		// kostet anteilig weniger als rechts (242 von 800 px), also wird unten ausgespart.
		Element.prototype.getBoundingClientRect = function (this: Element) {
			if (this.classList.contains('shell-canvas')) return rect(0, 40, 800, 140);
			if (this.classList.contains('preview')) return rect(800 - 14 - 220, 180 - 14 - 5, 220, 5);
			if (this.classList.contains('sequence-canvas')) return rect(0, 40, 800, 140);
			if (this.classList.contains('surface')) return rect(0, 80, 800, 100);
			return original.call(this);
		};
		cleanup.push(() => (Element.prototype.getBoundingClientRect = original));
		let control: { fit(): void; viewport(): { zoom: number } } | null = null;
		const target = await workspace(SEQ, { onseqcontrol: (c: typeof control) => (control = c) });
		await settle();
		const surface = target.querySelector<HTMLElement>('.sequence-canvas .surface')!;
		const svg = surface.querySelector('svg')!;
		const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
		Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 800 });
		Object.defineProperty(surface, 'clientHeight', { configurable: true, value: 100 });
		control!.fit();
		flushSync();
		const free = fitZoom({ width, height }, { width: 800, height: 100 });
		const spared = fitZoom({ width, height }, { width: 800, height: 100 - 27 });
		expect(spared).toBeLessThan(free);
		expect(control!.viewport().zoom).toBeCloseTo(spared);
	});
});

type Control = { select(ids: string[], center?: boolean): void; selection(): string[] };

/** Workspace mit gebundenem `control` (Accessor), Befehle laufen über den echten Sync. */
async function wired(text: string) {
	const sync = await createFake(text);
	cleanup.push(() => sync.dispose());
	const run = vi.fn(async (command) => void (await sync.execute(command)));
	// Reaktiver Accessor (Runes in .svelte.test.ts): Workspace liest `control` abgeleitet.
	let control = $state<Control | null>(null);
	const props = {
		sync,
		render: async () => ({ ok: true as const, svg: SVG }),
		measure,
		locked: null,
		previewOpen: false,
		banner: null,
		issues: [],
		armed: null,
		run,
		onundo: () => {},
		onredo: () => {},
		ontogglepreview: () => {},
		onseqcontrol: () => {},
		onbanneraction: () => {},
		onjump: () => {},
		onselect: vi.fn(),
		beforedelete: async () => true,
		get control() {
			return control;
		},
		set control(c: Control | null) {
			control = c;
		}
	};
	const target = show(Workspace, props as never);
	await settle();
	return { sync, run, target, onselect: props.onselect, control: () => control! };
}

const THREE = 'flowchart LR\n  A --> B\n  B --> C\n';
/** Ungleiche Abstände in x: A -> B, A -> C -> D, E einzeln. */
const FAN = 'flowchart LR\n  A --> B\n  A --> C --> D\n  E\n';

describe('Workspace: Ausrichten/Verteilen/Richtung in der CanvasBar (T126 C2, F-04)', () => {
	it('Aktivierung folgt der Auswahl: ab 2 Ausrichten, ab 3 Verteilen; Kanten zählen nicht', async () => {
		const { sync, target, control, onselect } = await wired(THREE);
		const align = button(target, 'Ausrichten');
		const spread = button(target, 'Verteilen');
		expect([align.disabled, spread.disabled]).toEqual([true, true]);
		control().select(['A'], false);
		await settle();
		expect([align.disabled, spread.disabled]).toEqual([true, true]);
		control().select(['A', 'B'], false);
		await settle();
		expect([align.disabled, spread.disabled]).toEqual([false, true]);
		expect(onselect).toHaveBeenLastCalledWith(['A', 'B']);
		const edge = docOf(sync).edges[0].id;
		control().select(['A', 'B', edge], false);
		await settle();
		expect(spread.disabled).toBe(true);
		control().select(['A', 'B', 'C'], false);
		await settle();
		expect([align.disabled, spread.disabled]).toEqual([false, false]);
	});

	it('Ausrichten über die CanvasBar: derselbe Command wie im Kontextmenü, mit Undo', async () => {
		const { sync, run, target, control } = await wired(THREE);
		control().select(['A', 'C'], false);
		await settle();
		const before = docOf(sync);
		button(target, 'Ausrichten').click();
		await settle();
		button(target, 'Links ausrichten').click();
		await settle();
		const after = docOf(sync);
		expect(after).not.toBe(before);
		expect(after.layout.positions.A[0]).toBe(after.layout.positions.C[0]);
		// Canvas-Pfad (GraphFlow `run`) wie im Kontextmenü, nicht der Shell-Weg.
		expect(run).not.toHaveBeenCalled();
		await sync.undo();
		await settle();
		expect(docOf(sync).layout.positions).toEqual(before.layout.positions);
	});

	it('Verteilen über die CanvasBar verschiebt den mittleren Knoten (ein Undo-Schritt)', async () => {
		const { sync, target, control } = await wired(FAN);
		control().select(['B', 'C', 'D', 'E'], false);
		await settle();
		const before = docOf(sync);
		button(target, 'Verteilen').click();
		await settle();
		button(target, 'Horizontal verteilen').click();
		await settle();
		const pos = docOf(sync).layout.positions;
		const xs = ['B', 'C', 'D', 'E'].map((id) => pos[id][0]).sort((a, b) => a - b);
		const lefts = xs.slice(1).map((x, i) => x - xs[i]);
		expect(new Set(lefts.map((d) => Math.round(d))).size).toBe(1);
		await sync.undo();
		await settle();
		expect(docOf(sync).layout.positions).toEqual(before.layout.positions);
	});

	it('Richtung: LR gedrückt, TD schaltet die Deklaration im Code, Undo stellt LR her', async () => {
		const { sync, run, target } = await wired(THREE);
		expect(button(target, 'LR').getAttribute('aria-pressed')).toBe('true');
		button(target, 'LR').click();
		await settle();
		expect(run).not.toHaveBeenCalled();
		button(target, 'TD').click();
		await settle();
		expect(run).toHaveBeenCalledTimes(1);
		expect(get(sync).code.split('\n')[0]).toBe('flowchart TD');
		expect(button(target, 'TD').getAttribute('aria-pressed')).toBe('true');
		await sync.undo();
		await settle();
		expect(get(sync).code.split('\n')[0]).toBe('flowchart LR');
		expect(button(target, 'LR').getAttribute('aria-pressed')).toBe('true');
	});

	it('Sequenz: Ausrichten, Verteilen und Richtung gesperrt', async () => {
		const { target } = await wired('sequenceDiagram\n  A->>B: hi\n');
		for (const name of ['Ausrichten', 'Verteilen', 'TD', 'LR']) {
			expect(button(target, name).disabled, name).toBe(true);
			expect(button(target, name).title, name).toBe('Nur im Flowchart verfügbar');
		}
	});

	it('Flowchart -> Sequenz -> Flowchart: alte Auswahl schaltet Ausrichten nicht frei', async () => {
		const { sync, target, control } = await wired(THREE);
		control().select(['A', 'B'], false);
		await settle();
		expect(button(target, 'Ausrichten').disabled).toBe(false);
		sync.editCode('sequenceDiagram\n  A->>B: hi\n');
		await sync.flush();
		await settle();
		expect(button(target, 'Ausrichten').disabled).toBe(true);
		sync.editCode(THREE);
		await sync.flush();
		await settle();
		expect(control().selection()).toEqual([]);
		expect(button(target, 'Ausrichten').disabled).toBe(true);
		expect(button(target, 'Ausrichten').title).toBe('Ausrichten: mindestens 2 Knoten auswählen');
	});
});

// T126 C3 I3: jsdom rechnet kein Layout, daher Regel im `<style>`-Block statisch; die echte Box
// prüft e2e zoom.spec.ts (Sequenz 207 %: `.surface` bleibt im Fenster).
describe('Workspace: Mittelspalte wächst nicht mit dem Inhalt (T126 C3)', () => {
	const source = readFileSync(
		join(__dirname, '../../../../src/lib/views/shell/Workspace.svelte'),
		'utf8'
	);
	const style = source.slice(source.lastIndexOf('<style>'), source.lastIndexOf('</style>'));
	const rule = (sel: string) =>
		new RegExp(`(?:^|[}/])\\s*${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(style)?.[1] ?? '';

	it('.center: Spalte minmax(0, 1fr), sonst setzt die min-content-Breite der Fläche (SVG) die Spur', () => {
		expect(rule('.center')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
		expect(rule('.center')).toMatch(/min-width:\s*0\s*;/);
	});
});

describe('reserveOf: Rand der Vorschau-Karte in der Canvas-Fläche (M-12)', () => {
	const rect = (left: number, top: number, width: number, height: number) => ({
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height
	});
	const canvas = rect(100, 50, 600, 500);

	it('Abstand der Karte zum rechten und unteren Flächenrand plus Lücke', () => {
		// Karte 220x200, 14 px vom rechten/unteren Rand.
		const card = rect(700 - 14 - 220, 550 - 14 - 200, 220, 200);
		expect(reserveOf(canvas, card)).toEqual({ right: 14 + 220 + 8, bottom: 14 + 200 + 8 });
	});

	it('ohne Karte, ohne Maße oder außerhalb der Fläche: kein Rand', () => {
		expect(reserveOf(canvas, null)).toBeNull();
		expect(reserveOf(canvas, rect(0, 0, 0, 0))).toBeNull();
		expect(reserveOf(canvas, rect(800, 50, 100, 100))).toBeNull();
		expect(reserveOf(canvas, rect(100, 600, 100, 100))).toBeNull();
	});
});

describe('SidePanel', () => {
	it('Tabs melden die Wahl, nur der gewählte Tab ist sichtbar', async () => {
		const sync = await createFake('flowchart LR\n  A\n');
		cleanup.push(() => sync.dispose());
		const onselecttab = vi.fn();
		const target = show(SidePanel, {
			sync,
			tab: 'properties',
			selected: null,
			issues: [],
			onselecttab,
			onjump: () => {},
			oncursor: () => {}
		});
		expect(target.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(true);
		target.querySelector<HTMLButtonElement>('#tab-code')!.click();
		expect(onselecttab).toHaveBeenCalledWith('code');
	});
});

describe('MessageBar', () => {
	it('Fehler in role=alert, sonst höflich', () => {
		const error = show(MessageBar, { message: { key: 'app.shell.rememberFailed', tone: 'error' } });
		expect(error.querySelector('[role="alert"]')!.textContent).not.toBe('');
		expect(error.querySelector('[aria-live="polite"]')!.textContent).toBe('');
		const info = show(MessageBar, { message: { key: 'app.shell.connectStart', tone: 'info' } });
		expect(info.querySelector('[role="alert"]')!.textContent).toBe('');
		expect(info.querySelector('[aria-live="polite"]')!.textContent).not.toBe('');
	});
});
