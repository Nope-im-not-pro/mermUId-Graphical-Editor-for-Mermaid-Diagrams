// Reaktive Sprache der Views (Runes): t() liest den $state, Markup und $derived folgen dem
// Wechsel ohne Neustart. applyLocale setzt zusätzlich Services-Sprache und <html lang>.
import {
	setLocale,
	translate,
	type Locale,
	type MessageKey,
	type Params
} from '../../services/i18n';

const state = $state<{ locale: Locale }>({ locale: 'de' });

export function t(key: MessageKey, params?: Params): string {
	return translate(state.locale, key, params);
}

export function currentLocale(): Locale {
	return state.locale;
}

export function applyLocale(locale: Locale): void {
	state.locale = locale;
	setLocale(locale);
	if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
