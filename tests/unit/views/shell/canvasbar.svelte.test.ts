// @vitest-environment jsdom
// T126 C1 (V-15): Raster/Einrasten als Schalter in der CanvasBar, gleiche Stelle für alle Canvas.
import { flushSync, mount, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CanvasBar from '../../../../src/lib/views/shell/CanvasBar.svelte';
import { button } from './helpers';

const cleanup: (() => void)[] = [];
afterEach(() => {
	while (cleanup.length > 0) cleanup.pop()!();
});

function bar(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.append(target);
	const handlers = {
		ongrid: vi.fn(),
		onsnap: vi.fn(),
		onarrange: vi.fn(),
		ondirection: vi.fn()
	};
	// Getter in `props` bleiben erhalten (reaktive Props), daher kein Spread.
	const base = {
		canUndo: false,
		canRedo: false,
		canZoom: true,
		canSelectAll: true,
		layout: 'auto' as const,
		zoom: '100 %',
		grid: { shown: true, snap: false },
		arrangeable: 0,
		direction: 'TD',
		onlayout: () => {},
		onundo: () => {},
		onredo: () => {},
		onselectall: () => {},
		onzoomout: () => {},
		onzoomin: () => {},
		onfit: () => {},
		...handlers
	};
	const all = Object.defineProperties(base, Object.getOwnPropertyDescriptors(props));
	const app = mount(CanvasBar, { target, props: all as typeof base });
	flushSync();
	cleanup.push(() => (unmount(app), target.remove()));
	return { target, ...handlers };
}

describe('CanvasBar: Raster und Einrasten (T126 C1)', () => {
	it('Schalter mit sichtbarem Text und aria-pressed nach Zustand', () => {
		const { target } = bar({ grid: { shown: false, snap: true } });
		const group = target.querySelector('.cmdbar [role="group"][aria-label="Raster"]');
		expect(group).not.toBeNull();
		expect(button(target, 'Raster').getAttribute('aria-pressed')).toBe('false');
		expect(button(target, 'Einrasten').getAttribute('aria-pressed')).toBe('true');
		expect(button(target, 'Raster').title).toBe('Raster ein/aus (G)');
		expect(button(target, 'Einrasten').title).toBe('Einrasten ein/aus (Umschalt+G)');
	});

	it('Klick meldet ongrid bzw. onsnap', () => {
		const { target, ongrid, onsnap } = bar();
		button(target, 'Raster').click();
		expect(ongrid).toHaveBeenCalledTimes(1);
		expect(onsnap).not.toHaveBeenCalled();
		button(target, 'Einrasten').click();
		expect(onsnap).toHaveBeenCalledTimes(1);
	});

	it('ohne Raster-Canvas (grid null): Schalter gesperrt, nicht gedrückt', () => {
		const { target, ongrid } = bar({ grid: null });
		const grid = button(target, 'Raster');
		expect(grid.disabled).toBe(true);
		expect(button(target, 'Einrasten').disabled).toBe(true);
		expect(grid.getAttribute('aria-pressed')).toBe('false');
		grid.click();
		expect(ongrid).not.toHaveBeenCalled();
	});

	it('keine Platzierungs-Variante mehr: eine Leiste ohne Klasse bottom', () => {
		const { target } = bar();
		const el = target.querySelector('.cmdbar')!;
		expect(el.getAttribute('role')).toBe('toolbar');
		expect(el.classList.contains('bottom')).toBe(false);
	});
});

const menu = (target: HTMLElement) => target.querySelector<HTMLElement>('.cmdbar [role="menu"]');
const items = (target: HTMLElement) =>
	[...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((b) =>
		b.textContent?.trim()
	);

describe('CanvasBar: Ausrichten und Verteilen (T126 C2, F-04)', () => {
	it('unter 2 Knoten: beide gesperrt, Grund im title', () => {
		const { target } = bar({ arrangeable: 1 });
		const align = button(target, 'Ausrichten');
		const spread = button(target, 'Verteilen');
		expect(align.disabled).toBe(true);
		expect(spread.disabled).toBe(true);
		expect(align.title).toBe('Ausrichten: mindestens 2 Knoten auswählen');
		expect(spread.title).toBe('Verteilen: mindestens 3 Knoten auswählen');
	});

	it('2 Knoten: Ausrichten aktiv, Verteilen gesperrt; 3 Knoten: beide aktiv', () => {
		const two = bar({ arrangeable: 2 }).target;
		expect(button(two, 'Ausrichten').disabled).toBe(false);
		expect(button(two, 'Ausrichten').title).toBe('Ausgewählte Knoten ausrichten');
		expect(button(two, 'Verteilen').disabled).toBe(true);
		const three = bar({ arrangeable: 3 }).target;
		expect(button(three, 'Verteilen').disabled).toBe(false);
		expect(button(three, 'Verteilen').title).toBe('Ausgewählte Knoten gleichmäßig verteilen');
	});

	it('ohne Graph-Canvas (null): gesperrt, Grund "nur Flowchart" statt Knotenzahl', () => {
		const { target } = bar({ arrangeable: null });
		for (const name of ['Ausrichten', 'Verteilen']) {
			expect(button(target, name).disabled, name).toBe(true);
			expect(button(target, name).title, name).toBe('Nur im Flowchart verfügbar');
		}
	});

	it('zweiter Klick auf den Menüknopf schließt das Menü', () => {
		const { target } = bar({ arrangeable: 2 });
		const align = button(target, 'Ausrichten');
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
		// Browser-Reihenfolge: pointerdown, focusout aus dem Menü (Fokus auf den Knopf), click.
		align.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		align.focus();
		flushSync();
		align.click();
		flushSync();
		expect(menu(target)).toBeNull();
		expect(align.getAttribute('aria-expanded')).toBe('false');
		align.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
	});

	/** Menü offen, pointerdown auf den Knopf, focusout schließt es (wie im Browser). */
	function pressWhileOpen(target: HTMLElement) {
		const align = button(target, 'Ausrichten');
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
		align.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		align.focus();
		flushSync();
		expect(menu(target)).toBeNull();
		// jsdom ohne Layout: Knopf-Rect fest, pointerup-Trefferprüfung läuft über Koordinaten.
		align.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 10, width: 100, height: 30 });
		return align;
	}
	const inside = { bubbles: true, clientX: 50, clientY: 20 };
	const outside = { bubbles: true, clientX: 300, clientY: 20 };

	it('pointercancel löscht die pointerdown-Marke: nächster click öffnet wieder', () => {
		const { target } = bar({ arrangeable: 2 });
		const align = pressWhileOpen(target);
		align.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
	});

	it('pointerup außerhalb des Knopfs (Zeiger weggezogen) löscht die Marke', () => {
		const { target } = bar({ arrangeable: 2 });
		const align = pressWhileOpen(target);
		document.body.dispatchEvent(new PointerEvent('pointerup', outside));
		// Folgender click, z. B. über Hilfstechnik ohne pointerdown/keydown, öffnet wieder.
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
	});

	it('pointerup mit click im selben Task: zweiter Klick schließt weiterhin', () => {
		const { target } = bar({ arrangeable: 2 });
		const align = pressWhileOpen(target);
		align.dispatchEvent(new PointerEvent('pointerup', inside));
		align.click();
		flushSync();
		expect(menu(target)).toBeNull();
	});

	it('pointerup auf dem Knopf, click in späterem Task (Touch): zweiter Klick schließt', async () => {
		const { target } = bar({ arrangeable: 2 });
		const align = pressWhileOpen(target);
		align.dispatchEvent(new PointerEvent('pointerup', inside));
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		align.click();
		flushSync();
		expect(menu(target)).toBeNull();
	});

	it('Touch: pointerup mit Capture am Knopf, Finger außerhalb gelöst -> Marke weg', () => {
		const { target } = bar({ arrangeable: 2 });
		const align = pressWhileOpen(target);
		// Pointer-Capture: target bleibt der Knopf, die Koordinaten liegen außerhalb.
		align.dispatchEvent(new PointerEvent('pointerup', outside));
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
	});

	it('click außerhalb nach pointerdown auf den Knopf löscht die Marke', () => {
		const { target } = bar({ arrangeable: 2 });
		const align = pressWhileOpen(target);
		document.body.click();
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
	});

	it('pointerdown anderswo löscht die Marke vor dem nächsten click', () => {
		const { target } = bar({ arrangeable: 2 });
		const align = pressWhileOpen(target);
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		align.click();
		flushSync();
		expect(menu(target)).not.toBeNull();
	});

	it('Ausrichten öffnet die Einträge des Kontextmenüs; Wahl meldet die Eintrags-ID', () => {
		const { target, onarrange } = bar({ arrangeable: 2 });
		const align = button(target, 'Ausrichten');
		expect(align.getAttribute('aria-haspopup')).toBe('menu');
		expect(align.getAttribute('aria-expanded')).toBe('false');
		align.click();
		flushSync();
		expect(align.getAttribute('aria-expanded')).toBe('true');
		expect(items(target)).toEqual([
			'Links ausrichten',
			'Horizontal zentrieren',
			'Rechts ausrichten',
			'Oben ausrichten',
			'Vertikal zentrieren',
			'Unten ausrichten'
		]);
		button(target, 'Links ausrichten').click();
		flushSync();
		expect(onarrange).toHaveBeenCalledExactlyOnceWith('align-left');
		expect(menu(target)).toBeNull();
		expect(document.activeElement).toBe(align);
	});

	it('Verteilen: zwei Einträge; Esc schließt ohne Meldung, Fokus zurück auf den Knopf', () => {
		const { target, onarrange } = bar({ arrangeable: 3 });
		const spread = button(target, 'Verteilen');
		spread.click();
		flushSync();
		expect(items(target)).toEqual(['Horizontal verteilen', 'Vertikal verteilen']);
		const first = target.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
		expect(document.activeElement).toBe(first);
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(menu(target)).toBeNull();
		expect(onarrange).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(spread);
		spread.click();
		flushSync();
		button(target, 'Vertikal verteilen').click();
		expect(onarrange).toHaveBeenCalledExactlyOnceWith('distribute-vertical');
	});

	it('Auswahl fällt unter die Schwelle: offenes Menü schließt', () => {
		const count = new SvelteMap([['n', 2]]);
		const { target } = bar({
			get arrangeable() {
				return count.get('n');
			}
		});
		button(target, 'Ausrichten').click();
		flushSync();
		expect(menu(target)).not.toBeNull();
		count.set('n', 1);
		flushSync();
		expect(menu(target)).toBeNull();
		expect(button(target, 'Ausrichten').getAttribute('aria-expanded')).toBe('false');
		// Wieder genug Knoten: das Menü bleibt zu, bis es erneut geöffnet wird.
		count.set('n', 2);
		flushSync();
		expect(menu(target)).toBeNull();
	});
});

describe('CanvasBar: Richtung TD/LR (T126 C2, F-04)', () => {
	const pressed = (target: HTMLElement) =>
		['TD', 'LR'].map((d) => button(target, d).getAttribute('aria-pressed'));

	it('Gruppe Richtung, gedrückt nach Deklaration; TB und ohne Angabe gelten als TD', () => {
		const lr = bar({ direction: 'LR' }).target;
		expect(lr.querySelector('.cmdbar [role="group"][aria-label="Richtung"]')).not.toBeNull();
		expect(pressed(lr)).toEqual(['false', 'true']);
		expect(button(lr, 'LR').title).toBe('Richtung: von links nach rechts (LR)');
		expect(button(lr, 'TD').title).toBe('Richtung: von oben nach unten (TD)');
		expect(pressed(bar({ direction: 'TB' }).target)).toEqual(['true', 'false']);
		expect(pressed(bar({ direction: '' }).target)).toEqual(['true', 'false']);
		expect(pressed(bar({ direction: 'RL' }).target)).toEqual(['false', 'false']);
	});

	it('Klick auf die andere Richtung meldet sie; gedrückte Richtung meldet nichts', () => {
		const { target, ondirection } = bar({ direction: 'TD' });
		button(target, 'TD').click();
		expect(ondirection).not.toHaveBeenCalled();
		button(target, 'LR').click();
		expect(ondirection).toHaveBeenCalledExactlyOnceWith('LR');
	});

	it('ohne Richtung (null, kein Flowchart): gesperrt, nicht gedrückt', () => {
		const { target } = bar({ direction: null });
		expect(button(target, 'TD').disabled).toBe(true);
		expect(button(target, 'LR').disabled).toBe(true);
		expect(pressed(target)).toEqual(['false', 'false']);
		expect(button(target, 'TD').title).toBe('Nur im Flowchart verfügbar');
		expect(button(target, 'LR').title).toBe('Nur im Flowchart verfügbar');
	});
});
