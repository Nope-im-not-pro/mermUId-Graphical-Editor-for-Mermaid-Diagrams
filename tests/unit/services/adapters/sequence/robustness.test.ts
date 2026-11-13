import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../../../../../src/lib/services/adapters/sequence';
import { MAX_LINE } from '../../../../../src/lib/services/adapters/sequence/syntax';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

/** Zeilen mit langen Leerraum-Läufen, die überlappende Quantoren auslösen würden. */
function hostile(n: number): string[] {
	const sp = ' '.repeat(n);
	return [
		`Note over ${sp}x`,
		`Note over x${sp}y`,
		`participant A${sp}x`,
		`participant A${sp}as${sp}`,
		`activate A${sp}:`,
		`A${sp}x`,
		`A${sp}->>${sp}B${sp},:x`,
		`A-x-x-x${sp}B:${sp}`,
		`title${sp}x${sp}y`,
		`loop a${sp}b`,
		`else a${sp}b`,
		// `:`, `\S`-Lauf und `#` im Wechsel (kubisch für `style.*:\S*#.*;`).
		'style:x#'.repeat(Math.max(1, Math.floor(n / 8))),
		`A->>B: ${'classDef:x#'.repeat(Math.max(1, Math.floor(n / 11)))}`
	];
}

/** Laufzeit von `run` in ms. */
function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

/**
 * Zeitfaktor groß/klein (Vorlage fix-e2): Warmlauf je Größe, 5 Runden im Wechsel (je 4x klein,
 * 1x groß), je Größe das Minimum (filtert Last-Spitzen und GC-Pausen).
 */
function growth(small: () => void, large: () => void): number {
	small();
	large();
	const tSmall: number[] = [];
	const tLarge: number[] = [];
	for (let i = 0; i < 5; i++) {
		for (let k = 0; k < 4; k++) tSmall.push(timed(small));
		tLarge.push(timed(large));
	}
	return Math.min(...tLarge) / Math.min(...tSmall);
}

describe('Laufzeit der Zeilen-Regexe', () => {
	// Verhältnis statt absoluter Zeit: Die Grenze 50 ms lag unter Gesamtlast nur Faktor 2 bis 3
	// über der Messung, beide Größen werden aber ähnlich gebremst. Je Paar 16-fache Länge mit
	// eigener Grenze. Regex-Pfad bis MAX_LINE: linear 8 bis 10 (Grundlast überwiegt), Grenze 32;
	// quadratisches Backtracking ergab in der Probe 98 bis 140, absolut aber nur etwa 6 ms, daher keine
	// Absolutgrenze. RawBlock-Pfad oberhalb MAX_LINE: linear 15 bis 36, Grenze 128 = Exponent
	// 1,75; quadratisch etwa 256 (Probe 285 bis 328).
	it.each([
		[122, MAX_LINE - 40, 32],
		[20000, 320000, 128]
	])('%i auf %i Leerzeichen je Zeile: 16-fache Länge < %i-fache Zeit', (a, b, bound) => {
		const small = hostile(a);
		const large = hostile(b);
		for (let i = 0; i < large.length; i++) {
			const s = `sequenceDiagram\n    ${small[i]}\n`;
			const text = `sequenceDiagram\n    ${large[i]}\n`;
			expect(
				growth(
					() => parse(s),
					() => parse(text)
				),
				large[i].slice(0, 20)
			).toBeLessThan(bound);
			const result = parse(text);
			if (result.ok) expect(serialize(result.doc)).toBe(text);
		}
	});

	it('legt zu lange Statement-Zeilen byte-gleich als RawBlock ab', () => {
		const text = `sequenceDiagram\n    A->>B: ${'x'.repeat(MAX_LINE)}\n`;
		const doc = ok(text);
		expect(doc.edges).toHaveLength(0);
		expect(doc.rawBlocks.map((r) => r.rawText)).toEqual([`    A->>B: ${'x'.repeat(MAX_LINE)}\n`]);
		expect(serialize(doc)).toBe(text);
	});

	it('erkennt Blockzeilen auch oberhalb der Längenschranke', () => {
		const label = 'x'.repeat(MAX_LINE);
		const doc = ok(`sequenceDiagram\n    loop ${label}\n    end\n`);
		expect(doc.containers.map((c) => c.label)).toEqual([label]);
	});
});
