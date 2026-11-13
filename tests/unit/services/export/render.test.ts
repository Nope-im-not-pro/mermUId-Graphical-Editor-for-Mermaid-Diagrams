// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { exportSvg } from '../../../../src/lib/services/export/source';
import { doc, edge, measure, node } from './fixtures';

beforeAll(() => {
	const proto = SVGElement.prototype as unknown as Record<string, unknown>;
	proto.getBBox = function (this: Element) {
		return { x: 0, y: 0, width: (this.textContent ?? '').length * 8, height: 16 };
	};
	proto.getComputedTextLength = function (this: Element) {
		return (this.textContent ?? '').length * 8;
	};
});

const LABEL = '"><script>x</script> url(https://evil.example/a) @mermuid';
const CODE =
	'flowchart LR\n  A["#quot;><script>x</script> url(https://evil.example/a) @mermuid"] --> B\n' +
	'%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[0,0,40,20]}}\n';

describe('exportSvg mit echtem renderSvg (beide Quellen)', () => {
	const d = doc({
		title: 'T',
		nodes: [node('A', LABEL), node('B')],
		edges: [edge('e1', 'A', 'B')]
	});
	const geometry = { A: [0, 0, 400, 20], B: [500, 0, 40, 20] } as Record<
		string,
		[number, number, number, number]
	>;

	it.each(['editor', 'mermaid'] as const)(
		'%s: kein @mermuid, kein foreignObject, <title>',
		async (source) => {
			const result = await exportSvg({ doc: d, code: CODE, geometry, measure, source });
			if (!result.ok) throw new Error(result.error.message);
			expect(result.source).toBe(source);
			expect(result.svg).toContain('<title>T</title>');
			expect(result.svg.toLowerCase()).not.toContain('@mermuid');
			expect(result.svg).not.toMatch(/<foreignObject/i);
			expect(result.svg).not.toContain('<script');
			// Externe Verweise nur in Attributen und <style> wirksam; Label-Text bleibt Text.
			expect(result.svg).not.toMatch(/="[^"]*url\((?!#)/i);
			expect(result.svg).not.toMatch(/<style[^>]*>[^<]*url\((?!#)/i);
			if (source === 'editor') expect(result.svg).not.toMatch(/url\((?!#)/i);
		},
		30000
	);
});
