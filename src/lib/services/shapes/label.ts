/**
 * Label-Umbruch für Editor und Exporter (D-04 b). Die Textmetrik `measure` wird injiziert
 * (Browser: Canvas `measureText`, Test: deterministischer Stub). Dazu die Label-Fläche je Form.
 */
import { shapeInsets } from './paths';

/** Harte Umbrüche: Zeilenende und `<br>`-Varianten wie mermaid (`<br>`, `<br/>`, `<br />`). */
const HARD_BREAK = /\r\n|\r|\n|<br\s*\/?>/gi;

/** Graphem-Teilung: kombinierende Zeichen und ZWJ-Sequenzen bleiben je Cluster ganz. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Teilt ein Wort graphemweise in Stücke, die `maxWidth` einhalten (mindestens ein Graphem). */
function splitWord(word: string, maxWidth: number, measure: (s: string) => number): string[] {
	const parts: string[] = [];
	let cur = '';
	for (const { segment: ch } of GRAPHEMES.segment(word)) {
		if (cur && measure(cur + ch) > maxWidth) {
			parts.push(cur);
			cur = ch;
		} else {
			cur += ch;
		}
	}
	parts.push(cur);
	return parts;
}

/**
 * Bricht `text` in Zeilen mit Breite <= `maxWidth` um: an Leerraum, harte Umbrüche
 * beachtet, überlange Wörter graphemweise geteilt. Keine leeren Zeilen; leerer Text -> `['']`.
 */
export function wrapLabel(
	text: string,
	maxWidth: number,
	measure: (s: string) => number
): string[] {
	const lines: string[] = [];
	for (const para of text.split(HARD_BREAK)) {
		let line = '';
		for (const word of para.split(/\s+/)) {
			if (!word) continue;
			const candidate = line ? `${line} ${word}` : word;
			if (measure(candidate) <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line);
			const parts = measure(word) <= maxWidth ? [word] : splitWord(word, maxWidth, measure);
			// Schleife statt Spread: Spread sehr vieler Teile wirft RangeError (Argument-Limit).
			for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
			line = parts[parts.length - 1];
		}
		if (line) lines.push(line);
	}
	return lines.length ? lines : [''];
}

/** Rechteck in Box-Koordinaten (Ursprung links oben). */
export type Area = { x: number; y: number; w: number; h: number };

/**
 * Label-Fläche der Form `shape` in der Box `w` x `h`: Box ohne Welle, Rundung, Schräge oder
 * Deckel. Bestandsformen: ganze Box (Label mittig wie bisher).
 */
export function labelArea(shape: string, w: number, h: number): Area {
	const i = shapeInsets(shape, w, h);
	const width = Number.isFinite(w) ? Math.max(0, w) : 0;
	const height = Number.isFinite(h) ? Math.max(0, h) : 0;
	return {
		x: i.left,
		y: i.top,
		w: Math.max(0, width - i.left - i.right),
		h: Math.max(0, height - i.top - i.bottom)
	};
}

/** Schritte der Fixpunkt-Suche in `fitShape` (Ränder wachsen langsamer als die Box). */
const FIT_STEPS = 64;

/**
 * Box, deren Label-Fläche (`labelArea`) mindestens `w` x `h` fasst. Bestandsformen: unverändert.
 * Die Ränder hängen von der Box ab und wachsen langsamer als sie; Fixpunkt-Iteration.
 */
export function fitShape(shape: string, w: number, h: number): { width: number; height: number } {
	let width = w;
	let height = h;
	for (let step = 0; step < FIT_STEPS; step++) {
		const i = shapeInsets(shape, width, height);
		const next = [w + i.left + i.right, h + i.top + i.bottom];
		if (next[0] === width && next[1] === height) break;
		[width, height] = next;
	}
	return { width, height };
}
