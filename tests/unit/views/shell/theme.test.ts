import { describe, expect, it } from 'vitest';
import {
	DEFAULT_THEME,
	otherTheme,
	readTheme,
	storedTheme,
	systemTheme,
	THEME_KEY,
	watchSystemTheme,
	writeTheme,
	type MediaAccess
} from '../../../../src/lib/views/shell/theme';

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

describe('Farbschema (Entwurf A)', () => {
	it('Standard ist dunkel, ohne oder mit ungültigem Eintrag', () => {
		expect(DEFAULT_THEME).toBe('dark');
		expect(readTheme(memory().access)).toBe('dark');
		expect(readTheme(memory({ [THEME_KEY]: 'blau' }).access)).toBe('dark');
		expect(readTheme(() => null)).toBe('dark');
	});

	it('gespeicherte Wahl wird gelesen und geschrieben', () => {
		const store = memory();
		expect(writeTheme(store.access, 'light')).toBe(true);
		expect(store.data[THEME_KEY]).toBe('light');
		expect(readTheme(store.access)).toBe('light');
	});

	it('werfender oder fehlender Storage: Standard, Schreiben meldet false', () => {
		expect(readTheme(throwing)).toBe('dark');
		expect(writeTheme(throwing, 'light')).toBe(false);
		expect(writeTheme(() => undefined, 'light')).toBe(false);
	});

	it('Umschalten wechselt zwischen dunkel und hell', () => {
		expect(otherTheme('dark')).toBe('light');
		expect(otherTheme('light')).toBe('dark');
	});
});

/** matchMedia-Attrappe: `light` steuert `(prefers-color-scheme: light)`, `change()` meldet Wechsel. */
function media(light: boolean) {
	const listeners = new Set<(e: { matches: boolean }) => void>();
	const queries: string[] = [];
	const state = { light };
	const access: MediaAccess = (query: string) => {
		queries.push(query);
		return {
			get matches() {
				return query === '(prefers-color-scheme: light)' && state.light;
			},
			addEventListener: (_: 'change', l: (e: { matches: boolean }) => void) =>
				void listeners.add(l),
			removeEventListener: (_: 'change', l: (e: { matches: boolean }) => void) =>
				listeners.delete(l)
		};
	};
	return {
		access,
		queries,
		listeners,
		change(next: boolean) {
			state.light = next;
			for (const l of [...listeners]) l({ matches: next });
		}
	};
}

describe('Farbschema nach System (T105 C2, V-14)', () => {
	it('storedTheme: nur eine gültige gespeicherte Wahl, sonst null', () => {
		expect(storedTheme(memory().access)).toBeNull();
		expect(storedTheme(memory({ [THEME_KEY]: 'blau' }).access)).toBeNull();
		expect(storedTheme(throwing)).toBeNull();
		expect(storedTheme(memory({ [THEME_KEY]: 'light' }).access)).toBe('light');
	});

	it('readTheme: gespeicherte Wahl vor Systemwert', () => {
		expect(readTheme(memory().access, 'light')).toBe('light');
		expect(readTheme(throwing, 'light')).toBe('light');
		expect(readTheme(memory({ [THEME_KEY]: 'dark' }).access, 'light')).toBe('dark');
	});

	it('systemTheme: hell nur bei prefers-color-scheme: light, sonst dunkel', () => {
		expect(systemTheme(media(true).access)).toBe('light');
		expect(systemTheme(media(false).access)).toBe('dark');
		expect(systemTheme(undefined)).toBe('dark');
		expect(
			systemTheme(() => {
				throw new Error('kaputt');
			})
		).toBe('dark');
	});

	it('watchSystemTheme meldet Wechsel bis zum Abmelden', () => {
		const m = media(false);
		const seen: string[] = [];
		const stop = watchSystemTheme(m.access, (theme) => seen.push(theme));
		m.change(true);
		m.change(false);
		stop();
		m.change(true);
		expect(seen).toEqual(['light', 'dark']);
		expect(m.listeners.size).toBe(0);
		expect(watchSystemTheme(undefined, () => seen.push('x'))).toBeTypeOf('function');
	});
});
