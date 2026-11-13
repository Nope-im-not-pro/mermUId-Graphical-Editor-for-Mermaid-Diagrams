// @vitest-environment jsdom
// T113 C2 (V-28): Vorschau verzögert, altes SVG bleibt bis zum neuen stehen, nur der neueste
// Auftrag wird gerendert (ein laufender darf enden, sein Ergebnis wird verworfen).
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderResult } from '../../../../src/lib/services/render';
import Preview from '../../../../src/lib/views/shell/Preview.svelte';
import { applyLocale, t } from '../../../../src/lib/views/shell/i18n.svelte';

const svg = (label: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`;
const ok = (code: string): RenderResult => ({ ok: true, svg: svg(code) });
const fail = (message: string): RenderResult => ({ ok: false, error: { message, line: 2 } });
const errorText = (message: string) =>
	t('help.renderError', { where: t('help.renderErrorLine', { line: 2 }), message });

/** Render-Attrappe mit Hand-Auflösung je Aufruf. */
function deferred() {
	const calls: { code: string; resolve: (r: RenderResult) => void }[] = [];
	const render = vi.fn(
		(code: string) =>
			new Promise<RenderResult>((resolve) => {
				calls.push({ code, resolve });
			})
	);
	return { calls, render };
}

let cleanup: (() => void) | null = null;

function setup(render: (code: string) => Promise<RenderResult>, code = 'v0') {
	const props = $state({ code, open: true, render, locked: null, ontoggle: () => {} });
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(Preview, { target, props });
	flushSync();
	cleanup = () => {
		unmount(app);
		target.remove();
	};
	const body = () => target.querySelector<HTMLElement>('.preview-body')!;
	const shown = () => body().querySelector('svg text')?.textContent ?? null;
	const edit = (next: string) => {
		props.code = next;
		flushSync();
	};
	return { props, target, body, shown, edit };
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	cleanup?.();
	cleanup = null;
	applyLocale('de');
	vi.useRealTimers();
});

describe('Vorschau-Debounce (V-28)', () => {
	it('erste Darstellung sofort, 5 Änderungen innerhalb 300 ms ergeben 1 Render', async () => {
		const render = vi.fn(async (code: string) => ok(code));
		const view = setup(render);
		await wait(0);
		expect(render).toHaveBeenCalledTimes(1);
		expect(view.shown()).toBe('v0');
		render.mockClear();
		for (let i = 1; i <= 5; i++) {
			view.edit(`v${i}`);
			await wait(50);
		}
		expect(render).not.toHaveBeenCalled();
		await wait(300);
		expect(render).toHaveBeenCalledTimes(1);
		expect(render).toHaveBeenCalledWith('v5');
		expect(view.shown()).toBe('v5');
	});

	it('Ladetext nur ohne altes SVG; altes SVG bleibt, bis das neue fertig ist', async () => {
		const { calls, render } = deferred();
		const view = setup(render);
		expect(view.body().textContent).toBe(t('help.loading'));
		calls[0].resolve(ok('v0'));
		await wait(0);
		expect(view.shown()).toBe('v0');
		view.edit('v1');
		await wait(300);
		expect(calls.map((c) => c.code)).toEqual(['v0', 'v1']);
		expect(view.shown()).toBe('v0');
		expect(view.body().textContent).not.toContain(t('help.loading'));
		calls[1].resolve(ok('v1'));
		await wait(0);
		expect(view.shown()).toBe('v1');
		expect(view.body().getAttribute('aria-busy')).toBe('false');
		expect(view.target.querySelector('.state.ok')).not.toBeNull();
	});

	it('überholte Aufträge werden nicht gerendert, Ergebnis des laufenden verworfen', async () => {
		const { calls, render } = deferred();
		const view = setup(render);
		calls[0].resolve(ok('v0'));
		await wait(0);
		view.edit('v1');
		await wait(300);
		for (const code of ['v2', 'v3', 'v4']) {
			view.edit(code);
			await wait(300);
		}
		expect(calls.map((c) => c.code)).toEqual(['v0', 'v1']);
		calls[1].resolve(ok('v1'));
		await wait(0);
		expect(view.shown()).toBe('v0');
		expect(calls.map((c) => c.code)).toEqual(['v0', 'v1', 'v4']);
		calls[2].resolve(ok('v4'));
		await wait(0);
		expect(view.shown()).toBe('v4');
		expect(render).toHaveBeenCalledTimes(3);
	});

	it('Fehler beim neuesten Auftrag: Fehleranzeige wie bisher', async () => {
		const render = vi.fn(async (code: string): Promise<RenderResult> =>
			code === 'kaputt' ? { ok: false, error: { message: 'Syntax', line: 2 } } : ok(code)
		);
		const view = setup(render);
		await wait(0);
		view.edit('kaputt');
		await wait(300);
		const error = view.body().querySelector('.help-error[role="alert"]');
		expect(error?.textContent).toBe(
			t('help.renderError', { where: t('help.renderErrorLine', { line: 2 }), message: 'Syntax' })
		);
		expect(view.body().querySelector('svg')).toBeNull();
		expect(view.target.querySelector('.state:not(.ok)')).not.toBeNull();
	});

	it('Schließen vor Ablauf der Verzögerung: kein Render', async () => {
		const render = vi.fn(async (code: string) => ok(code));
		const view = setup(render);
		await wait(0);
		render.mockClear();
		view.edit('v1');
		view.props.open = false;
		flushSync();
		await wait(500);
		expect(render).not.toHaveBeenCalled();
	});
	it('aria-busy="true" während laufendem Render; überholter Auftrag mit Fehler bleibt unsichtbar', async () => {
		const { calls, render } = deferred();
		const view = setup(render);
		calls[0].resolve(ok('v0'));
		await wait(0);
		view.edit('A');
		await wait(300);
		expect(calls.map((c) => c.code)).toEqual(['v0', 'A']);
		expect(view.body().getAttribute('aria-busy')).toBe('true');
		view.edit('C');
		await wait(300);
		calls[1].resolve(fail('A kaputt'));
		await wait(0);
		expect(view.shown()).toBe('v0');
		expect(view.body().querySelector('.help-error')).toBeNull();
		expect(calls.map((c) => c.code)).toEqual(['v0', 'A', 'C']);
		expect(view.body().getAttribute('aria-busy')).toBe('true');
		calls[2].resolve(ok('C'));
		await wait(0);
		expect(view.shown()).toBe('C');
		expect(view.body().getAttribute('aria-busy')).toBe('false');
	});

	it('neuester Auftrag mit Fehler nach überholtem: Fehler angezeigt, aria-busy="false"', async () => {
		const { calls, render } = deferred();
		const view = setup(render);
		calls[0].resolve(ok('v0'));
		await wait(0);
		view.edit('A');
		await wait(300);
		view.edit('C');
		await wait(300);
		calls[1].resolve(ok('A'));
		await wait(0);
		expect(view.shown()).toBe('v0');
		calls[2].resolve(fail('C kaputt'));
		await wait(0);
		expect(view.body().querySelector('.help-error[role="alert"]')?.textContent).toBe(
			errorText('C kaputt')
		);
		expect(view.body().querySelector('svg')).toBeNull();
		expect(view.body().getAttribute('aria-busy')).toBe('false');
		expect(view.target.querySelector('.state:not(.ok)')).not.toBeNull();
	});

	it('Sprachwechsel nach Edit rendert neu: Fehlertext übersetzt', async () => {
		const render = vi.fn(async (code: string): Promise<RenderResult> =>
			code === 'kaputt' ? fail('Syntax') : ok(code)
		);
		const view = setup(render);
		await wait(0);
		view.edit('kaputt');
		await wait(300);
		const de = errorText('Syntax');
		expect(view.body().querySelector('.help-error')?.textContent).toBe(de);
		applyLocale('en');
		flushSync();
		await wait(300);
		const en = errorText('Syntax');
		expect(en).not.toBe(de);
		expect(view.body().querySelector('.help-error')?.textContent).toBe(en);
		expect(view.target.querySelector('.state')?.textContent).toBe(t('app.preview.error'));
	});

	it('Sprachwechsel bei Ladetext: Ladetext sofort übersetzt, kein Debounce, 2 Renders (O-94)', async () => {
		const { calls, render } = deferred();
		const view = setup(render);
		const de = t('help.loading');
		expect(view.body().textContent).toBe(de);
		applyLocale('en');
		flushSync();
		const en = t('help.loading');
		expect(en).not.toBe(de);
		expect(view.body().textContent).toBe(en);
		expect(view.target.querySelector('.state')).toBeNull();
		calls[0].resolve(ok('alt'));
		await wait(0);
		// Ergebnis der überholten ersten Darstellung bleibt unsichtbar, neuer Auftrag sofort.
		expect(view.shown()).toBeNull();
		expect(calls.map((c) => c.code)).toEqual(['v0', 'v0']);
		calls[1].resolve(ok('v0'));
		await wait(0);
		expect(view.shown()).toBe('v0');
		expect(render).toHaveBeenCalledTimes(2);
	});

	it('Sprachwechsel mit SVG: SVG bleibt, nach 300 ms genau 1 weiterer Render (O-94)', async () => {
		const render = vi.fn(async (code: string) => ok(code));
		const view = setup(render);
		await wait(0);
		expect(render).toHaveBeenCalledTimes(1);
		applyLocale('en');
		flushSync();
		await wait(299);
		expect(render).toHaveBeenCalledTimes(1);
		expect(view.shown()).toBe('v0');
		expect(view.body().textContent).not.toContain(t('help.loading'));
		await wait(1);
		expect(render).toHaveBeenCalledTimes(2);
		expect(view.shown()).toBe('v0');
	});

	it('Edit während erster Darstellung: deren Ergebnis wird verworfen (cancel, O-94)', async () => {
		const { calls, render } = deferred();
		const view = setup(render);
		view.edit('v1');
		expect(view.body().textContent).toBe(t('help.loading'));
		calls[0].resolve(ok('v0'));
		await wait(0);
		expect(view.shown()).toBeNull();
		expect(view.body().textContent).toBe(t('help.loading'));
		expect(calls.map((c) => c.code)).toEqual(['v0', 'v1']);
		calls[1].resolve(ok('v1'));
		await wait(0);
		expect(view.shown()).toBe('v1');
		expect(render).toHaveBeenCalledTimes(2);
		expect(view.target.querySelector('.state.ok')).not.toBeNull();
	});

	it('Schließen/Öffnen während laufender Darstellung: Ladetext statt leerem Streifen, Kopf ohne alten Status (O-94)', async () => {
		const { calls, render } = deferred();
		const view = setup(render);
		calls[0].resolve(ok('v0'));
		await wait(0);
		expect(view.target.querySelector('.state.ok')).not.toBeNull();
		view.edit('v1');
		await wait(300);
		expect(calls.map((c) => c.code)).toEqual(['v0', 'v1']);
		view.props.open = false;
		flushSync();
		view.props.open = true;
		flushSync();
		expect(view.body().textContent).toBe(t('help.loading'));
		expect(view.target.querySelector('.state')).toBeNull();
		calls[1].resolve(ok('v1'));
		await wait(0);
		expect(view.shown()).toBeNull();
		expect(calls.map((c) => c.code)).toEqual(['v0', 'v1', 'v1']);
		calls[2].resolve(ok('v1'));
		await wait(0);
		expect(view.shown()).toBe('v1');
		expect(view.target.querySelector('.state.ok')).not.toBeNull();
	});

	it('Fehlertext zählt als altes Ergebnis: Edit danach verzögert, Fehler bleibt bis zum neuen', async () => {
		const render = vi.fn(async (code: string) => (code === 'kaputt' ? fail('Syntax') : ok(code)));
		const view = setup(render, 'kaputt');
		await wait(0);
		expect(view.body().querySelector('.help-error')).not.toBeNull();
		view.edit('v1');
		await wait(299);
		expect(render).toHaveBeenCalledTimes(1);
		expect(view.body().querySelector('.help-error')).not.toBeNull();
		await wait(1);
		expect(view.shown()).toBe('v1');
		expect(render).toHaveBeenCalledTimes(2);
	});
});
