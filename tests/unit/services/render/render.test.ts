// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RENDER_ID_PREFIX, renderConfig, renderSvg } from '../../../../src/lib/services/render';
import { filterMermaidConfig } from '../../../../src/lib/services/security';

/** jsdom kennt keine SVG-Messfunktionen; nur im Test ersetzen (O-20). */
function stubSvgMeasurement(): void {
	const proto = SVGElement.prototype as unknown as Record<string, unknown>;
	proto.getBBox = function (this: Element) {
		const length = (this.textContent ?? '').length;
		return { x: 0, y: 0, width: length * 8, height: 16 };
	};
	proto.getComputedTextLength = function (this: Element) {
		return (this.textContent ?? '').length * 8;
	};
}

/** Wirksame mermaid-Konfiguration nach dem letzten Rendern (nur lesend). */
async function effectiveConfig(): Promise<Record<string, unknown>> {
	const { default: mermaid } = await import('mermaid');
	return mermaid.mermaidAPI.getConfig() as Record<string, unknown>;
}

function expectOk(result: Awaited<ReturnType<typeof renderSvg>>): string {
	if (!result.ok) throw new Error(`Rendern fehlgeschlagen: ${result.error.message}`);
	return result.svg;
}

function renderContainers(): Element[] {
	return Array.from(document.body.children).filter((el) =>
		[`d${RENDER_ID_PREFIX}`, `i${RENDER_ID_PREFIX}`].some((p) => el.id.startsWith(p))
	);
}

const FLOWCHART = 'flowchart TD\n    A[Start] --> B{Frage}\n    B -->|ja| C[Ende]\n';

beforeAll(() => {
	stubSvgMeasurement();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('renderConfig', () => {
	it('basiert ausschließlich auf filterMermaidConfig (inkl. startOnLoad false) und sperrt zusätzlich htmlLabels', () => {
		const config = renderConfig();
		const filtered = filterMermaidConfig({});
		expect(filtered.startOnLoad).toBe(false);
		expect({ ...config, secure: filtered.secure }).toEqual(filtered);
		expect(config.secure).toEqual(expect.arrayContaining([...(filtered.secure as string[])]));
		expect(config.secure).toContain('htmlLabels');
		expect(config.secure).toContain('layout');
		expect(config.securityLevel).toBe('strict');
		expect(config.layout).toBe('dagre');
		expect(config.htmlLabels).toBe(false);
	});

	it('sperrt themeCSS, fontFamily und altFontFamily für Nutzer-Code', () => {
		expect(renderConfig().secure).toEqual(
			expect.arrayContaining(['themeCSS', 'fontFamily', 'altFontFamily'])
		);
	});

	it('setzt startOnLoad false (kein automatisches run beim load-Event)', () => {
		expect(renderConfig().startOnLoad).toBe(false);
	});
});

const EVIL = 'evil.example';

/** Zeichnet `src`-Zuweisungen an Bildern auf; jsdom fehlt `decode`, nur im Test ersetzen. */
function recordImageLoads(): { sources: string[]; restore: () => void } {
	const proto = HTMLImageElement.prototype as unknown as Record<string, unknown>;
	const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
	const decode = proto.decode;
	const sources: string[] = [];
	Object.defineProperty(HTMLImageElement.prototype, 'src', {
		configurable: true,
		get(this: HTMLImageElement) {
			return this.getAttribute('src') ?? '';
		},
		set(this: HTMLImageElement, value: string) {
			sources.push(value);
			this.setAttribute('src', value);
		}
	});
	proto.decode = async () => undefined;
	return {
		sources,
		restore: () => {
			if (descriptor) Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor);
			proto.decode = decode;
		}
	};
}

describe('renderSvg ohne externe Ressourcen', () => {
	it('%%{init} themeCSS mit url() erreicht das SVG nicht', async () => {
		const code =
			'%%{init: {"themeCSS": ".node rect{fill:url(https://evil.example/x.png)}"}}%%\n' +
			'flowchart TD\n    A --> B\n';
		const result = await renderSvg(code);
		if (result.ok) expect(result.svg).not.toContain(EVIL);
		expect((await effectiveConfig()).themeCSS).toBeUndefined();
	});

	it('Frontmatter themeCSS und fontFamily mit url() erreichen das SVG nicht', async () => {
		const code =
			'---\nconfig:\n  themeCSS: ".node rect{fill:url(https://evil.example/x.png)}"\n' +
			'  fontFamily: "x;background:url(https://evil.example/f.png)"\n' +
			'  altFontFamily: "x;background:url(https://evil.example/a.png)"\n---\n' +
			'flowchart TD\n    A --> B\n';
		const result = await renderSvg(code);
		if (result.ok) expect(result.svg).not.toContain(EVIL);
		const config = await effectiveConfig();
		expect(config.themeCSS).toBeUndefined();
		expect(String(config.fontFamily)).not.toContain(EVIL);
	});

	it('Knoten-img mit externer URL: Fehler ohne URL, kein Ladeversuch', async () => {
		const images = recordImageLoads();
		try {
			const result = await renderSvg(
				'flowchart TD\n    A@{ img: "https://evil.example/p.png", label: "x" }\n'
			);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.message).not.toContain(EVIL);
			expect(images.sources.join(' ')).not.toContain(EVIL);
		} finally {
			images.restore();
		}
		expect(window.Image.name).not.toMatch(/guard/i);
	});

	it('Knoten-img als data:image bleibt erlaubt', async () => {
		const images = recordImageLoads();
		const src = 'data:image/png;base64,iVBORw0KGgo=';
		try {
			const svg = expectOk(await renderSvg(`flowchart TD\n    A@{ img: "${src}", label: "x" }\n`));
			expect(svg).toContain(src);
			expect(images.sources).toEqual([src]);
		} finally {
			images.restore();
		}
	});

	it('flowchart mit Pfeil-Markern url(#...) bleibt ok', async () => {
		const svg = expectOk(await renderSvg(FLOWCHART));
		expect(svg).toMatch(/marker-end="url\(#/);
	});

	it('http(s)-Links aus click und sequence-links bleiben ok', async () => {
		const flow = expectOk(
			await renderSvg('flowchart TD\n    A --> B\n    click A href "https://example.com/a"\n')
		);
		expect(flow).toContain('href="https://example.com/a"');
		expectOk(
			await renderSvg(
				'sequenceDiagram\n    participant A\n' +
					'    links A: {"Repo": "https://example.com/r", "Doku": "http://example.com/d"}\n' +
					'    A->>B: Hallo\n'
			)
		);
	});

	it('style mit Escape-Kommentar verdeckt url() nicht (Probe R2)', async () => {
		const result = await renderSvg(
			'classDiagram\n class A\n' +
				' style A fill:\\2f\\2a,cursor:url(https://evil.example/x.png),color:\\2a\\2f\n'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).not.toContain(EVIL);
	});

	it('style mit /* in url(#...) verdeckt url() nicht (Probe R3/4)', async () => {
		const result = await renderSvg(
			'classDiagram\n class A\n' +
				' style A cursor:url(#x/*),cursor:url(https://evil.example/x.png),opacity:*/)\n'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).not.toContain(EVIL);
	});

	// `url(#` ohne Abschluss fehlt hier: mermaid selbst braucht dafür in jsdom etwa 7 s (eigene
	// Laufzeit, nicht die Prüfung); die Prüfung deckt die Attrappe ab (mocked.test.ts).
	it.each(['url(', 'url("'])(
		'style mit langem %s ohne Abschluss wird zügig abgewiesen (E2)',
		async (unit) => {
			const value = unit.repeat(Math.floor(199000 / unit.length));
			const start = performance.now();
			const result = await renderSvg(`classDiagram\n class A\n style A cursor:${value}\n`);
			expect(performance.now() - start).toBeLessThan(5000);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.message).toMatch(/externe Ressource/);
		},
		30000
	);

	/** Kein CSS-Whitespace: der Browser liest `url("\u00a0#x")` als relative URL (P3, E3). */
	const NON_CSS_SPACE = ['url(\u00a0#x)', 'url(\u3000#x)', 'url(\\a0 #x)', 'url(\\3000 #x)'];
	const LOCAL_URLS = ['url( #x )', "url('#x')", 'url(\\20#x)', 'url(\t#x)', 'url(\\a #x)'];
	const styleCodes = (value: string) => [
		`classDiagram\n class A\n style A fill:${value}\n`,
		`stateDiagram-v2\n classDef c fill:${value}\n A:::c\n`
	];

	it.each(NON_CSS_SPACE)('style/classDef mit %s vor # wird abgewiesen (P3)', async (value) => {
		for (const code of styleCodes(value)) {
			const result = await renderSvg(code);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.message).toMatch(/externe Ressource/);
		}
	});

	it.each(LOCAL_URLS)('style/classDef mit lokalem %s bleibt ok (P3)', async (value) => {
		for (const code of styleCodes(value)) expectOk(await renderSvg(code));
	});

	it.each(['default', 'dark', 'forest', 'neutral', 'base'])(
		'Theme %s ergibt keinen Fehlalarm',
		async (theme) => {
			expectOk(await renderSvg(`%%{init: {"theme": "${theme}"}}%%\n${FLOWCHART}`));
			expectOk(await renderSvg(`%%{init: {"theme": "${theme}"}}%%\nstateDiagram-v2\n A --> B\n`));
		}
	);

	it('style mit Farben und Strichen bleibt ok', async () => {
		expectOk(await renderSvg('classDiagram\n class A\n style A fill:#f9f,stroke:#333\n'));
		expectOk(
			await renderSvg('flowchart TD\n    A --> B\n    style A fill:#f9f,stroke:#333,color:#000\n')
		);
	});

	it('sequence-Icon mit externer URL wird abgewiesen', async () => {
		const result = await renderSvg(
			'sequenceDiagram\n    participant A\n' +
				'    properties A: {"icon": "https://evil.example/i.png"}\n    A->>B: Hallo\n'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).not.toContain(EVIL);
	});
});

describe('renderSvg', () => {
	it('liefert für einen flowchart ein SVG ohne foreignObject', async () => {
		const svg = expectOk(await renderSvg(FLOWCHART));
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).not.toMatch(/<foreignObject/i);
		expect(svg).toContain('Start');
	});

	it('rendert auch sequence ohne foreignObject', async () => {
		const svg = expectOk(await renderSvg('sequenceDiagram\n    A->>B: Hallo\n'));
		expect(svg).not.toMatch(/<foreignObject/i);
	});

	it('%%{init} mit securityLevel loose bleibt strict, Klick-Callback und Link bleiben wirkungslos', async () => {
		const callback = vi.fn();
		(window as unknown as Record<string, unknown>).mermuidProbe = callback;
		const code =
			'%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\n    A[Knoten] --> B\n' +
			'    click A mermuidProbe "Tipp"\n    click B href "javascript:mermuidProbe()"\n';
		const svg = expectOk(await renderSvg(code));
		expect((await effectiveConfig()).securityLevel).toBe('strict');
		expect(svg).not.toContain('javascript:');
		expect(svg).not.toMatch(/\son\w+=/i);
		document.body.innerHTML = svg;
		for (const el of document.body.querySelectorAll('g, a, rect, span')) {
			el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		}
		expect(callback).not.toHaveBeenCalled();
		expect(document.querySelector('script')).toBeNull();
		delete (window as unknown as Record<string, unknown>).mermuidProbe;
	});

	it('%%{init} kann htmlLabels nicht einschalten (kein foreignObject)', async () => {
		const code =
			'%%{init: {"htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%\n' +
			'flowchart TD\n    A[<b>fett</b>] --> B\n';
		const svg = expectOk(await renderSvg(code));
		expect(svg).not.toMatch(/<foreignObject/i);
		const config = await effectiveConfig();
		expect(config.htmlLabels).toBe(false);
		expect((config.flowchart as Record<string, unknown>).htmlLabels).toBe(false);
	});

	it('Frontmatter config layout elk ergibt dagre', async () => {
		const code =
			'---\nconfig:\n  layout: elk\n  htmlLabels: true\n  flowchart:\n    layout: elk\n---\n' +
			'flowchart TD\n    A --> B\n';
		const svg = expectOk(await renderSvg(code));
		expect(svg).not.toMatch(/<foreignObject/i);
		const config = await effectiveConfig();
		expect(config.layout).toBe('dagre');
		expect(config.securityLevel).toBe('strict');
	});

	it('setzt die App-Grenzen maxTextSize und maxEdges (über den mermaid-Defaults 50000/500)', async () => {
		expectOk(await renderSvg(FLOWCHART));
		const config = await effectiveConfig();
		expect(config.maxTextSize).toBe(200000);
		expect(config.maxEdges).toBe(1000);
	});

	it('meldet überschrittene maxEdges als Fehler', async () => {
		const edges = Array.from({ length: 1001 }, (_, i) => `    n${i} --> n${i + 1}`).join('\n');
		const result = await renderSvg(`flowchart TD\n${edges}\n`);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toMatch(/Edge limit/);
	});

	it('weist Text über maxTextSize ab, ohne mermaid-Ersatzdiagramm', async () => {
		const label = 'x'.repeat(200001);
		const result = await renderSvg(`flowchart TD\n    A[${label}]\n`);
		expect(result).toEqual({
			ok: false,
			error: { message: expect.stringContaining('200000') }
		});
	});

	it('meldet Syntaxfehler mit Originalzeile und Spalte', async () => {
		const result = await renderSvg('%% Kommentar\n\nflowchart TD\n    A --> B\n    C -->\n');
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.line).toBe(5);
		expect(result.error.column).toBeGreaterThanOrEqual(1);
		expect(result.error.message).toMatch(/Parse error/);
	});

	it('meldet unbekannten Diagrammtyp ohne Position', async () => {
		const result = await renderSvg('kein diagramm\n');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).not.toBe('');
			expect(result.error.line).toBeUndefined();
		}
	});

	it('räumt Render-Container auch nach Fehlern auf', async () => {
		await renderSvg('flowchart TD\n    A -->\n');
		await renderSvg(FLOWCHART);
		expect(renderContainers()).toEqual([]);
	});

	it('entfernt verwaiste Container früherer Läufe, lässt eingefügte Vorschau-SVGs stehen', async () => {
		const orphan = document.createElement('div');
		orphan.id = `d${RENDER_ID_PREFIX}999`;
		document.body.append(orphan);
		const preview = document.createElement('div');
		preview.id = 'vorschau';
		preview.innerHTML = expectOk(await renderSvg(FLOWCHART));
		document.body.append(preview);
		expectOk(await renderSvg(FLOWCHART));
		expect(renderContainers()).toEqual([]);
		expect(preview.querySelector('svg')).not.toBeNull();
	});

	it('serialisiert parallele Aufrufe mit eindeutigen IDs', async () => {
		const results = await Promise.all([
			renderSvg(FLOWCHART),
			renderSvg('flowchart LR\n    X --> Y\n'),
			renderSvg('flowchart TD\n    A -->\n'),
			renderSvg('sequenceDiagram\n    A->>B: x\n')
		]);
		expect(results.map((r) => r.ok)).toEqual([true, true, false, true]);
		const ids = results
			.filter((r) => r.ok)
			.map((r) => (r.ok ? /<svg[^>]*\sid="([^"]+)"/.exec(r.svg)?.[1] : undefined));
		expect(new Set(ids).size).toBe(3);
		for (const id of ids) expect(id?.startsWith(RENDER_ID_PREFIX)).toBe(true);
		expect(renderContainers()).toEqual([]);
	});
});

describe('Theme-Auswahl (F-09)', () => {
	const fm = (theme: string) => `---\nconfig:\n  theme: ${theme}\n---\n${FLOWCHART}`;

	it('Frontmatter-Theme der Allow-Liste wirkt, andere fallen auf default', async () => {
		expectOk(await renderSvg(fm('dark')));
		expect((await effectiveConfig()).theme).toBe('dark');
		expectOk(await renderSvg(fm('neo')));
		expect((await effectiveConfig()).theme).toBe('default');
		expectOk(await renderSvg(`%%{init: {"theme": "forest"}}%%\n${FLOWCHART}`));
		expect((await effectiveConfig()).theme).toBe('forest');
		expectOk(await renderSvg(FLOWCHART));
		expect((await effectiveConfig()).theme).toBe('default');
	});

	it('theme base mit themeVariables: abgeleitete Farben neu berechnet wie vor T134 (O-167)', async () => {
		const vars = (head: string) => `---\nconfig:\n${head}---\n${FLOWCHART}`;
		type Vars = Record<string, string>;
		expectOk(await renderSvg(vars('  theme: base\n')));
		const plain = (await effectiveConfig()).themeVariables as Vars;
		const svg = expectOk(
			await renderSvg(vars('  theme: base\n  themeVariables:\n    primaryColor: "#ff0000"\n'))
		);
		const config = await effectiveConfig();
		const themed = config.themeVariables as Vars;
		expect(config.theme).toBe('base');
		expect(themed.mainBkg).toBe('#ff0000');
		expect(themed.nodeBorder).not.toBe(plain.nodeBorder);
		expect(themed.nodeBorder).toBe(themed.primaryBorderColor);
		expect(svg).toContain('#ff0000');
		const direct = expectOk(
			await renderSvg(
				`%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ff0000"}}}%%\n${FLOWCHART}`
			)
		);
		expect(((await effectiveConfig()).themeVariables as Vars).mainBkg).toBe('#ff0000');
		expect(direct).toContain('#ff0000');
	});
});

describe('Theme-Sperre über mermaid.parse (O-174)', () => {
	const D = 'flowchart TD\n  A --> B\n';
	const theme = async () => (await effectiveConfig()).theme;
	const siteConfig = async () => {
		const { default: mermaid } = await import('mermaid');
		return mermaid.mermaidAPI.getSiteConfig() as Record<string, unknown>;
	};

	it.each([
		['Direktive hinter %%}%% in letzter Zeile', `${D}%%}%%%%{init: {"theme":"neo"}}%%`],
		['dito CRLF', `${D}%%}%%%%{init: {"theme":"neo"}}%%\r\n`.replace(/\n/g, '\r\n')],
		['Kommentar und Direktive in einer Zeile', `${D}A %%}%%%%{init: {"theme":"neo"}}%%\n`],
		['eingerückter Schlusszaun', `---\nconfig:\n  theme: neo\n  ---\n  x: 1\n---\n${D}`],
		['theme: dark redux', `---\nconfig:\n  theme: dark redux\n---\n${D}`],
		['theme: dark,redux', `---\nconfig:\n  theme: dark,redux\n---\n${D}`],
		['Fluss-Mapping dark redux', `---\nconfig: {theme: dark redux}\n---\n${D}`],
		['Tab nach Doppelpunkt', `---\nconfig:\n  theme:\tneo\n---\n${D}`],
		['neo Frontmatter', `---\nconfig:\n  theme: neo\n---\n${D}`],
		['redux Direktive', `%%{init: {"theme": "redux"}}%%\n${D}`],
		[
			'Direktive vor Frontmatter',
			`---\nconfig:\n  theme: dark\n---\n%%{init: {"theme": "neo"}}%%\n${D}`
		]
	])('%s: wirksames Theme default', async (_name, code) => {
		await renderSvg(code);
		expect(await theme()).toBe('default');
	});

	it('erlaubte Werte bleiben, auch nach gesperrtem Render (Übergänge)', async () => {
		const fm = (value: string) => `---\nconfig:\n  theme: ${value}\n---\n${D}`;
		expectOk(await renderSvg(fm('neo')));
		expect(await theme()).toBe('default');
		expectOk(await renderSvg(fm('dark')));
		expect(await theme()).toBe('dark');
		expectOk(
			await renderSvg(`---\nconfig:\n  theme: neo\n---\n%%{init: {"theme": "forest"}}%%\n${D}`)
		);
		expect(await theme()).toBe('forest');
		expectOk(await renderSvg(fm('redux')));
		expectOk(await renderSvg(`%%{init: {"theme": "base"}}%%\n${D}`));
		expect(await theme()).toBe('base');
	});

	it('parse verändert die Site-Config nicht dauerhaft', async () => {
		const before = await siteConfig();
		expectOk(
			await renderSvg(`%%{init: {"theme": "forest", "flowchart": {"curve": "step"}}}%%\n${D}`)
		);
		expect(await siteConfig()).toEqual(before);
		expect((await siteConfig()).secure).not.toContain('theme');
		expectOk(await renderSvg(D));
		expect(await theme()).toBe('default');
		expect(((await effectiveConfig()).flowchart as Record<string, unknown>).curve).not.toBe('step');
	});
});

describe('Modulgrenzen', () => {
	const dir = join(__dirname, '../../../../src/lib/services/render');
	const sources = ['index.ts', 'lines.ts'].map((f) => readFileSync(join(dir, f), 'utf8'));

	it('lädt mermaid nur dynamisch über den Paket-Einstieg (N-01)', () => {
		const all = sources.join('\n');
		expect(all).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+'mermaid/m);
		expect(all).not.toMatch(/mermaid\.esm|mermaid\/dist|elkjs/);
		expect(all).toContain("import('mermaid')");
	});

	it('importiert kein Svelte', () => {
		for (const source of sources) expect(source).not.toMatch(/from\s+'svelte|\.svelte'/);
	});
});
