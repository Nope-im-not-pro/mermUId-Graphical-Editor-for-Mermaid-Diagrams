// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installBrowserStubs } from '../canvas/helpers';
import { fakeAdapters } from '../../controllers/sync/helpers';
import { settle, SVG, timer } from './helpers';

const created = vi.hoisted(() => ({
	texts: [] as string[],
	fail: false,
	disposed: 0,
	syncs: [] as import('../../../../src/lib/controllers/sync').SyncController[]
}));

vi.mock('../../../../src/lib/controllers/sync', async (original) => {
	const real = await original<typeof import('../../../../src/lib/controllers/sync')>();
	return {
		...real,
		createSync: (text: string) => {
			created.texts.push(text);
			if (created.fail) return Promise.reject(new Error('kein Start'));
			return real.createSync(text, { adapters: fakeAdapters, timer }).then((s) => {
				const proxy = new Proxy(s, {
					get: (t, k) =>
						k === 'dispose' ? () => (created.disposed++, t.dispose()) : Reflect.get(t, k)
				});
				created.syncs.push(proxy);
				return proxy;
			});
		}
	};
});
vi.mock('../../../../src/lib/services/render', () => ({
	renderSvg: async () => ({ ok: true, svg: SVG })
}));

import Page from '../../../../src/routes/+page.svelte';

beforeAll(installBrowserStubs);
let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.replaceChildren();
	created.texts.length = 0;
	created.fail = false;
	created.disposed = 0;
	created.syncs.length = 0;
});

describe('+page', () => {
	it('mountet die Shell mit leerem flowchart-Dokument (createSync async)', async () => {
		app = mount(Page, { target: document.body });
		flushSync();
		// jsdom meldet navigator.language "en-US": ohne gespeicherte Wahl startet Englisch.
		expect(document.body.textContent).toContain('Loading mermUId');
		await settle();
		expect(created.texts).toEqual(['flowchart TD\n']);
		expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="type"]')!.textContent).toBe('Type: flowchart');
		expect(document.querySelector<HTMLElement>('#shell-code')!.hidden).toBe(true);
	});

	it('Startfehler wird gemeldet', async () => {
		created.fail = true;
		app = mount(Page, { target: document.body });
		await settle();
		expect(document.querySelector('[role="alert"]')!.textContent).toBe(
			'Startup failed: kein Start'
		);
	});

	it('Abbau vor Abschluss verwirft den Controller', async () => {
		app = mount(Page, { target: document.body });
		flushSync();
		expect(created.texts).toHaveLength(1);
		unmount(app);
		app = null;
		await settle();
		expect(created.disposed).toBe(1);
		expect(document.querySelector('[role="toolbar"]')).toBeNull();
	});
});

/** Steuerbares `prefers-color-scheme` (T105 C2); ersetzt `window.matchMedia` für einen Test. */
function systemScheme(light: boolean) {
	const listeners = new Set<(e: { matches: boolean }) => void>();
	const state = { light };
	const original = window.matchMedia;
	window.matchMedia = ((query: string) => ({
		media: query,
		get matches() {
			return query === '(prefers-color-scheme: light)' && state.light;
		},
		addEventListener: (_: string, l: (e: { matches: boolean }) => void) => {
			if (query === '(prefers-color-scheme: light)') listeners.add(l);
		},
		removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l)
	})) as unknown as typeof window.matchMedia;
	restore.push(() => (window.matchMedia = original));
	return {
		listeners,
		change(next: boolean) {
			state.light = next;
			for (const l of [...listeners]) l({ matches: next });
			flushSync();
		}
	};
}

const restore: (() => void)[] = [];
afterEach(() => {
	while (restore.length > 0) restore.pop()!();
	localStorage.clear();
	document.documentElement.style.colorScheme = '';
});

const shellTheme = () => document.querySelector<HTMLElement>('.shell')?.dataset.theme;

async function mountPage() {
	app = mount(Page, { target: document.body });
	flushSync();
	await settle();
}

describe('+page T105 C2: Farbschema nach System', () => {
	it('ohne gespeicherte Wahl hell nach System, schon vor dem Shell-Start', async () => {
		systemScheme(true);
		app = mount(Page, { target: document.body });
		flushSync();
		expect(document.documentElement.style.colorScheme).toBe('light');
		await settle();
		expect(shellTheme()).toBe('light');
		expect(document.documentElement.style.colorScheme).toBe('light');
	});

	it('Systemwechsel wird live übernommen, solange keine Wahl gespeichert ist', async () => {
		const system = systemScheme(false);
		await mountPage();
		expect(shellTheme()).toBe('dark');
		system.change(true);
		expect(shellTheme()).toBe('light');
		expect(document.documentElement.style.colorScheme).toBe('light');
		system.change(false);
		expect(shellTheme()).toBe('dark');
	});

	it('gespeicherte Wahl hat Vorrang, auch beim Systemwechsel', async () => {
		localStorage.setItem('mermuid.theme', 'dark');
		const system = systemScheme(true);
		app = mount(Page, { target: document.body });
		flushSync();
		expect(document.documentElement.style.colorScheme).toBe('dark');
		await settle();
		expect(shellTheme()).toBe('dark');
		system.change(false);
		system.change(true);
		expect(shellTheme()).toBe('dark');
	});

	it('Umschalten speichert die Wahl, danach kein Folgen mehr', async () => {
		const system = systemScheme(false);
		await mountPage();
		document.querySelector<HTMLButtonElement>('button[aria-label="Light theme"]')!.click();
		flushSync();
		expect(shellTheme()).toBe('light');
		expect(localStorage.getItem('mermuid.theme')).toBe('light');
		system.change(false);
		expect(shellTheme()).toBe('light');
	});

	it('Abbau meldet den System-Listener ab', async () => {
		const system = systemScheme(false);
		await mountPage();
		expect(system.listeners.size).toBeGreaterThan(0);
		unmount(app!);
		app = null;
		expect(system.listeners.size).toBe(0);
	});
});

describe('+page T105 C2: Tab-Titel', () => {
	it('ohne Datei Standardname wie Toolbar, Stern bei Änderungen', async () => {
		await mountPage();
		expect(document.title).toBe('diagram.mmd - mermUId');
		const sync = created.syncs[0];
		sync.editCode('flowchart TD\n  X\n');
		await sync.flush();
		await settle();
		expect(document.title).toBe('diagram.mmd* - mermUId');
	});

	it('geöffnete Datei: Dateiname, Stern nur bei Änderungen', async () => {
		await mountPage();
		const e = new MouseEvent('drop', { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'dataTransfer', {
			value: { types: ['Files'], files: [new File(['flowchart TD\n  D\n'], 'd.mmd')] }
		});
		document.querySelector('.shell')!.dispatchEvent(e);
		await settle();
		expect(document.title).toBe('d.mmd - mermUId');
		const sync = created.syncs.at(-1)!;
		sync.editCode('flowchart TD\n  E\n');
		await sync.flush();
		await settle();
		expect(document.title).toBe('d.mmd* - mermUId');
	});
});
