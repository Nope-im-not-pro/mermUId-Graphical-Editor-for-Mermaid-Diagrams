/**
 * Entwurfs-Sicherung (T132 C1, F-13): Code und Dateiname ungespeicherter Änderungen verzögert in
 * localStorage; sauberer Stand (gespeichert/unverändert) löscht den eigenen Entwurf. Nur der
 * Dateiname ohne Pfad, kein Handle (KONZEPT §10). Jeder Storage-Zugriff in try/catch: Quota-
 * und Zugriffsfehler lassen das laufende Dokument unberührt.
 */
import type { StorageAccess } from './confirm';

export const DRAFT_KEY = 'mermuid.draft';
/** Verzögerung nach der letzten Änderung, bevor gesichert wird. */
export const DRAFT_DELAY = 1000;

export interface Draft {
	code: string;
	name: string;
}

/** `removeItem` optional: Attrappen und ältere Zugriffe kennen nur get/set. */
export type DraftStorage = () =>
	(ReturnType<StorageAccess> & Partial<Pick<Storage, 'removeItem'>>) | null | undefined;

/** Nur der letzte Pfadteil (KONZEPT §10: kein Dateipfad im Speicher). */
const baseName = (name: string) => name.split(/[\\/]/).pop() ?? '';

const blank = (code: string) => code.trim() === '';

export function readDraft(storage: DraftStorage): Draft | null {
	try {
		const raw = storage()?.getItem(DRAFT_KEY);
		if (!raw) return null;
		const value: unknown = JSON.parse(raw);
		if (typeof value !== 'object' || value === null) return null;
		const { code, name } = value as Record<string, unknown>;
		if (typeof code !== 'string' || typeof name !== 'string' || blank(code)) return null;
		return { code, name: baseName(name) };
	} catch {
		return null;
	}
}

/** `false`, wenn nicht gespeichert wurde (kein Storage, Quota, Zugriff verweigert). */
export function writeDraft(storage: DraftStorage, draft: Draft): boolean {
	try {
		const s = storage();
		if (!s) return false;
		s.setItem(DRAFT_KEY, JSON.stringify({ code: draft.code, name: baseName(draft.name) }));
		return true;
	} catch {
		return false;
	}
}

export function removeDraft(storage: DraftStorage): boolean {
	try {
		const s = storage();
		if (!s) return false;
		if (s.removeItem) s.removeItem(DRAFT_KEY);
		else s.setItem(DRAFT_KEY, '');
		return true;
	} catch {
		return false;
	}
}

export interface DraftState extends Draft {
	/** Ungespeicherte Änderungen gegenüber dem geladenen/gespeicherten Stand. */
	dirty: boolean;
}

export interface DraftKeeper {
	/** Je Änderung aufrufen: geändert -> verzögert sichern; sauber -> eigenen Entwurf löschen. */
	update(state: DraftState): void;
	/** Ausstehenden Stand sofort sichern (z. B. `pagehide`). */
	flush(): void;
	/** Entwurf verwerfen (Ablehnen der Rückfrage). */
	clear(): void;
	/** Ausstehenden Stand verwerfen, nichts schreiben. */
	dispose(): void;
}

export function createDraftKeeper(storage: DraftStorage, delay = DRAFT_DELAY): DraftKeeper {
	let pending: Draft | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Seit Start gab es einen eigenen geänderten Stand. Erst dann löscht ein sauberer Stand den
	 * gespeicherten Entwurf. Esc auf der Start-Rückfrage behält den Entwurf so bis zur nächsten
	 * Änderung (diese überschreibt ihn verzögert).
	 */
	let owned = false;

	function cancel() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		pending = null;
	}

	function flush() {
		const draft = pending;
		cancel();
		if (draft) writeDraft(storage, draft);
	}

	return {
		update({ code, name, dirty }) {
			if (!dirty || blank(code)) {
				cancel();
				if (owned) removeDraft(storage);
				owned = false;
				return;
			}
			owned = true;
			pending = { code, name };
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(flush, delay);
		},
		flush,
		clear() {
			cancel();
			owned = false;
			removeDraft(storage);
		},
		dispose: cancel
	};
}
