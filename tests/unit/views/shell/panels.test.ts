// T129 C1 (M-09 a, D6): Leisten einklappbar ab 900 px, Schublade darunter, Mindestbreite 640 px.
import { describe, expect, it } from 'vitest';
import {
	closeDrawer,
	dockOpen,
	initialDocks,
	MIN_QUERY,
	MIN_WIDTH,
	NARROW_QUERY,
	nextTab,
	toggleDock,
	watchNarrow
} from '../../../../src/lib/views/shell/panels';
import type { MediaAccess } from '../../../../src/lib/views/shell/theme';

describe('Leisten (DockState)', () => {
	it('Standard: beide Leisten offen, keine Schublade (Bestand >= 900 px)', () => {
		const s = initialDocks();
		expect(s).toEqual({ palette: true, inspector: true, drawer: null });
		expect(dockOpen(s, 'palette', false)).toBe(true);
		expect(dockOpen(s, 'inspector', false)).toBe(true);
	});

	it('breit: Knopf klappt je Leiste unabhängig ein und aus', () => {
		const s = toggleDock(initialDocks(), 'palette', false);
		expect(dockOpen(s, 'palette', false)).toBe(false);
		expect(dockOpen(s, 'inspector', false)).toBe(true);
		const t = toggleDock(s, 'inspector', false);
		expect(dockOpen(t, 'inspector', false)).toBe(false);
		expect(dockOpen(toggleDock(t, 'palette', false), 'palette', false)).toBe(true);
		expect(t.drawer).toBeNull();
	});

	it('schmal: Schubladen starten zu, höchstens eine offen', () => {
		const s = initialDocks();
		expect(dockOpen(s, 'palette', true)).toBe(false);
		expect(dockOpen(s, 'inspector', true)).toBe(false);
		const p = toggleDock(s, 'palette', true);
		expect(p.drawer).toBe('palette');
		const i = toggleDock(p, 'inspector', true);
		expect(dockOpen(i, 'inspector', true)).toBe(true);
		expect(dockOpen(i, 'palette', true)).toBe(false);
		expect(toggleDock(i, 'inspector', true).drawer).toBeNull();
	});

	it('schmal: Umschalten ändert den Einklapp-Zustand der breiten Ansicht nicht', () => {
		const wide = toggleDock(initialDocks(), 'palette', false);
		const s = toggleDock(wide, 'palette', true);
		expect(s.palette).toBe(false);
		expect(dockOpen(closeDrawer(s), 'palette', false)).toBe(false);
	});

	it('closeDrawer schließt die Schublade, ohne Schublade unverändert', () => {
		const s = initialDocks();
		expect(closeDrawer(s)).toBe(s);
		expect(closeDrawer(toggleDock(s, 'inspector', true)).drawer).toBeNull();
	});

	it('closeDrawer mit Leiste: schließt nur diese Schublade (T129 C2)', () => {
		const p = toggleDock(initialDocks(), 'palette', true);
		expect(closeDrawer(p, 'palette').drawer).toBeNull();
		const i = toggleDock(initialDocks(), 'inspector', true);
		expect(closeDrawer(i, 'palette')).toBe(i);
	});

	it('Grenzen: Schublade unter 900 px, Mindestbreite 640 px (D6)', () => {
		expect(NARROW_QUERY).toBe('(max-width: 899.98px)');
		expect(MIN_WIDTH).toBe(640);
		expect(MIN_QUERY).toBe('(max-width: 639.98px)');
	});
});

/** matchMedia-Attrappe für NARROW_QUERY; `set()` meldet einen Wechsel. */
function media(narrow: boolean) {
	const listeners = new Set<(e: { matches: boolean }) => void>();
	const state = { narrow };
	const access: MediaAccess = (query: string) => ({
		get matches() {
			return query === NARROW_QUERY && state.narrow;
		},
		addEventListener: (_: 'change', l: (e: { matches: boolean }) => void) => void listeners.add(l),
		removeEventListener: (_: 'change', l: (e: { matches: boolean }) => void) => listeners.delete(l)
	});
	return {
		access,
		listeners,
		set(value: boolean) {
			state.narrow = value;
			for (const l of listeners) l({ matches: value });
		}
	};
}

describe('nextTab (WAI-ARIA Tabs, T129 C2)', () => {
	const ids = ['properties', 'code'] as const;

	it('Pfeil rechts/links wechselt zyklisch', () => {
		expect(nextTab(ids, 'properties', 'ArrowRight')).toBe('code');
		expect(nextTab(ids, 'code', 'ArrowRight')).toBe('properties');
		expect(nextTab(ids, 'properties', 'ArrowLeft')).toBe('code');
		expect(nextTab(ids, 'code', 'ArrowLeft')).toBe('properties');
	});

	it('Home/End: erster bzw. letzter Tab', () => {
		expect(nextTab(ids, 'code', 'Home')).toBe('properties');
		expect(nextTab(ids, 'properties', 'End')).toBe('code');
	});

	it('gesperrte Tabs werden übersprungen; andere Tasten: null', () => {
		const open = (id: string) => id !== 'properties';
		expect(nextTab(ids, 'code', 'ArrowRight', open)).toBe('code');
		expect(nextTab(ids, 'code', 'Home', open)).toBe('code');
		expect(nextTab(ids, 'code', 'ArrowDown')).toBeNull();
		expect(nextTab(ids, 'code', 'Enter')).toBeNull();
	});
});

describe('watchNarrow', () => {
	it('meldet den Anfangswert und Wechsel; Abmeldung entfernt den Listener', () => {
		const m = media(true);
		const seen: boolean[] = [];
		const stop = watchNarrow(m.access, (n) => seen.push(n));
		m.set(false);
		expect(seen).toEqual([true, false]);
		stop();
		expect(m.listeners.size).toBe(0);
	});

	it('ohne matchMedia oder bei Fehler: breit, ohne Wechsel', () => {
		const seen: boolean[] = [];
		watchNarrow(undefined, (n) => seen.push(n))();
		watchNarrow(
			() => {
				throw new Error('kein matchMedia');
			},
			(n) => seen.push(n)
		)();
		expect(seen).toEqual([false, false]);
	});

	it('eigene Abfrage (Mindestbreite, T129 C2)', () => {
		const asked: string[] = [];
		const access: MediaAccess = (query) => {
			asked.push(query);
			return { matches: true, addEventListener() {}, removeEventListener() {} };
		};
		const seen: boolean[] = [];
		watchNarrow(access, (n) => seen.push(n), MIN_QUERY)();
		expect(asked).toEqual([MIN_QUERY]);
		expect(seen).toEqual([true]);
	});
});
