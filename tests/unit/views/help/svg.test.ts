// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderResult } from '../../../../src/lib/services/render';
import { insertSvg, showMermaid } from '../../../../src/lib/views/help/svg';

const SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" id="m1" viewBox="0 0 10 10"><g><text>A &amp; B</text></g></svg>';

function box(): HTMLElement {
	const el = document.createElement('div');
	document.body.append(el);
	return el;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('insertSvg', () => {
	it('fügt geparstes SVG als echtes SVG-Element ein und ersetzt alten Inhalt', () => {
		const el = box();
		el.append(document.createElement('span'));
		expect(insertSvg(el, SVG)).toBe(true);
		expect(el.children).toHaveLength(1);
		const svg = el.firstElementChild!;
		expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
		expect(svg.ownerDocument).toBe(document);
		expect(svg.textContent).toBe('A & B');
	});

	it('bricht bei parsererror ab und lässt Container unverändert', () => {
		const el = box();
		el.textContent = 'alt';
		expect(insertSvg(el, '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>')).toBe(false);
		expect(el.textContent).toBe('alt');
	});

	it('lehnt Wurzel außer svg ab', () => {
		const el = box();
		expect(insertSvg(el, '<html xmlns="http://www.w3.org/1999/xhtml"><b>x</b></html>')).toBe(false);
		expect(insertSvg(el, '<svg><g/></svg>')).toBe(false);
		expect(el.childNodes).toHaveLength(0);
	});

	it('Skript-Text im SVG bleibt inert (kein Ausführen)', () => {
		const el = box();
		const spy = vi.fn();
		(globalThis as { helpSpy?: () => void }).helpSpy = spy;
		const evil =
			'<svg xmlns="http://www.w3.org/2000/svg"><script>helpSpy()</script><text>t</text></svg>';
		insertSvg(el, evil);
		expect(spy).not.toHaveBeenCalled();
		expect(el.querySelector('script')).toBeNull();
	});

	it('entfernt on*-Attribute auf allen Ebenen', () => {
		const el = box();
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><a onclick="y()" class="k"><text>t</text></a></svg>';
		expect(insertSvg(el, svg)).toBe(true);
		expect(el.querySelector('svg')!.hasAttribute('onload')).toBe(false);
		const g = el.querySelector('g.k')!;
		expect(g.hasAttribute('onclick')).toBe(false);
		expect(g.getAttribute('class')).toBe('k');
	});

	it('Links navigieren nie: <a> wird <g> mit gleichen Attributen außer Verweisen', () => {
		const el = box();
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
			'<a href="https://example.org/" xlink:href="https://x.test/" target="_top" transform="translate(1, 2)" class="k"><text>t</text></a>' +
			'<image href="https://x.test/i.png"/><use href="#m"/><use xlink:href="#n"/></svg>';
		expect(insertSvg(el, svg)).toBe(true);
		expect(el.querySelector('a')).toBeNull();
		const g = el.querySelector('svg > g')!;
		expect(g.namespaceURI).toBe('http://www.w3.org/2000/svg');
		expect(g.getAttribute('transform')).toBe('translate(1, 2)');
		expect(g.getAttribute('class')).toBe('k');
		expect(g.hasAttribute('target')).toBe(false);
		expect(g.textContent).toBe('t');
		const refs = [...el.querySelectorAll('*')].flatMap((e) =>
			[...e.attributes].filter((a) => a.localName === 'href').map((a) => a.value)
		);
		expect(refs).toEqual(['#m', '#n']);
	});
});

describe('showMermaid', () => {
	it('zeigt Ladehinweis, dann SVG', async () => {
		const el = box();
		const render = vi.fn(async (): Promise<RenderResult> => ({ ok: true, svg: SVG }));
		const view = showMermaid(el, 'flowchart LR\n A', render);
		expect(el.textContent).toBe('Diagramm wird geladen ...');
		await view.done;
		expect(render).toHaveBeenCalledWith('flowchart LR\n A');
		expect(el.querySelector('svg')).not.toBeNull();
		expect(el.getAttribute('aria-busy')).toBe('false');
	});

	it('Fehlertext statt SVG bei ok: false, mit Zeile', async () => {
		const el = box();
		const render = async (): Promise<RenderResult> => ({
			ok: false,
			error: { message: '<b>Parse</b>', line: 3 }
		});
		await showMermaid(el, 'x', render).done;
		expect(el.querySelector('svg')).toBeNull();
		expect(el.querySelector('b')).toBeNull();
		const p = el.querySelector('p.help-error')!;
		expect(p.getAttribute('role')).toBe('alert');
		expect(p.textContent).toBe('Diagramm nicht darstellbar (Zeile 3): <b>Parse</b>');
	});

	it('Fehlertext ohne Zeile, bei Ablehnung und bei nicht parsebarem SVG', async () => {
		const a = box();
		await showMermaid(a, 'x', async () => ({ ok: false, error: { message: 'm' } })).done;
		expect(a.textContent).toBe('Diagramm nicht darstellbar: m');
		const b = box();
		await showMermaid(b, 'x', () => Promise.reject(new Error('weg'))).done;
		expect(b.textContent).toBe('Diagramm nicht darstellbar: weg');
		const c = box();
		await showMermaid(c, 'x', () => Promise.reject('roh')).done;
		expect(c.textContent).toBe('Diagramm nicht darstellbar: roh');
		const d = box();
		await showMermaid(d, 'x', async () => ({ ok: true, svg: '<svg' })).done;
		expect(d.textContent).toBe('Diagramm nicht darstellbar: SVG nicht lesbar.');
	});

	it('nach cancel bleibt Container unverändert', async () => {
		const el = box();
		const view = showMermaid(el, 'x', async () => ({ ok: true, svg: SVG }));
		view.cancel();
		await view.done;
		expect(el.querySelector('svg')).toBeNull();
	});
});
