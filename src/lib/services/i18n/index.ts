// Übersetzung ohne Abhängigkeit (Task i18n): Wörterbücher de/en, Platzhalter {name}.
// Services und Controller nutzen msg() mit der zuletzt gesetzten Sprache; Views nutzen das
// reaktive t() aus views/shell/i18n.svelte.ts.
import { de, en } from './messages';

export type Locale = 'de' | 'en';
export type MessageKey = keyof typeof de;
export type Params = Record<string, string | number>;

export const LOCALES: readonly Locale[] = ['de', 'en'];
export const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { de, en };

let current: Locale = 'de';

export function setLocale(locale: Locale): void {
	current = locale;
}

export function getLocale(): Locale {
	return current;
}

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
	const text = DICTIONARIES[locale][key];
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (all, name: string) =>
		name in params ? String(params[name]) : all
	);
}

/** Text in der aktuell gesetzten Sprache (nicht reaktiv, für Services/Controller). */
export function msg(key: MessageKey, params?: Params): string {
	return translate(current, key, params);
}
