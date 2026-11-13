import { describe, expect, it } from 'vitest';
import { editorSvg } from '../../../../src/lib/services/export/svg';
import { doc, edge, measure, node } from './fixtures';

function input(n: number) {
	const nodes = Array.from({ length: n }, (_, i) => node(`N${i}`, `Knoten ${i}`));
	const edges = Array.from({ length: n - 1 }, (_, i) => edge(`E${i}`, `N${i}`, `N${i + 1}`));
	const geometry = Object.fromEntries(
		nodes.map((x, i) => [x.id, [(i % 100) * 150, Math.floor(i / 100) * 80, 100, 40]])
	) as Record<string, [number, number, number, number]>;
	return { d: doc({ nodes, edges }), geometry };
}

function time(n: number): number {
	const { d, geometry } = input(n);
	const t = performance.now();
	editorSvg(d, geometry, { measure });
	return performance.now() - t;
}

describe('editorSvg Laufzeit (Verhältnis-Messung)', () => {
	it('16-fache Eingabe < 64-fache Zeit (linear)', () => {
		time(1000);
		time(16000);
		const small: number[] = [];
		const large: number[] = [];
		for (let r = 0; r < 3; r++) {
			let s = 0;
			for (let k = 0; k < 4; k++) s += time(1000);
			small.push(s / 4);
			large.push(time(16000));
		}
		expect(Math.min(...large) / Math.min(...small)).toBeLessThan(64);
	}, 30000);
});
