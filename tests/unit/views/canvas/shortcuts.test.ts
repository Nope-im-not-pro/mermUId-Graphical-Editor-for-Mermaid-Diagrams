import { describe, expect, it } from 'vitest';
import {
	clipboardShortcut,
	editorKey,
	resolveShortcut
} from '../../../../src/lib/views/canvas/common/shortcuts';

const key = (
	k: string,
	mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}
) => ({
	key: k,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	...mods
});
const ctx = { canvasFocused: true, editing: false, step: 8 };

describe('resolveShortcut', () => {
	it('Einzeltasten nur mit Canvas-Fokus und ohne aktiven Editor', () => {
		expect(resolveShortcut(key('Delete'), ctx)).toEqual({ type: 'delete' });
		expect(resolveShortcut(key('Delete'), { ...ctx, canvasFocused: false })).toBeNull();
		expect(resolveShortcut(key('Delete'), { ...ctx, editing: true })).toBeNull();
		expect(resolveShortcut(key('F2'), { ...ctx, editing: true })).toBeNull();
	});

	it('Bearbeiten, Löschen, Duplizieren', () => {
		expect(resolveShortcut(key('F2'), ctx)).toEqual({ type: 'edit' });
		expect(resolveShortcut(key('Backspace'), ctx)).toEqual({ type: 'delete' });
		expect(resolveShortcut(key('d', { ctrlKey: true }), ctx)).toEqual({ type: 'duplicate' });
		expect(resolveShortcut(key('D', { metaKey: true }), ctx)).toEqual({ type: 'duplicate' });
		expect(resolveShortcut(key('d'), ctx)).toBeNull();
		expect(resolveShortcut(key('Delete', { ctrlKey: true }), ctx)).toBeNull();
	});

	it('Pfeiltasten verschieben um die Schrittweite', () => {
		expect(resolveShortcut(key('ArrowLeft'), ctx)).toEqual({ type: 'move', dx: -8, dy: 0 });
		expect(resolveShortcut(key('ArrowRight'), ctx)).toEqual({ type: 'move', dx: 8, dy: 0 });
		expect(resolveShortcut(key('ArrowUp'), ctx)).toEqual({ type: 'move', dx: 0, dy: -8 });
		expect(resolveShortcut(key('ArrowDown'), ctx)).toEqual({ type: 'move', dx: 0, dy: 8 });
		expect(resolveShortcut(key('ArrowDown', { altKey: true }), ctx)).toBeNull();
		expect(resolveShortcut(key('x'), ctx)).toBeNull();
	});
});

describe('clipboardShortcut (T133 C3)', () => {
	it('Strg/Cmd-C/X/V: Kopieren, Ausschneiden, Einfügen', () => {
		expect(clipboardShortcut(key('c', { ctrlKey: true }), ctx)).toBe('copy');
		expect(clipboardShortcut(key('X', { ctrlKey: true }), ctx)).toBe('cut');
		expect(clipboardShortcut(key('v', { metaKey: true }), ctx)).toBe('paste');
		expect(clipboardShortcut(key('v', { ctrlKey: true, shiftKey: true }), ctx)).toBe('paste');
	});

	it('nicht mit Alt, ohne Strg/Cmd, ohne Canvas-Fokus oder im Editor', () => {
		expect(clipboardShortcut(key('c', { ctrlKey: true, altKey: true }), ctx)).toBeNull();
		expect(clipboardShortcut(key('v'), ctx)).toBeNull();
		expect(clipboardShortcut(key('c', { ctrlKey: true }), { ...ctx, editing: true })).toBeNull();
		expect(
			clipboardShortcut(key('v', { ctrlKey: true }), { ...ctx, canvasFocused: false })
		).toBeNull();
		expect(clipboardShortcut(key('d', { ctrlKey: true }), ctx)).toBeNull();
		expect(clipboardShortcut(key('constructor', { ctrlKey: true }), ctx)).toBeNull();
	});

	it('resolveShortcut liefert für Strg-C/X/V nichts (Sequenz-Canvas: no-op)', () => {
		for (const k of ['c', 'x', 'v']) {
			expect(resolveShortcut(key(k, { ctrlKey: true }), ctx)).toBeNull();
		}
	});
});

describe('editorKey', () => {
	it('Enter übernimmt, Umschalt+Enter ist Zeilenumbruch, Escape verwirft', () => {
		expect(editorKey(key('Enter'))).toBe('commit');
		expect(editorKey(key('Enter', { shiftKey: true }))).toBeNull();
		expect(editorKey(key('Escape'))).toBe('cancel');
		expect(editorKey(key('a'))).toBeNull();
	});
});
