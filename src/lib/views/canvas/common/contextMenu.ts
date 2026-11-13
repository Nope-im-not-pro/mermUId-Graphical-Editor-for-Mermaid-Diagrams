/** Einträge und Tastatur-Navigation des Canvas-Kontextmenüs (reine Logik). */
import { t } from '../../shell/i18n.svelte';
import { ALIGN_MIN, DISTRIBUTE_MIN } from './align';

export type MenuItem = { id: string; label: string };

const ALIGN = (): MenuItem[] => [
	{ id: 'align-left', label: t('canvas.menu.alignLeft') },
	{ id: 'align-center', label: t('canvas.menu.alignCenter') },
	{ id: 'align-right', label: t('canvas.menu.alignRight') },
	{ id: 'align-top', label: t('canvas.menu.alignTop') },
	{ id: 'align-middle', label: t('canvas.menu.alignMiddle') },
	{ id: 'align-bottom', label: t('canvas.menu.alignBottom') }
];

const DISTRIBUTE = (): MenuItem[] => [
	{ id: 'distribute-horizontal', label: t('canvas.menu.distributeHorizontal') },
	{ id: 'distribute-vertical', label: t('canvas.menu.distributeVertical') }
];

/** Menü für `selected` ausgewählte Elemente; 0 bedeutet Klick auf die Fläche. */
export function menuItems(selected: number): MenuItem[] {
	if (selected === 0) return [{ id: 'create', label: t('canvas.menu.create') }];
	return [
		...(selected === 1 ? [{ id: 'edit', label: t('canvas.menu.edit') }] : []),
		{ id: 'duplicate', label: t('canvas.menu.duplicate') },
		{ id: 'delete', label: t('canvas.menu.delete') },
		{ id: 'group', label: t('canvas.menu.group') },
		...(selected >= ALIGN_MIN ? ALIGN() : []),
		...(selected >= DISTRIBUTE_MIN ? DISTRIBUTE() : [])
	];
}

export function menuNavigate(index: number, key: string, count: number): number {
	if (key === 'ArrowDown') return (index + 1) % count;
	if (key === 'ArrowUp') return (index - 1 + count) % count;
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	return index;
}

/** Umschalt+F10 oder Kontextmenü-Taste öffnet das Menü per Tastatur. */
export function isMenuKey(e: { key: string; shiftKey: boolean }): boolean {
	return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
}
