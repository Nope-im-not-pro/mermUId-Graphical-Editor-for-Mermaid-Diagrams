// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pathPoints, sequenceSvg } from '../../../../src/lib/services/export/sequence';
import { textMeasure, toSequence } from '../../../../src/lib/views/canvas/sequence/mapping';
import { parseOk, SAMPLE } from '../../views/canvas-sequence/helpers';

const scene = (text = SAMPLE) => toSequence(parseOk(text), [], textMeasure);

describe('pathPoints', () => {
	it('liest M/H/V-Pfade der Canvas-Nachrichten', () => {
		expect(pathPoints('M 10 20 H 50')).toEqual([
			[10, 20],
			[50, 20]
		]);
		expect(pathPoints('M 0 4 H 30 V 18 H 0')).toEqual([
			[0, 4],
			[30, 4],
			[30, 18],
			[0, 18]
		]);
		expect(pathPoints('M x y H 3')).toEqual([]);
	});
});

describe('sequenceSvg', () => {
	it('deterministisch, parsebar, mit Titel und viewBox der Szene', () => {
		const s = scene();
		const svg = sequenceSvg(s, { title: 'Ablauf' });
		expect(sequenceSvg(scene(), { title: 'Ablauf' })).toBe(svg);
		expect(svg).toContain('<title>Ablauf</title>');
		expect(svg).toContain(`viewBox="${s.minX} ${s.minY} ${s.width} ${s.height}"`);
		const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
		expect(doc.querySelector('parsererror')).toBeNull();
		expect(doc.documentElement.nodeName).toBe('svg');
	});

	it('zeichnet Teilnehmer, Lebenslinien, Nachrichten, Notiz, Block, Section, Balken', () => {
		const svg = sequenceSvg(scene());
		expect(svg).toContain('>Alice</text>');
		expect(svg.match(/class="lifeline"/g)).toHaveLength(2);
		expect(svg.match(/class="message"/g)).toHaveLength(3);
		expect(svg).toContain('stroke-dasharray="4 3"');
		expect(svg).toContain('class="note"');
		expect(svg).toContain('>alt [Fall]</text>');
		expect(svg).toContain('>else [Sonst]</text>');
		expect(svg).toContain(' rx="12"');
		// Aktivierungs-Marken des Canvas sind Bedienelemente und fehlen.
		expect(svg).not.toContain('activate');
	});

	it('nur feste Elemente, keine Verweise, Label-Text maskiert', () => {
		const svg = sequenceSvg(
			scene(
				'sequenceDiagram\n  participant A\n  participant B\n  A->>B: x <b>"@mermuid"</b> url(y)\n'
			)
		);
		expect(svg).not.toMatch(/<(?!\/?(svg|title|g|path|rect|text)[\s>/])/);
		expect(svg).not.toMatch(/url\(|@mermuid|href|marker-end|<b>/);
	});

	it('Palette und Hintergrund', () => {
		const svg = sequenceSvg(scene(), {
			palette: { nodeFill: '#1d2232', noteFill: '#3a3320', background: '#0d0f14' }
		});
		expect(svg).toContain('fill="#1d2232"');
		expect(svg).toContain('fill="#3a3320"');
		expect(svg).toMatch(/<title>Diagramm<\/title><rect [^>]*fill="#0d0f14"\/>/);
	});
});
