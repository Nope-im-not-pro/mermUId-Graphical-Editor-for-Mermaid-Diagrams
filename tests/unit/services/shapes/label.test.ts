import { describe, expect, it } from 'vitest';
import { wrapLabel } from '../../../../src/lib/services/shapes';

/** Deterministischer Stub: 10 px je Zeichen (Codepunkte). */
const measure = (s: string) => Array.from(s).length * 10;

describe('wrapLabel', () => {
	it('leerer Text und reiner Leerraum ergeben eine leere Zeile', () => {
		expect(wrapLabel('', 100, measure)).toEqual(['']);
		expect(wrapLabel('   \t ', 100, measure)).toEqual(['']);
		expect(wrapLabel('<br>', 100, measure)).toEqual(['']);
	});

	it('passt in eine Zeile', () => {
		expect(wrapLabel('Hallo Welt', 100, measure)).toEqual(['Hallo Welt']);
	});

	it('bricht an Leerraum um und fasst Leerraum zusammen', () => {
		expect(wrapLabel('a b c', 30, measure)).toEqual(['a b', 'c']);
		expect(wrapLabel('  eins   zwei\tdrei ', 90, measure)).toEqual(['eins zwei', 'drei']);
	});

	it('beachtet harte Umbrüche', () => {
		for (const t of ['a\nb', 'a\r\nb', 'a\rb', 'a<br>b', 'a<br/>b', 'a<br />b', 'a<BR>b']) {
			expect(wrapLabel(t, 100, measure)).toEqual(['a', 'b']);
		}
	});

	it('erzeugt keine leeren Zeilen', () => {
		expect(wrapLabel('a\n\n<br>b\n', 100, measure)).toEqual(['a', 'b']);
	});

	it('teilt überlange Wörter zeichenweise', () => {
		expect(wrapLabel('abcdefg', 30, measure)).toEqual(['abc', 'def', 'g']);
		expect(wrapLabel('xy abcdefg hi', 30, measure)).toEqual(['xy', 'abc', 'def', 'g', 'hi']);
		expect(wrapLabel('abcdefg h', 30, measure)).toEqual(['abc', 'def', 'g h']);
		expect(wrapLabel('äöüß', 20, measure)).toEqual(['äö', 'üß']);
	});

	it('mindestens ein Zeichen je Zeile bei zu kleiner Breite', () => {
		expect(wrapLabel('ab c', 0, measure)).toEqual(['a', 'b', 'c']);
	});

	it('ist deterministisch', () => {
		const t = 'Ein etwas längerer Text<br/>mit Umbruch und Überlangwortxyz';
		expect(wrapLabel(t, 70, measure)).toEqual(wrapLabel(t, 70, measure));
	});

	it('teilt nach Graphemen: kombinierende Zeichen und ZWJ-Sequenzen bleiben ganz', () => {
		const e = 'e\u0301';
		expect(wrapLabel(e + e, 10, measure)).toEqual([e, e]);
		const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
		expect(wrapLabel(family + family + 'a', 10, () => 1000)).toEqual([family, family, 'a']);
	});

	it('200000 Zeichen mit stets zu breiter Messung: kein Wurf, eine Zeile je Zeichen', () => {
		const lines = wrapLabel('x'.repeat(200000), 10, () => 1000);
		expect(lines).toHaveLength(200000);
		expect(lines.every((l) => l === 'x')).toBe(true);
	});
});

/** Laufzeit von `run` in ms. */
function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

describe('wrapLabel linear (P2)', () => {
	// Verhältnis statt absoluter Zeit (Parallel-Last schwankt stark, trifft beide Größen ähnlich).
	// 16-fache Eingabe: linear etwa Faktor 16, quadratisch 256; Grenze 64 = Exponent 1,5.
	// Warmlauf, Messungen im Wechsel klein/groß, je Größe das Minimum; die kleine öfter.
	it('16-fache Eingabe (bis 200000 Zeichen) < 64-fache Zeit', () => {
		const small = 'x'.repeat(12500);
		const large = 'x'.repeat(200000);
		const tooWide = () => 1000;
		wrapLabel(small, 10, tooWide);
		wrapLabel(large, 10, tooWide);
		const tSmall: number[] = [];
		const tLarge: number[] = [];
		for (let i = 0; i < 3; i++) {
			for (let k = 0; k < 4; k++) tSmall.push(timed(() => wrapLabel(small, 10, tooWide)));
			tLarge.push(timed(() => wrapLabel(large, 10, tooWide)));
		}
		expect(Math.min(...tLarge) / Math.min(...tSmall)).toBeLessThan(64);
	}, 30000);
});
