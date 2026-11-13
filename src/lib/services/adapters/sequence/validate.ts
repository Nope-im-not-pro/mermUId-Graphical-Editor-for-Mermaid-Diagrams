/**
 * Asynchrone Validierung über `mermaid.parse` (O-15, N-01: nur Paket-Einstieg). Zeile aus
 * `hash.loc.first_line`, Spalte näherungsweise aus `first_column`. mermaid entfernt vor dem Parsen
 * Frontmatter, Direktiven und Kommentarzeilen; die Zeile wird daher auf den Originaltext
 * zurückgerechnet (Vorverarbeitung wie `preprocessDiagram` in mermaid 12).
 */
import { msg } from '../../i18n';
import type { ParseError } from '../../../model/types';
import { diagnose, reportedColumn, reportedLine } from '../diagnostics';

/** Text mit Originalzeile je Zeichen. */
interface Tagged {
	text: string;
	lines: number[];
}

/** Wie `frontMatterRegex` in mermaid 12 (Einrückung erlaubt), Text bereits mit `\n`. */
const FRONTMATTER = /^([^\S\n]*)-{3}\s*\n[\s\S]*?\n\1-{3}\s*\n+/g;
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
const COMMENT = /^\s*%%(?!{)[^\n]+\n?/gm;
const LEADING = /^\s+/g;

function strip(t: Tagged, re: RegExp): Tagged {
	let text = '';
	const lines: number[] = [];
	let last = 0;
	for (const m of t.text.matchAll(re)) {
		text += t.text.slice(last, m.index);
		for (let i = last; i < m.index; i++) lines.push(t.lines[i]);
		last = m.index + m[0].length;
	}
	for (let i = last; i < t.lines.length; i++) lines.push(t.lines[i]);
	return { text: text + t.text.slice(last), lines };
}

function cleaned(text: string): Tagged {
	const normal = text.replace(/\r\n?/g, '\n');
	const lines: number[] = [];
	let line = 1;
	// Je UTF-16-Einheit ein Eintrag: `matchAll`-Indizes zählen UTF-16, nicht Codepoints.
	for (let i = 0; i < normal.length; i++) {
		lines.push(line);
		if (normal[i] === '\n') line++;
	}
	let t: Tagged = { text: normal, lines };
	for (const re of [FRONTMATTER, DIRECTIVE, COMMENT, LEADING]) t = strip(t, re);
	return t;
}

function originalLine(t: Tagged, line: number): number {
	let pos = 0;
	for (let i = 1; i < line; i++) {
		const nl = t.text.indexOf('\n', pos);
		if (nl < 0) return (t.lines[t.lines.length - 1] ?? 0) + line - i;
		pos = nl + 1;
	}
	if (pos < t.lines.length) return t.lines[pos];
	return pos > 0 ? t.lines[pos - 1] + 1 : line;
}

export async function validate(text: string): Promise<ParseError[]> {
	const { default: mermaid } = await import('mermaid');
	try {
		const result = await mermaid.parse(text);
		if (result && result.diagramType !== 'sequence') {
			return [
				{
					line: 1,
					column: 1,
					message: msg('services.validate.notSequence', { type: result.diagramType })
				}
			];
		}
		return [];
	} catch (e) {
		const reported = reportedLine(e);
		const line = originalLine(cleaned(text), Number.isInteger(reported) ? reported : 1);
		return [diagnose(e, line, reportedColumn(e))];
	}
}
