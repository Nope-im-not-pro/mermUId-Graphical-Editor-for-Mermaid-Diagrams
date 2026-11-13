// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HelpPanel from '../../../../src/lib/views/help/HelpPanel.svelte';

const render = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/lib/services/render', () => ({ renderSvg: render }));

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>';
const tick = () => new Promise((r) => setTimeout(r, 0));

let cleanup: (() => void) | null = null;
afterEach(() => {
	cleanup?.();
	cleanup = null;
	document.body.replaceChildren();
	render.mockReset();
});

function setup(initial: boolean) {
	render.mockImplementation(async (code: string) =>
		code.startsWith('sequenceDiagram')
			? { ok: false, error: { message: 'kaputt' } }
			: { ok: true, svg: SVG }
	);
	const opener = document.createElement('button');
	opener.textContent = 'Hilfe';
	const target = document.createElement('div');
	document.body.append(opener, target);
	opener.focus();
	const props = $state({ open: initial });
	const onclose = vi.fn(() => {
		props.open = false;
	});
	const app = mount(HelpPanel, {
		target,
		props: {
			get open() {
				return props.open;
			},
			onclose
		}
	});
	cleanup = () => unmount(app);
	return { opener, target, props, onclose };
}

describe('HelpPanel', () => {
	it('geschlossen: kein Dialog, keine Render-Aufrufe', () => {
		const { target } = setup(false);
		flushSync();
		expect(target.querySelector('[role="dialog"]')).toBeNull();
		expect(render).not.toHaveBeenCalled();
	});

	it('offen: Dialog fokussiert, Inhalt als Elemente, Diagramme über renderSvg', async () => {
		const { target } = setup(true);
		flushSync();
		const dialog = target.querySelector<HTMLElement>('[role="dialog"]')!;
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement).toBe(dialog);
		const title = target.querySelector(`#${dialog.getAttribute('aria-labelledby')}`);
		expect(title?.textContent).toBe('Hilfe');
		expect(target.querySelectorAll('h2').length).toBeGreaterThanOrEqual(4);
		expect(target.querySelector('table th')).not.toBeNull();
		expect(target.querySelector('ul li')).not.toBeNull();
		expect(target.querySelector('td code')).not.toBeNull();
		expect(target.querySelector('pre code')).not.toBeNull();
		await tick();
		expect(render).toHaveBeenCalled();
		expect(render.mock.calls.every(([c]) => typeof c === 'string')).toBe(true);
		expect(target.querySelectorAll('.help-mermaid svg').length).toBeGreaterThan(0);
		expect(target.querySelector('.help-mermaid p.help-error')?.textContent).toBe(
			'Diagramm nicht darstellbar: kaputt'
		);
	});

	it('Esc schließt, Fokus kehrt zum Auslöser zurück', () => {
		const { target, opener, onclose } = setup(true);
		flushSync();
		const dialog = target.querySelector<HTMLElement>('[role="dialog"]')!;
		const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
		dialog.dispatchEvent(other);
		expect(onclose).not.toHaveBeenCalled();
		const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		dialog.dispatchEvent(esc);
		expect(esc.defaultPrevented).toBe(true);
		expect(onclose).toHaveBeenCalledTimes(1);
		flushSync();
		expect(target.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	it('Schließen-Knopf ruft onclose; erneutes Öffnen fokussiert wieder', () => {
		const { target, props, onclose, opener } = setup(true);
		flushSync();
		target.querySelector<HTMLButtonElement>('button.help-close')!.click();
		expect(onclose).toHaveBeenCalledTimes(1);
		flushSync();
		expect(document.activeElement).toBe(opener);
		props.open = true;
		flushSync();
		expect(document.activeElement).toBe(target.querySelector('[role="dialog"]'));
	});

	it('Fokus-Falle: Tab und Shift-Tab bleiben zyklisch im Dialog', () => {
		const { target, opener } = setup(true);
		flushSync();
		const dialog = target.querySelector<HTMLElement>('[role="dialog"]')!;
		const focusable = [...dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex="0"]')];
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const press = (from: HTMLElement, shiftKey: boolean) => {
			from.focus();
			const e = new KeyboardEvent('keydown', {
				key: 'Tab',
				shiftKey,
				bubbles: true,
				cancelable: true
			});
			from.dispatchEvent(e);
			return e;
		};
		expect(press(last, false).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
		expect(press(first, true).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
		expect(press(dialog, true).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
		expect(press(dialog, false).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
		// Fokus außerhalb (z. B. nach Mausklick daneben) wird beim nächsten Tab zurückgeholt.
		expect(press(opener, false).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
	});

	it('Esc wirkt, solange der Dialog offen ist, auch bei Fokus außerhalb', () => {
		const { target, opener, onclose } = setup(true);
		flushSync();
		opener.focus();
		const esc = () =>
			opener.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
		esc();
		expect(onclose).toHaveBeenCalledTimes(1);
		flushSync();
		expect(target.querySelector('[role="dialog"]')).toBeNull();
		esc();
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('Backdrop: Klick erreicht kein Element dahinter, schließt den Dialog', () => {
		const { target, opener, onclose } = setup(true);
		const canvas = document.createElement('div');
		canvas.tabIndex = 0;
		const hits: string[] = [];
		for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
			canvas.addEventListener(type, () => hits.push(type));
		}
		document.body.prepend(canvas);
		flushSync();
		const backdrop = target.querySelector<HTMLElement>('.help-backdrop')!;
		expect(backdrop).not.toBeNull();
		expect(backdrop.nextElementSibling?.getAttribute('role')).toBe('dialog');
		for (const type of ['pointerdown', 'mousedown', 'mouseup']) {
			backdrop.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
		}
		backdrop.click();
		expect(hits).toEqual([]);
		expect(onclose).toHaveBeenCalledTimes(1);
		flushSync();
		expect(target.querySelector('.help-backdrop')).toBeNull();
		expect(document.activeElement).toBe(opener);
		expect(document.activeElement).not.toBe(canvas);
	});

	it('Fokus-Rückgabe entfällt, wenn der Auslöser nicht mehr im Dokument ist', () => {
		const { target, props, opener } = setup(true);
		flushSync();
		opener.remove();
		props.open = false;
		flushSync();
		expect(target.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).not.toBe(opener);
	});
});
