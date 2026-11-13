/**
 * Farbschema der Shell (Entwurf A "Studio"): dunkel als Standard, hell umschaltbar.
 * Die Wahl liegt in localStorage; jeder Zugriff in try/catch, ohne Storage gilt der Standard.
 * Ohne gespeicherte Wahl folgt das Schema `prefers-color-scheme` (T105 C2, V-14).
 */
import { get, writable, type Readable } from 'svelte/store';
import type { StorageAccess } from './confirm';

export type Theme = 'dark' | 'light';

export const THEME_KEY = 'mermuid.theme';
export const DEFAULT_THEME: Theme = 'dark';

/** Ausschnitt von `matchMedia`, den die Systemabfrage braucht. */
export interface MediaList {
	readonly matches: boolean;
	addEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void;
	removeEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void;
}
export type MediaAccess = (query: string) => MediaList;

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Gespeicherte Wahl oder `null` (keine, ungültig, Storage fehlt oder wirft). */
export function storedTheme(storage: StorageAccess): Theme | null {
	try {
		const value = storage()?.getItem(THEME_KEY);
		return value === 'light' || value === 'dark' ? value : null;
	} catch {
		return null;
	}
}

/** Gespeicherte Wahl hat Vorrang, sonst `system` (Standard dunkel). */
export function readTheme(storage: StorageAccess, system: Theme = DEFAULT_THEME): Theme {
	return storedTheme(storage) ?? system;
}

/** Systemwert: hell nur bei `prefers-color-scheme: light`, sonst (auch ohne API) dunkel. */
export function systemTheme(media: MediaAccess | undefined): Theme {
	try {
		return media?.(LIGHT_QUERY).matches ? 'light' : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

/** Meldet Wechsel des Systemwerts; liefert die Abmeldung (ohne API: nichts zu tun). */
export function watchSystemTheme(
	media: MediaAccess | undefined,
	onchange: (theme: Theme) => void
): () => void {
	let list: MediaList;
	try {
		if (!media) return () => {};
		list = media(LIGHT_QUERY);
	} catch {
		return () => {};
	}
	const listener = (e: { matches: boolean }) => onchange(e.matches ? 'light' : DEFAULT_THEME);
	list.addEventListener('change', listener);
	return () => list.removeEventListener('change', listener);
}

/** Farbschema des Dokuments (Hintergrund, Formulare, Scrollbalken), auch vor dem Shell-Start. */
export function applyColorScheme(theme: Theme) {
	if (typeof document !== 'undefined') document.documentElement.style.colorScheme = theme;
}

/** Speichert die Wahl; `false`, wenn der Storage fehlt oder wirft. */
export function writeTheme(storage: StorageAccess, theme: Theme): boolean {
	try {
		const store = storage();
		if (!store) return false;
		store.setItem(THEME_KEY, theme);
		return true;
	} catch {
		return false;
	}
}

export const otherTheme = (theme: Theme): Theme => (theme === 'dark' ? 'light' : 'dark');

/** Farbschema-Zustand der Shell (T123 C4): Startwert, Umschalten, Systemwechsel ohne Wahl. */
export interface ThemeState {
	readonly theme: Readable<Theme>;
	/** Wechselt hell/dunkel und speichert die Wahl; danach folgt das Schema nicht mehr dem System. */
	toggle(): void;
	/** Folgt dem System, solange keine Wahl getroffen ist; liefert die Abmeldung. */
	watch(): () => void;
}

/** Gespeichertes Schema beim Start, sonst Systemwert (Storage ist danach fest). */
export function createTheme(storage: StorageAccess, media: MediaAccess | undefined): ThemeState {
	const theme = writable(readTheme(storage, systemTheme(media)));
	/** Ohne gespeicherte Wahl folgt das Schema live dem System (T105 C2, V-14). */
	let chosen = storedTheme(storage) !== null;
	return {
		theme: { subscribe: theme.subscribe },
		toggle() {
			chosen = true;
			theme.set(otherTheme(get(theme)));
			writeTheme(storage, get(theme));
		},
		watch: () =>
			watchSystemTheme(media, (next) => {
				if (!chosen) theme.set(next);
			})
	};
}
