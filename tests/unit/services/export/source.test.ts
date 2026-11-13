import { describe, expect, it, vi } from 'vitest';
import {
	defaultSource,
	exportSvg,
	withSize,
	withTitle
} from '../../../../src/lib/services/export/source';
import { doc, edge, measure, node } from './fixtures';

const META = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[40,60,100,40]}}';
const CODE = `flowchart LR\n  A --> B\n${META}\n`;

const graph = (mode: 'manual' | 'auto') =>
	doc({
		title: 'T',
		nodes: [node('A'), node('B')],
		edges: [edge('e1', 'A', 'B')],
		layout: { mode, engine: 'dagre', positions: {}, gridSize: 10, snap: false }
	});

const geometry = { A: [0, 0, 40, 20], B: [100, 0, 40, 20] } as Record<
	string,
	[number, number, number, number]
>;

describe('defaultSource (KONZEPT §6.3)', () => {
	it('manuell -> editor, auto -> mermaid, sequence immer mermaid', () => {
		expect(defaultSource(graph('manual'))).toBe('editor');
		expect(defaultSource(graph('auto'))).toBe('mermaid');
		expect(defaultSource({ ...graph('manual'), diagramType: 'sequence' })).toBe('mermaid');
	});
});

describe('withTitle', () => {
	it('setzt <title> als erstes Kind, Anführungszeichen mit > im Start-Tag beachtet', () => {
		expect(withTitle('<svg a=">" b=\'>\'><g/></svg>', 'x<y')).toBe(
			'<svg a=">" b=\'>\'><title>x&lt;y</title><g/></svg>'
		);
	});

	it('vorhandenes <title> direkt nach dem Start-Tag bleibt, ohne <svg> unverändert', () => {
		const svg = '<svg id="m">\n<title>alt</title></svg>';
		expect(withTitle(svg, 'neu')).toBe(svg);
		expect(withTitle('kein svg', 'neu')).toBe('kein svg');
		expect(withTitle('<svg', 'neu')).toBe('<svg');
	});
});

describe('withSize (T127 C1, V-22)', () => {
	it('width/height aus der viewBox ersetzen width="100%", übrige Attribute bleiben', () => {
		const svg =
			'<svg id="m" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 120.5px;"' +
			' viewBox="-8 -8 120.5 64"><g stroke-width="2"/></svg>';
		expect(withSize(svg)).toBe(
			'<svg id="m" width="120.5" xmlns="http://www.w3.org/2000/svg" style="max-width: 120.5px;"' +
				' viewBox="-8 -8 120.5 64" height="64"><g stroke-width="2"/></svg>'
		);
	});

	it('vorhandene Höhe wird an ihrer Stelle ersetzt, Kommas in der viewBox erlaubt', () => {
		expect(withSize("<svg height='3' viewBox='0,0,10,20'></svg>")).toBe(
			'<svg height="20" viewBox=\'0,0,10,20\' width="10"></svg>'
		);
	});

	it('übriger Start-Tag-Text bleibt unverändert, auch ohne Leerraum zwischen Attributen', () => {
		expect(withSize('<svg a="1"b="2"  viewBox="0 0 4 5"\n/>')).toBe(
			'<svg a="1"b="2"  viewBox="0 0 4 5"\n width="4" height="5"/>'
		);
	});

	it('Attributnamen wie Prototyp-Felder (constructor, toString) bleiben unverändert', () => {
		expect(withSize('<svg viewBox="0 0 4 5" constructor="x">')).toBe(
			'<svg viewBox="0 0 4 5" constructor="x" width="4" height="5">'
		);
		expect(withSize('<svg toString="y" viewBox="0 0 4 5"></svg>')).toBe(
			'<svg toString="y" viewBox="0 0 4 5" width="4" height="5"></svg>'
		);
	});

	it('ohne gültige viewBox unverändert', () => {
		for (const svg of [
			'<svg width="100%"><g/></svg>',
			'<svg viewBox="0 0 0 10"></svg>',
			'<svg viewBox="0 0 a 10"></svg>',
			'kein svg'
		]) {
			expect(withSize(svg)).toBe(svg);
		}
	});
});

describe('exportSvg', () => {
	it('Default manuell: Editor-SVG ohne Render-Aufruf', async () => {
		const render = vi.fn();
		const result = await exportSvg({ doc: graph('manual'), code: CODE, geometry, measure, render });
		expect(render).not.toHaveBeenCalled();
		expect(result).toMatchObject({ ok: true, source: 'editor' });
		if (result.ok) expect(result.svg).toContain('<title>T</title>');
	});

	it('Default auto: renderSvg mit Code ohne Metadaten-Zeile, <title> ergänzt', async () => {
		const render = vi.fn(async () => ({ ok: true as const, svg: '<svg id="m"><g/></svg>' }));
		const result = await exportSvg({ doc: graph('auto'), code: CODE, geometry, measure, render });
		expect(render).toHaveBeenCalledWith('flowchart LR\n  A --> B\n');
		expect(result).toEqual({
			ok: true,
			source: 'mermaid',
			svg: '<svg id="m"><title>T</title><g/></svg>'
		});
	});

	it('Quelle umschaltbar; Titel-Option hat Vorrang', async () => {
		const render = vi.fn(async () => ({ ok: true as const, svg: '<svg><g/></svg>' }));
		const result = await exportSvg({
			doc: graph('manual'),
			code: CODE,
			geometry,
			measure,
			render,
			source: 'mermaid',
			title: 'Eigen'
		});
		expect(result).toMatchObject({ ok: true, svg: '<svg><title>Eigen</title><g/></svg>' });
	});

	it('Mermaid-SVG trägt width/height aus der viewBox (V-22)', async () => {
		const render = vi.fn(async () => ({
			ok: true as const,
			svg: '<svg id="m" width="100%" viewBox="0 0 200 80"><g/></svg>'
		}));
		const result = await exportSvg({ doc: graph('auto'), code: CODE, geometry, measure, render });
		expect(result).toMatchObject({
			ok: true,
			svg: '<svg id="m" width="200" viewBox="0 0 200 80" height="80"><title>T</title><g/></svg>'
		});
	});

	it('Render-Fehler wird durchgereicht', async () => {
		const render = vi.fn(async () => ({ ok: false as const, error: { message: 'kaputt' } }));
		const result = await exportSvg({ doc: graph('auto'), code: 'x', geometry, measure, render });
		expect(result).toEqual({ ok: false, error: { message: 'kaputt' } });
	});

	it('Mermaid-SVG mit foreignObject wird abgewiesen', async () => {
		const render = vi.fn(async () => ({ ok: true as const, svg: '<svg><foreignObject/></svg>' }));
		const result = await exportSvg({ doc: graph('auto'), code: 'x', geometry, measure, render });
		expect(result.ok).toBe(false);
	});

	it('Metadaten-Marke aus Nutzertext wird im Mermaid-SVG maskiert, sonst unverändert', async () => {
		const render = vi.fn(async () => ({
			ok: true as const,
			svg: '<svg><title>t</title><text>@mermuid @MermUId URL(x) url(#m)</text></svg>'
		}));
		const result = await exportSvg({ doc: graph('auto'), code: 'x', geometry, measure, render });
		expect(result).toMatchObject({
			ok: true,
			svg: '<svg><title>t</title><text>&#64;mermuid &#64;MermUId URL(x) url(#m)</text></svg>'
		});
	});

	it('Editor-SVG für sequence aus der Szene', async () => {
		const result = await exportSvg({
			doc: { ...graph('manual'), diagramType: 'sequence' },
			code: CODE,
			geometry,
			measure,
			source: 'editor',
			sequence: { items: [], lifelines: [], bars: [], minX: 0, minY: 0, width: 10, height: 10 }
		});
		expect(result).toMatchObject({ ok: true, source: 'editor' });
		expect(result.ok && result.svg).toContain('<title>T</title>');
	});

	it('Editor-SVG für sequence ohne Szene: Fehler', async () => {
		const result = await exportSvg({
			doc: { ...graph('manual'), diagramType: 'sequence' },
			code: CODE,
			geometry,
			measure,
			source: 'editor'
		});
		expect(result).toEqual({
			ok: false,
			error: { message: 'Editor-SVG nur für Layout-Klasse "Graph"; Mermaid-SVG verwenden.' }
		});
	});
});
