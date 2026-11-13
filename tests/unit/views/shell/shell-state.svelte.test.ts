// @vitest-environment jsdom
// T123 C4 (V-24): aus Shell.svelte gelöste Zustände - Meldung, Farbschema, Sprache, Banner-Abstand.
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAP, insetFor, MIN_BANNER, watchInset } from '../../../../src/lib/views/shell/banner';
import { applyLocale, currentLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import { createLocale, LOCALE_KEY } from '../../../../src/lib/views/shell/locale';
import { createMessages, SUCCESS_MS } from '../../../../src/lib/views/shell/messages.svelte';
import { createTheme, THEME_KEY, type MediaAccess } from '../../../../src/lib/views/shell/theme';

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

function fakeMedia(matches: boolean) {
	const listeners = new Set<(e: { matches: boolean }) => void>();
	const media: MediaAccess = () => ({
		matches,
		addEventListener: (_t, l) => void listeners.add(l),
		removeEventListener: (_t, l) => void listeners.delete(l)
	});
	return { media, emit: (m: boolean) => listeners.forEach((l) => l({ matches: m })), listeners };
}

afterEach(() => {
	vi.useRealTimers();
	applyLocale('de');
});

describe('createMessages', () => {
	function setup(initial = 'A') {
		let code = $state(initial);
		let messages!: ReturnType<typeof createMessages>;
		const stop = $effect.root(() => {
			messages = createMessages(() => code);
		});
		flushSync();
		return { messages, setCode: (c: string) => ((code = c), flushSync()), stop };
	}

	it('Erfolg verschwindet nach SUCCESS_MS, Fehler bleibt', () => {
		vi.useFakeTimers();
		const { messages, stop } = setup();
		messages.say({ key: 'app.shell.copied', tone: 'success' });
		flushSync();
		vi.advanceTimersByTime(SUCCESS_MS - 1);
		expect(messages.current?.tone).toBe('success');
		vi.advanceTimersByTime(1);
		expect(messages.current).toBeNull();
		messages.say({ key: 'app.shell.rememberFailed', tone: 'error' });
		flushSync();
		vi.advanceTimersByTime(SUCCESS_MS * 2);
		expect(messages.current?.tone).toBe('error');
		stop();
	});

	it('Code-Änderung nach dem Setzen blendet Erfolg aus, Hinweis bleibt', () => {
		const { messages, setCode, stop } = setup();
		messages.say({ key: 'app.shell.copied', tone: 'success' });
		flushSync();
		setCode('B');
		expect(messages.current).toBeNull();
		messages.say({ key: 'app.shell.connectStart', tone: 'info' });
		setCode('C');
		expect(messages.current?.key).toBe('app.shell.connectStart');
		stop();
	});
});

describe('createTheme', () => {
	it('ohne Wahl Systemwert und folgt dem System; nach toggle gespeichert und fest', () => {
		const store = memory();
		const sys = fakeMedia(true);
		const state = createTheme(store.access, sys.media);
		expect(get(state.theme)).toBe('light');
		const stop = state.watch();
		sys.emit(false);
		expect(get(state.theme)).toBe('dark');
		state.toggle();
		expect(get(state.theme)).toBe('light');
		expect(store.data[THEME_KEY]).toBe('light');
		sys.emit(false);
		expect(get(state.theme)).toBe('light');
		stop();
		expect(sys.listeners.size).toBe(0);
	});

	it('gespeicherte Wahl hat Vorrang und ignoriert Systemwechsel', () => {
		const sys = fakeMedia(true);
		const state = createTheme(memory({ [THEME_KEY]: 'dark' }).access, sys.media);
		state.watch();
		sys.emit(true);
		expect(get(state.theme)).toBe('dark');
	});
});

describe('createLocale', () => {
	it('Startwert gilt sofort; toggle speichert und wendet an', () => {
		const store = memory();
		const state = createLocale(store.access, 'en-US');
		expect(get(state.locale)).toBe('en');
		expect(currentLocale()).toBe('en');
		state.toggle();
		expect(get(state.locale)).toBe('de');
		expect(currentLocale()).toBe('de');
		expect(store.data[LOCALE_KEY]).toBe('de');
	});
});

describe('Banner-Abstand', () => {
	const rect = (left: number, top: number, width: number, height: number) =>
		({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
	const el = (r: DOMRect) => {
		const e = document.createElement('div');
		e.getBoundingClientRect = () => r;
		return e;
	};

	it('Graph: rechts/links der Panels; zu schmal -> nur Ränder', () => {
		const box = el(rect(0, 0, 800, 400));
		const left = [el(rect(0, 350, 100, 40))];
		const right = [el(rect(700, 350, 100, 40)), el(rect(0, 0, 0, 0))];
		expect(insetFor(box, { top: [], left, right }, true)).toEqual({
			left: 100 + GAP,
			right: 100 + GAP
		});
		const narrow = el(rect(0, 0, 100 + 2 * GAP + MIN_BANNER - 1, 400));
		const wide = [el(rect(0, 350, 100, 40))];
		expect(insetFor(narrow, { top: [], left: wide, right: [] }, true)).toEqual({
			left: GAP,
			right: GAP
		});
	});

	it('Sequenz: unterhalb der Werkzeugleiste', () => {
		const box = el(rect(0, 50, 800, 400));
		expect(insetFor(box, { top: [el(rect(0, 50, 300, 30))], left: [], right: [] }, false)).toEqual({
			top: 30 + GAP
		});
	});

	it('watchInset: sofort gesetzt, beobachtet Fläche, Abmeldung trennt', () => {
		const observed: Element[] = [];
		const disconnect = vi.fn();
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe = (e: Element) => void observed.push(e);
				disconnect = disconnect;
			}
		);
		const box = el(rect(0, 0, 800, 400));
		const set = vi.fn();
		const stop = watchInset(box, true, set);
		expect(set).toHaveBeenCalledWith({ left: GAP, right: GAP });
		expect(observed).toEqual([box]);
		stop();
		expect(disconnect).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});
});
