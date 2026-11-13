/**
 * Löschen-Rückfrage (D-10, KONZEPT §5): Knoten mit Kanten fragt einmalig, dauerhaft abschaltbar
 * über localStorage. Jeder Storage-Zugriff in try/catch; ohne Storage bleibt die Rückfrage aktiv.
 */
import type { DiagramDocument } from '../../model/types';

export const CONFIRM_KEY = 'mermuid.confirmDelete';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
/** Zugriff als Funktion, weil schon `localStorage` selbst werfen kann (SecurityError). */
export type StorageAccess = () => StorageLike | null | undefined;

export const browserStorage: StorageAccess = () => globalThis.localStorage;

export function confirmEnabled(storage: StorageAccess = browserStorage): boolean {
	try {
		return storage()?.getItem(CONFIRM_KEY) !== 'false';
	} catch {
		return true;
	}
}

/** Schaltet die Rückfrage dauerhaft ab; `false`, wenn der Wert nicht gespeichert wurde. */
export function disableConfirm(storage: StorageAccess = browserStorage): boolean {
	try {
		const s = storage();
		if (!s) return false;
		s.setItem(CONFIRM_KEY, 'false');
		return true;
	} catch {
		return false;
	}
}

/** Rückfrage nötig: mindestens ein zu löschender Knoten hat Kanten; nie bei Shift-Entf. */
export function needsConfirm(
	doc: DiagramDocument,
	ids: readonly string[],
	{ force, enabled }: { force: boolean; enabled: boolean }
): boolean {
	if (force || !enabled) return false;
	const nodes = new Set(doc.nodes.filter((n) => ids.includes(n.id)).map((n) => n.id));
	return doc.edges.some((e) => nodes.has(e.sourceId) || nodes.has(e.targetId));
}
