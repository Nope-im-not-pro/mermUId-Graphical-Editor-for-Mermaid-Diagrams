import { describe, expect, it } from 'vitest';
import { DICTIONARIES, msg, setLocale, translate } from '../../../../src/lib/services/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Wörterbücher de/en', () => {
	it('identische Schlüsselmengen', () => {
		expect(Object.keys(DICTIONARIES.en).sort()).toEqual(Object.keys(DICTIONARIES.de).sort());
	});

	it('keine leeren Werte, gleiche Platzhalter', () => {
		for (const key of Object.keys(DICTIONARIES.de) as (keyof typeof DICTIONARIES.de)[]) {
			expect(DICTIONARIES.de[key].trim(), `de ${key}`).not.toBe('');
			expect(DICTIONARIES.en[key].trim(), `en ${key}`).not.toBe('');
			expect(placeholders(DICTIONARIES.en[key]), key).toEqual(placeholders(DICTIONARIES.de[key]));
		}
	});

	it('translate setzt Platzhalter, msg folgt setLocale', () => {
		expect(translate('en', 'page.failed', { reason: 'x' })).toBe('Startup failed: x');
		expect(translate('de', 'page.failed', { reason: 'x' })).toBe('Start fehlgeschlagen: x');
		setLocale('en');
		expect(msg('toolbar.save')).toBe('Save');
		setLocale('de');
		expect(msg('toolbar.save')).toBe('Speichern');
	});
});
