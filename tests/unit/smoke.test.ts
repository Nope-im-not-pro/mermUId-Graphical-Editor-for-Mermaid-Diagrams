import { describe, expect, it } from 'vitest';
import dagre from '@dagrejs/dagre';

describe('smoke', () => {
	it('rechnet', () => {
		expect(1 + 1).toBe(2);
	});

	it('importiert gepinntes dagre', () => {
		const g = new dagre.graphlib.Graph();
		g.setGraph({});
		g.setDefaultEdgeLabel(() => ({}));
		g.setNode('a', { width: 10, height: 10 });
		g.setNode('b', { width: 10, height: 10 });
		g.setEdge('a', 'b');
		dagre.layout(g);
		expect(g.node('b').y).toBeGreaterThan(g.node('a').y);
	});
});
