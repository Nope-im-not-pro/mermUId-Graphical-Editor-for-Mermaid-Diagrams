// Sprachwahl (Task i18n): gespeicherte Wahl, sonst Browsersprache (de* -> de, sonst en).
// Gleicher Storage wie Farbschema und Löschen-Rückfrage; jeder Zugriff abgesichert.
import type { Locale } from '../../services/i18n';
import { get, writable, type Readable } from 'svelte/store';
import type { StorageAccess } from './confirm';
import { applyLocale } from './i18n.svelte';

export type { Locale };

export const LOCALE_KEY = 'mermuid.locale';

const isLocale = (v: unknown): v is Locale => v === 'de' || v === 'en';

/** Browsersprache auf de/en abbilden; ohne Angabe Englisch. */
export function localeFromLanguage(language: string | null | undefined): Locale {
	return language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function readLocale(storage: StorageAccess, language?: string | null): Locale {
	try {
		const v = storage()?.getItem(LOCALE_KEY);
		if (isLocale(v)) return v;
	} catch {
		// Storage gesperrt: Browsersprache
	}
	return localeFromLanguage(language);
}

/** Wahl merken; false, wenn der Storage fehlt oder wirft. */
export function writeLocale(storage: StorageAccess, locale: Locale): boolean {
	try {
		const s = storage();
		if (!s) return false;
		s.setItem(LOCALE_KEY, locale);
		return true;
	} catch {
		return false;
	}
}

export const otherLocale = (l: Locale): Locale => (l === 'de' ? 'en' : 'de');

/** Sprach-Zustand der Shell (T123 C4): Startwert gilt sofort für t() und <html lang>. */
export interface LocaleState {
	readonly locale: Readable<Locale>;
	/** Wechselt de/en, speichert die Wahl und wendet sie an. */
	toggle(): void;
}

export function createLocale(storage: StorageAccess, language?: string | null): LocaleState {
	const locale = writable(readLocale(storage, language));
	applyLocale(get(locale));
	return {
		locale: { subscribe: locale.subscribe },
		toggle() {
			locale.set(otherLocale(get(locale)));
			writeLocale(storage, get(locale));
			applyLocale(get(locale));
		}
	};
}
