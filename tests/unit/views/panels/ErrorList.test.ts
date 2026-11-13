// @vitest-environment jsdom
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { diagnose } from '../../../../src/lib/services/adapters/diagnostics';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import ErrorList from '../../../../src/lib/views/panels/ErrorList.svelte';
import { BAD, fakeAdapters } from './helpers';

const timer = { set: () => 0, clear: () => {} };
let cleanup: (() => void) | null = null;
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
	cleanup?.();
	applyLocale('de');
});

describe('ErrorList', () => {
	it('Code-Fehler und Modell-Befunde mit Sprung', async () => {
		const sync = await createSync('flowchart TD\n  A --> B\n', { adapters: fakeAdapters, timer });
		const onjump = vi.fn();
		const target = document.createElement('div');
		document.body.append(target);
		const issues = [
			{
				kind: 'unknown-id' as const,
				severity: 'error' as const,
				elementId: 'A',
				message: '<i>m</i>'
			},
			{ kind: 'unknown-id' as const, severity: 'hint' as const, elementId: 'fehlt', message: 'h' }
		];
		const app = mount(ErrorList, { target, props: { sync, issues, onjump } });
		cleanup = () => {
			unmount(app);
			target.remove();
			sync.dispose();
		};
		await tick();
		expect(target.querySelectorAll('li')).toHaveLength(2);
		expect(target.querySelector('i')).toBeNull();
		sync.editCode(`flowchart TD\n  A --> B\n${BAD}\n`);
		await sync.flush();
		await tick();
		const buttons = [...target.querySelectorAll('button')];
		expect(buttons.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Fehler Zeile 3, Spalte 1: Syntaxfehler',
			'Fehler A: <i>m</i>',
			'Hinweis fehlt: h'
		]);
		buttons[0].click();
		buttons[1].click();
		expect(buttons[2].disabled).toBe(true);
		expect(onjump.mock.calls).toEqual([
			[{ type: 'line', line: 3, column: 1 }],
			[{ type: 'element', id: 'A' }]
		]);
	});

	it('leer: Hinweis', async () => {
		const sync = await createSync('flowchart TD\n  A\n', { adapters: fakeAdapters, timer });
		const target = document.createElement('div');
		const app = mount(ErrorList, { target, props: { sync, onjump: () => {} } });
		cleanup = () => {
			unmount(app);
			sync.dispose();
		};
		expect(target.textContent).toContain('Keine Fehler.');
	});

	it('Diagnose: Kurztext, Rohtext hinter "Details", Sprachwechsel', async () => {
		const raw = "Parse error on line 9:\n<b>A[x</b>\n---^\nExpecting 'SQE', got '1'";
		const error = Object.assign(new Error(raw), { hash: { token: 1, expected: ["'SQE'"] } });
		const adapters = {
			...fakeAdapters,
			flowchart: {
				...fakeAdapters.flowchart,
				validate: (text: string) =>
					Promise.resolve(text.includes(BAD) ? [diagnose(error, 3, 2)] : [])
			}
		};
		const sync = await createSync('flowchart TD\n  A --> B\n', { adapters, timer });
		const onjump = vi.fn();
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(ErrorList, { target, props: { sync, onjump } });
		cleanup = () => {
			unmount(app);
			target.remove();
			sync.dispose();
		};
		sync.editCode(`flowchart TD\n  A --> B\n${BAD}\n`);
		await sync.flush();
		await tick();
		const [jump, toggle] = [...target.querySelectorAll('button')];
		const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();
		expect(text(jump)).toBe('Fehler Zeile 3, Spalte 2: Klammer oder | nicht geschlossen');
		expect(text(toggle)).toBe('Details');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(target.querySelector('pre')).toBeNull();

		toggle.click();
		await tick();
		const pre = target.querySelector('pre');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(text(toggle)).toBe('Details ausblenden');
		expect(toggle.getAttribute('aria-controls')).toBe(pre?.id);
		expect(pre?.textContent).toBe(raw);
		expect(target.querySelector('b')).toBeNull();
		expect(jump.textContent).not.toContain('SQE');

		applyLocale('en');
		await tick();
		expect(text(jump)).toBe('Error Line 3, column 2: Bracket or | not closed');
		expect(text(toggle)).toBe('Hide details');

		jump.click();
		expect(onjump.mock.calls).toEqual([[{ type: 'line', line: 3, column: 2 }]]);
		toggle.click();
		await tick();
		expect(target.querySelector('pre')).toBeNull();
	});
});
