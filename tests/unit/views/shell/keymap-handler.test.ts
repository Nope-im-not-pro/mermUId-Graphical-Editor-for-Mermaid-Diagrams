// @vitest-environment jsdom
// T123 C3: perform/keyHandler aus Shell.svelte nach keymap.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	keyHandler,
	onCanvas,
	perform,
	type ActionHandlers,
	type KeyDeps
} from '../../../../src/lib/views/shell/keymap';

function handlers(overrides: Partial<ActionHandlers> = {}): ActionHandlers {
	const all = {} as Record<string, () => void>;
	for (const type of [
		'save',
		'undo',
		'redo',
		'zoomIn',
		'zoomOut',
		'fit',
		'toggleCode',
		'search',
		'help',
		'selectAll',
		'toggleGrid',
		'toggleSnap',
		'nudge',
		'cycle',
		'connectStart',
		'connectNeighbor'
	])
		all[type] = vi.fn();
	return { ...(all as unknown as ActionHandlers), ...overrides };
}

describe('perform', () => {
	it('ruft den Handler der Aktion mit der Aktion; void = behandelt, false = weiterreichen', () => {
		const nudge = vi.fn(() => false);
		const h = handlers({ nudge });
		expect(perform({ type: 'save' }, h)).toBe(true);
		expect(h.save).toHaveBeenCalledWith({ type: 'save' });
		expect(perform({ type: 'nudge', dx: 1, dy: 0 }, h)).toBe(false);
		expect(nudge).toHaveBeenCalledWith({ type: 'nudge', dx: 1, dy: 0 });
		expect(perform({ type: 'cycle', dir: 1 }, handlers({ cycle: () => true }))).toBe(true);
	});
});

describe('onCanvas', () => {
	it('Wrapper und Elemente im Canvas, nicht Controls', () => {
		document.body.innerHTML =
			'<div class="graph-canvas"><div class="svelte-flow__node"><span id="n"></span></div><button id="b"></button></div>';
		expect(onCanvas(document.querySelector('.graph-canvas'))).toBe(true);
		expect(onCanvas(document.getElementById('n'))).toBe(true);
		expect(onCanvas(document.getElementById('b'))).toBe(false);
		expect(onCanvas(null)).toBe(false);
	});
});

describe('keyHandler', () => {
	afterEach(() => (document.body.innerHTML = ''));

	function setup(extra: Partial<KeyDeps> = {}) {
		document.body.innerHTML =
			'<div id="root"><div class="graph-canvas" tabindex="0"></div><input id="i" /></div>';
		const root = document.getElementById('root')!;
		const connect = { active: false, step: vi.fn(), reset: vi.fn() };
		const actions = handlers();
		const deps: KeyDeps = {
			root: () => root,
			dialogOpen: () => false,
			graph: () => true,
			zoomable: () => true,
			canvasReady: () => true,
			connect,
			actions,
			...extra
		};
		return { root, connect, actions, onkey: keyHandler(deps) };
	}

	const press = (onkey: (e: KeyboardEvent) => void, init: KeyboardEventInit) => {
		const e = new KeyboardEvent('keydown', { cancelable: true, ...init });
		onkey(e);
		return e;
	};

	it('Kürzel auf dem Canvas: Aktion ausgeführt, Taste verbraucht', () => {
		const { root, actions, onkey } = setup();
		root.querySelector<HTMLElement>('.graph-canvas')!.focus();
		const e = press(onkey, { key: 'g' });
		expect(actions.toggleGrid).toHaveBeenCalled();
		expect(e.defaultPrevented).toBe(true);
	});

	it('Einzeltaste im Eingabefeld: keine Aktion', () => {
		const { root, actions, onkey } = setup();
		root.querySelector<HTMLElement>('#i')!.focus();
		const e = press(onkey, { key: 'g' });
		expect(actions.toggleGrid).not.toHaveBeenCalled();
		expect(e.defaultPrevented).toBe(false);
	});

	it('Verbinden aktiv: Pfeil auf dem Canvas geht an den Modus', () => {
		const { root, connect, actions, onkey } = setup();
		connect.active = true;
		root.querySelector<HTMLElement>('.graph-canvas')!.focus();
		const e = press(onkey, { key: 'ArrowRight' });
		expect(connect.step).toHaveBeenCalledWith({ type: 'target', dir: 'right' });
		expect(connect.reset).not.toHaveBeenCalled();
		expect(actions.nudge).not.toHaveBeenCalled();
		expect(e.defaultPrevented).toBe(true);
	});

	it('Verbinden aktiv: fremde Taste beendet still und läuft normal weiter', () => {
		const { root, connect, actions, onkey } = setup();
		connect.active = true;
		root.querySelector<HTMLElement>('.graph-canvas')!.focus();
		press(onkey, { key: 'g' });
		expect(connect.step).not.toHaveBeenCalled();
		expect(connect.reset).toHaveBeenCalled();
		expect(actions.toggleGrid).toHaveBeenCalled();
	});

	it('Dialog offen: Verbinden bleibt, keine Aktion', () => {
		const { root, connect, actions, onkey } = setup({ dialogOpen: () => true });
		connect.active = true;
		root.querySelector<HTMLElement>('.graph-canvas')!.focus();
		press(onkey, { key: 'ArrowRight' });
		expect(connect.step).not.toHaveBeenCalled();
		expect(connect.reset).not.toHaveBeenCalled();
		expect(actions.nudge).not.toHaveBeenCalled();
	});

	// T123 C4 (Review C3): Nachträge.
	it('Verbinden aktiv, Canvas nicht bereit: Pfeil beendet still statt Schritt', () => {
		const { root, connect, onkey } = setup({ canvasReady: () => false });
		connect.active = true;
		root.querySelector<HTMLElement>('.graph-canvas')!.focus();
		press(onkey, { key: 'ArrowRight' });
		expect(connect.step).not.toHaveBeenCalled();
		expect(connect.reset).toHaveBeenCalledOnce();
	});

	it('search liefert false (Modus "nur Code"): Taste geht an den Browser', () => {
		const search = vi.fn(() => false);
		const { root, onkey } = setup({ actions: handlers({ search }) });
		root.querySelector<HTMLElement>('.graph-canvas')!.focus();
		const e = press(onkey, { key: 'f', ctrlKey: true });
		expect(search).toHaveBeenCalled();
		expect(e.defaultPrevented).toBe(false);
	});

	// T126 C3: Zoom-Kürzel auch im Sequenz-Canvas, nicht im Code-Editor.
	it('Sequenz-Canvas: Strg-Plus/Minus/0 zoomen, im Code-Editor nicht', () => {
		const { root, actions, onkey } = setup({ graph: () => false });
		root.innerHTML =
			'<div class="sequence-canvas"><div class="surface" tabindex="0"></div></div><div class="cm-editor"><div id="cm" tabindex="0"></div></div>';
		root.querySelector<HTMLElement>('.surface')!.focus();
		expect(press(onkey, { key: '+', ctrlKey: true }).defaultPrevented).toBe(true);
		expect(press(onkey, { key: '-', ctrlKey: true }).defaultPrevented).toBe(true);
		expect(press(onkey, { key: '0', ctrlKey: true }).defaultPrevented).toBe(true);
		expect(actions.zoomIn).toHaveBeenCalledOnce();
		expect(actions.zoomOut).toHaveBeenCalledOnce();
		expect(actions.fit).toHaveBeenCalledOnce();
		root.querySelector<HTMLElement>('#cm')!.focus();
		expect(press(onkey, { key: '+', ctrlKey: true }).defaultPrevented).toBe(false);
		expect(press(onkey, { key: '0', ctrlKey: true }).defaultPrevented).toBe(false);
		expect(actions.zoomIn).toHaveBeenCalledOnce();
		expect(actions.fit).toHaveBeenCalledOnce();
	});

	it('ohne zoombaren Canvas (nur Code): Strg-0 bleibt beim Browser', () => {
		const { actions, onkey } = setup({ graph: () => false, zoomable: () => false });
		expect(press(onkey, { key: '0', ctrlKey: true }).defaultPrevented).toBe(false);
		expect(actions.fit).not.toHaveBeenCalled();
	});
});
