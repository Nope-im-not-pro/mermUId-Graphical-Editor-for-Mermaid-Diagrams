import { describe, expect, it } from 'vitest';
import { changesFor, lineDiff, MAX_D } from '../../../../src/lib/views/panels/code';

/** Text mit etwa `chars` Zeichen und Variante mit jeder 50. Zeile geändert. */
function pair(chars: number): [string, string] {
	const lines: string[] = [];
	for (let i = 0, n = 0; n < chars; i++) {
		const line = `  N${i} --> N${i + 1}`;
		lines.push(line);
		n += line.length + 1;
	}
	const changed = lines.map((l, i) => (i % 50 === 25 ? `${l}x` : l));
	return [lines.join('\n'), changed.join('\n')];
}

function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

/** Text mit festen vier geänderten Zeilen (D konstant): O(N·D) ist dann linear in N. */
function fixed(chars: number): [string, string] {
	const [a] = pair(chars);
	const rows = a.split('\n');
	for (const i of [10, rows.length >> 2, rows.length >> 1, rows.length - 3]) rows[i] += 'x';
	return [a, rows.join('\n')];
}

const RATIO = 32;

/**
 * Wachstums-Exponent log(Zeitverhältnis) / log(Eingabeverhältnis) bei 32-facher Eingabe
 * (Vorlage fix-e2: Verhältnis statt absoluter Zeit). Warmlauf, Messungen im Wechsel, Minimum
 * je Größe; die kleine Eingabe läuft je Messung `RATIO`-mal, damit die Zeitauflösung nicht
 * dominiert. Linear ergibt etwa 1, quadratisch etwa 2.
 */
function exponent(run: (input: [string, string]) => void, rounds: number): number {
	const small = fixed(200000 / RATIO);
	const large = fixed(200000);
	run(small);
	run(large);
	const tSmall: number[] = [];
	const tLarge: number[] = [];
	for (let i = 0; i < rounds; i++) {
		tSmall.push(
			timed(() => {
				for (let k = 0; k < RATIO; k++) run(small);
			}) / RATIO
		);
		tLarge.push(timed(() => run(large)));
	}
	const ratio = Math.min(...tLarge) / Math.max(Math.min(...tSmall), 1e-3);
	const size = large[0].length / small[0].length;
	return Math.log(ratio) / Math.log(size);
}

describe('Zeilen-Diff Laufzeit', () => {
	it('200000 Zeichen: Exponent < 1,6 bei 32-facher Eingabe', () => {
		const large = fixed(200000);
		expect(large[0].length).toBeGreaterThanOrEqual(200000);
		const run = ([a, b]: [string, string]) => {
			lineDiff(a, b);
			changesFor(a, b);
		};
		expect(exponent(run, 9)).toBeLessThan(1.6);
		expect(lineDiff(...large).filter((r) => r.type === 'add')).toHaveLength(4);
	}, 60000);

	it('Messung erkennt quadratisches Verhalten', () => {
		// Absichtlich quadratische Attrappe: jedes Zeilenpaar wird verglichen.
		let sink = 0;
		const quadratic = ([a, b]: [string, string]) => {
			const x = a.split('\n');
			const y = b.split('\n');
			for (const l of x) for (const r of y) if (l.length === r.length) sink++;
		};
		expect(exponent(quadratic, 3)).toBeGreaterThan(1.6);
		expect(sink).toBeGreaterThan(0);
	}, 60000);

	it('Viele Änderungen bei 200000 Zeichen bleiben korrekt', () => {
		const [a, b] = pair(200000);
		const rows = lineDiff(a, b);
		expect(rows.filter((r) => r.type === 'add').length).toBeLessThanOrEqual(MAX_D);
		expect(
			rows
				.filter((r) => r.type !== 'del')
				.map((r) => r.text)
				.join('\n')
		).toBe(b);
	}, 30000);
});
