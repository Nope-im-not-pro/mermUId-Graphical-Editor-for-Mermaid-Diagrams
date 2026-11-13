/**
 * Rückrechnung einer von mermaid gemeldeten Zeile auf die Zeile im Originaltext. mermaid
 * entfernt vor dem Parsen Frontmatter, Direktiven, Kommentarzeilen und führenden Leerraum
 * (`preprocessDiagram` in mermaid 12.2.0); `hash.loc` bezieht sich auf diesen bereinigten Text.
 */

/** Text mit Originalzeile je Zeichen. */
interface Mapped {
	text: string;
	lines: number[];
}

/** mermaid `directiveRegex` und `cleanupComments`. */
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
const COMMENT = /^\s*%%(?!{)[^\n]+\n?/gm;
const WS = /\s/;

/** CRLF und CR werden LF (mermaid `cleanupText`). */
function normalize(text: string): Mapped {
	let out = '';
	const lines: number[] = [];
	let line = 1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '\r' && text[i + 1] === '\n') continue;
		out += ch === '\r' ? '\n' : ch;
		lines.push(line);
		if (ch === '\n' || ch === '\r') line++;
	}
	return { text: out, lines };
}

function dropPrefix(src: Mapped, length: number): Mapped {
	return { text: src.text.slice(length), lines: src.lines.slice(length) };
}

function dropMatches(src: Mapped, re: RegExp): Mapped {
	let text = '';
	const lines: number[] = [];
	let last = 0;
	for (const m of src.text.matchAll(re)) {
		text += src.text.slice(last, m.index);
		lines.push(...src.lines.slice(last, m.index));
		last = m.index + m[0].length;
	}
	lines.push(...src.lines.slice(last));
	return { text: text + src.text.slice(last), lines };
}

/** Letzter Zeilenumbruch in der Leerraum-Folge ab `from`, sonst -1. */
function lastBreak(text: string, from: number): number {
	let index = -1;
	for (let i = from; i < text.length && WS.test(text[i]); i++) if (text[i] === '\n') index = i;
	return index;
}

/** Länge des Frontmatter-Präfixes (Port von mermaid `matchFrontMatter`), sonst 0. */
function frontmatterLength(text: string): number {
	let cursor = 0;
	while (cursor < text.length && WS.test(text[cursor]) && text[cursor] !== '\n') cursor++;
	if (!text.startsWith('---', cursor)) return 0;
	const openingEnds: number[] = [];
	for (let i = cursor + 3; i < text.length && WS.test(text[i]); i++) {
		if (text[i] === '\n') openingEnds.push(i);
	}
	if (openingEnds.length === 0) return 0;
	const fence = `${text.slice(0, cursor)}---`;
	const closingEnd = (i: number) =>
		text[i] === '\n' && text.startsWith(fence, i + 1) ? lastBreak(text, i + 1 + fence.length) : -1;
	let lastClosing = -1;
	for (let i = openingEnds[0] + 1; i < text.length; i++) if (closingEnd(i) !== -1) lastClosing = i;
	if (lastClosing === -1) return 0;
	const openingEnd = openingEnds.filter((end) => end < lastClosing).at(-1) ?? openingEnds[0];
	for (let i = openingEnd + 1; i <= lastClosing; i++) {
		const end = closingEnd(i);
		if (end !== -1) return end + 1;
	}
	return 0;
}

/** Originalzeile zu Zeile `cleanedLine` (1-basiert) des von mermaid bereinigten Texts. */
export function originLine(code: string, cleanedLine: number): number {
	let src = normalize(code);
	src = dropPrefix(src, frontmatterLength(src.text));
	src = dropMatches(dropMatches(src, DIRECTIVE), COMMENT);
	src = dropPrefix(src, src.text.length - src.text.trimStart().length);
	let line = 1;
	for (let i = 0; i < src.text.length; i++) {
		if (line === cleanedLine) return src.lines[i];
		if (src.text[i] === '\n') line++;
	}
	const base = src.lines.at(-1) ?? 1;
	return base + cleanedLine - line + (src.text.endsWith('\n') ? 1 : 0);
}
