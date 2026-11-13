// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

type RenderFn = (id: string, text: string) => Promise<{ svg: string }>;
type ParseFn = (text: string) => Promise<unknown>;

/** `parse`-Attrappe: `config.theme` aus `theme: x` bzw. `"theme": "x"` im Code. */
const parseTheme: ParseFn = async (text) => {
	const theme = /theme"?:\s*"?(\w+)/.exec(text)?.[1];
	return { diagramType: 'flowchart-v2', config: theme ? { theme } : {} };
};

/** Lädt den Service frisch mit einer mermaid-Attrappe (Modulzustand je Test neu). */
async function loadWith(render: RenderFn, initialize = vi.fn(), parse = parseTheme) {
	vi.resetModules();
	vi.doMock('mermaid', () => ({ default: { initialize, render, parse } }));
	const mod = await import('../../../../src/lib/services/render');
	return { ...mod, initialize };
}

afterEach(() => {
	vi.doUnmock('mermaid');
	vi.resetModules();
});

describe('renderSvg mit mermaid-Attrappe', () => {
	it('initialisiert mermaid genau einmal mit renderConfig', async () => {
		const { renderSvg, renderConfig, initialize } = await loadWith(async (id) => ({
			svg: `<svg id="${id}"></svg>`
		}));
		await renderSvg('a');
		await renderSvg('b');
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(initialize).toHaveBeenCalledWith(renderConfig());
	});

	it('führt parallele Aufrufe nacheinander aus', async () => {
		let active = 0;
		let maxActive = 0;
		const order: string[] = [];
		const { renderSvg } = await loadWith(async (id, text) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((r) => setTimeout(r, 5));
			order.push(text);
			active--;
			if (text === 'fehler') throw new Error('kaputt');
			return { svg: `<svg id="${id}"></svg>` };
		});
		const results = await Promise.all(['a', 'fehler', 'c'].map((t) => renderSvg(t)));
		expect(maxActive).toBe(1);
		expect(order).toEqual(['a', 'fehler', 'c']);
		expect(results.map((r) => r.ok)).toEqual([true, false, true]);
	});

	it('weist SVG mit foreignObject ab', async () => {
		const { renderSvg } = await loadWith(async () => ({
			svg: '<svg><foreignObject><div>x</div></foreignObject></svg>'
		}));
		const result = await renderSvg('flowchart TD\n    A\n');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toMatch(/foreignObject/);
	});

	it.each([
		[
			'themeCSS-Ausgabe (Probe R1)',
			'<style>#a .node rect{fill:url("https://evil.example/x.png")}</style>'
		],
		['url() ohne Anführung', '<style>#a{background:url(https://evil.example/x.png)}</style>'],
		['protokoll-relative url()', '<style>#a{background:url(//evil.example/x.png)}</style>'],
		['CSS-Escape \\75 rl()', '<style>#a{background:\\75 rl(https://evil.example/x.png)}</style>'],
		['Entity in url()', '<style>#a{background:&#117;rl(https://evil.example/x.png)}</style>'],
		['@import', '<style>@import "https://evil.example/x.css";</style>'],
		['image-set', '<style>#a{background:image-set("https://evil.example/x.png" 1x)}</style>'],
		['style-Attribut', '<rect style="fill:url(https://evil.example/x.png)"></rect>'],
		['Präsentations-Attribut', '<rect fill="url(https://evil.example/x.png)"></rect>'],
		['image href', '<image href="https://evil.example/p.png"></image>'],
		['image xlink:href', '<image xlink:href="https://evil.example/p.png"></image>'],
		['use mit externem Ziel', '<use href="https://evil.example/s.svg#a"></use>'],
		['Link mit javascript:', '<a href="javascript:alert(1)"><text>x</text></a>'],
		['Link mit data:', '<a xlink:href="data:text/html,x"><text>x</text></a>'],
		[
			'Escape-Kommentar \\2f\\2a ... \\2a\\2f (Probe R2)',
			'<rect style="fill:\\2f\\2a;cursor:url(https://evil.example/x.png);color:\\2a\\2f"></rect>'
		],
		[
			'Escape \\/* ist kein Kommentar',
			'<rect style="fill:\\/*;cursor:url(https://evil.example/x.png);color:*/"></rect>'
		],
		[
			'/* in String ist kein Kommentar',
			'<style>#a{content:"/*"}#b{background:url(https://evil.example/x.png)}#c{content:"*/"}</style>'
		],
		[
			'unquotierte url() mit /*',
			'<style>#a{background:url(https://evil.example/*)}#b{content:"*/"}</style>'
		],
		[
			'/* in url(#...) ist kein Kommentar (Probe R3/1)',
			'<rect style="cursor:url(#x/*);mask-image:url(https://evil.example/x.png);opacity:*/)"></rect>'
		],
		[
			'/* in url(#...) im Stylesheet (Probe R3/2)',
			'<style>#a{cursor:url(#x/*);mask-image:url(https://evil.example/x.png);opacity:*/)}</style>'
		],
		[
			'/* in u\\72l(#...) mit Escape (Probe R3/3)',
			'<rect style="cursor:u\\72l(#x/*);mask-image:url(https://evil.example/x.png);opacity:*/)"></rect>'
		]
	])('weist SVG mit externer Ressource ab: %s', async (_name, body) => {
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
		}));
		const result = await renderSvg('flowchart TD\n    A\n');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).not.toMatch(/evil|javascript|data:/);
			expect(result.error.line).toBeUndefined();
		}
	});

	it('lässt lokale Verweise, http(s)-Links und data:image-Bilder durch', async () => {
		const body =
			'<style>#a{filter:url(#a-shadow);font-family:"trebuchet ms",verdana;}</style>' +
			'<marker id="m"></marker><path marker-end="url(#m)" fill="url( \'#g\' )"></path>' +
			'<a href="https://example.com/a"><text>a</text></a>' +
			'<a xlink:href="http://example.com/b"><text>b</text></a>' +
			'<use xlink:href="#m"></use><image href="data:image/png;base64,iVBORw0KGgo="></image>';
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`
		}));
		expect((await renderSvg('flowchart TD\n    A\n')).ok).toBe(true);
	});

	/** Browser-mermaid serialisiert http(s)-click als `xlink:href` ohne `xmlns:xlink` (T24 C2). */
	const parseErrors = (svg: string) =>
		new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror')
			.length;

	it('liefert bei http(s)-click ein wohlgeformtes SVG (xlink-Präfix deklariert)', async () => {
		const link = '<a xlink:href="https://example.org"><text>A</text></a>';
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><g>${link}</g></svg>`
		}));
		const result = await renderSvg('flowchart LR\n A-->B\n click A "https://example.org"');
		if (!result.ok) throw new Error(result.error.message);
		expect(result.svg).toContain(link);
		expect(parseErrors(result.svg)).toBe(0);
	});

	it('ergänzt xmlns:xlink nicht doppelt und lässt SVG ohne xlink unverändert', async () => {
		const declared =
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
			'<a xlink:href="https://example.org"><text>A</text></a></svg>';
		const plain =
			'<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.org"></a></svg>';
		for (const svg of [declared, plain]) {
			const { renderSvg } = await loadWith(async () => ({ svg }));
			expect(await renderSvg('flowchart LR\n A\n')).toEqual({ ok: true, svg });
		}
	});

	/** Nur CSS-Whitespace `[ \t\n\r\f]` vor `#`; sonst liest der Browser eine relative URL (P3). */
	const asCss = (value: string): [string, string][] => [
		[`${value} im style-Attribut`, `<rect style="fill:${value.replaceAll('"', '&quot;')}"></rect>`],
		[`${value} im Stylesheet`, `<style>#a{fill:${value}}</style>`]
	];
	it.each(
		[
			'url(\u00a0#x)',
			'url(\u3000#x)',
			'url(\\a0 #x)',
			'url(\\3000 #x)',
			'url("\u00a0#x")',
			"url( '\\a0 #x' )",
			'url(#x) url(\u00a0#y)'
		].flatMap(asCss)
	)('weist Nicht-CSS-Whitespace vor # ab: %s', async (_n, body) => {
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
		}));
		expect((await renderSvg('flowchart TD\n    A\n')).ok).toBe(false);
	});

	it.each(
		[
			'url( #x )',
			"url('#x')",
			'url(" #x")',
			'url(\\20#x)',
			'url(\t#x)',
			'url(\n#x\n)',
			'url(\f#x)',
			'url( "\f#x" )'
		].flatMap(asCss)
	)('lässt CSS-Whitespace vor # durch: %s', async (_n, body) => {
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
		}));
		expect((await renderSvg('flowchart TD\n    A\n')).ok).toBe(true);
	});

	it.each([
		['Stylesheet', '<style>/* url(https://x) */#a{fill:red}</style>'],
		['Stylesheet mit @import', '<style>#a{fill:red}/* @import "https://x"; */</style>'],
		['style-Attribut', '<rect style="fill:red;/* url(https://x) */stroke:blue"></rect>']
	])(
		'weist url() und @import auch in CSS-Kommentaren ab (fail-closed, E1): %s',
		async (_n, body) => {
			const { renderSvg } = await loadWith(async (id) => ({
				svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
			}));
			expect((await renderSvg('flowchart TD\n    A\n')).ok).toBe(false);
		}
	);

	it('lässt CSS-Kommentare ohne url() durch', async () => {
		const body =
			'<style>/* Rahmen */#a{fill:red}</style><rect style="fill:red;/* x */stroke:blue"></rect>';
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
		}));
		expect((await renderSvg('flowchart TD\n    A\n')).ok).toBe(true);
	});

	/** 200000 Zeichen `url(` ohne Abschluss; E1-Regex brauchte dafür etwa 60 s (quadratisch). */
	const UNCLOSED: [string, string][] = [
		['url(', 'url('.repeat(50000)],
		['url(#', 'url(#'.repeat(40000)],
		['url("', 'url("'.repeat(40000)]
	];
	it.each(
		UNCLOSED.flatMap(([name, value]) => [
			[`${name} im style-Attribut`, `<rect style='cursor:${value}'></rect>`],
			[`${name} im Stylesheet`, `<style>#a{cursor:${value}}</style>`]
		])
	)('prüft url() ohne Abschluss in linearer Zeit (E2): %s', async (_n, body) => {
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
		}));
		const start = performance.now();
		const result = await renderSvg('flowchart TD\n    A\n');
		expect(performance.now() - start).toBeLessThan(1000);
		expect(result.ok).toBe(false);
	});

	it('prüft viele lokale url(#...) in linearer Zeit und lässt sie durch (E2)', async () => {
		const value = 'fill:url(#a);stroke:url( "#b" );'.repeat(6000);
		const { renderSvg } = await loadWith(async (id) => ({
			svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><style>#a{${value}}</style><rect style='${value}'></rect></svg>`
		}));
		const start = performance.now();
		const result = await renderSvg('flowchart TD\n    A\n');
		expect(performance.now() - start).toBeLessThan(1000);
		expect(result.ok).toBe(true);
	});

	it('stellt Image nach Fehlern im Rendern wieder her', async () => {
		const original = window.Image;
		let during: unknown;
		const { renderSvg } = await loadWith(async () => {
			during = window.Image;
			throw new Error('kaputt');
		});
		expect((await renderSvg('x')).ok).toBe(false);
		expect(during).not.toBe(original);
		expect(window.Image).toBe(original);
	});

	it('übernimmt Zeile aus der Fehlermeldung, wenn hash.loc fehlt', async () => {
		const { renderSvg } = await loadWith(async () => {
			throw new Error('Parse error on line 2:\nx');
		});
		const result = await renderSvg('%% k\nflowchart TD\n    A -->\n');
		expect(result).toEqual({
			ok: false,
			error: { message: 'Parse error on line 2:\nx', line: 3, column: 1 }
		});
	});

	it('verträgt Nicht-Error-Würfe', async () => {
		const { renderSvg } = await loadWith(async () => {
			throw 'roh';
		});
		expect(await renderSvg('x')).toEqual({ ok: false, error: { message: 'roh' } });
	});

	it('meldet Ladefehler von mermaid und versucht es beim nächsten Aufruf erneut', async () => {
		const initialize = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('Laden fehlgeschlagen');
			})
			.mockImplementation(() => undefined);
		const { renderSvg } = await loadWith(
			async (id) => ({ svg: `<svg id="${id}"></svg>` }),
			initialize
		);
		expect(await renderSvg('a')).toEqual({
			ok: false,
			error: { message: 'Laden fehlgeschlagen' }
		});
		expect((await renderSvg('a')).ok).toBe(true);
		expect(initialize).toHaveBeenCalledTimes(2);
	});
});

describe('Theme aus dem Code (F-09)', () => {
	const svg = async (id: string) => ({ svg: `<svg id="${id}"></svg>` });
	const fm = (theme: string) => `---\nconfig:\n  theme: ${theme}\n---\nflowchart TD\n  A\n`;

	it('erlaubte Themes wendet mermaid selbst an, kein erneutes initialize (O-167)', async () => {
		const { renderSvg, renderConfig, initialize } = await loadWith(svg);
		expect(renderConfig().secure).not.toContain('theme');
		await renderSvg(fm('dark'));
		await renderSvg(`%%{init: {"theme": "forest"}}%%\nflowchart TD\n  A\n`);
		await renderSvg('flowchart TD\n  A\n');
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(initialize).toHaveBeenCalledWith(renderConfig());
	});

	it('nicht erlaubte Werte: theme nur dann gesperrt, Fallback default (O-167)', async () => {
		const { renderSvg, renderConfig, initialize } = await loadWith(svg);
		const base = renderConfig();
		const locked = { ...base, secure: [...(base.secure as string[]), 'theme'] };
		await renderSvg(fm('neo'));
		expect(initialize).toHaveBeenLastCalledWith(locked);
		expect(locked).not.toHaveProperty('theme');
		expect(initialize).toHaveBeenCalledTimes(2);
		await renderSvg(`%%{init: {"theme": "redux"}}%%\nflowchart TD\n  A\n`);
		expect(initialize).toHaveBeenLastCalledWith(locked);
		// parse liest gesperrt kein Theme (mermaid entfernt es): je Render erst entsperren (O-174).
		expect(initialize).toHaveBeenCalledTimes(4);
		await renderSvg(fm('dark'));
		expect(initialize).toHaveBeenLastCalledWith(base);
		expect(initialize).toHaveBeenCalledTimes(5);
	});

	it('parse vor render, entsperrt; unklares parse-Ergebnis sperrt (fail-closed, O-174)', async () => {
		const calls: string[] = [];
		const initialize = vi.fn((config: { secure: string[] }) => {
			calls.push(config.secure.includes('theme') ? 'lock' : 'open');
		});
		const parse = vi.fn(async (text: string) => {
			calls.push('parse');
			return text.includes('kaputt') ? false : parseTheme(text);
		});
		const { renderSvg } = await loadWith(
			async (id) => {
				calls.push('render');
				return { svg: `<svg id="${id}"></svg>` };
			},
			initialize,
			parse
		);
		await renderSvg('kaputt');
		await renderSvg(fm('neo'));
		await renderSvg(fm('dark'));
		expect(parse).toHaveBeenCalledWith('kaputt', { suppressErrors: true });
		expect(calls).toEqual([
			'open',
			'parse',
			'lock',
			'render',
			'open',
			'parse',
			'lock',
			'render',
			'open',
			'parse',
			'render'
		]);
	});
});
