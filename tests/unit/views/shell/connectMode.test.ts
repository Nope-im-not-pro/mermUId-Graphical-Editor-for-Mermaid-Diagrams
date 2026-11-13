// T123 C3: Verbinden-Modus als Zustandsautomat (idle -> picking -> idle).
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../../../../src/lib/views/canvas/common/grid';
import { createConnectMode } from '../../../../src/lib/views/shell/connectMode';

/** A links, B rechts daneben, C rechts von B. */
const GEOMETRY: Record<string, Rect> = {
	A: { x: 0, y: 0, w: 80, h: 42 },
	B: { x: 200, y: 0, w: 80, h: 42 },
	C: { x: 400, y: 0, w: 80, h: 42 }
};

function setup(selection: string[] = ['A'], geometry: Record<string, Rect> | null = GEOMETRY) {
	const deps = {
		targets: vi.fn(() => selection),
		nodeIds: () => ['A', 'B', 'C'],
		geometry: () => geometry,
		label: (id: string) => (id === 'B' ? 'Bob' : ''),
		select: vi.fn(),
		connect: vi.fn(),
		say: vi.fn()
	};
	return { deps, mode: createConnectMode(deps) };
}

const keyOf = (say: ReturnType<typeof vi.fn>) => say.mock.calls.map(([m]) => m.key);

describe('createConnectMode', () => {
	it('startet ruhend', () => {
		const { mode } = setup();
		expect(mode.state).toEqual({ type: 'idle' });
		expect(mode.active).toBe(false);
	});

	it('start ohne Knoten in Auswahl/Fokus: bleibt ruhend, Hinweis', () => {
		const { mode, deps } = setup(['A-->B']);
		mode.start();
		expect(mode.active).toBe(false);
		expect(deps.say).toHaveBeenCalledWith({ key: 'app.shell.connectNoSource', tone: 'info' });
	});

	it('start mit Knoten: wählt Quelle, noch kein Ziel', () => {
		const { mode, deps } = setup(['e1', 'A']);
		mode.start();
		expect(mode.state).toEqual({ type: 'picking', source: 'A', target: null });
		expect(deps.say).toHaveBeenCalledWith({ key: 'app.shell.connectStart', tone: 'info' });
	});

	it('Pfeil wählt Nachbar als Ziel, markiert Quelle+Ziel ohne Zentrieren, nennt Label', () => {
		const { mode, deps } = setup();
		mode.start();
		mode.step({ type: 'target', dir: 'right' });
		expect(mode.state).toEqual({ type: 'picking', source: 'A', target: 'B' });
		expect(deps.select).toHaveBeenLastCalledWith(['A', 'B']);
		expect(deps.say).toHaveBeenLastCalledWith({
			key: 'app.shell.connectTarget',
			params: { target: 'Bob' },
			tone: 'info'
		});
		mode.step({ type: 'target', dir: 'right' });
		expect(mode.state).toEqual({ type: 'picking', source: 'A', target: 'C' });
		expect(deps.say).toHaveBeenLastCalledWith({
			key: 'app.shell.connectTarget',
			params: { target: 'C' },
			tone: 'info'
		});
	});

	it('Pfeil ohne Nachbarn: Ziel bleibt, Hinweis', () => {
		const { mode, deps } = setup();
		mode.start();
		mode.step({ type: 'target', dir: 'left' });
		expect(mode.state).toEqual({ type: 'picking', source: 'A', target: null });
		expect(deps.say).toHaveBeenLastCalledWith({ key: 'app.shell.noNeighbor', tone: 'info' });
	});

	it('Pfeil ohne Geometrie (kein Graph-Canvas): kein Nachbar', () => {
		const { mode, deps } = setup(['A'], null);
		mode.start();
		mode.step({ type: 'target', dir: 'right' });
		expect(mode.state).toEqual({ type: 'picking', source: 'A', target: null });
		expect(deps.say).toHaveBeenLastCalledWith({ key: 'app.shell.noNeighbor', tone: 'info' });
	});

	it('Enter mit Ziel verbindet und beendet', () => {
		const { mode, deps } = setup();
		mode.start();
		mode.step({ type: 'target', dir: 'right' });
		mode.step({ type: 'confirm' });
		expect(deps.connect).toHaveBeenCalledWith('A', 'B');
		expect(mode.state).toEqual({ type: 'idle' });
	});

	it('Ziel = Quelle: Enter ohne gewähltes Ziel verbindet nicht, Hinweis', () => {
		const { mode, deps } = setup();
		mode.start();
		mode.step({ type: 'confirm' });
		expect(deps.connect).not.toHaveBeenCalled();
		expect(mode.state).toEqual({ type: 'idle' });
		expect(deps.say).toHaveBeenLastCalledWith({ key: 'app.shell.connectNoTarget', tone: 'info' });
	});

	it('Esc bricht mit Hinweis ab, ohne zu verbinden', () => {
		const { mode, deps } = setup();
		mode.start();
		mode.step({ type: 'target', dir: 'right' });
		mode.step({ type: 'cancel' });
		expect(deps.connect).not.toHaveBeenCalled();
		expect(mode.state).toEqual({ type: 'idle' });
		expect(deps.say).toHaveBeenLastCalledWith({ key: 'app.shell.connectCancelled', tone: 'info' });
	});

	it('Moduswechsel/fremde Taste: reset beendet still', () => {
		const { mode, deps } = setup();
		mode.start();
		deps.say.mockClear();
		mode.reset();
		expect(mode.state).toEqual({ type: 'idle' });
		expect(deps.say).not.toHaveBeenCalled();
		expect(deps.connect).not.toHaveBeenCalled();
	});

	it('step im Ruhezustand ist wirkungslos', () => {
		const { mode, deps } = setup();
		mode.step({ type: 'confirm' });
		mode.step({ type: 'target', dir: 'right' });
		expect(mode.state).toEqual({ type: 'idle' });
		expect(deps.say).not.toHaveBeenCalled();
		expect(deps.connect).not.toHaveBeenCalled();
	});

	it('neighbor (Alt+Pfeil) verbindet direkt, ohne Moduszustand', () => {
		const { mode, deps } = setup();
		mode.neighbor('right');
		expect(deps.connect).toHaveBeenCalledWith('A', 'B');
		expect(mode.active).toBe(false);
		expect(keyOf(deps.say)).toEqual([]);
	});

	it('neighbor ohne Quelle, ohne Nachbarn oder ohne Geometrie: Hinweis', () => {
		for (const [selection, geometry, dir] of [
			[[], GEOMETRY, 'right'],
			[['A'], GEOMETRY, 'up'],
			[['A'], null, 'right']
		] as const) {
			const { mode, deps } = setup([...selection], geometry);
			mode.neighbor(dir);
			expect(deps.connect).not.toHaveBeenCalled();
			expect(keyOf(deps.say)).toEqual(['app.shell.noNeighbor']);
		}
	});
});

describe('createConnectMode: Rückweg zur Quelle (T123 C4, Entscheid: Selbstschleife erlaubt)', () => {
	it('Pfeil zurück auf die Quelle + Enter legt eine Selbstschleife an', () => {
		const { mode, deps } = setup();
		mode.start();
		mode.step({ type: 'target', dir: 'right' });
		mode.step({ type: 'target', dir: 'left' });
		expect(mode.state).toEqual({ type: 'picking', source: 'A', target: 'A' });
		mode.step({ type: 'confirm' });
		expect(deps.connect).toHaveBeenCalledExactlyOnceWith('A', 'A');
		expect(mode.state).toEqual({ type: 'idle' });
	});
});
