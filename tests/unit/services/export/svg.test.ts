import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PALETTE,
	editorSvg,
	escapeXml,
	safePalette
} from '../../../../src/lib/services/export/svg';
import type { ClassDef, DiagramNode } from '../../../../src/lib/model/types';
import { resolveStyle, textColor } from '../../../../src/lib/services/shapes/style';
import { container, doc, edge, measure, node } from './fixtures';

const sample = () =>
	doc({
		title: 'Ablauf',
		nodes: [node('A', 'Start'), node('B', 'Prüfen', 'diamond', 'S'), node('C', 'Weiter', 'round')],
		edges: [
			edge('e1', 'A', 'B', { label: 'ok' }),
			edge('e2', 'B', 'C', { lineStyle: 'dotted', arrowHead: 'double_circle' }),
			edge('e3', 'A', 'C', { lineStyle: 'invisible' })
		],
		containers: [container('S', 'Gruppe')]
	});

const geometry = {
	A: [40, 60, 100, 40],
	B: [220, 50, 80, 60],
	C: [400, 60, 100, 40],
	S: [200, 20, 120, 110]
} as Record<string, [number, number, number, number]>;

describe('escapeXml', () => {
	it('maskiert Markup, Klammern und @, entfernt in XML ungültige Zeichen', () => {
		expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;'
		);
		expect(escapeXml('url(x) @mermuid')).toBe('url&#40;x&#41; &#64;mermuid');
		expect(escapeXml('a\u0000b\u0008c\u000bd￾e\ud800f')).toBe('abcdef');
		expect(escapeXml('😀\tok\n')).toBe('😀\tok\n');
	});
});

describe('editorSvg', () => {
	it('liefert deterministisches SVG (Snapshot)', () => {
		const svg = editorSvg(sample(), geometry, { measure });
		expect(editorSvg(sample(), geometry, { measure })).toBe(svg);
		expect(svg).toMatchSnapshot();
	});

	it('hat <title>, viewBox aus Geometrie plus Rand und Formpfade aus services/shapes', () => {
		const svg = editorSvg(sample(), geometry, { measure });
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
		expect(svg).toContain('<title>Ablauf</title>');
		expect(svg).toContain('viewBox="20 0 500 150"');
		expect(svg).toContain('width="500" height="150"');
		// diamond 80 x 60 aus shapePath
		expect(svg).toContain('d="M40 0 L80 30 L40 60 L0 30 Z"');
		expect(svg).toContain('stroke-dasharray="3 3"');
		expect(svg).not.toContain('<foreignObject');
		expect(svg).not.toContain('@mermuid');
	});

	it('Titel-Vorrang: Option vor Modell vor Standard', () => {
		expect(editorSvg(doc(), {}, { measure, title: 'X' })).toContain('<title>X</title>');
		expect(editorSvg(doc(), {}, { measure })).toContain('<title>Diagramm</title>');
	});

	it('bricht Labels über wrapLabel um und zentriert die Zeilen', () => {
		const d = doc({ nodes: [node('A', 'eins zwei drei')] });
		const svg = editorSvg(d, { A: [0, 0, 60, 80] }, { measure });
		expect(svg.match(/<tspan /g)).toHaveLength(3);
		expect(svg).toContain('>eins</tspan>');
	});

	it('überspringt Elemente ohne Geometrie und Kanten mit fehlendem Ende', () => {
		const d = doc({ nodes: [node('A'), node('B')], edges: [edge('e1', 'A', 'B')] });
		const svg = editorSvg(d, { A: [0, 0, 50, 30] }, { measure });
		expect(svg.match(/<path /g)).toHaveLength(1);
	});

	it('Selbstkante A-->A als Schleife außerhalb des Knotens, endliche Koordinaten', () => {
		const d = doc({ nodes: [node('A')], edges: [edge('e1', 'A', 'A', { label: 'zurück' })] });
		const svg = editorSvg(d, { A: [40, 60, 100, 40] }, { measure });
		const path = /<g class="edge"><path d="([^"]+)"/.exec(svg)?.[1] ?? '';
		const values = (path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
		expect(values.length).toBeGreaterThan(0);
		expect(values.every(Number.isFinite)).toBe(true);
		const xs = values.filter((_, i) => i % 2 === 0);
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(140);
		expect(Math.max(...xs)).toBeGreaterThan(140);
		expect(svg).toContain('class="marker"');
		expect(svg).not.toMatch(/NaN|Infinity/);
		const [, , vw] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);
		expect(vw).toBeGreaterThan(100 + 40);
	});

	const labelBoxes = (svg: string) =>
		[
			...svg.matchAll(
				/<g class="edge-label"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g
			)
		].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
	const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
		a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

	it('Label der Selbstkante liegt rechts der Schleife und überlappt den Knoten nicht', () => {
		const host = { x: 40, y: 60, w: 100, h: 40 };
		const d = doc({
			nodes: [node('A')],
			edges: [edge('e1', 'A', 'A', { label: 'ein recht langes Label' })]
		});
		const svg = editorSvg(d, { A: [host.x, host.y, host.w, host.h] }, { measure });
		const [box] = labelBoxes(svg);
		expect(box).toBeDefined();
		expect(box.x).toBeGreaterThanOrEqual(host.x + host.w + 40);
		expect(overlaps(box, host)).toBe(false);
		const [vx, , vw] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);
		expect(vx + vw).toBeGreaterThanOrEqual(box.x + box.w);
	});

	it('mehrere Selbstkanten am selben Knoten: verschiedene Pfade, gestaffelte Labels', () => {
		const d = doc({
			nodes: [node('A'), node('B')],
			edges: [
				edge('e1', 'A', 'A', { label: 'eins' }),
				edge('e2', 'A', 'B'),
				edge('e3', 'A', 'A', { label: 'zwei' }),
				edge('e4', 'A', 'A', { label: 'drei' }),
				edge('e5', 'B', 'B', { label: 'B' })
			]
		});
		const svg = editorSvg(d, { A: [40, 60, 100, 40], B: [40, 200, 100, 40] }, { measure });
		const paths = [...svg.matchAll(/<g class="edge"><path d="([^"]+)"/g)].map((m) => m[1]);
		expect(paths).toHaveLength(5);
		const loopsA = [paths[0], paths[2], paths[3]];
		expect(new Set(loopsA).size).toBe(3);
		const boxes = labelBoxes(svg);
		expect(boxes).toHaveLength(4);
		const [a1, a2, a3, b] = boxes;
		expect(a1.x).toBeLessThan(a2.x);
		expect(a2.x).toBeLessThan(a3.x);
		expect(overlaps(a1, a2) || overlaps(a2, a3) || overlaps(a1, a3)).toBe(false);
		// Index zählt je Knoten: erste Schleife an B wie erste an A.
		expect(b.x).toBe(a1.x);
	});

	it('jedes Kantenlabel steht hinter jedem Kantenpfad (kein Pfad überdeckt ein Label)', () => {
		const d = doc({
			nodes: [node('A'), node('B')],
			edges: [
				edge('e1', 'A', 'A', { label: 'eins' }),
				edge('e2', 'A', 'B', { label: 'quer' }),
				edge('e3', 'A', 'A', { label: 'zwei' }),
				edge('e4', 'A', 'A', { label: 'drei' })
			]
		});
		const svg = editorSvg(d, { A: [40, 60, 100, 40], B: [300, 60, 100, 40] }, { measure });
		const pathAt = [...svg.matchAll(/<g class="edge">/g)].map((m) => m.index);
		const labelAt = [...svg.matchAll(/<g class="edge-label">/g)].map((m) => m.index);
		expect(pathAt).toHaveLength(4);
		expect(labelAt).toHaveLength(4);
		expect(Math.min(...labelAt)).toBeGreaterThan(Math.max(...pathAt));
	});

	it('leeres Modell ergibt gültiges leeres SVG', () => {
		expect(editorSvg(doc(), {}, { measure })).toContain('viewBox="0 0 0 0"');
	});

	it('nicht-endliche Geometrie zählt als 0, keine NaN im Ergebnis', () => {
		const d = doc({ nodes: [node('A'), node('B')], edges: [edge('e1', 'A', 'B')] });
		const svg = editorSvg(
			d,
			{ A: [NaN, Infinity, -5, 20], B: [100, -0, 40, 20] },
			{ measure, edgeKind: 'straight' }
		);
		expect(svg).not.toMatch(/NaN|Infinity/);
	});

	it.each(['bezier', 'smoothstep', 'straight'] as const)(
		'Kantenart %s: Pfad und Marker in allen Richtungen',
		(edgeKind) => {
			const d = doc({
				nodes: [node('M'), node('L'), node('R'), node('T'), node('U')],
				edges: [
					edge('e1', 'M', 'R'),
					edge('e2', 'M', 'L', { arrowHead: 'double_arrow' }),
					edge('e3', 'M', 'T', { arrowHead: 'cross' }),
					edge('e4', 'M', 'U', { arrowHead: 'none', lineStyle: 'thick' })
				]
			});
			const g = {
				M: [100, 100, 40, 20],
				L: [0, 100, 40, 20],
				R: [200, 100, 40, 20],
				T: [100, 0, 40, 20],
				U: [100, 200, 40, 20]
			} as Record<string, [number, number, number, number]>;
			const svg = editorSvg(d, g, { measure, edgeKind });
			expect(svg.match(/class="edge"/g)).toHaveLength(4);
			expect(svg.match(/class="marker"/g)).toHaveLength(4);
			expect(svg).toContain('fill="none" stroke="#333333" stroke-width="1.5"');
			expect(svg).toContain('stroke-width="3.5"');
		}
	);

	it('Kantenlabel mit Hintergrund; Container vor Kindern gezeichnet', () => {
		const d = doc({
			nodes: [node('A'), node('B')],
			edges: [edge('e1', 'A', 'B', { label: 'ja<br>nein' })],
			containers: [container('Inner', 'innen', 'Outer'), container('Outer', 'außen')]
		});
		const svg = editorSvg(
			d,
			{
				A: [0, 0, 40, 20],
				B: [200, 0, 40, 20],
				Inner: [10, 10, 100, 50],
				Outer: [0, 0, 300, 100]
			},
			{ measure }
		);
		expect(svg.indexOf('>außen<')).toBeLessThan(svg.indexOf('>innen<'));
		expect(svg).toContain('class="edge-label"');
		expect(svg).toContain('>ja</tspan>');
		expect(svg).toContain('>nein</tspan>');
	});

	it('Zyklus in parentId bricht nicht ab', () => {
		const d = doc({ containers: [container('X', 'x', 'Y'), container('Y', 'y', 'X')] });
		const svg = editorSvg(d, { X: [0, 0, 10, 10], Y: [0, 0, 20, 20] }, { measure });
		expect(svg.match(/class="container"/g)).toHaveLength(2);
	});

	describe('feindliche Labels und IDs', () => {
		const hostile = [
			'"><script>alert(1)</script>',
			'url(https://evil.example/x.png)',
			'<image href="https://evil.example/x"/>',
			'<foreignObject><div>x</div></foreignObject>',
			'%% @mermuid: {"v":1}',
			'&lt;b&gt;'
		];
		const d = doc({
			title: hostile[0],
			nodes: hostile.map((label, i) => node(`${hostile[i]}#${i}`, label)),
			edges: [edge(hostile[1], `${hostile[0]}#0`, `${hostile[1]}#1`, { label: hostile[2] })],
			containers: [container(hostile[3], hostile[4])]
		});
		const g = Object.fromEntries(
			[...d.nodes.map((n) => n.id), hostile[3]].map((id, i) => [id, [i * 50, 0, 1000, 30]])
		) as Record<string, [number, number, number, number]>;
		const svg = editorSvg(d, g, { measure });

		it('keine Tags, keine externen Referenzen, kein url(', () => {
			expect(svg).not.toContain('<script');
			expect(svg).not.toContain('<image');
			expect(svg).not.toContain('<foreignObject');
			expect(svg).not.toContain('url(');
			expect(svg).not.toContain('@mermuid');
			expect(svg).not.toMatch(/\s(?:xlink:)?href="|<style|\sstyle="/i);
			expect(svg).not.toContain('evil.example/x.png)');
		});

		it('nur erlaubte Elemente und Attribute', () => {
			const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]));
			expect([...tags].sort()).toEqual(['g', 'path', 'rect', 'svg', 'text', 'title', 'tspan']);
			const attrs = new Set([...svg.matchAll(/\s([a-zA-Z-]+)="/g)].map((m) => m[1]));
			for (const a of attrs) expect(a).toMatch(/^(?!on)[a-z-]+$|^viewBox$/);
		});

		it('Text bleibt als Text lesbar (maskiert)', () => {
			expect(svg).toContain('&quot;&gt;&lt;script&gt;alert&#40;1&#41;&lt;/script&gt;');
			expect(svg).toContain('&amp;lt;b&amp;gt;');
		});
	});
});

describe('editorSvg: Palette', () => {
	it('Theme-Farben und Hintergrund über die ganze viewBox', () => {
		const svg = editorSvg(sample(), geometry, {
			measure,
			palette: { nodeFill: '#1d2232', text: '#e6e9f2', background: '#0d0f14' }
		});
		expect(svg).toContain('fill="#1d2232"');
		expect(svg).toContain('fill="#e6e9f2"');
		expect(svg).toContain('<rect x="20" y="0" width="500" height="150" fill="#0d0f14"/>');
		expect(svg).not.toContain(`fill="${DEFAULT_PALETTE.nodeFill}"`);
	});

	it('unzulässige Farbwerte fallen auf die Standard-Palette zurück', () => {
		const p = safePalette({
			nodeFill: 'url(#x)',
			text: 'red" onload="x',
			line: 'rgb(1, 2, 3)',
			background: 'javascript:1'
		});
		expect(p.nodeFill).toBe(DEFAULT_PALETTE.nodeFill);
		expect(p.text).toBe(DEFAULT_PALETTE.text);
		expect(p.line).toBe('rgb(1, 2, 3)');
		expect(p.background).toBeUndefined();
		const svg = editorSvg(sample(), geometry, { measure, palette: { line: 'rgb(1, 2, 3)' } });
		expect(svg).not.toMatch(/url\(|rgb\(/);
		expect(svg).toContain('stroke="rgb&#40;1, 2, 3&#41;"');
	});
});

describe('editorSvg: Auswahl', () => {
	it('nur ausgewählte Knoten, Kanten nur mit beiden Enden, viewBox enger', () => {
		const svg = editorSvg(sample(), geometry, { measure, only: new Set(['A', 'C']) });
		expect(svg).not.toContain('Prüfen');
		expect(svg).not.toContain('class="container"');
		expect(svg.match(/class="node"/g)).toHaveLength(2);
		// e1 (A->B) und e2 (B->C) entfallen, e3 ist unsichtbar.
		expect(svg).not.toContain('class="edge"');
		expect(svg).not.toContain('>ok<');
	});

	it('ausgewählter Container bringt seinen Inhalt mit', () => {
		const svg = editorSvg(sample(), geometry, { measure, only: new Set(['S']) });
		expect(svg).toContain('class="container"');
		expect(svg).toContain('Prüfen');
		expect(svg.match(/class="node"/g)).toHaveLength(1);
		expect(svg).toContain('viewBox="180 0 160 150"');
	});
});

describe('editorSvg: Stile (V-06, gleiche resolveStyle-Werte wie der Canvas)', () => {
	const classDefs: ClassDef[] = [
		{
			name: 'rot',
			style: { fill: '#ff0000', stroke: '#990000', 'stroke-width': '3px' },
			sourceText: ''
		},
		{ name: 'default', style: { stroke: '#123456' }, sourceText: '' }
	];
	const styled = (id: string, extra: Partial<DiagramNode>): DiagramNode => ({
		...node(id),
		...extra
	});
	const d = doc({
		nodes: [
			styled('A', { style: { fill: '#00aa00' } }),
			styled('B', { cssClasses: ['rot'] }),
			styled('C', { style: { fill: 'url(#x)', stroke: 'expression(1)' } }),
			styled('D', { style: { fill: 'rgb(1, 2, 3)', color: '#abcdef', 'stroke-dasharray': '4,2' } }),
			node('E')
		],
		edges: [
			edge('e1', 'A', 'B'),
			edge('e2', 'B', 'C', {
				label: 'x',
				style: {
					stroke: '#0000ff',
					'stroke-width': '2px',
					'stroke-dasharray': '5 5',
					color: '#00ff00'
				}
			}),
			edge('e3', 'C', 'D', { style: { stroke: 'url(#evil)' } })
		],
		containers: [container('S', 'Gruppe')],
		classDefs
	});
	const g = {
		A: [0, 0, 60, 40],
		B: [100, 0, 60, 40],
		C: [200, 0, 60, 40],
		D: [300, 0, 60, 40],
		E: [400, 0, 60, 40],
		S: [0, 100, 200, 100]
	} as Record<string, [number, number, number, number]>;
	const svg = editorSvg(d, g, { measure });
	const groups = (cls: string) => svg.split(`<g class="${cls}"`).slice(1);
	const nodeSvg = (i: number) => groups('node')[i];
	const edgeSvg = (i: number) => groups('edge')[i];

	it('style A fill:#00aa00 färbt den Knoten, Textfarbe aus der Füllung', () => {
		const a = nodeSvg(0);
		expect(a).toContain('fill="#00aa00"');
		expect(a).toContain(`stroke="#123456"`);
		expect(a).toContain(`<text text-anchor="middle"`);
		expect(a).toMatch(/<text [^>]*fill="#000000"/);
	});

	it('classDef/class: Füllung, Rand, Stärke wie resolveStyle', () => {
		const r = resolveStyle(d.nodes[1].style, d.nodes[1].cssClasses, classDefs);
		const b = nodeSvg(1);
		expect(b).toContain(`fill="${r.fill}"`);
		expect(b).toContain(`stroke="${r.stroke}"`);
		expect(b).toContain(`stroke-width="${r.strokeWidth}"`);
		expect(b).toMatch(new RegExp(`<text [^>]*fill="${textColor(r)}"`));
	});

	it('url(- und expression-Werte landen nicht im SVG, Palette greift', () => {
		expect(svg).not.toContain('url(');
		expect(svg).not.toContain('url&#40;');
		expect(svg).not.toContain('expression');
		expect(nodeSvg(2)).toContain(`fill="${DEFAULT_PALETTE.nodeFill}"`);
		expect(nodeSvg(2)).toMatch(new RegExp(`<text [^>]*fill="${DEFAULT_PALETTE.text}"`));
	});

	it('rgb()-Wert maskiert, eigene Textfarbe und Strichmuster', () => {
		const n = nodeSvg(3);
		expect(n).toContain('fill="rgb&#40;1, 2, 3&#41;"');
		expect(n).toContain('stroke-dasharray="4 2"');
		expect(n).toMatch(/<text [^>]*fill="#abcdef"/);
	});

	it('Knoten ohne Stil bekommt classDef default, sonst Palette', () => {
		const e = nodeSvg(4);
		expect(e).toContain(`fill="${DEFAULT_PALETTE.nodeFill}"`);
		expect(e).toContain('stroke="#123456"');
		expect(e).toContain('stroke-width="1"');
		expect(e).not.toContain('stroke-dasharray');
	});

	it('linkStyle färbt Kantenpfad, Marker und Label (M-19)', () => {
		const e2 = edgeSvg(1);
		expect(e2).toMatch(
			/<path d="[^"]+" fill="none" stroke="#0000ff" stroke-width="2" stroke-dasharray="5 5"\/>/
		);
		expect(e2).toMatch(/class="marker"[^>]*stroke="#0000ff"/);
		expect(svg).toMatch(/<g class="edge-label">.*?<text [^>]*fill="#00ff00"/);
		const e1 = edgeSvg(0);
		expect(e1).toContain(`stroke="${DEFAULT_PALETTE.line}"`);
		expect(e1).toMatch(/<path d="[^"]+" fill="none" stroke="#333333" stroke-width="2"\/>/);
	});

	it('unzulässiger linkStyle-Wert fällt auf die Palette zurück', () => {
		expect(edgeSvg(2)).toContain(`stroke="${DEFAULT_PALETTE.line}"`);
	});

	it('Container: Stil des ID-Knotens, ohne classDef default', () => {
		const plain = groups('container')[0];
		expect(plain).toContain(`stroke="${DEFAULT_PALETTE.containerStroke}"`);
		const withNode = doc({
			nodes: [styled('S', { style: { fill: '#000000', 'stroke-width': '4' } })],
			containers: [container('S', 'Gruppe')],
			classDefs
		});
		const c = editorSvg(withNode, { S: [0, 0, 200, 100] }, { measure, only: new Set(['S']) })
			.split('<g class="container"')[1]
			.split('</g>')[0];
		expect(c).toContain('fill="#000000"');
		expect(c).toContain(`stroke="${DEFAULT_PALETTE.containerStroke}"`);
		expect(c).toContain('stroke-width="4"');
		expect(c).toMatch(/<text [^>]*fill="#ffffff"/);
	});

	it('Knoten mit Container-ID wird nicht zusätzlich gezeichnet, Kante bleibt (wie Canvas)', () => {
		const same = doc({
			nodes: [styled('S', { style: { fill: '#000000' } }), node('B')],
			edges: [edge('e1', 'S', 'B')],
			containers: [container('S', 'Gruppe')]
		});
		const out = editorSvg(same, { S: [0, 0, 200, 100], B: [300, 20, 60, 40] }, { measure });
		const nodes = out.split('<g class="node"').slice(1);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toContain('translate(300 20)');
		expect(out.split('<g class="container"').slice(1)).toHaveLength(1);
		expect(out.split('<g class="edge"').slice(1)).toHaveLength(1);
	});
});
