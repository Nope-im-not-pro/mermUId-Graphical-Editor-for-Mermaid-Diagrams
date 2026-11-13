import { describe, expect, it } from 'vitest';
import {
	connectKey,
	cycleTarget,
	neighbor,
	resolveKey,
	type KeyContext
} from '../../../../src/lib/views/shell/keymap';

const key = (
	k: string,
	mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>> = {}
) => ({
	key: k,
	ctrlKey: !!mods.ctrl,
	metaKey: !!mods.meta,
	shiftKey: !!mods.shift,
	altKey: !!mods.alt
});

const app: KeyContext = {
	inApp: true,
	canvasFocused: false,
	editing: false,
	dialogOpen: false,
	graph: true,
	zoomable: true
};
const canvas: KeyContext = { ...app, canvasFocused: true };

describe('resolveKey: Strg-Kürzel', () => {
	it('Strg-S, Strg-E, Strg-F, F1 bei Fokus in der App', () => {
		expect(resolveKey(key('s', { ctrl: true }), app)).toEqual({ type: 'save' });
		expect(resolveKey(key('S', { meta: true }), app)).toEqual({ type: 'save' });
		expect(resolveKey(key('e', { ctrl: true }), app)).toEqual({ type: 'toggleCode' });
		expect(resolveKey(key('f', { ctrl: true }), app)).toEqual({ type: 'search' });
		expect(resolveKey(key('F1'), app)).toEqual({ type: 'help' });
	});

	it('außerhalb der App oder bei offenem Dialog: nichts', () => {
		expect(resolveKey(key('s', { ctrl: true }), { ...app, inApp: false })).toBeNull();
		expect(resolveKey(key('F1'), { ...app, dialogOpen: true })).toBeNull();
	});

	it('Undo/Redo global, aber nicht in Eingabefeldern (Code-Panel bindet selbst)', () => {
		expect(resolveKey(key('z', { ctrl: true }), app)).toEqual({ type: 'undo' });
		expect(resolveKey(key('y', { ctrl: true }), app)).toEqual({ type: 'redo' });
		expect(resolveKey(key('Z', { ctrl: true, shift: true }), app)).toEqual({ type: 'redo' });
		expect(resolveKey(key('z', { ctrl: true }), { ...app, editing: true })).toBeNull();
		expect(resolveKey(key('y', { ctrl: true }), { ...app, editing: true })).toBeNull();
	});

	it('Zoom bei zoombarem Canvas (Graph und Sequenz), sonst Browser', () => {
		const seq = { ...app, graph: false, zoomable: true };
		for (const ctx of [app, seq, { ...canvas, graph: false }]) {
			expect(resolveKey(key('+', { ctrl: true }), ctx)).toEqual({ type: 'zoomIn' });
			// Numpad-Plus/-Minus liefern dieselben `key`-Werte wie die Haupttastatur.
			expect(resolveKey(key('+', { ctrl: true, shift: true }), ctx)).toEqual({ type: 'zoomIn' });
			expect(resolveKey(key('=', { ctrl: true }), ctx)).toEqual({ type: 'zoomIn' });
			expect(resolveKey(key('-', { ctrl: true }), ctx)).toEqual({ type: 'zoomOut' });
			expect(resolveKey(key('0', { ctrl: true }), ctx)).toEqual({ type: 'fit' });
			expect(resolveKey(key('0', { meta: true }), ctx)).toEqual({ type: 'fit' });
		}
		// Nur Code (kein zoombarer Canvas): Browser-Zoom bleibt.
		for (const k of ['+', '=', '-', '0']) {
			expect(
				resolveKey(key(k, { ctrl: true }), { ...app, graph: false, zoomable: false })
			).toBeNull();
		}
	});

	it('Zoom nicht im Code-Editor oder Eingabefeld (Graph und Sequenz gleich)', () => {
		for (const ctx of [app, { ...app, graph: false }]) {
			for (const k of ['+', '=', '-', '0']) {
				expect(resolveKey(key(k, { ctrl: true }), { ...ctx, editing: true }), k).toBeNull();
			}
		}
	});

	it('Strg-A nur bei fokussiertem Canvas ohne Editor', () => {
		expect(resolveKey(key('a', { ctrl: true }), canvas)).toEqual({ type: 'selectAll' });
		expect(resolveKey(key('a', { ctrl: true }), app)).toBeNull();
		expect(resolveKey(key('a', { ctrl: true }), { ...canvas, editing: true })).toBeNull();
	});

	it('Strg-Alt und unbekannte Strg-Tasten: nichts (Strg-D bleibt beim Canvas)', () => {
		expect(resolveKey(key('s', { ctrl: true, alt: true }), app)).toBeNull();
		expect(resolveKey(key('d', { ctrl: true }), canvas)).toBeNull();
	});
});

describe('resolveKey: Einzeltasten', () => {
	it('nur bei fokussiertem Canvas, ohne Editor, Layout-Klasse Graph', () => {
		expect(resolveKey(key('g'), app)).toBeNull();
		expect(resolveKey(key('g'), { ...canvas, editing: true })).toBeNull();
		expect(resolveKey(key('g'), { ...canvas, graph: false })).toBeNull();
	});

	it('G / Shift-G: Raster / Einrasten', () => {
		expect(resolveKey(key('g'), canvas)).toEqual({ type: 'toggleGrid' });
		expect(resolveKey(key('G', { shift: true }), canvas)).toEqual({ type: 'toggleSnap' });
	});

	it('C startet Verbinden', () => {
		expect(resolveKey(key('c'), canvas)).toEqual({ type: 'connectStart' });
		expect(resolveKey(key('C', { shift: true }), canvas)).toBeNull();
	});

	it('Tab / Shift-Tab wechseln die Auswahl', () => {
		expect(resolveKey(key('Tab'), canvas)).toEqual({ type: 'cycle', dir: 1 });
		expect(resolveKey(key('Tab', { shift: true }), canvas)).toEqual({ type: 'cycle', dir: -1 });
	});

	it('Shift-Pfeil: 10-facher Schritt; einfacher Pfeil bleibt beim Canvas', () => {
		expect(resolveKey(key('ArrowLeft', { shift: true }), canvas)).toEqual({
			type: 'nudge',
			dx: -10,
			dy: 0
		});
		expect(resolveKey(key('ArrowDown', { shift: true }), canvas)).toEqual({
			type: 'nudge',
			dx: 0,
			dy: 10
		});
		expect(resolveKey(key('ArrowLeft'), canvas)).toBeNull();
	});

	it('Alt-Pfeil verbindet mit Nachbar', () => {
		expect(resolveKey(key('ArrowUp', { alt: true }), canvas)).toEqual({
			type: 'connectNeighbor',
			dir: 'up'
		});
		expect(resolveKey(key('ArrowUp', { alt: true, shift: true }), canvas)).toBeNull();
	});

	it('andere Tasten: nichts', () => {
		expect(resolveKey(key('x'), canvas)).toBeNull();
		expect(resolveKey(key('Delete'), canvas)).toBeNull();
	});
});

describe('connectKey', () => {
	it('Pfeile, Enter, Esc', () => {
		expect(connectKey(key('ArrowRight'))).toEqual({ type: 'target', dir: 'right' });
		expect(connectKey(key('Enter'))).toEqual({ type: 'confirm' });
		expect(connectKey(key('Escape'))).toEqual({ type: 'cancel' });
		expect(connectKey(key('x'))).toBeNull();
		expect(connectKey(key('ArrowRight', { ctrl: true }))).toBeNull();
	});
});

describe('neighbor', () => {
	const g = {
		a: { x: 0, y: 0, w: 10, h: 10 },
		b: { x: 100, y: 0, w: 10, h: 10 },
		c: { x: 50, y: 0, w: 10, h: 10 },
		d: { x: 0, y: 100, w: 10, h: 10 },
		e: { x: 30, y: -200, w: 10, h: 10 }
	};

	it('nächster Knoten in Pfeilrichtung', () => {
		expect(neighbor(g, ['a', 'b', 'c', 'd', 'e'], 'a', 'right')).toBe('c');
		expect(neighbor(g, ['a', 'b', 'c', 'd', 'e'], 'c', 'right')).toBe('b');
		expect(neighbor(g, ['a', 'b', 'c', 'd', 'e'], 'a', 'down')).toBe('d');
		expect(neighbor(g, ['a', 'b', 'c', 'd', 'e'], 'a', 'up')).toBe('e');
		expect(neighbor(g, ['a', 'b', 'c', 'd', 'e'], 'a', 'left')).toBeNull();
	});

	it('ohne Geometrie: null', () => {
		expect(neighbor(g, ['a', 'x'], 'x', 'left')).toBeNull();
		expect(neighbor(g, ['a', 'x'], 'a', 'right')).toBeNull();
	});
});

describe('cycleTarget', () => {
	it('vor und zurück, am Rand null (Tab verlässt den Canvas)', () => {
		const order = ['a', 'b', 'c'];
		expect(cycleTarget(order, null, 1)).toBe('a');
		expect(cycleTarget(order, null, -1)).toBe('c');
		expect(cycleTarget(order, 'a', 1)).toBe('b');
		expect(cycleTarget(order, 'b', -1)).toBe('a');
		expect(cycleTarget(order, 'c', 1)).toBeNull();
		expect(cycleTarget(order, 'a', -1)).toBeNull();
		expect(cycleTarget(order, 'x', 1)).toBe('a');
		expect(cycleTarget([], null, 1)).toBeNull();
	});
});
