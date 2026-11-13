import { describe, expect, it } from 'vitest';
import {
	isMenuKey,
	menuItems,
	menuNavigate
} from '../../../../src/lib/views/canvas/common/contextMenu';

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('Kontextmenü', () => {
	it('Fläche: nur Anlegen', () => {
		expect(ids(menuItems(0))).toEqual(['create']);
	});

	it('Auswahl: Aktionen, Ausrichten ab zwei, Verteilen ab drei', () => {
		const one = menuItems(1);
		expect(ids(one)).toEqual(['edit', 'duplicate', 'delete', 'group']);
		const two = ids(menuItems(2));
		expect(two).not.toContain('edit');
		expect(two).toContain('align-left');
		expect(two).not.toContain('distribute-horizontal');
		expect(ids(menuItems(3))).toContain('distribute-vertical');
		expect(one.every((i) => i.label.length > 0)).toBe(true);
	});

	it('Pfeile, Pos1, Ende mit Umlauf', () => {
		expect(menuNavigate(0, 'ArrowDown', 3)).toBe(1);
		expect(menuNavigate(2, 'ArrowDown', 3)).toBe(0);
		expect(menuNavigate(0, 'ArrowUp', 3)).toBe(2);
		expect(menuNavigate(1, 'Home', 3)).toBe(0);
		expect(menuNavigate(1, 'End', 3)).toBe(2);
		expect(menuNavigate(1, 'x', 3)).toBe(1);
	});

	it('Umschalt+F10 und Kontextmenü-Taste', () => {
		const k = (key: string, shiftKey = false) => ({ key, shiftKey });
		expect(isMenuKey(k('F10', true))).toBe(true);
		expect(isMenuKey(k('ContextMenu'))).toBe(true);
		expect(isMenuKey(k('F10'))).toBe(false);
	});
});
