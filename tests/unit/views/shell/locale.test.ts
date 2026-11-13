import { describe, expect, it } from 'vitest';
import {
	LOCALE_KEY,
	localeFromLanguage,
	otherLocale,
	readLocale,
	writeLocale
} from '../../../../src/lib/views/shell/locale';

function memory(initial: Record<string, string> = {}) {
	const data = { ...initial };
	return {
		data,
		access: () => ({
			getItem: (k: string) => data[k] ?? null,
			setItem: (k: string, v: string) => void (data[k] = v)
		})
	};
}

const throwing = () => {
	throw new Error('SecurityError');
};

describe('Sprachwahl', () => {
	it('gespeicherte Wahl wird gelesen und geschrieben', () => {
		const store = memory();
		expect(writeLocale(store.access, 'en')).toBe(true);
		expect(store.data[LOCALE_KEY]).toBe('en');
		expect(readLocale(store.access, 'de-DE')).toBe('en');
		expect(readLocale(memory({ [LOCALE_KEY]: 'de' }).access, 'en-US')).toBe('de');
	});

	it('ohne gültigen Eintrag: Browsersprache (de* -> de, sonst en)', () => {
		expect(readLocale(memory().access, 'de-AT')).toBe('de');
		expect(readLocale(memory({ [LOCALE_KEY]: 'fr' }).access, 'DE')).toBe('de');
		expect(readLocale(memory().access, 'en-GB')).toBe('en');
		expect(readLocale(memory().access, 'fr-FR')).toBe('en');
		expect(readLocale(() => null, undefined)).toBe('en');
		expect(localeFromLanguage('')).toBe('en');
	});

	it('werfender oder fehlender Storage: Browsersprache, Schreiben meldet false', () => {
		expect(readLocale(throwing, 'de-DE')).toBe('de');
		expect(writeLocale(throwing, 'en')).toBe(false);
		expect(writeLocale(() => null, 'en')).toBe(false);
	});

	it('otherLocale wechselt', () => {
		expect(otherLocale('de')).toBe('en');
		expect(otherLocale('en')).toBe('de');
	});
});
