import { describe, expect, it } from 'vitest';
import { editorSvg } from '../../../../src/lib/services/export/svg';
import { labelArea } from '../../../../src/lib/services/shapes';
import { doc, measure, node } from './fixtures';

// T138 C2 I2, Befund 2: Export-Text liegt in der Label-Fläche der Form (wie ShapeNode im Canvas).

const W = 120;
const H = 80;
const NODE_PADDING = 8;

function firstSpan(svg: string) {
	const m = /<tspan x="([^"]+)" y="([^"]+)">/.exec(svg);
	return { x: Number(m?.[1]), y: Number(m?.[2]) };
}

describe('editorSvg: Text in labelArea', () => {
	it.each(['doc', 'delay', 'sl-rect', 'h-cyl', 'lin-cyl'])(
		'%s: Textmitte = Mitte der Label-Fläche',
		(shape) => {
			const svg = editorSvg(
				doc({ nodes: [node('A', 'x', shape)] }),
				{ A: [0, 0, W, H] },
				{ measure }
			);
			const a = labelArea(shape, W, H);
			expect(a.w * a.h).toBeLessThan(W * H);
			const span = firstSpan(svg);
			expect(span.x).toBeCloseTo(a.x + a.w / 2, 1);
			expect(span.y).toBeCloseTo(a.y + a.h / 2, 1);
		}
	);

	it('Umbruch an der Breite der Label-Fläche', () => {
		const label = 'aaaaa bbbbb ccccc';
		const shape = 'delay';
		const a = labelArea(shape, W, H);
		// Ganze Box (104) fasst zwei Wörter je Zeile (11 * 7 = 77), die Label-Fläche nicht.
		expect(a.w - 2 * NODE_PADDING).toBeLessThan(77);
		const box = editorSvg(
			doc({ nodes: [node('A', label, 'square')] }),
			{ A: [0, 0, W, H] },
			{ measure }
		);
		expect(box.match(/<tspan /g)).toHaveLength(2);
		const svg = editorSvg(
			doc({ nodes: [node('A', label, shape)] }),
			{ A: [0, 0, W, H] },
			{ measure }
		);
		expect(svg.match(/<tspan /g)).toHaveLength(3);
	});

	it('Bestandsform: Textmitte = Boxmitte', () => {
		const svg = editorSvg(
			doc({ nodes: [node('A', 'x', 'cylinder')] }),
			{ A: [0, 0, W, H] },
			{ measure }
		);
		expect(firstSpan(svg)).toEqual({ x: W / 2, y: H / 2 });
	});
});
