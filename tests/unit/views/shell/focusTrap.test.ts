// @vitest-environment jsdom
// T101 C2 (V-03): Fokus-Falle der Shell-Dialoge. Startfokus auf `data-autofocus` (sonst erstes
// Bedienelement), Tab zyklisch, Esc schließt, beim Schließen Fokus zurück zum Auslöser.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusTrap } from '../../../../src/lib/views/shell/focusTrap';

const cleanups: (() => void)[] = [];
afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()!();
	document.body.replaceChildren();
});

function setup(html: string) {
	const trigger = document.createElement('button');
	trigger.textContent = 'Auslöser';
	const dialog = document.createElement('div');
	dialog.tabIndex = -1;
	dialog.innerHTML = html;
	document.body.append(trigger, dialog);
	trigger.focus();
	const onclose = vi.fn();
	let done = false;
	const detach = focusTrap(onclose)(dialog) as () => void;
	const cleanup = () => {
		if (!done) detach();
		done = true;
	};
	cleanups.push(cleanup);
	const byText = (label: string) =>
		[...dialog.querySelectorAll('button')].find((b) => b.textContent === label)!;
	return { trigger, dialog, onclose, cleanup, byText };
}

function press(key: string, init: KeyboardEventInit = {}) {
	const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
	const outer = vi.fn();
	document.body.addEventListener('keydown', outer);
	(document.activeElement ?? document.body).dispatchEvent(e);
	document.body.removeEventListener('keydown', outer);
	return { e, reached: outer.mock.calls.length > 0 };
}

const THREE =
	'<button>Erster</button><button data-autofocus>Primär</button><button>Letzter</button>';

describe('focusTrap', () => {
	it('fokussiert ohne Markierung das erste Bedienelement', () => {
		const { byText } = setup('<button>A</button><button>B</button>');
		expect(document.activeElement).toBe(byText('A'));
	});

	it('fokussiert das mit data-autofocus markierte Element', () => {
		const { byText } = setup(THREE);
		expect(document.activeElement).toBe(byText('Primär'));
	});

	it('ohne Bedienelement: Fokus auf den Dialog', () => {
		const { dialog } = setup('<p>nur Text</p>');
		expect(document.activeElement).toBe(dialog);
	});

	it('Tab am Ende springt zum Anfang, Shift-Tab am Anfang zum Ende', () => {
		const { byText } = setup(THREE);
		byText('Letzter').focus();
		expect(press('Tab').e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(byText('Erster'));
		expect(press('Tab', { shiftKey: true }).e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(byText('Letzter'));
	});

	it('Tab in der Mitte bleibt beim Browser', () => {
		setup(THREE);
		expect(press('Tab').e.defaultPrevented).toBe(false);
	});

	it('Esc ruft onclose und hält die Taste vor der Shell zurück', () => {
		const { onclose } = setup(THREE);
		const { e, reached } = press('Escape');
		expect(onclose).toHaveBeenCalledTimes(1);
		expect(e.defaultPrevented).toBe(true);
		expect(reached).toBe(false);
	});

	it('Schließen gibt den Fokus an den Auslöser zurück und löst die Tasten', () => {
		const { trigger, dialog, onclose, cleanup } = setup(THREE);
		cleanup();
		dialog.remove();
		expect(document.activeElement).toBe(trigger);
		press('Escape');
		expect(onclose).not.toHaveBeenCalled();
	});
});
